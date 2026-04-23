/**
 * Team Ratings Repository — bb_team_ratings table
 *
 * Time series of team ratings (ELO, Bayesian, Massey, composite) per
 * (source, league, season, team, as_of_date).
 *
 * - ELO updated after every game (sequential).
 * - Bayesian posterior updated after every game (conjugate normal update).
 * - Massey recomputed periodically from game results.
 * - Composite is the blended rating for request-time use.
 *
 * We query `bb_team_ratings` for the latest rating as-of the game date, so
 * predictions reflect only data known BEFORE the predicted game (no leakage).
 */

import { getBbPool } from './connection';
import { ensureBbSchema } from './migrations';

export interface TeamRating {
  source: 'nba' | 'basketball';
  leagueId: number;
  season: string;
  teamId: number;
  asOfDate: string;           // YYYY-MM-DD

  elo: number;
  eloGames: number;

  offMean: number | null;
  offVar: number | null;
  defMean: number | null;
  defVar: number | null;

  massey: number | null;

  composite: number | null;

  homeAdv: number;
}

export async function upsertRating(rating: TeamRating): Promise<void> {
  await ensureBbSchema();
  const pool = getBbPool();
  await pool.query(
    `
    INSERT INTO bb_team_ratings (
      source, league_id, season, team_id, as_of_date,
      elo, elo_games, off_mean, off_var, def_mean, def_var,
      massey, composite, home_adv
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    ON CONFLICT (source, league_id, season, team_id, as_of_date) DO UPDATE SET
      elo = EXCLUDED.elo,
      elo_games = EXCLUDED.elo_games,
      off_mean = EXCLUDED.off_mean,
      off_var = EXCLUDED.off_var,
      def_mean = EXCLUDED.def_mean,
      def_var = EXCLUDED.def_var,
      massey = EXCLUDED.massey,
      composite = EXCLUDED.composite,
      home_adv = EXCLUDED.home_adv
    `,
    [
      rating.source, rating.leagueId, rating.season, rating.teamId, rating.asOfDate,
      rating.elo, rating.eloGames, rating.offMean, rating.offVar,
      rating.defMean, rating.defVar, rating.massey, rating.composite, rating.homeAdv,
    ]
  );
}

function rowToRating(row: any): TeamRating {
  return {
    source: row.source,
    leagueId: row.league_id,
    season: row.season,
    teamId: row.team_id,
    asOfDate: row.as_of_date instanceof Date
      ? row.as_of_date.toISOString().slice(0, 10)
      : row.as_of_date,
    elo: parseFloat(row.elo),
    eloGames: row.elo_games,
    offMean: row.off_mean ? parseFloat(row.off_mean) : null,
    offVar: row.off_var ? parseFloat(row.off_var) : null,
    defMean: row.def_mean ? parseFloat(row.def_mean) : null,
    defVar: row.def_var ? parseFloat(row.def_var) : null,
    massey: row.massey ? parseFloat(row.massey) : null,
    composite: row.composite ? parseFloat(row.composite) : null,
    homeAdv: row.home_adv ? parseFloat(row.home_adv) : 0,
  };
}

/**
 * Get the most recent rating for a team as-of the given date.
 * CRITICAL: This must return ratings from BEFORE the prediction date to
 * avoid data leakage. Used at prediction time.
 */
export async function getRatingAsOf(
  source: 'nba' | 'basketball',
  leagueId: number,
  season: string,
  teamId: number,
  asOf: Date | string
): Promise<TeamRating | null> {
  await ensureBbSchema();
  const pool = getBbPool();
  const cutoff = typeof asOf === 'string' ? asOf : asOf.toISOString().slice(0, 10);
  const res = await pool.query(
    `
    SELECT * FROM bb_team_ratings
    WHERE source = $1 AND league_id = $2 AND season = $3 AND team_id = $4
      AND as_of_date < $5
    ORDER BY as_of_date DESC
    LIMIT 1
    `,
    [source, leagueId, season, teamId, cutoff]
  );
  return res.rows[0] ? rowToRating(res.rows[0]) : null;
}

/**
 * Get the single most recent rating (used after backfill).
 */
export async function getCurrentRating(
  source: 'nba' | 'basketball',
  leagueId: number,
  season: string,
  teamId: number
): Promise<TeamRating | null> {
  await ensureBbSchema();
  const pool = getBbPool();
  const res = await pool.query(
    `
    SELECT * FROM bb_team_ratings
    WHERE source = $1 AND league_id = $2 AND season = $3 AND team_id = $4
    ORDER BY as_of_date DESC
    LIMIT 1
    `,
    [source, leagueId, season, teamId]
  );
  return res.rows[0] ? rowToRating(res.rows[0]) : null;
}

/**
 * Bulk delete ratings for a season (used when rebuilding from scratch).
 */
export async function deleteSeasonRatings(
  source: 'nba' | 'basketball',
  leagueId: number,
  season: string
): Promise<number> {
  await ensureBbSchema();
  const pool = getBbPool();
  const res = await pool.query(
    `DELETE FROM bb_team_ratings WHERE source = $1 AND league_id = $2 AND season = $3`,
    [source, leagueId, season]
  );
  return res.rowCount || 0;
}

/**
 * Get rating history for a team (time series) — used in "team ratings over
 * time" charts and for backtest debugging.
 */
export async function getRatingHistory(
  source: 'nba' | 'basketball',
  leagueId: number,
  season: string,
  teamId: number
): Promise<TeamRating[]> {
  await ensureBbSchema();
  const pool = getBbPool();
  const res = await pool.query(
    `
    SELECT * FROM bb_team_ratings
    WHERE source = $1 AND league_id = $2 AND season = $3 AND team_id = $4
    ORDER BY as_of_date ASC
    `,
    [source, leagueId, season, teamId]
  );
  return res.rows.map(rowToRating);
}
