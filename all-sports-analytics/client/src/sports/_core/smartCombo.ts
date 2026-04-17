/**
 * Smart Combo (Akıllı Kombinasyon) Üreticisi
 *
 * hockey-analytics playerAnalysis'teki SmartBet + SmartCombo üreticilerinin
 * multi-sport uyarlaması. Ensemble + risk tier + player prop kaynaklarından
 * gelen bahisleri alır, farklı stratejilerle kupon önerileri üretir.
 *
 * Stratejiler:
 *   - Safe:       riskScore < 30, totalOdds 2.5-6.0, olasılık ≥%70 her leg
 *   - Value:      edge ≥ 8%, totalOdds 3-10
 *   - HighOdds:   totalOdds ≥ 8, ama prob ≥%50 her leg
 *   - Balanced:   Her tier'dan karışım
 *   - MultiSport: En az 3 farklı spor
 */

import type { SportId, CouponBet } from './types';
import type { RiskTier } from './riskTier';
import { suggestedStakePercent } from './riskTier';

// ===== SMART BET (tek bir bahis) =====
export interface SmartBet {
  gameId: number;
  sport: SportId;
  sportDisplay: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchDate: string;
  betType: string;
  iddaaName: string;
  selection: string;
  odds: number;
  bookmaker: string;
  trueProbability: number;
  edge: number;
  confidence: number;
  riskScore: number;                 // 0-100, düşük = düşük risk
  riskCategory: 'very-low' | 'low' | 'medium' | 'high';
  tier: RiskTier;
  profitPotential: number;           // edge * odds
  reasoning: string;
  tags: string[];
}

// ===== SMART COMBO =====
export interface SmartCombo {
  id: string;
  name: string;
  description: string;
  strategy: 'safe' | 'value' | 'highodds' | 'balanced' | 'multisport';
  bets: SmartBet[];
  totalOdds: number;
  combinedProbability: number;       // Her leg'in prob'u çarpılır
  riskScore: number;
  riskCategory: 'very-low' | 'low' | 'medium' | 'high';
  expectedValue: number;             // (prob * (odds - 1)) - (1 - prob)
  suggestedStakePercent: number;     // Bankroll %
  potentialReturn: number;           // suggestedStakePercent * totalOdds
  tags: string[];
  sportsIncluded: SportId[];
}

// ===== RISK SCORE HESAPLA =====
export function calculateRiskScore(bet: {
  trueProbability: number;
  odds: number;
  edge: number;
  confidence: number;
  bookmakerCount?: number;
}): { score: number; category: SmartBet['riskCategory'] } {
  let score = 100;

  // Prob yüksek → risk düşük
  score -= Math.max(0, bet.trueProbability * 60); // 0.0 = 100, 1.0 = 40

  // Odds makul aralıkta → risk düşük
  if (bet.odds >= 1.6 && bet.odds <= 2.2) score -= 15;
  else if (bet.odds >= 2.2 && bet.odds <= 3.5) score -= 5;
  else if (bet.odds > 5) score += 10;

  // Edge varlığı → risk düşük
  if (bet.edge >= 0.08) score -= 10;
  else if (bet.edge >= 0.05) score -= 5;

  // Confidence → risk düşük
  score -= bet.confidence * 0.3; // 0-100 skala → 0-30 düşüş

  // Bookmaker onayı
  if (bet.bookmakerCount && bet.bookmakerCount >= 5) score -= 8;
  else if (bet.bookmakerCount && bet.bookmakerCount >= 3) score -= 4;

  score = Math.max(0, Math.min(100, score));

  let category: SmartBet['riskCategory'];
  if (score < 25) category = 'very-low';
  else if (score < 45) category = 'low';
  else if (score < 65) category = 'medium';
  else category = 'high';

  return { score: Math.round(score), category };
}

