/**
 * Backtest Motoru
 *
 * Eagle `backtest-engine.ts` sadeleştirilmiş port. Geçmiş kuponları veya
 * geçmiş tahminleri gerçek sonuçlarla karşılaştırıp ROI, win rate,
 * tier bazlı dağılım hesaplar.
 *
 * Sport-agnostic: her spor için evaluateBetResult callback'i verilir.
 */

import type { SportId, NormalizedGame, CouponBet } from './types';
import type { RiskTier } from './riskTier';

// ===== GENEL =====
export interface BacktestBet {
  gameId: number;
  sport: SportId;
  betName: string;
  selection: string;
  odds: number;
  trueProbability: number;
  stake: number;         // Önerilen stake (Kelly veya sabit birim)
  tier?: RiskTier;
  marketKind?: string;
}

export interface BacktestResult {
  sport?: SportId | 'all';
  period: { from: string; to: string };
  totalBets: number;
  won: number;
  lost: number;
  void: number;
  pending: number;
  winRate: number;                           // 0-1
  totalStaked: number;
  totalReturn: number;
  netProfit: number;
  roi: number;                               // 0-100 (%)
  avgOdds: number;
  profitByTier: Partial<Record<RiskTier, {
    bets: number; won: number; lost: number; profit: number; roi: number;
  }>>;
  profitByMarket: Record<string, {
    bets: number; won: number; lost: number; profit: number; roi: number;
  }>;
  profitBySport: Partial<Record<SportId, {
    bets: number; won: number; lost: number; profit: number; roi: number;
  }>>;
}

export type BetResult = 'won' | 'lost' | 'void' | 'pending';

export type ResultEvaluator = (params: {
  betName: string;
  selection: string;
  game: NormalizedGame;
}) => BetResult;

/**
 * Tekil bahis kar/zarar.
 * Kazanç = (odds - 1) * stake. Kayıp = -stake. Void = 0. Pending = 0.
 */
function profitFor(result: BetResult, odds: number, stake: number): number {
  switch (result) {
    case 'won':  return (odds - 1) * stake;
    case 'lost': return -stake;
    case 'void': return 0;
    case 'pending': return 0;
  }
}

/**
 * Backtest koşturucu.
 *
 * Her bet için ilgili sport'un evaluateBetResult fonksiyonu çağrılır.
 * evaluators map'i sport → fn.
 */
export function runBacktest(params: {
  bets: BacktestBet[];
  games: NormalizedGame[];
  evaluators: Partial<Record<SportId, ResultEvaluator>>;
  period: { from: string; to: string };
}): BacktestResult {
  const gameIndex = new Map<number, NormalizedGame>();
  for (const g of params.games) gameIndex.set(g.id, g);

  const result: BacktestResult = {
    period: params.period,
    totalBets: 0,
    won: 0,
    lost: 0,
    void: 0,
    pending: 0,
    winRate: 0,
    totalStaked: 0,
    totalReturn: 0,
    netProfit: 0,
    roi: 0,
    avgOdds: 0,
    profitByTier: {},
    profitByMarket: {},
    profitBySport: {},
  };

  let oddsSum = 0;

  for (const bet of params.bets) {
    const game = gameIndex.get(bet.gameId);
    const evaluator = params.evaluators[bet.sport];
    if (!game || !evaluator) continue;

    if (!game.status.finished) {
      result.pending++;
      continue;
    }

    const outcome = evaluator({ betName: bet.betName, selection: bet.selection, game });
    const profit = profitFor(outcome, bet.odds, bet.stake);

    result.totalBets++;
    result.totalStaked += bet.stake;
    result.totalReturn += outcome === 'won' ? bet.odds * bet.stake : (outcome === 'void' ? bet.stake : 0);
    oddsSum += bet.odds;

    if (outcome === 'won') result.won++;
    else if (outcome === 'lost') result.lost++;
    else if (outcome === 'void') result.void++;

    // Tier grouping
    if (bet.tier) {
      const bucket = result.profitByTier[bet.tier] ?? { bets: 0, won: 0, lost: 0, profit: 0, roi: 0 };
      bucket.bets++;
      if (outcome === 'won') bucket.won++;
      else if (outcome === 'lost') bucket.lost++;
      bucket.profit += profit;
      result.profitByTier[bet.tier] = bucket;
    }

    // Market grouping
    const mkey = bet.marketKind ?? bet.betName;
    const mbucket = result.profitByMarket[mkey] ?? { bets: 0, won: 0, lost: 0, profit: 0, roi: 0 };
    mbucket.bets++;
    if (outcome === 'won') mbucket.won++;
    else if (outcome === 'lost') mbucket.lost++;
    mbucket.profit += profit;
    result.profitByMarket[mkey] = mbucket;

    // Sport grouping
    const sbucket = result.profitBySport[bet.sport] ?? { bets: 0, won: 0, lost: 0, profit: 0, roi: 0 };
    sbucket.bets++;
    if (outcome === 'won') sbucket.won++;
    else if (outcome === 'lost') sbucket.lost++;
    sbucket.profit += profit;
    result.profitBySport[bet.sport] = sbucket;
  }

  // ROI'leri hesapla
  const finalize = (b: { bets: number; won: number; lost: number; profit: number; roi: number }, stake: number) => {
    b.roi = stake > 0 ? (b.profit / stake) * 100 : 0;
  };

  // Per-tier stakes
  const perTierStake = new Map<RiskTier, number>();
  const perMarketStake = new Map<string, number>();
  const perSportStake = new Map<SportId, number>();

  for (const bet of params.bets) {
    const game = gameIndex.get(bet.gameId);
    if (!game || !game.status.finished) continue;
    if (bet.tier) perTierStake.set(bet.tier, (perTierStake.get(bet.tier) ?? 0) + bet.stake);
    const mk = bet.marketKind ?? bet.betName;
    perMarketStake.set(mk, (perMarketStake.get(mk) ?? 0) + bet.stake);
    perSportStake.set(bet.sport, (perSportStake.get(bet.sport) ?? 0) + bet.stake);
  }

  for (const [tier, bucket] of Object.entries(result.profitByTier)) {
    if (bucket) finalize(bucket, perTierStake.get(tier as RiskTier) ?? 0);
  }
  for (const [mk, bucket] of Object.entries(result.profitByMarket)) {
    finalize(bucket, perMarketStake.get(mk) ?? 0);
  }
  for (const [sp, bucket] of Object.entries(result.profitBySport)) {
    if (bucket) finalize(bucket, perSportStake.get(sp as SportId) ?? 0);
  }

  result.netProfit = result.totalReturn - result.totalStaked;
  result.roi = result.totalStaked > 0 ? (result.netProfit / result.totalStaked) * 100 : 0;
  result.winRate = result.totalBets > 0 ? result.won / result.totalBets : 0;
  result.avgOdds = result.totalBets > 0 ? oddsSum / result.totalBets : 0;

  return result;
}

