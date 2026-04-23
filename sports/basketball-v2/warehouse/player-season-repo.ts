/**
 * Player Season Averages Repository — bb_player_season_averages table
 *
 * Cached per-player per-season averages + standard deviations + empirical
 * stat correlations (for DD/TD combo probability modeling).
 */

import { getBbPool } from './connection';
import { ensureBbSchema } from './migrations';

export interface PlayerSeasonAverage {
  source: 'nba';
  playerId: number;
  playerName: string | null;
  teamId: number;
  teamName: string | null;
  season: string;
  gamesPlayed: number;
  gamesStarted: number;

  mpg: number;
  ppg: number;
  rpg: number;
  apg: number;
  spg: number;
  bpg: number;
  topg: number;
  tpmpg: number;
  tpapg: number;
  fgPct: number;
  ftPct: number;
  tpPct: number;
  plusMinusAvg: number;
  usageRate: number | null;

  ppgStd: number;
  rpgStd: number;
  apgStd: number;
  tpmpgStd: number;

  /**
   * Empirical Pearson correlations between stats:
   *   pts_reb, pts_ast, reb_ast, pts_3pm, ast_3pm, etc.
   * Used for multivariate normal sampling in player prop combos.
   */
  correlations: Record<string, number> | null;
}

export async function upsertPlayerSeasonAverage(
  avg: PlayerSeasonAverage
): Promise<void> {
  await ensureBbSchema();
  const pool = getBbPool();
  await pool.query(
    `
    INSERT INTO bb_player_season_averages (
      source, player_id, player_name, team_id, team_name, season,
      games_played, games_started, mpg, ppg, rpg, apg, spg, bpg, topg,
      tpmpg, tpapg, fg_pct, ft_pct, tp_pct, plus_minus_avg, usage_rate,
      ppg_std, rpg_std, apg_std, tpmpg_std, correlations, computed_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
      $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27::jsonb, NOW()
    )
    ON CONFLICT (source, player_id, season) DO UPDATE SET
      player_name = EXCLUDED.player_name,
      team_id = EXCLUDED.team_id,
      team_name = EXCLUDED.team_name,
      games_played = EXCLUDED.games_played,
      games_started = EXCLUDED.games_started,
      mpg = EXCLUDED.mpg, ppg = EXCLUDED.ppg, rpg = EXCLUDED.rpg,
      apg = EXCLUDED.apg, spg = EXCLUDED.spg, bpg = EXCLUDED.bpg,
      topg = EXCLUDED.topg, tpmpg = EXCLUDED.tpmpg, tpapg = EXCLUDED.tpapg,
      fg_pct = EXCLUDED.fg_pct, ft_pct = EXCLUDED.ft_pct, tp_pct = EXCLUDED.tp_pct,
      plus_minus_avg = EXCLUDED.plus_minus_avg, usage_rate = EXCLUDED.usage_rate,
      ppg_std = EXCLUDED.ppg_std, rpg_std = EXCLUDED.rpg_std,
      apg_std = EXCLUDED.apg_std, tpmpg_std = EXCLUDED.tpmpg_std,
      correlations = EXCLUDED.correlations,
      computed_at = NOW()
    `,
    [
      avg.source, avg.playerId, avg.playerName, avg.teamId, avg.teamName, avg.season,
      avg.gamesPlayed, avg.gamesStarted, avg.mpg, avg.ppg, avg.rpg, avg.apg,
      avg.spg, avg.bpg, avg.topg, avg.tpmpg, avg.tpapg, avg.fgPct, avg.ftPct,
      avg.tpPct, avg.plusMinusAvg, avg.usageRate, avg.ppgStd, avg.rpgStd,
      avg.apgStd, avg.tpmpgStd,
      avg.correlations ? JSON.stringify(avg.correlations) : null,
    ]
  );
}

