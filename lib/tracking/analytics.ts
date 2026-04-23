/**
 * Cross-sport analytics queries.
 *
 * Answers questions like:
 *  - "Hangi spordaki hangi market en çok para kazandırdı?"
 *  - "Platinum tier'ın 30 günlük ROI'si?"
 *  - "Son 100 maçta en yüksek edge'e sahip bookmaker/market kombinasyonu?"
 */

import { trackingPrisma as prisma } from '@/lib/db';
import type { AnalyticsFilters, MarketFamily, MarketPerformanceRow, SportCode } from './types';
import { getMarket } from './market-taxonomy';

/** Build a SQL-level WHERE clause for analytics filters. */
function buildPredicateArgs(filters: AnalyticsFilters) {
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;
  if (filters.sports && filters.sports.length > 0) {
    conditions.push(`p.sport = ANY($${idx}::text[])`);
    params.push(filters.sports);
    idx++;
  }
  if (filters.markets && filters.markets.length > 0) {
    conditions.push(`pk.market = ANY($${idx}::text[])`);
    params.push(filters.markets);
    idx++;
  }
  if (filters.date_from) {
    conditions.push(`p.match_date >= $${idx}::timestamptz`);
    params.push(filters.date_from);
    idx++;
  }
  if (filters.date_to) {
    conditions.push(`p.match_date <= $${idx}::timestamptz`);
    params.push(filters.date_to);
    idx++;
  }
  if (filters.min_probability != null) {
    conditions.push(`pk.probability >= $${idx}::float`);
    params.push(filters.min_probability);
    idx++;
  }
  if (filters.min_expected_value != null) {
    conditions.push(`pk.expected_value >= $${idx}::float`);
    params.push(filters.min_expected_value);
    idx++;
  }
  if (filters.only_high_confidence) {
    conditions.push(`pk.is_high_confidence = true`);
  }
  return { where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

/**
 * Per-(sport, market) performance aggregation — answers "hangi market kazandırıyor".
 * Filters to settled picks only (hit IS NOT NULL).
 */
export async function getMarketPerformance(filters: AnalyticsFilters = {}): Promise<MarketPerformanceRow[]> {
  const { where, params } = buildPredicateArgs(filters);
  const sql = `
    SELECT
      p.sport::text  AS sport,
      pk.market      AS market,
      COUNT(*)::int  AS total,
      SUM(CASE WHEN pk.hit = true THEN 1 ELSE 0 END)::int AS hit,
      AVG(COALESCE(pk.market_odds, 0))::float  AS avg_odds,
      AVG(COALESCE(pk.probability, 0))::float  AS avg_probability,
      SUM(CASE WHEN pk.hit = true AND pk.market_odds IS NOT NULL THEN pk.market_odds ELSE 0 END)::float AS total_return
    FROM picks pk
    JOIN predictions p ON p.id = pk.prediction_id
    ${where}
      ${where ? 'AND' : 'WHERE'} pk.hit IS NOT NULL
    GROUP BY p.sport, pk.market
    HAVING COUNT(*) >= 3
    ORDER BY SUM(CASE WHEN pk.hit = true THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0) DESC NULLS LAST, COUNT(*) DESC
    LIMIT 500
  `;
  const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...params);
  return rows.map(r => {
    const def = getMarket(r.market);
    const total = Number(r.total);
    const hit = Number(r.hit);
    const totalStake = total; // 1 unit each
    const totalReturn = Number(r.total_return);
    return {
      sport: r.sport,
      market: r.market,
      market_label: def?.display_name_tr,
      family: def?.family as MarketFamily | undefined,
      total,
      hit,
      win_rate: total > 0 ? hit / total : 0,
      avg_odds: Number(r.avg_odds),
      avg_probability: Number(r.avg_probability),
      total_stake: totalStake,
      total_return: totalReturn,
      profit: totalReturn - totalStake,
      roi: totalStake > 0 ? (totalReturn - totalStake) / totalStake : 0,
    } as MarketPerformanceRow;
  });
}

/** Per-sport aggregate ROI (flat-stake 1 unit). */
export async function getSportRoi(filters: AnalyticsFilters = {}) {
  const { where, params } = buildPredicateArgs(filters);
  const sql = `
    SELECT
      p.sport::text AS sport,
      COUNT(*)::int AS total,
      SUM(CASE WHEN pk.hit = true THEN 1 ELSE 0 END)::int AS hit,
      SUM(CASE WHEN pk.hit = true AND pk.market_odds IS NOT NULL THEN pk.market_odds ELSE 0 END)::float AS total_return,
      AVG(COALESCE(pk.probability, 0))::float AS avg_prob
    FROM picks pk
    JOIN predictions p ON p.id = pk.prediction_id
    ${where}
      ${where ? 'AND' : 'WHERE'} pk.hit IS NOT NULL
    GROUP BY p.sport
    ORDER BY total DESC
  `;
  const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...params);
  return rows.map(r => {
    const total = Number(r.total);
    const ret = Number(r.total_return);
    return {
      sport: r.sport,
      total,
      hit: Number(r.hit),
      win_rate: total > 0 ? Number(r.hit) / total : 0,
      total_return: ret,
      profit: ret - total,
      roi: total > 0 ? (ret - total) / total : 0,
      avg_probability: Number(r.avg_prob),
    };
  });
}

