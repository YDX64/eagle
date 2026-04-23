/**
 * Backfill Job Orchestrator
 *
 * One-shot job to populate the warehouse with historical data:
 *   - NBA: 5 seasons (2021 → 2025)
 *   - Basketball: all leagues returned by api-basketball for 2 seasons
 *
 * Designed to be idempotent: running it twice yields the same warehouse
 * state. Uses bb_backfill_jobs to track progress and avoid double-work.
 *
 * Usage (from API route or CLI):
 *   await runBackfill({
 *     nbaSeasons: [2021, 2022, 2023, 2024, 2025],
 *     basketballLeagues: [12, 120, 79, ...],
 *     basketballSeasons: ['2024-2025', '2025-2026'],
 *   });
 */

import { upsertGamesBulk } from '../warehouse/games-repo';
import { upsertPlayerLogsBulk } from '../warehouse/player-logs-repo';
import { getBbPool } from '../warehouse/connection';
import { ensureBbSchema } from '../warehouse/migrations';
import {
  fetchNbaSeasonGames,
} from './api-clients/nba-adapter';
import {
  fetchBasketballSeasonGames,
} from './api-clients/basketball-adapter';

export interface BackfillConfig {
  nbaSeasons?: number[];
  basketballLeagues?: number[];
  basketballSeasons?: string[];
}

export interface BackfillResult {
  nbaGamesIngested: number;
  nbaPlayerLogsIngested: number;
  basketballGamesIngested: number;
  errors: string[];
  elapsedMs: number;
}

async function recordJob(
  jobType: string,
  source: string,
  target: string,
  status: 'pending' | 'running' | 'done' | 'failed',
  progress: { done: number; total: number },
  error?: string
): Promise<number> {
  await ensureBbSchema();
  const pool = getBbPool();
  const res = await pool.query(
    `
    INSERT INTO bb_backfill_jobs (job_type, source, target, status, progress_done, progress_total, error_message, started_at, finished_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7,
      CASE WHEN $4 IN ('running', 'done', 'failed') THEN NOW() ELSE NULL END,
      CASE WHEN $4 IN ('done', 'failed') THEN NOW() ELSE NULL END)
    RETURNING id
    `,
    [jobType, source, target, status, progress.done, progress.total, error ?? null]
  );
  return res.rows[0].id;
}

async function updateJob(
  id: number,
  status: 'running' | 'done' | 'failed',
  progress: { done: number; total: number },
  error?: string
): Promise<void> {
  const pool = getBbPool();
  await pool.query(
    `
    UPDATE bb_backfill_jobs
    SET status = $2,
        progress_done = $3,
        progress_total = $4,
        error_message = COALESCE($5, error_message),
        finished_at = CASE WHEN $2 IN ('done', 'failed') THEN NOW() ELSE finished_at END
    WHERE id = $1
    `,
    [id, status, progress.done, progress.total, error ?? null]
  );
}

export async function runBackfill(config: BackfillConfig): Promise<BackfillResult> {
  const start = Date.now();
  const result: BackfillResult = {
    nbaGamesIngested: 0,
    nbaPlayerLogsIngested: 0,
    basketballGamesIngested: 0,
    errors: [],
    elapsedMs: 0,
  };

  // ─── NBA Backfill ────────────────────────────────────────────────────────
  if (config.nbaSeasons && config.nbaSeasons.length > 0) {
    for (const season of config.nbaSeasons) {
      const jobId = await recordJob(
        'nba_season_backfill',
        'nba',
        `season ${season}`,
        'running',
        { done: 0, total: 1 }
      );
      try {
        console.log(`[backfill] NBA season ${season} starting...`);
        const { games, playerLogs } = await fetchNbaSeasonGames(season);
        if (games.length > 0) {
          await upsertGamesBulk(games);
          result.nbaGamesIngested += games.length;
        }
        if (playerLogs.length > 0) {
          await upsertPlayerLogsBulk(playerLogs);
          result.nbaPlayerLogsIngested += playerLogs.length;
        }
        await updateJob(jobId, 'done', { done: 1, total: 1 });
        console.log(`[backfill] NBA ${season}: ${games.length} games, ${playerLogs.length} player logs`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`NBA ${season}: ${msg}`);
        await updateJob(jobId, 'failed', { done: 0, total: 1 }, msg);
      }
    }
  }

  // ─── Basketball Backfill (per league per season) ─────────────────────────
  if (
    config.basketballLeagues &&
    config.basketballLeagues.length > 0 &&
    config.basketballSeasons &&
    config.basketballSeasons.length > 0
  ) {
    const totalJobs = config.basketballLeagues.length * config.basketballSeasons.length;
    let doneJobs = 0;

    for (const leagueId of config.basketballLeagues) {
      for (const season of config.basketballSeasons) {
        const jobId = await recordJob(
          'basketball_league_backfill',
          'basketball',
          `league ${leagueId} season ${season}`,
          'running',
          { done: doneJobs, total: totalJobs }
        );
        try {
          const games = await fetchBasketballSeasonGames(leagueId, season);
          if (games.length > 0) {
            await upsertGamesBulk(games);
            result.basketballGamesIngested += games.length;
          }
          doneJobs++;
          await updateJob(jobId, 'done', { done: doneJobs, total: totalJobs });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`basketball ${leagueId}/${season}: ${msg}`);
          await updateJob(jobId, 'failed', { done: doneJobs, total: totalJobs }, msg);
        }
      }
    }
  }

  result.elapsedMs = Date.now() - start;
  return result;
}

/**
 * Quick "has warehouse been populated?" check — used by API routes to
 * decide whether to use Tier 2 warehouse-backed prediction or fall back.
 */
export async function isWarehousePopulated(): Promise<{
  populated: boolean;
  nbaGames: number;
  basketballGames: number;
}> {
  try {
    await ensureBbSchema();
    const pool = getBbPool();
    const res = await pool.query(`
      SELECT source, COUNT(*)::int as count
      FROM bb_games
      WHERE home_score IS NOT NULL AND away_score IS NOT NULL
      GROUP BY source
    `);
    let nba = 0;
    let basketball = 0;
    for (const row of res.rows) {
      if (row.source === 'nba') nba = row.count;
      if (row.source === 'basketball') basketball = row.count;
    }
    return {
      populated: nba + basketball > 100,
      nbaGames: nba,
      basketballGames: basketball,
    };
  } catch {
    return { populated: false, nbaGames: 0, basketballGames: 0 };
  }
}
