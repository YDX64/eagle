/**
 * Market settlement engine.
 *
 * After a match finishes, determine won/lost/void for every child row of a
 * prediction (picks, system_bets, player_prop_picks). Uses canonical market
 * definitions from `market-taxonomy.ts` so the logic is one place.
 *
 * Pattern:
 *   1. Load pending predictions whose match_date < now (or `before`).
 *   2. Fetch the authoritative result (score, half-time, set breakdown).
 *   3. Evaluate every pick against the taxonomy's `settle` rule.
 *   4. Update hit/best_pick_hit/status/resolved_at in a transaction.
 */

import { trackingPrisma as prisma } from '@/lib/db';
import { getMarket, inferLine, type SettleContext } from './market-taxonomy';
import type { SettlementResult, SportCode } from './types';

export interface GameResult {
  sport: SportCode;
  api_game_id: number;
  status_short: string;
  home: number;
  away: number;
  home_ht?: number | null;
  away_ht?: number | null;
  home_et?: number | null;
  away_et?: number | null;
  home_pen?: number | null;
  away_pen?: number | null;
  periods?: Array<{ home: number | null; away: number | null }>;
  sets?: Array<{ home: number | null; away: number | null }>;
  corners_home?: number | null;
  corners_away?: number | null;
  cards_home?: number | null;
  cards_away?: number | null;
  // Player actual stats keyed by player_id for player prop settlement
  player_stats?: Record<number, Record<string, number>>;
}

const FINISHED_STATUSES = new Set([
  'FT',
  'AET',
  'AOT',
  'AP',
  'PEN',
  'Match Finished',
  'Finished',
  'After Extra Time',
  'After Penalties',
  // Basketball / NBA
  'Game Finished',
  // Hockey / volleyball / handball
  'Ended',
  'AFTER_OT',
  'AFTER_PEN',
]);

function isFinished(status: string | null | undefined): boolean {
  if (!status) return false;
  return FINISHED_STATUSES.has(status) || status.toLowerCase().includes('finished') || status.toLowerCase().includes('ended');
}

function evalPick(marketCode: string, ctx: SettleContext): boolean | 'void' | null {
  const def = getMarket(marketCode);
  if (!def) return null;
  // Inject line if missing
  if (def.requires_line && ctx.line == null) {
    ctx.line = inferLine(marketCode);
  }
  try {
    return def.settle(ctx);
  } catch {
    return null;
  }
}

/**
 * Settle a single prediction using an externally-fetched game result.
 * Returns null if the game isn't finished yet.
 */