/** Return top N (sport × market) leaderboard ordered by ROI with min sample size. */
export async function getLeaderboard(filters: AnalyticsFilters & { min_sample?: number; limit?: number } = {}) {
  const rows = await getMarketPerformance(filters);
  const min = filters.min_sample ?? 20;
  return rows
    .filter(r => r.total >= min)
    .sort((a, b) => b.roi - a.roi)
    .slice(0, filters.limit ?? 50);
}

/** Value bet leaderboard — pending predictions with highest edge. */
export async function getPendingValueBets(filters: AnalyticsFilters & { limit?: number } = {}) {
  const where: any = { };
  if (filters.sports && filters.sports.length > 0) where.prediction_sport_in = filters.sports;
  // Use Prisma for this simpler query
  const picks = await prisma.picks.findMany({
    where: {
      hit: null,
      expected_value: { gte: filters.min_expected_value ?? 0.05 },
      probability: { gte: filters.min_probability ?? 0.55 },
      ...(filters.only_high_confidence ? { is_high_confidence: true } : {}),
      predictions: {
        status: 'pending',
        ...(filters.sports && filters.sports.length > 0 ? { sport: { in: filters.sports as string[] } } : {}),
        ...(filters.date_from ? { match_date: { gte: new Date(filters.date_from) } } : {}),
        ...(filters.date_to ? { match_date: { lte: new Date(filters.date_to) } } : {}),
      },
    },
    include: { predictions: true },
    orderBy: [{ expected_value: 'desc' }],
    take: filters.limit ?? 100,
  });
  return picks.map(p => ({
    prediction_id: p.prediction_id,
    sport: p.predictions.sport,
    match_date: p.predictions.match_date,
    home_team: p.predictions.home_team,
    away_team: p.predictions.away_team,
    league: p.predictions.league,
    market: p.market,
    market_label: p.market_label ?? getMarket(p.market)?.display_name_tr,
    pick_label: p.pick_label,
    probability: p.probability,
    market_odds: p.market_odds,
    expected_value: p.expected_value,
    is_high_confidence: p.is_high_confidence,
  }));
}

/** Family-level breakdown (match_winner vs totals vs btts etc.) across all sports. */
export async function getFamilyPerformance(filters: AnalyticsFilters = {}) {
  const rows = await getMarketPerformance(filters);
  const byFamily = new Map<string, { total: number; hit: number; ret: number; stake: number; probs: number[]; odds: number[] }>();
  for (const r of rows) {
    const key = `${r.sport}|${r.family ?? 'other'}`;
    const entry = byFamily.get(key) ?? { total: 0, hit: 0, ret: 0, stake: 0, probs: [], odds: [] };
    entry.total += r.total;
    entry.hit += r.hit;
    entry.ret += r.total_return;
    entry.stake += r.total_stake;
    if (r.avg_probability) entry.probs.push(r.avg_probability);
    if (r.avg_odds) entry.odds.push(r.avg_odds);
    byFamily.set(key, entry);
  }
  return Array.from(byFamily.entries()).map(([k, v]) => {
    const [sport, family] = k.split('|');
    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    return {
      sport,
      family,
      total: v.total,
      hit: v.hit,
      win_rate: v.total > 0 ? v.hit / v.total : 0,
      avg_probability: avg(v.probs),
      avg_odds: avg(v.odds),
      total_return: v.ret,
      total_stake: v.stake,
      profit: v.ret - v.stake,
      roi: v.stake > 0 ? (v.ret - v.stake) / v.stake : 0,
    };
  }).sort((a, b) => b.roi - a.roi);
}

