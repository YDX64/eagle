/**
 * Games Repository — bb_games table
 *
 * Unified access layer for both NBA and basketball games. All reads return
 * a canonical shape regardless of source API.
 */

import { getBbPool } from './connection';
import { ensureBbSchema } from './migrations';

export interface CanonicalGame {
  id: string;                     // 'nba:16677' or 'basketball:487665'
  source: 'nba' | 'basketball';
  apiGameId: number;
  leagueId: number;
  leagueName: string | null;
  season: string;
  gameDate: string;               // ISO timestamp
  statusShort: string | null;
  statusLong: string | null;
  homeTeamId: number;
  homeTeamName: string;
  homeTeamCode: string | null;
  awayTeamId: number;
  awayTeamName: string;
  awayTeamCode: string | null;
  homeScore: number | null;
  awayScore: number | null;
  homeLinescore: number[] | null;
  awayLinescore: number[] | null;
  venueName: string | null;
  venueCity: string | null;
}

export interface UpsertGameInput extends Omit<CanonicalGame, 'id'> {
  rawData?: unknown;
}

/**
 * UPSERT a game by (source, apiGameId). Updates all mutable fields.
 */
export async function upsertGame(input: UpsertGameInput): Promise<string> {
  await ensureBbSchema();
  const pool = getBbPool();
  const id = `${input.source}:${input.apiGameId}`;

  await pool.query(
    `
    INSERT INTO bb_games (
      id, source, api_game_id, league_id, league_name, season,
      game_date, status_short, status_long,
      home_team_id, home_team_name, home_team_code,
      away_team_id, away_team_name, away_team_code,
      home_score, away_score, home_linescore, away_linescore,
      venue_name, venue_city, raw_data, fetched_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
      $16, $17, $18::jsonb, $19::jsonb, $20, $21, $22::jsonb, NOW(), NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      status_short   = EXCLUDED.status_short,
      status_long    = EXCLUDED.status_long,
      home_score     = EXCLUDED.home_score,
      away_score     = EXCLUDED.away_score,
      home_linescore = EXCLUDED.home_linescore,
      away_linescore = EXCLUDED.away_linescore,
      raw_data       = EXCLUDED.raw_data,
      updated_at     = NOW()
    `,
    [
      id,
      input.source,
      input.apiGameId,
      input.leagueId,
      input.leagueName,
      input.season,
      input.gameDate,
      input.statusShort,
      input.statusLong,
      input.homeTeamId,
      input.homeTeamName,
      input.homeTeamCode,
      input.awayTeamId,
      input.awayTeamName,
      input.awayTeamCode,
      input.homeScore,
      input.awayScore,
      input.homeLinescore ? JSON.stringify(input.homeLinescore) : null,
      input.awayLinescore ? JSON.stringify(input.awayLinescore) : null,
      input.venueName,
      input.venueCity,
      input.rawData ? JSON.stringify(input.rawData) : null,
    ]
  );

  return id;
}

/**
 * Bulk UPSERT — used by backfill jobs for efficiency.
 */
