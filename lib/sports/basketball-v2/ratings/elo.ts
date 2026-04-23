/**
 * ELO Rating System for Basketball
 *
 * Adapted from FiveThirtyEight's NBA ELO methodology:
 *   - Starting rating: 1500 (league average)
 *   - K-factor: 20 (lower than chess to reduce noise)
 *   - Margin of victory multiplier: log(margin + 1) * 2.2 / (rating_diff * 0.001 + 2.2)
 *   - Home court advantage: +100 ELO points
 *
 * Reference: https://fivethirtyeight.com/features/how-our-nba-predictions-work/
 */

import type { CanonicalGame } from '../warehouse/games-repo';

export interface EloUpdate {
  homeOldElo: number;
  awayOldElo: number;
  homeNewElo: number;
  awayNewElo: number;
  homeWinProbBefore: number;
  delta: number;
}

export const ELO_DEFAULT = 1500;
export const ELO_K_FACTOR = 20;
export const ELO_HOME_COURT = 100;

/**
 * Compute pre-game home win probability from ELO ratings.
 */
export function eloWinProbability(homeElo: number, awayElo: number): number {
  const eloDiff = homeElo + ELO_HOME_COURT - awayElo;
  return 1 / (1 + Math.pow(10, -eloDiff / 400));
}

/**
 * Margin-of-victory multiplier from FiveThirtyEight.
 * Larger wins → larger ELO updates, but with diminishing returns and
 * autocorrelation correction (so blowouts don't double-count).
 */
function marginMultiplier(margin: number, eloDiff: number): number {
  const absMargin = Math.abs(margin);
  return Math.log(absMargin + 1) * (2.2 / (Math.abs(eloDiff) * 0.001 + 2.2));
}

/**
 * Update ELO ratings after a game completes.
 */
export function updateElo(
  homeElo: number,
  awayElo: number,
  homeScore: number,
  awayScore: number
): EloUpdate {
  const homeWinProb = eloWinProbability(homeElo, awayElo);
  const margin = homeScore - awayScore;
  const eloDiff = homeElo + ELO_HOME_COURT - awayElo;

  // Actual result: 1 = home win, 0 = away win
  const homeActual = margin > 0 ? 1 : 0;

  // Margin multiplier
  const movMult = marginMultiplier(margin, eloDiff);

  // ELO update
  const delta = ELO_K_FACTOR * movMult * (homeActual - homeWinProb);

  return {
    homeOldElo: homeElo,
    awayOldElo: awayElo,
    homeNewElo: homeElo + delta,
    awayNewElo: awayElo - delta,
    homeWinProbBefore: homeWinProb,
    delta,
  };
}

/**
 * Run ELO from scratch over a sequence of games (chronological).
 * Returns the final rating for every team that appeared.
 *
 * Used after backfill to compute complete rating history.
 */
export function runEloHistory(
  games: CanonicalGame[]
): Map<number, { rating: number; gamesPlayed: number }> {
  // Sort games chronologically
  const sorted = [...games].sort(
    (a, b) => new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime()
  );

  const ratings = new Map<number, { rating: number; gamesPlayed: number }>();

  for (const g of sorted) {
    if (g.homeScore === null || g.awayScore === null) continue;

    const homeRating = ratings.get(g.homeTeamId) ?? { rating: ELO_DEFAULT, gamesPlayed: 0 };
    const awayRating = ratings.get(g.awayTeamId) ?? { rating: ELO_DEFAULT, gamesPlayed: 0 };

    const update = updateElo(homeRating.rating, awayRating.rating, g.homeScore, g.awayScore);

    ratings.set(g.homeTeamId, {
      rating: update.homeNewElo,
      gamesPlayed: homeRating.gamesPlayed + 1,
    });
    ratings.set(g.awayTeamId, {
      rating: update.awayNewElo,
      gamesPlayed: awayRating.gamesPlayed + 1,
    });
  }

  return ratings;
}

/**
 * Run ELO and emit per-game snapshots for time-series storage.
 * This is what the backfill cron uses to populate bb_team_ratings.
 */
export function runEloHistoryWithSnapshots(
  games: CanonicalGame[]
): Array<{
  gameDate: string;
  teamId: number;
  rating: number;
  gamesPlayed: number;
}> {
  const sorted = [...games].sort(
    (a, b) => new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime()
  );

  const ratings = new Map<number, { rating: number; gamesPlayed: number }>();
  const snapshots: Array<{
    gameDate: string;
    teamId: number;
    rating: number;
    gamesPlayed: number;
  }> = [];

  for (const g of sorted) {
    if (g.homeScore === null || g.awayScore === null) continue;
    const dateStr = g.gameDate.slice(0, 10);

    const homeRating = ratings.get(g.homeTeamId) ?? { rating: ELO_DEFAULT, gamesPlayed: 0 };
    const awayRating = ratings.get(g.awayTeamId) ?? { rating: ELO_DEFAULT, gamesPlayed: 0 };

    const update = updateElo(homeRating.rating, awayRating.rating, g.homeScore, g.awayScore);

    const newHome = { rating: update.homeNewElo, gamesPlayed: homeRating.gamesPlayed + 1 };
    const newAway = { rating: update.awayNewElo, gamesPlayed: awayRating.gamesPlayed + 1 };
    ratings.set(g.homeTeamId, newHome);
    ratings.set(g.awayTeamId, newAway);

    snapshots.push({
      gameDate: dateStr,
      teamId: g.homeTeamId,
      rating: newHome.rating,
      gamesPlayed: newHome.gamesPlayed,
    });
    snapshots.push({
      gameDate: dateStr,
      teamId: g.awayTeamId,
      rating: newAway.rating,
      gamesPlayed: newAway.gamesPlayed,
    });
  }

  return snapshots;
}

/**
 * Convert ELO win probability to a points spread for the moneyline.
 * Useful for setting initial spread expectations.
 *
 * Approximation: 100 ELO points ≈ 3.0 spread points
 */
export function eloToPointSpread(homeElo: number, awayElo: number): number {
  const eloDiff = homeElo + ELO_HOME_COURT - awayElo;
  return -(eloDiff / 100) * 3.0;
}