/**
 * Kupon backtest: tüm bet'ler geçmeli (AND). Herhangi biri kaybederse kupon kayıp.
 */
export interface BacktestCoupon {
  id: string;
  stake: number;
  bets: Array<BacktestBet>;
}

export function runCouponBacktest(params: {
  coupons: BacktestCoupon[];
  games: NormalizedGame[];
  evaluators: Partial<Record<SportId, ResultEvaluator>>;
  period: { from: string; to: string };
}): {
  totalCoupons: number;
  won: number;
  lost: number;
  pending: number;
  totalStaked: number;
  totalReturn: number;
  netProfit: number;
  roi: number;
  winRate: number;
} {
  const gameIndex = new Map<number, NormalizedGame>();
  for (const g of params.games) gameIndex.set(g.id, g);

  let totalCoupons = 0;
  let won = 0, lost = 0, pending = 0;
  let totalStaked = 0, totalReturn = 0;

  for (const coupon of params.coupons) {
    totalCoupons++;
    totalStaked += coupon.stake;

    let couponResult: BetResult = 'won';
    let totalOdds = 1;
    let hasPending = false;

    for (const bet of coupon.bets) {
      const game = gameIndex.get(bet.gameId);
      const ev = params.evaluators[bet.sport];
      if (!game || !ev || !game.status.finished) {
        hasPending = true;
        break;
      }
      const o = ev({ betName: bet.betName, selection: bet.selection, game });
      if (o === 'lost') { couponResult = 'lost'; break; }
      if (o === 'void') continue; // void leg = odd 1.0
      if (o === 'pending') { hasPending = true; break; }
      totalOdds *= bet.odds;
    }

    if (hasPending) { pending++; continue; }

    if (couponResult === 'won') {
      won++;
      totalReturn += coupon.stake * totalOdds;
    } else {
      lost++;
    }
  }

  const settled = totalCoupons - pending;
  const netProfit = totalReturn - (totalStaked - (pending > 0 ? params.coupons.filter((_, i) => i < pending).reduce((a, c) => a + c.stake, 0) : 0));
  const settledStake = totalStaked; // basitleştirilmiş
  const roi = settledStake > 0 ? (netProfit / settledStake) * 100 : 0;
  const winRate = settled > 0 ? won / settled : 0;

  return {
    totalCoupons,
    won,
    lost,
    pending,
    totalStaked,
    totalReturn,
    netProfit,
    roi,
    winRate,
  };
}

/**
 * CouponBet'ten BacktestBet türetir (kupon geçmişi backtest için).
 */
export function couponBetToBacktestBet(bet: CouponBet, stake: number = 1): BacktestBet {
  return {
    gameId: bet.gameId,
    sport: bet.sport,
    betName: bet.betType,
    selection: bet.selection,
    odds: bet.odds,
    trueProbability: bet.trueProbability,
    stake,
  };
}