export async function upsertGamesBulk(games: UpsertGameInput[]): Promise<number> {
  if (games.length === 0) return 0;
  await ensureBbSchema();
  const pool = getBbPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    for (const g of games) {
      const id = `${g.source}:${g.apiGameId}`;
      await client.query(
        `
        INSERT INTO bb_games (
          id, source, api_game_id, league_id, league_name, season,
          game_date, status_short, status_long,
          home_team_id, home_team_name, home_team_code,
          away_team_id, away_team_name, away_team_code,
          home_score, away_score, home_linescore, away_linescore,
          venue_name, venue_city, raw_data, fetched_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18::jsonb, $19::jsonb, $20, $21, $22::jsonb, NOW(), NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          status_short   = EXCLUDED.status_short,
          status_long    = EXCLUDED.status_long,
          home_score     = EXCLUDED.home_score,
          away_score     = EXCLUDED.away_score,
          home_linescore = EXCLUDED.home_linescore,
          away_linescore = EXCLUDED.away_linescore,
          raw_data       = EXCLUDED.raw_data,
          updated_at     = NOW()
        `,
        [
          id,
          g.source,
          g.apiGameId,
          g.leagueId,
          g.leagueName,
          g.season,
          g.gameDate,
          g.statusShort,
          g.statusLong,
          g.homeTeamId,
          g.homeTeamName,
          g.homeTeamCode,
          g.awayTeamId,
          g.awayTeamName,
          g.awayTeamCode,
          g.homeScore,
          g.awayScore,
          g.homeLinescore ? JSON.stringify(g.homeLinescore) : null,
          g.awayLinescore ? JSON.stringify(g.awayLinescore) : null,
          g.venueName,
          g.venueCity,
          g.rawData ? JSON.stringify(g.rawData) : null,
        ]
      );
    }
    await client.query('COMMIT');
    return games.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

function rowToGame(row: any): CanonicalGame {
  return {
    id: row.id,
    source: row.source,
    apiGameId: row.api_game_id,
    leagueId: row.league_id,
    leagueName: row.league_name,
    season: row.season,
    gameDate: row.game_date instanceof Date ? row.game_date.toISOString() : row.game_date,
    statusShort: row.status_short,
    statusLong: row.status_long,
    homeTeamId: row.home_team_id,
    homeTeamName: row.home_team_name,
    homeTeamCode: row.home_team_code,
    awayTeamId: row.away_team_id,
    awayTeamName: row.away_team_name,
    awayTeamCode: row.away_team_code,
    homeScore: row.home_score,
    awayScore: row.away_score,
    homeLinescore: row.home_linescore,
    awayLinescore: row.away_linescore,
    venueName: row.venue_name,
    venueCity: row.venue_city,
  };
}

export async function getGameById(id: string): Promise<CanonicalGame | null> {
  await ensureBbSchema();
  const pool = getBbPool();
  const res = await pool.query('SELECT * FROM bb_games WHERE id = $1', [id]);
  return res.rows[0] ? rowToGame(res.rows[0]) : null;
}

export async function getGameByApiId(
  source: 'nba' | 'basketball',
  apiGameId: number
): Promise<CanonicalGame | null> {
  return getGameById(`${source}:${apiGameId}`);
}

/**
 * Recent finished games for a team — used by feature engineering.
 */
export async function getRecentFinishedGames(
  source: 'nba' | 'basketball',
  teamId: number,
  limit: number = 20,
  beforeDate?: Date
): Promise<CanonicalGame[]> {
  await ensureBbSchema();
  const pool = getBbPool();
  const cutoff = beforeDate ? beforeDate.toISOString() : new Date().toISOString();

  const res = await pool.query(
    `
    SELECT * FROM bb_games
    WHERE source = $1
      AND (home_team_id = $2 OR away_team_id = $2)
      AND home_score IS NOT NULL
      AND away_score IS NOT NULL
      AND game_date < $3
    ORDER BY game_date DESC
    LIMIT $4
    `,
    [source, teamId, cutoff, limit]
  );

  return res.rows.map(rowToGame);
}

/**
 * Head-to-head games between two teams.
 */
export async function getHeadToHead(
  source: 'nba' | 'basketball',
  team1: number,
  team2: number,
  limit: number = 10
): Promise<CanonicalGame[]> {
  await ensureBbSchema();
  const pool = getBbPool();
  const res = await pool.query(
    `
    SELECT * FROM bb_games
    WHERE source = $1
      AND home_score IS NOT NULL AND away_score IS NOT NULL
      AND (
        (home_team_id = $2 AND away_team_id = $3)
        OR (home_team_id = $3 AND away_team_id = $2)
      )
    ORDER BY game_date DESC
    LIMIT $4
    `,
    [source, team1, team2, limit]
  );
  return res.rows.map(rowToGame);
}

/**
 * All finished games in a season (for batch computing aggregates).
 */
export async function getSeasonGames(
  source: 'nba' | 'basketball',
  leagueId: number,
  season: string,
  onlyFinished: boolean = true
): Promise<CanonicalGame[]> {
  await ensureBbSchema();
  const pool = getBbPool();
  const where = onlyFinished
    ? 'home_score IS NOT NULL AND away_score IS NOT NULL AND'
    : '';
  const res = await pool.query(
    `
    SELECT * FROM bb_games
    WHERE ${where} source = $1 AND league_id = $2 AND season = $3
    ORDER BY game_date ASC
    `,
    [source, leagueId, season]
  );
  return res.rows.map(rowToGame);
}

/**
 * Count games per source/league for reporting.
 */
export async function countGames(): Promise<
  Array<{ source: string; leagueId: number; season: string; count: number }>
> {
  await ensureBbSchema();
  const pool = getBbPool();
  const res = await pool.query(`
    SELECT source, league_id as "leagueId", season, COUNT(*)::int as count
    FROM bb_games
    GROUP BY source, league_id, season
    ORDER BY count DESC
  `);
  return res.rows;
}