// ===== COMBO KALITE HESABI =====
function comboQuality(bets: SmartBet[]): {
  totalOdds: number;
  combinedProbability: number;
  riskScore: number;
  riskCategory: SmartCombo['riskCategory'];
  ev: number;
} {
  if (bets.length === 0) {
    return { totalOdds: 1, combinedProbability: 1, riskScore: 0, riskCategory: 'very-low', ev: 0 };
  }
  let totalOdds = 1;
  let combinedProb = 1;
  let sumRisk = 0;
  for (const b of bets) {
    totalOdds *= b.odds;
    combinedProb *= b.trueProbability;
    sumRisk += b.riskScore;
  }
  const avgRisk = sumRisk / bets.length;
  // Çoklu leg eklemek riski artırır (her leg kayıp riski)
  const legRiskMultiplier = 1 + (bets.length - 1) * 0.08;
  const riskScore = Math.min(100, avgRisk * legRiskMultiplier);

  let riskCategory: SmartCombo['riskCategory'];
  if (riskScore < 25) riskCategory = 'very-low';
  else if (riskScore < 45) riskCategory = 'low';
  else if (riskScore < 65) riskCategory = 'medium';
  else riskCategory = 'high';

  const ev = combinedProb * (totalOdds - 1) - (1 - combinedProb);

  return { totalOdds, combinedProbability: combinedProb, riskScore, riskCategory, ev };
}

// ===== STRATEJI: SAFE =====
/**
 * Güvenli kupon: her leg ≥ %70, risk düşük, totalOdds 2.5-6.0.
 */
export function buildSafeCombo(bets: SmartBet[], opts: { minLegs?: number; maxLegs?: number } = {}): SmartCombo | null {
  const minLegs = opts.minLegs ?? 2;
  const maxLegs = opts.maxLegs ?? 4;

  const candidates = bets
    .filter(b => b.trueProbability >= 0.70 && b.riskScore < 40 && b.odds >= 1.4 && b.odds <= 2.5)
    .sort((a, b) => a.riskScore - b.riskScore);

  if (candidates.length < minLegs) return null;

  const selected: SmartBet[] = [];
  const usedGames = new Set<number>();

  for (const c of candidates) {
    if (selected.length >= maxLegs) break;
    if (usedGames.has(c.gameId)) continue;
    const withNew = [...selected, c];
    const q = comboQuality(withNew);
    if (q.totalOdds > 6.0) continue;
    selected.push(c);
    usedGames.add(c.gameId);
  }

  if (selected.length < minLegs) return null;
  const q = comboQuality(selected);
  if (q.totalOdds < 2.0) return null;

  const sports = Array.from(new Set(selected.map(b => b.sport)));
  const topTier = selected.reduce((best, b) => tierRank(b.tier) > tierRank(best.tier) ? b : best).tier;

  return {
    id: `safe-${Date.now()}`,
    name: 'Güvenli Kupon',
    description: `${selected.length} leg, tümü %70+ olasılık, toplam oran ${q.totalOdds.toFixed(2)}`,
    strategy: 'safe',
    bets: selected,
    totalOdds: q.totalOdds,
    combinedProbability: q.combinedProbability,
    riskScore: q.riskScore,
    riskCategory: q.riskCategory,
    expectedValue: q.ev,
    suggestedStakePercent: suggestedStakePercent(topTier),
    potentialReturn: q.totalOdds * suggestedStakePercent(topTier) / 100,
    tags: ['safe', 'conservative'],
    sportsIncluded: sports,
  };
}

// ===== STRATEJI: VALUE =====
/**
 * Değer bahsi kombinasyonu: edge ≥ 8% her leg, totalOdds 3-10.
 */