export async function settlePrediction(pred_id: string, result: GameResult): Promise<SettlementResult | null> {
  if (!isFinished(result.status_short)) return null;

  const prediction = await prisma.predictions.findUnique({
    where: { id: pred_id },
    include: { picks: true, system_bets: true, player_prop_picks: true },
  });
  if (!prediction) return null;

  const baseCtx: SettleContext = {
    home: result.home,
    away: result.away,
    home_ht: result.home_ht ?? null,
    away_ht: result.away_ht ?? null,
    home_et: result.home_et ?? null,
    away_et: result.away_et ?? null,
    home_pen: result.home_pen ?? null,
    away_pen: result.away_pen ?? null,
    periods: result.periods,
    sets: result.sets,
    corners_home: result.corners_home ?? null,
    corners_away: result.corners_away ?? null,
    cards_home: result.cards_home ?? null,
    cards_away: result.cards_away ?? null,
  };

  let picksHit = 0;
  let sbHit = 0;
  let ppHit = 0;
  const errors: string[] = [];
  let bestPickHit: boolean | null = null;

  await prisma.$transaction(async tx => {
    for (const pick of prediction.picks) {
      const ctx = { ...baseCtx };
      const outcome = evalPick(pick.market, ctx);
      const hit = outcome === true ? true : outcome === false ? false : null;
      if (outcome === 'void') {
        await tx.picks.update({ where: { id: pick.id }, data: { hit: null } });
        continue;
      }
      if (outcome == null) {
        errors.push(`unknown market: ${pick.market}`);
        continue;
      }
      if (hit === true) picksHit++;
      await tx.picks.update({ where: { id: pick.id }, data: { hit } });
      if (pick.is_best) bestPickHit = hit;
    }

    for (const sb of prediction.system_bets) {
      const outcome = evalPick(sb.market, { ...baseCtx });
      const hit = outcome === true ? true : outcome === false ? false : null;
      if (outcome === 'void') {
        await tx.system_bets.update({ where: { id: sb.id }, data: { hit: null } });
        continue;
      }
      if (outcome == null) continue;
      if (hit === true) sbHit++;
      await tx.system_bets.update({ where: { id: sb.id }, data: { hit } });
    }

    for (const pp of prediction.player_prop_picks) {
      const stats = result.player_stats?.[pp.player_id];
      if (!stats) continue;
      const statKey = playerStatKeyFor(pp.market);
      if (!statKey) continue;
      const actual = stats[statKey];
      if (actual == null) continue;
      let hit: boolean;
      if (pp.selection === 'OVER') hit = actual > pp.line;
      else if (pp.selection === 'UNDER') hit = actual < pp.line;
      else if (pp.selection === 'YES') hit = actual >= pp.line;
      else if (pp.selection === 'NO') hit = actual < pp.line;
      else continue;
      if (hit) ppHit++;
      await tx.player_prop_picks.update({
        where: { id: pp.id },
        data: { hit, actual_value: actual, resolved_at: new Date() },
      });
    }

    await tx.predictions.update({
      where: { id: pred_id },
      data: {
        status: 'resolved',
        actual_home: result.home,
        actual_away: result.away,
        actual_ht_home: result.home_ht ?? null,
        actual_ht_away: result.away_ht ?? null,
        resolved_at: new Date(),
        best_pick_hit: bestPickHit,
      },
    });
  });

  return {
    prediction_id: pred_id,
    sport: prediction.sport as SportCode,
    api_game_id: prediction.fixture_id,
    picks_settled: prediction.picks.length,
    picks_hit: picksHit,
    system_bets_settled: prediction.system_bets.length,
    system_bets_hit: sbHit,
    player_props_settled: prediction.player_prop_picks.length,
    player_props_hit: ppHit,
    errors,
  };
}

/**
 * Map market code → expected stat key in the `player_stats` payload.
 * Keep this aligned with player-props engine output.
 */
function playerStatKeyFor(market: string): string | null {
  const m = market.toUpperCase();
  if (m.includes('POINTS')) return 'points';
  if (m.includes('REBOUNDS') || m === 'REB') return 'rebounds';
  if (m.includes('ASSIST')) return 'assists';
  if (m.includes('STEAL')) return 'steals';
  if (m.includes('BLOCK')) return 'blocks';
  if (m.includes('THREE') || m.includes('3PM')) return 'threes';
  if (m.includes('PRA')) return 'pra';
  if (m.includes('GOAL')) return 'goals';
  if (m.includes('SHOT')) return 'shots';
  if (m.includes('STRIKEOUT') || m.includes('SO')) return 'strikeouts';
  if (m.includes('HIT')) return 'hits';
  if (m.includes('RBI')) return 'rbis';
  if (m.includes('RUNS')) return 'runs';
  return null;
}

/** Bulk settle all pending predictions for a given sport whose game has ended. */
export async function settlePendingPredictions(
  sport: SportCode | 'all',
  fetchResult: (sport: SportCode, api_game_id: number) => Promise<GameResult | null>,
): Promise<{ settled: number; errors: Array<{ id: string; error: string }> }> {
  const where: any = { status: 'pending' };
  if (sport !== 'all') where.sport = sport;
  const pending = await prisma.predictions.findMany({
    where,
    select: { id: true, sport: true, fixture_id: true, match_date: true },
    take: 1000,
  });

  let settled = 0;
  const errors: Array<{ id: string; error: string }> = [];
  for (const p of pending) {
    try {
      if (p.match_date && p.match_date.getTime() > Date.now()) continue;
      const result = await fetchResult(p.sport as SportCode, p.fixture_id);
      if (!result) continue;
      const r = await settlePrediction(p.id, result);
      if (r) settled++;
    } catch (err) {
      errors.push({ id: p.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { settled, errors };
}
