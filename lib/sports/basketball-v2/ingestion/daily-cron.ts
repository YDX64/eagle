/**
 * Daily Incremental Cron Job
 *
 * Called nightly (or on demand) to fetch yesterday's finished games and
 * update the warehouse. Very cheap — ~100 API calls per run vs 15K for
 * full backfill.
 *
 * Tasks:
 *   1. Fetch yesterday's NBA games → upsert + fetch player stats
 *   2. Fetch yesterday's basketball games (all leagues) → upsert
 *   3. Recompute team season aggregates for any team that played yesterday
 *   4. Recompute quarter shares for each (league, season) with new data
 *   5. Advance ELO + Bayesian ratings using yesterday's results
 */

import { upsertGamesBulk } from '../warehouse/games-repo';
import { upsertPlayerLogsBulk } from '../warehouse/player-logs-repo';
import {
  fetchNbaGamesByDate,
} from './api-clients/nba-adapter';
import {
  fetchBasketballGamesByDate,
} from './api-clients/basketball-adapter';
import { nbaApi } from '@/lib/sports/nba/api-nba';
import { nbaPlayerStatsToLog } from './api-clients/nba-adapter';
import type { PlayerGameLog } from '../warehouse/player-logs-repo';

export interface DailyCronResult {
  date: string;
  nbaGamesIngested: number;
  nbaPlayerLogsIngested: number;
  basketballGamesIngested: number;
  errors: string[];
  elapsedMs: number;
  nbaPlayerStatsSkipped?: number;
  nbaRateLimited?: boolean;
}

// Throttle between NBA API calls (api-nba free/paid tier is much stricter
// than api-football). 300ms → ~200 req/min, well under typical limits.
const NBA_THROTTLE_MS = Number(process.env.NBA_THROTTLE_MS || 300);
// Max consecutive rate-limit errors before we abort the loop. Hitting the
// wall repeatedly just wastes quota and spams logs.
const NBA_RATE_LIMIT_ABORT_AFTER = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /rate.?limit|too many requests|exceeded the limit/i.test(msg);
}

/**
 * Run the daily incremental update for a specific date (defaults to yesterday).
 */
export async function runDailyCron(date?: string): Promise<DailyCronResult> {
  const targetDate =
    date ??
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const start = Date.now();
  const result: DailyCronResult = {
    date: targetDate,
    nbaGamesIngested: 0,
    nbaPlayerLogsIngested: 0,
    basketballGamesIngested: 0,
    errors: [],
    elapsedMs: 0,
    nbaPlayerStatsSkipped: 0,
    nbaRateLimited: false,
  };

  // ── NBA games ──
  try {
    const nbaGames = await fetchNbaGamesByDate(targetDate);
    if (nbaGames.length > 0) {
      await upsertGamesBulk(nbaGames);
      result.nbaGamesIngested = nbaGames.length;
    }

    // Fetch player stats for each finished game — WITH throttling and
    // rate-limit-aware abort. Once we detect repeated rate limit errors
    // we stop the loop (continuing would just waste quota and spam logs).
    const playerLogs: PlayerGameLog[] = [];
    let consecutiveRateLimits = 0;
    let abortedDueToRateLimit = false;

    for (const g of nbaGames) {
      if (g.statusShort !== 'FT') continue;
      if (abortedDueToRateLimit) {
        result.nbaPlayerStatsSkipped = (result.nbaPlayerStatsSkipped || 0) + 1;
        continue;
      }
      try {
        const stats = await nbaApi.getGamePlayerStats(g.apiGameId);
        const gameId = `nba:${g.apiGameId}`;
        for (const s of stats) {
          playerLogs.push(nbaPlayerStatsToLog(s, gameId));
        }
        consecutiveRateLimits = 0;
        // Throttle — prevent hammering api-nba
        if (NBA_THROTTLE_MS > 0) await sleep(NBA_THROTTLE_MS);
      } catch (err) {
        if (isRateLimitError(err)) {
          consecutiveRateLimits += 1;
          result.nbaRateLimited = true;
          if (consecutiveRateLimits >= NBA_RATE_LIMIT_ABORT_AFTER) {
            abortedDueToRateLimit = true;
            result.errors.push(
              `NBA player stats: rate-limited, aborting loop after ${consecutiveRateLimits} consecutive errors (remaining games skipped)`
            );
          }
          // Longer backoff after a rate limit
          await sleep(5_000);
        } else {
          result.errors.push(
            `NBA player stats game ${g.apiGameId}: ${err instanceof Error ? err.message : String(err)}`
          );
          consecutiveRateLimits = 0;
        }
      }
    }
    if (playerLogs.length > 0) {
      await upsertPlayerLogsBulk(playerLogs);
      result.nbaPlayerLogsIngested = playerLogs.length;
    }
  } catch (err) {
    if (isRateLimitError(err)) {
      result.nbaRateLimited = true;
    }
    result.errors.push(`NBA ${targetDate}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Basketball games ──
  try {
    const bbGames = await fetchBasketballGamesByDate(targetDate);
    if (bbGames.length > 0) {
      await upsertGamesBulk(bbGames);
      result.basketballGamesIngested = bbGames.length;
    }
  } catch (err) {
    result.errors.push(
      `basketball ${targetDate}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Note: aggregate + rating recomputation happens in a separate step
  // (usually triggered after cron via /api/basketball-v2/recompute-aggregates)
  // because those are pure DB operations and don't need API access.

  result.elapsedMs = Date.now() - start;
  return result;
}