export function buildValueCombo(bets: SmartBet[], opts: { minLegs?: number; maxLegs?: number } = {}): SmartCombo | null {
  const minLegs = opts.minLegs ?? 2;
  const maxLegs = opts.maxLegs ?? 4;

  const candidates = bets
    .filter(b => b.edge >= 0.08 && b.odds >= 1.6 && b.odds <= 4.0 && b.trueProbability >= 0.40)
    .sort((a, b) => b.profitPotential - a.profitPotential);

  if (candidates.length < minLegs) return null;

  const selected: SmartBet[] = [];
  const usedGames = new Set<number>();
  for (const c of candidates) {
    if (selected.length >= maxLegs) break;
    if (usedGames.has(c.gameId)) continue;
    const q = comboQuality([...selected, c]);
    if (q.totalOdds > 10) continue;
    selected.push(c);
    usedGames.add(c.gameId);
  }

  if (selected.length < minLegs) return null;
  const q = comboQuality(selected);
  if (q.totalOdds < 3) return null;

  const sports = Array.from(new Set(selected.map(b => b.sport)));
  const topTier = selected.reduce((best, b) => tierRank(b.tier) > tierRank(best.tier) ? b : best).tier;

  return {
    id: `value-${Date.now()}`,
    name: 'Değer Kuponu',
    description: `${selected.length} leg, her birinde ≥%8 değer, toplam oran ${q.totalOdds.toFixed(2)}`,
    strategy: 'value',
    bets: selected,
    totalOdds: q.totalOdds,
    combinedProbability: q.combinedProbability,
    riskScore: q.riskScore,
    riskCategory: q.riskCategory,
    expectedValue: q.ev,
    suggestedStakePercent: suggestedStakePercent(topTier),
    potentialReturn: q.totalOdds * suggestedStakePercent(topTier) / 100,
    tags: ['value', '+ev'],
    sportsIncluded: sports,
  };
}

// ===== STRATEJI: HIGH ODDS =====
export function buildHighOddsCombo(bets: SmartBet[], opts: { minLegs?: number; maxLegs?: number } = {}): SmartCombo | null {
  const minLegs = opts.minLegs ?? 3;
  const maxLegs = opts.maxLegs ?? 5;

  const candidates = bets
    .filter(b => b.odds >= 2.0 && b.trueProbability >= 0.50 && b.edge >= 0.02)
    .sort((a, b) => b.odds - a.odds);

  if (candidates.length < minLegs) return null;

  const selected: SmartBet[] = [];
  const usedGames = new Set<number>();
  for (const c of candidates) {
    if (selected.length >= maxLegs) break;
    if (usedGames.has(c.gameId)) continue;
    selected.push(c);
    usedGames.add(c.gameId);
  }

  if (selected.length < minLegs) return null;
  const q = comboQuality(selected);
  if (q.totalOdds < 8) return null;

  const sports = Array.from(new Set(selected.map(b => b.sport)));
  const topTier = selected.reduce((best, b) => tierRank(b.tier) > tierRank(best.tier) ? b : best).tier;

  return {
    id: `high-${Date.now()}`,
    name: 'Yüksek Oran Kuponu',
    description: `${selected.length} leg, toplam oran ${q.totalOdds.toFixed(2)}, her leg ≥%50 olasılık`,
    strategy: 'highodds',
    bets: selected,
    totalOdds: q.totalOdds,
    combinedProbability: q.combinedProbability,
    riskScore: q.riskScore,
    riskCategory: q.riskCategory,
    expectedValue: q.ev,
    suggestedStakePercent: Math.max(0.5, suggestedStakePercent(topTier) * 0.5),
    potentialReturn: q.totalOdds * suggestedStakePercent(topTier) / 200,
    tags: ['high-odds', 'risky'],
    sportsIncluded: sports,
  };
}

// ===== STRATEJI: MULTI-SPORT =====
/**
 * En az 3 farklı spor karışık olur.
 */
export function buildMultiSportCombo(bets: SmartBet[], opts: { minLegs?: number; maxLegs?: number } = {}): SmartCombo | null {
  const minLegs = opts.minLegs ?? 3;
  const maxLegs = opts.maxLegs ?? 5;

  // Her spor için en iyi bet
  const bySport = new Map<SportId, SmartBet>();
  const sorted = [...bets].sort((a, b) => (b.trueProbability * (b.odds - 1)) - (a.trueProbability * (a.odds - 1)));
  for (const b of sorted) {
    if (b.trueProbability < 0.55) continue;
    if (!bySport.has(b.sport)) bySport.set(b.sport, b);
  }

  const selected = Array.from(bySport.values()).slice(0, maxLegs);
  if (selected.length < 3) return null;
  if (selected.length < minLegs) return null;

  const q = comboQuality(selected);
  const sports = selected.map(b => b.sport);

  const topTier = selected.reduce((best, b) => tierRank(b.tier) > tierRank(best.tier) ? b : best).tier;

  return {
    id: `multi-${Date.now()}`,
    name: `${sports.length} Spor Karma Kupon`,
    description: `${sports.length} farklı spor, ${selected.length} leg, toplam oran ${q.totalOdds.toFixed(2)}`,
    strategy: 'multisport',
    bets: selected,
    totalOdds: q.totalOdds,
    combinedProbability: q.combinedProbability,
    riskScore: q.riskScore,
    riskCategory: q.riskCategory,
    expectedValue: q.ev,
    suggestedStakePercent: suggestedStakePercent(topTier) * 0.75,
    potentialReturn: q.totalOdds * suggestedStakePercent(topTier) / 133,
    tags: ['multi-sport', 'diversified'],
    sportsIncluded: sports,
  };
}

