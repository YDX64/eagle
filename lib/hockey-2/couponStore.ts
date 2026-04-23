/**
 * AWA Stats - Kupon Kayıt & Geçmiş Sistemi
 * localStorage ile kupon kaydetme, yükleme, sonuç takibi
 */

import type { Game } from './api';

export interface SavedBet {
  gameId: number;
  homeTeam: string;
  awayTeam: string;
  betType: string;
  selection: string;
  odds: number;
  trueProbability: number;
  edge: number;
  confidence: number;
  // Sonuç bilgisi
  result?: 'won' | 'lost' | 'pending' | 'void';
  actualScore?: { home: number; away: number };
}

export interface SavedCoupon {
  id: string;
  name: string;
  createdAt: string;
  bets: SavedBet[];
  totalOdds: number;
  stake: number;
  potentialReturn: number;
  riskLevel: string;
  strategyName: string;
  // Sonuç
  status: 'pending' | 'won' | 'lost' | 'partial';
  settledAt?: string;
  actualReturn?: number;
}

const isBrowser = typeof window !== "undefined";
const STORAGE_KEY = 'awa_stats_coupons';

// Tüm kuponları getir
export function getSavedCoupons(): SavedCoupon[] {
  try {
    if (!isBrowser) return [];
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

// Kupon kaydet
export function saveCoupon(coupon: Omit<SavedCoupon, 'id' | 'createdAt' | 'status'>): SavedCoupon {
  const coupons = getSavedCoupons();
  const newCoupon: SavedCoupon = {
    ...coupon,
    id: `coupon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    createdAt: new Date().toISOString(),
    status: 'pending',
    bets: coupon.bets.map(b => ({ ...b, result: 'pending' as const })),
  };
  coupons.unshift(newCoupon);
  if (isBrowser) localStorage.setItem(STORAGE_KEY, JSON.stringify(coupons));

  // ── Tracking bridge: ProBet DB'sine fire-and-forget gönder ──
  // Aynı bets'leri winrate hesaplamasına besler. Hata olursa localStorage
  // üzerinden yine çalışmaya devam eder.
  try {
    void fetch('/api/probet/external-prediction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sport: 'hockey-2',
        source: 'hockey-2',
        fixtureId: newCoupon.bets[0]?.gameId,
        homeTeam: newCoupon.bets[0]?.homeTeam,
        awayTeam: newCoupon.bets[0]?.awayTeam,
        league: (newCoupon.bets[0] as any)?.league || null,
        matchDate: new Date().toISOString(),
        bets: newCoupon.bets.map((b) => ({
          betType: b.betType,
          selection: b.selection,
          odds: b.odds,
          trueProbability: b.trueProbability,
          edge: b.edge,
          confidence: b.confidence,
        })),
        coupon: {
          id: newCoupon.id,
          name: newCoupon.name,
          totalOdds: newCoupon.totalOdds,
          stake: newCoupon.stake,
          potentialReturn: newCoupon.potentialReturn,
          riskLevel: newCoupon.riskLevel,
          strategyName: newCoupon.strategyName,
        },
      }),
    }).catch(() => {
      // Sessizce yut — bridge offline olsa bile uygulama çalışmalı
    });
  } catch {
    // no-op
  }

  return newCoupon;
}

// Kupon sil
export function deleteCoupon(id: string): void {
  if (!isBrowser) return;
  const coupons = getSavedCoupons().filter(c => c.id !== id);
  if (isBrowser) localStorage.setItem(STORAGE_KEY, JSON.stringify(coupons));
}

// Kupon sonuçlarını güncelle (bitmiş maçlara göre)
export function updateCouponResults(finishedGames: Game[]): SavedCoupon[] {
  const coupons = getSavedCoupons();
  let changed = false;

  coupons.forEach(coupon => {
    if (coupon.status === 'won' || coupon.status === 'lost') return; // Zaten sonuçlanmış

    coupon.bets.forEach(bet => {
      if (bet.result !== 'pending') return;

      const game = finishedGames.find(g => g.id === bet.gameId);
      if (!game || game.scores.home === null || game.scores.away === null) return;

      bet.actualScore = { home: game.scores.home, away: game.scores.away };
      bet.result = evaluateBetResult(bet, game);
      changed = true;
    });

    // Kupon durumunu güncelle
    const allSettled = coupon.bets.every(b => b.result !== 'pending');
    if (allSettled) {
      const allWon = coupon.bets.every(b => b.result === 'won');
      const anyWon = coupon.bets.some(b => b.result === 'won');
      coupon.status = allWon ? 'won' : anyWon ? 'partial' : 'lost';
      coupon.settledAt = new Date().toISOString();
      coupon.actualReturn = allWon ? coupon.potentialReturn : 0;
    }
  });

  if (changed) {
    if (isBrowser) localStorage.setItem(STORAGE_KEY, JSON.stringify(coupons));
  }

  return coupons;
}

// Tek bir bahsin sonucunu değerlendir
function evaluateBetResult(bet: SavedBet, game: Game): 'won' | 'lost' | 'void' {
  const homeGoals = game.scores.home ?? 0;
  const awayGoals = game.scores.away ?? 0;
  const totalGoals = homeGoals + awayGoals;

  const betType = bet.betType.toLowerCase();
  const selection = bet.selection;

  // 3Way Result / Match Winner
  if (betType.includes('3way') || betType === 'match winner') {
    if (selection === 'Home') return homeGoals > awayGoals ? 'won' : 'lost';
    if (selection === 'Draw') return homeGoals === awayGoals ? 'won' : 'lost';
    if (selection === 'Away') return awayGoals > homeGoals ? 'won' : 'lost';
  }

  // Home/Away (berabere yok)
  if (betType === 'home/away') {
    if (selection === 'Home') return homeGoals > awayGoals ? 'won' : 'lost';
    if (selection === 'Away') return awayGoals > homeGoals ? 'won' : 'lost';
  }

  // Over/Under
  if (betType.includes('over/under') && !betType.includes('period')) {
    const line = parseFloat(selection.replace('Over ', '').replace('Under ', ''));
    if (selection.startsWith('Over')) return totalGoals > line ? 'won' : 'lost';
    if (selection.startsWith('Under')) return totalGoals < line ? 'won' : 'lost';
  }

  // Period Over/Under
  if (betType.includes('over/under') && betType.includes('period')) {
    // Periyot skorlarını parse et
    const periodNum = betType.includes('1st') || betType.includes('first') ? 1 :
                      betType.includes('2nd') || betType.includes('second') ? 2 :
                      betType.includes('3rd') || betType.includes('third') ? 3 : 0;
    
    let periodGoals = totalGoals; // Fallback
    if (periodNum > 0) {
      const periodStr = periodNum === 1 ? game.periods.first :
                        periodNum === 2 ? game.periods.second :
                        periodNum === 3 ? game.periods.third : null;
      if (periodStr) {
        const parts = periodStr.split('-').map(Number);
        periodGoals = (parts[0] || 0) + (parts[1] || 0);
      }
    }

    const line = parseFloat(selection.replace('Over ', '').replace('Under ', ''));
    if (selection.startsWith('Over')) return periodGoals > line ? 'won' : 'lost';
    if (selection.startsWith('Under')) return periodGoals < line ? 'won' : 'lost';
  }

  // Both Teams To Score
  if (betType.includes('both teams') || betType.includes('btts')) {
    const bothScored = homeGoals > 0 && awayGoals > 0;
    if (selection === 'Yes') return bothScored ? 'won' : 'lost';
    if (selection === 'No') return !bothScored ? 'won' : 'lost';
  }

  // Double Chance
  if (betType.includes('double chance')) {
    if (selection === '1X' || selection === 'Home/Draw') return homeGoals >= awayGoals ? 'won' : 'lost';
    if (selection === 'X2' || selection === 'Draw/Away') return awayGoals >= homeGoals ? 'won' : 'lost';
    if (selection === '12' || selection === 'Home/Away') return homeGoals !== awayGoals ? 'won' : 'lost';
  }

  // Correct Score
  if (betType.includes('correct score') || betType.includes('exact score')) {
    const parts = selection.split(/[-:]/).map(s => parseInt(s.trim()));
    if (parts.length === 2) {
      return homeGoals === parts[0] && awayGoals === parts[1] ? 'won' : 'lost';
    }
  }

  // Handicap
  if (betType.includes('handicap')) {
    const match = selection.match(/(Home|Away)\s*([-+]?\d+\.?\d*)/);
    if (match) {
      const team = match[1];
      const handicap = parseFloat(match[2]);
      if (team === 'Home') {
        return (homeGoals + handicap) > awayGoals ? 'won' : 'lost';
      } else {
        return (awayGoals + handicap) > homeGoals ? 'won' : 'lost';
      }
    }
  }

  // Odd/Even
  if (betType.includes('odd/even') || betType.includes('odd or even')) {
    if (selection === 'Odd') return totalGoals % 2 !== 0 ? 'won' : 'lost';
    if (selection === 'Even') return totalGoals % 2 === 0 ? 'won' : 'lost';
  }

  // Bilinmeyen bahis türü - void
  return 'void';
}

// Standalone bet sonuç değerlendirmesi (MatchDetail sayfası için)
export function evaluateStandaloneBet(
  betType: string,
  selection: string,
  game: Game
): 'won' | 'lost' | 'void' | 'pending' {
  if (game.scores.home === null || game.scores.away === null) return 'pending';
  
  const mockBet: SavedBet = {
    gameId: game.id,
    homeTeam: game.teams.home.name,
    awayTeam: game.teams.away.name,
    betType,
    selection,
    odds: 0,
    trueProbability: 0,
    edge: 0,
    confidence: 0,
  };

  return evaluateBetResult(mockBet, game);
}

// Prediction sonuçlarını değerlendir (Analiz sekmesi için)
export function evaluatePredictionResults(game: Game): {
  matchWinner: { prediction: string; result: 'won' | 'lost' | 'pending' };
  overUnder25: { prediction: string; result: 'won' | 'lost' | 'pending' };
  overUnder35: { prediction: string; result: 'won' | 'lost' | 'pending' };
  overUnder45: { prediction: string; result: 'won' | 'lost' | 'pending' };
  btts: { prediction: string; result: 'won' | 'lost' | 'pending' };
  topScore: { prediction: string; result: 'won' | 'lost' | 'pending' };
} | null {
  if (game.scores.home === null || game.scores.away === null) return null;

  const h = game.scores.home;
  const a = game.scores.away;
  const total = h + a;

  return {
    matchWinner: { prediction: '', result: 'pending' }, // Caller fills prediction
    overUnder25: { prediction: total > 2.5 ? 'Üst 2.5' : 'Alt 2.5', result: 'pending' },
    overUnder35: { prediction: total > 3.5 ? 'Üst 3.5' : 'Alt 3.5', result: 'pending' },
    overUnder45: { prediction: total > 4.5 ? 'Üst 4.5' : 'Alt 4.5', result: 'pending' },
    btts: { prediction: (h > 0 && a > 0) ? 'KG Var' : 'KG Yok', result: 'pending' },
    topScore: { prediction: `${h}-${a}`, result: 'pending' },
  };
}

// İstatistikler
export function getCouponStats(): {
  total: number;
  won: number;
  lost: number;
  partial: number;
  pending: number;
  totalStaked: number;
  totalReturned: number;
  profit: number;
  roi: number;
  winRate: number;
  avgOdds: number;
  bestWin: SavedCoupon | null;
} {
  const coupons = getSavedCoupons();
  const won = coupons.filter(c => c.status === 'won');
  const lost = coupons.filter(c => c.status === 'lost');
  const partial = coupons.filter(c => c.status === 'partial');
  const pending = coupons.filter(c => c.status === 'pending');

  const totalStaked = coupons.filter(c => c.status !== 'pending').reduce((acc, c) => acc + c.stake, 0);
  const totalReturned = won.reduce((acc, c) => acc + (c.actualReturn || 0), 0);
  const profit = totalReturned - totalStaked;
  const roi = totalStaked > 0 ? (profit / totalStaked) * 100 : 0;
  const settled = coupons.filter(c => c.status !== 'pending');
  const winRate = settled.length > 0 ? (won.length / settled.length) * 100 : 0;
  const avgOdds = coupons.length > 0 ? coupons.reduce((acc, c) => acc + c.totalOdds, 0) / coupons.length : 0;

  const bestWin = won.sort((a, b) => (b.actualReturn || 0) - (a.actualReturn || 0))[0] || null;

  return {
    total: coupons.length,
    won: won.length,
    lost: lost.length,
    partial: partial.length,
    pending: pending.length,
    totalStaked,
    totalReturned,
    profit,
    roi,
    winRate,
    avgOdds,
    bestWin,
  };
}
