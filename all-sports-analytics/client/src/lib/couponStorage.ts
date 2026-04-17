/**
 * Multi-Sport Coupon Storage
 * localStorage + reshape to support all sports
 * Result tracking across sports
 */

import type { Coupon, CouponBet, NormalizedGame, SportId } from '../sports/_core/types';
import { getSport } from '../sports/registry';

const STORAGE_KEY = 'all_sports_coupons_v1';

export function getSavedCoupons(): Coupon[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function saveCoupon(coupon: Omit<Coupon, 'id' | 'createdAt' | 'status'>): Coupon {
  const coupons = getSavedCoupons();
  const sportsIncluded = Array.from(new Set(coupon.bets.map(b => b.sport)));
  const newCoupon: Coupon = {
    ...coupon,
    id: `cpn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    createdAt: new Date().toISOString(),
    status: 'pending',
    bets: coupon.bets.map(b => ({ ...b, result: 'pending' as const })),
    isMultiSport: sportsIncluded.length > 1,
    sportsIncluded,
  };
  coupons.unshift(newCoupon);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(coupons));
  return newCoupon;
}

export function deleteCoupon(id: string): void {
  const coupons = getSavedCoupons().filter(c => c.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(coupons));
}

export async function refreshCouponResults(): Promise<Coupon[]> {
  const coupons = getSavedCoupons();
  let changed = false;

  for (const coupon of coupons) {
    if (coupon.status === 'won' || coupon.status === 'lost') continue;

    // Group bets by sport for efficient fetching
    const bySport = new Map<SportId, CouponBet[]>();
    coupon.bets.forEach(b => {
      if (b.result !== 'pending') return;
      if (!bySport.has(b.sport)) bySport.set(b.sport, []);
      bySport.get(b.sport)!.push(b);
    });

    for (const [sport, bets] of bySport) {
      const plugin = getSport(sport);
      for (const bet of bets) {
        try {
          const game = await plugin.getGameById(bet.gameId);
          if (!game || !game.status.finished) continue;
          bet.actualScore = { home: game.scores.home ?? 0, away: game.scores.away ?? 0 };
          bet.result = plugin.evaluateBetResult({
            betName: bet.betType,
            selection: bet.selection,
            game,
          });
          changed = true;
        } catch (err) {
          console.warn(`Could not refresh coupon bet ${bet.gameId}:`, err);
        }
      }
    }

    const allSettled = coupon.bets.every(b => b.result !== 'pending');
    if (allSettled) {
      const allWon = coupon.bets.every(b => b.result === 'won' || b.result === 'void');
      const anyWon = coupon.bets.some(b => b.result === 'won');
      coupon.status = allWon ? 'won' : anyWon ? 'partial' : 'lost';
      coupon.settledAt = new Date().toISOString();
      // Calculate actual return considering void legs (re-multiply without them)
      if (allWon) {
        const effectiveOdds = coupon.bets
          .filter(b => b.result === 'won')
          .reduce((a, b) => a * b.odds, 1);
        coupon.actualReturn = round(effectiveOdds * coupon.stake);
      } else {
        coupon.actualReturn = 0;
      }
    }
  }

  if (changed) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(coupons));
  }

  return coupons;
}

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
  bestWin: Coupon | null;
  byPeriod: { period: string; roi: number; count: number }[];
  bySport: Record<SportId, { count: number; won: number; roi: number }>;
} {
  const coupons = getSavedCoupons();
  const won = coupons.filter(c => c.status === 'won');
  const lost = coupons.filter(c => c.status === 'lost');
  const partial = coupons.filter(c => c.status === 'partial');
  const pending = coupons.filter(c => c.status === 'pending');
  const settled = coupons.filter(c => c.status !== 'pending');

  const totalStaked = settled.reduce((a, c) => a + c.stake, 0);
  const totalReturned = won.reduce((a, c) => a + (c.actualReturn || 0), 0);
  const profit = totalReturned - totalStaked;
  const roi = totalStaked > 0 ? (profit / totalStaked) * 100 : 0;
  const winRate = settled.length > 0 ? (won.length / settled.length) * 100 : 0;
  const avgOdds = coupons.length > 0 ? coupons.reduce((a, c) => a + c.totalOdds, 0) / coupons.length : 0;

  const bestWin = won.sort((a, b) => (b.actualReturn || 0) - (a.actualReturn || 0))[0] || null;

  // Sport statistics
  const bySport: Record<string, { count: number; won: number; roi: number }> = {};
  settled.forEach(c => {
    c.bets.forEach(b => {
      if (!bySport[b.sport]) bySport[b.sport] = { count: 0, won: 0, roi: 0 };
      bySport[b.sport].count++;
      if (b.result === 'won') bySport[b.sport].won++;
    });
  });

  return {
    total: coupons.length,
    won: won.length,
    lost: lost.length,
    partial: partial.length,
    pending: pending.length,
    totalStaked: round(totalStaked),
    totalReturned: round(totalReturned),
    profit: round(profit),
    roi: round(roi),
    winRate: round(winRate),
    avgOdds: round(avgOdds),
    bestWin,
    byPeriod: [],
    bySport: bySport as any,
  };
}

function round(n: number, d: number = 2): number {
  const m = Math.pow(10, d);
  return Math.round(n * m) / m;
}