// ===== STRATEJI: BALANCED =====
export function buildBalancedCombo(bets: SmartBet[], opts: { legs?: number } = {}): SmartCombo | null {
  const legs = opts.legs ?? 4;

  // Her tier'dan en iyi 1 tane
  const tiersInOrder: RiskTier[] = ['platinum', 'gold', 'silver', 'bronze'];
  const selected: SmartBet[] = [];
  const usedGames = new Set<number>();

  for (const tier of tiersInOrder) {
    const best = bets
      .filter(b => b.tier === tier && !usedGames.has(b.gameId))
      .sort((a, b) => b.edge - a.edge)[0];
    if (best) {
      selected.push(best);
      usedGames.add(best.gameId);
    }
    if (selected.length >= legs) break;
  }

  if (selected.length < 2) return null;
  const q = comboQuality(selected);
  const sports = Array.from(new Set(selected.map(b => b.sport)));

  const topTier = selected.reduce((best, b) => tierRank(b.tier) > tierRank(best.tier) ? b : best).tier;

  return {
    id: `balanced-${Date.now()}`,
    name: 'Dengeli Kupon',
    description: `${selected.length} leg, her tier'dan seçim`,
    strategy: 'balanced',
    bets: selected,
    totalOdds: q.totalOdds,
    combinedProbability: q.combinedProbability,
    riskScore: q.riskScore,
    riskCategory: q.riskCategory,
    expectedValue: q.ev,
    suggestedStakePercent: suggestedStakePercent(topTier),
    potentialReturn: q.totalOdds * suggestedStakePercent(topTier) / 100,
    tags: ['balanced', 'diversified'],
    sportsIncluded: sports,
  };
}

// ===== TOP-LEVEL: HEPSINI ÜRET =====
export function buildAllCombos(bets: SmartBet[]): SmartCombo[] {
  const out: SmartCombo[] = [];
  const safe = buildSafeCombo(bets);
  const value = buildValueCombo(bets);
  const high = buildHighOddsCombo(bets);
  const multi = buildMultiSportCombo(bets);
  const balanced = buildBalancedCombo(bets);
  if (safe) out.push(safe);
  if (value) out.push(value);
  if (high) out.push(high);
  if (multi) out.push(multi);
  if (balanced) out.push(balanced);
  return out;
}

// ===== YARDIMCILAR =====
function tierRank(t: RiskTier): number {
  switch (t) {
    case 'platinum': return 4;
    case 'gold':     return 3;
    case 'silver':   return 2;
    case 'bronze':   return 1;
    case 'reject':   return 0;
  }
}

/**
 * SmartBet'i CouponBet'e çevirir (storage için).
 */
export function smartBetToCouponBet(sb: SmartBet): CouponBet {
  return {
    gameId: sb.gameId,
    sport: sb.sport,
    sportDisplay: sb.sportDisplay,
    homeTeam: sb.homeTeam,
    awayTeam: sb.awayTeam,
    league: sb.league,
    matchDate: sb.matchDate,
    betType: sb.betType,
    iddaaName: sb.iddaaName,
    selection: sb.selection,
    odds: sb.odds,
    trueProbability: sb.trueProbability,
    edge: sb.edge,
    confidence: sb.confidence,
  };
}