/** Player-prop market performance, grouped by (sport, market, selection). */
export async function getPlayerPropPerformance(filters: AnalyticsFilters = {}) {
  const where: any = { hit: { not: null } };
  if (filters.sports && filters.sports.length > 0) where.sport = { in: filters.sports as string[] };
  if (filters.date_from) where.predicted_at = { ...(where.predicted_at ?? {}), gte: new Date(filters.date_from) };
  if (filters.date_to) where.predicted_at = { ...(where.predicted_at ?? {}), lte: new Date(filters.date_to) };
  if (filters.only_high_confidence) where.is_high_confidence = true;

  const picks = await prisma.player_prop_picks.findMany({
    where,
    select: {
      sport: true,
      market: true,
      selection: true,
      hit: true,
      market_odds: true,
      probability: true,
    },
    take: 10000,
  });

  const grouped = new Map<string, { total: number; hit: number; ret: number; probs: number[]; odds: number[] }>();
  for (const p of picks) {
    const key = `${p.sport}|${p.market}|${p.selection}`;
    const entry = grouped.get(key) ?? { total: 0, hit: 0, ret: 0, probs: [], odds: [] };
    entry.total++;
    if (p.hit) entry.hit++;
    if (p.hit && p.market_odds) entry.ret += p.market_odds;
    if (p.probability) entry.probs.push(p.probability);
    if (p.market_odds) entry.odds.push(p.market_odds);
    grouped.set(key, entry);
  }

  return Array.from(grouped.entries())
    .map(([k, v]) => {
      const [sport, market, selection] = k.split('|');
      const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
      return {
        sport,
        market,
        selection,
        total: v.total,
        hit: v.hit,
        win_rate: v.total > 0 ? v.hit / v.total : 0,
        avg_probability: avg(v.probs),
        avg_odds: avg(v.odds),
        total_return: v.ret,
        profit: v.ret - v.total,
        roi: v.total > 0 ? (v.ret - v.total) / v.total : 0,
      };
    })
    .filter(r => r.total >= ((filters as any).min_sample ?? 3))
    .sort((a, b) => b.roi - a.roi);
}

/** Quick KPIs for the tracking dashboard header. */
export async function getOverallKpis(filters: AnalyticsFilters = {}) {
  const [predictions, pending, settled, profit] = await Promise.all([
    prisma.predictions.count({
      where: {
        ...(filters.sports && filters.sports.length > 0 ? { sport: { in: filters.sports as string[] } } : {}),
        ...(filters.date_from ? { predicted_at: { gte: new Date(filters.date_from) } } : {}),
      },
    }),
    prisma.predictions.count({
      where: {
        status: 'pending',
        ...(filters.sports && filters.sports.length > 0 ? { sport: { in: filters.sports as string[] } } : {}),
      },
    }),
    prisma.predictions.count({
      where: {
        status: 'resolved',
        ...(filters.sports && filters.sports.length > 0 ? { sport: { in: filters.sports as string[] } } : {}),
      },
    }),
    prisma.picks.aggregate({
      _count: { _all: true },
      _sum: { market_odds: true },
      where: {
        hit: true,
        predictions: {
          ...(filters.sports && filters.sports.length > 0 ? { sport: { in: filters.sports as string[] } } : {}),
        },
      },
    }),
  ]);
  return {
    total_predictions: predictions,
    pending,
    settled,
    total_picks_won: profit._count._all,
    total_return: profit._sum.market_odds ?? 0,
  };
}
