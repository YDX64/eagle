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
  };

  // ── NBA games ──
  try {
    const nbaGames = await fetchNbaGamesByDate(targetDate);
    if (nbaGames.length > 0) {
      await upsertGamesBulk(nbaGames);
      result.nbaGamesIngested = nbaGames.length;
    }
    // Fetch player stats for each finished game
    const playerLogs: PlayerGameLog[] = [];
    for (const g of nbaGames) {
      if (g.statusShort !== 'FT') continue;
      try {
        const stats = await nbaApi.getGamePlayerStats(g.apiGameId);
        const gameId = `nba:${g.apiGameId}`;
        for (const s of stats) {
          playerLogs.push(nbaPlayerStatsToLog(s, gameId));
        }
      } catch (err) {
        result.errors.push(
          `NBA player stats game ${g.apiGameId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    if (playerLogs.length > 0) {
      await upsertPlayerLogsBulk(playerLogs);
      result.nbaPlayerLogsIngested = playerLogs.length;
    }
  } catch (err) {
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
