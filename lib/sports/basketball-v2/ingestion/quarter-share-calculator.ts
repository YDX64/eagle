/**
 * Empirical Quarter Share Calculator
 *
 * Computes per-league per-season empirical quarter share distribution from
 * stored game linescores. Replaces hardcoded constants like [24.5%, 25.5%]
 * with actual league behavior.
 *
 * Run after backfill and nightly after daily-cron.
 */

import { getBbPool } from '../warehouse/connection';
import { ensureBbSchema } from '../warehouse/migrations';
import { upsertQuarterShares } from '../warehouse/quarter-shares-repo';

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Compute quarter shares from all finished games for a (source, league, season).
 *
 * Algorithm:
 *   For each game:
 *     total = home_points + away_points
 *     q_i_share = (home_q_i + away_q_i) / total
 *   Compute per-quarter mean + stddev across all games.
 */
export async function computeQuarterShares(
  source: 'nba' | 'basketball',
  leagueId: number,
  season: string
): Promise<{ sampleGames: number; q1: number; q2: number; q3: number; q4: number } | null> {
  await ensureBbSchema();
  const pool = getBbPool();

  const res = await pool.query(
    `
    SELECT home_linescore, away_linescore, home_score, away_score
    FROM bb_games
    WHERE source = $1 AND league_id = $2 AND season = $3
      AND home_score IS NOT NULL AND away_score IS NOT NULL
      AND home_linescore IS NOT NULL AND away_linescore IS NOT NULL
    `,
    [source, leagueId, season]
  );

  if (res.rows.length < 10) return null; // Not enough data

  const q1Shares: number[] = [];
  const q2Shares: number[] = [];
  const q3Shares: number[] = [];
  const q4Shares: number[] = [];

  for (const row of res.rows) {
    const homeLs = row.home_linescore as number[] | null;
    const awayLs = row.away_linescore as number[] | null;
    if (!homeLs || !awayLs || homeLs.length < 4 || awayLs.length < 4) continue;

    // Only use first 4 quarters (ignore OT for share calc)
    const q = [0, 1, 2, 3].map((i) => (homeLs[i] || 0) + (awayLs[i] || 0));
    const total = q[0] + q[1] + q[2] + q[3];
    if (total <= 0) continue;

    q1Shares.push(q[0] / total);
    q2Shares.push(q[1] / total);
    q3Shares.push(q[2] / total);
    q4Shares.push(q[3] / total);
  }

  if (q1Shares.length < 10) return null;

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  const q1 = avg(q1Shares);
  const q2 = avg(q2Shares);
  const q3 = avg(q3Shares);
  const q4 = avg(q4Shares);

  // Normalize so they sum to exactly 1 (tiny rounding can drift)
  const sum = q1 + q2 + q3 + q4;
  const q1n = q1 / sum;
  const q2n = q2 / sum;
  const q3n = q3 / sum;
  const q4n = q4 / sum;

  await upsertQuarterShares({
    source,
    leagueId,
    season,
    q1Share: q1n,
    q2Share: q2n,
    q3Share: q3n,
    q4Share: q4n,
    fhShare: q1n + q2n,
    shShare: q3n + q4n,
    q1Std: stddev(q1Shares),
    q2Std: stddev(q2Shares),
    q3Std: stddev(q3Shares),
    q4Std: stddev(q4Shares),
    sampleGames: q1Shares.length,
  });

  return { sampleGames: q1Shares.length, q1: q1n, q2: q2n, q3: q3n, q4: q4n };
}

/**
 * Recompute quarter shares for ALL (source, league, season) combos that have
 * games in the warehouse. Called after backfill + nightly after daily cron.
 */
export async function recomputeAllQuarterShares(): Promise<number> {
  await ensureBbSchema();
  const pool = getBbPool();

  const res = await pool.query(`
    SELECT DISTINCT source, league_id, season
    FROM bb_games
    WHERE home_linescore IS NOT NULL AND away_linescore IS NOT NULL
  `);

  let count = 0;
  for (const row of res.rows) {
    try {
      const result = await computeQuarterShares(row.source, row.league_id, row.season);
      if (result) count++;
    } catch (err) {
      console.warn(
        `[quarter-share-calc] ${row.source} ${row.league_id}/${row.season}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  return count;
}