function rowToAvg(row: any): PlayerSeasonAverage {
  return {
    source: row.source,
    playerId: row.player_id,
    playerName: row.player_name,
    teamId: row.team_id,
    teamName: row.team_name,
    season: row.season,
    gamesPlayed: row.games_played,
    gamesStarted: row.games_started,
    mpg: row.mpg ? parseFloat(row.mpg) : 0,
    ppg: row.ppg ? parseFloat(row.ppg) : 0,
    rpg: row.rpg ? parseFloat(row.rpg) : 0,
    apg: row.apg ? parseFloat(row.apg) : 0,
    spg: row.spg ? parseFloat(row.spg) : 0,
    bpg: row.bpg ? parseFloat(row.bpg) : 0,
    topg: row.topg ? parseFloat(row.topg) : 0,
    tpmpg: row.tpmpg ? parseFloat(row.tpmpg) : 0,
    tpapg: row.tpapg ? parseFloat(row.tpapg) : 0,
    fgPct: row.fg_pct ? parseFloat(row.fg_pct) : 0,
    ftPct: row.ft_pct ? parseFloat(row.ft_pct) : 0,
    tpPct: row.tp_pct ? parseFloat(row.tp_pct) : 0,
    plusMinusAvg: row.plus_minus_avg ? parseFloat(row.plus_minus_avg) : 0,
    usageRate: row.usage_rate ? parseFloat(row.usage_rate) : null,
    ppgStd: row.ppg_std ? parseFloat(row.ppg_std) : 0,
    rpgStd: row.rpg_std ? parseFloat(row.rpg_std) : 0,
    apgStd: row.apg_std ? parseFloat(row.apg_std) : 0,
    tpmpgStd: row.tpmpg_std ? parseFloat(row.tpmpg_std) : 0,
    correlations: row.correlations,
  };
}

export async function getPlayerSeasonAverage(
  playerId: number,
  season: string
): Promise<PlayerSeasonAverage | null> {
  await ensureBbSchema();
  const pool = getBbPool();
  const res = await pool.query(
    `SELECT * FROM bb_player_season_averages
     WHERE source = 'nba' AND player_id = $1 AND season = $2`,
    [playerId, season]
  );
  return res.rows[0] ? rowToAvg(res.rows[0]) : null;
}

/**
 * Get all players for a team's roster, ordered by PPG (starting 5 first).
 */
export async function getTeamPlayerAverages(
  teamId: number,
  season: string
): Promise<PlayerSeasonAverage[]> {
  await ensureBbSchema();
  const pool = getBbPool();
  const res = await pool.query(
    `SELECT * FROM bb_player_season_averages
     WHERE source = 'nba' AND team_id = $1 AND season = $2
     ORDER BY ppg DESC`,
    [teamId, season]
  );
  return res.rows.map(rowToAvg);
}

/**
 * Cross-source lookup — get players by team NAME match instead of ID.
 *
 * This is critical for NBA games fetched via basketball-api (which uses
 * different team IDs than the NBA api-v2). When a basketball-api game
 * is played by an NBA team, we can still enrich it with NBA-api player
 * data via team name matching.
 *
 * Season mapping: basketball-api uses "2024-2025" while NBA api uses
 * "2024" — we try multiple candidate seasons and pick the one with data.
 */
export async function getTeamPlayerAveragesByName(
  teamName: string,
  basketballSeason: string
): Promise<PlayerSeasonAverage[]> {
  await ensureBbSchema();
  const pool = getBbPool();

  // Map basketball-api season string to NBA api candidate seasons
  // "2025-2026" → try ["2025", "2026"]
  // "2025"       → try ["2025"]
  const candidateSeasons = deriveNbaSeasonCandidates(basketballSeason);

  // Try each candidate season, preferring the most recent with data
  for (const season of candidateSeasons) {
    const res = await pool.query(
      `SELECT * FROM bb_player_season_averages
       WHERE source = 'nba'
         AND LOWER(team_name) = LOWER($1)
         AND season = $2
       ORDER BY ppg DESC`,
      [teamName, season]
    );
    if (res.rows.length > 0) {
      return res.rows.map(rowToAvg);
    }
  }

  // Fallback: exact name match across any season (most recent)
  const fallback = await pool.query(
    `SELECT * FROM bb_player_season_averages
     WHERE source = 'nba'
       AND LOWER(team_name) = LOWER($1)
     ORDER BY season DESC, ppg DESC
     LIMIT 25`,
    [teamName]
  );
  return fallback.rows.map(rowToAvg);
}

/**
 * Given a basketball-api season like "2024-2025" or "2025", produce
 * candidate NBA-api season strings ordered by preference.
 */
function deriveNbaSeasonCandidates(basketballSeason: string): string[] {
  const match = basketballSeason.match(/^(\d{4})(?:-(\d{4}))?$/);
  if (!match) return [basketballSeason];
  const first = match[1];
  const second = match[2];
  if (second) {
    // "2025-2026" → prefer "2025" (NBA convention: first year of season)
    return [first, second];
  }
  return [first];
}
