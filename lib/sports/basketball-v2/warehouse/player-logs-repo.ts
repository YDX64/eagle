/**
 * Player Game Logs Repository — bb_player_game_logs table
 *
 * NBA-only (basketball v1 API doesn't expose per-player stats).
 * Stores every NBA player's box score for every game.
 */

import { getBbPool } from './connection';
import { ensureBbSchema } from './migrations';

export interface PlayerGameLog {
  source: 'nba';
  gameId: string;
  apiGameId: number;
  playerId: number;
  playerName: string | null;
  teamId: number;
  teamName: string | null;

  minutes: number | null;
  points: number | null;
  fgm: number | null;
  fga: number | null;
  ftm: number | null;
  fta: number | null;
  tpm: number | null;
  tpa: number | null;
  offReb: number | null;
  defReb: number | null;
  totalReb: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  personalFouls: number | null;
  plusMinus: number | null;

  position: string | null;
  isStarter: boolean | null;
  dnp: boolean;
}

export async function upsertPlayerLogsBulk(logs: PlayerGameLog[]): Promise<number> {
  if (logs.length === 0) return 0;
  await ensureBbSchema();
  const pool = getBbPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    for (const log of logs) {
      await client.query(
        `
        INSERT INTO bb_player_game_logs (
          source, game_id, api_game_id, player_id, player_name,
          team_id, team_name, minutes, points, fgm, fga, ftm, fta,
          tpm, tpa, off_reb, def_reb, total_reb, assists, steals,
          blocks, turnovers, personal_fouls, plus_minus,
          position, is_starter, dnp, fetched_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
          $25, $26, $27, NOW()
        )
        ON CONFLICT (source, api_game_id, player_id) DO UPDATE SET
          minutes = EXCLUDED.minutes,
          points = EXCLUDED.points,
          fgm = EXCLUDED.fgm, fga = EXCLUDED.fga,
          ftm = EXCLUDED.ftm, fta = EXCLUDED.fta,
          tpm = EXCLUDED.tpm, tpa = EXCLUDED.tpa,
          off_reb = EXCLUDED.off_reb, def_reb = EXCLUDED.def_reb,
          total_reb = EXCLUDED.total_reb, assists = EXCLUDED.assists,
          steals = EXCLUDED.steals, blocks = EXCLUDED.blocks,
          turnovers = EXCLUDED.turnovers,
          personal_fouls = EXCLUDED.personal_fouls,
          plus_minus = EXCLUDED.plus_minus,
          position = EXCLUDED.position,
          is_starter = EXCLUDED.is_starter,
          dnp = EXCLUDED.dnp,
          fetched_at = NOW()
        `,
        [
          log.source, log.gameId, log.apiGameId, log.playerId, log.playerName,
          log.teamId, log.teamName, log.minutes, log.points, log.fgm, log.fga,
          log.ftm, log.fta, log.tpm, log.tpa, log.offReb, log.defReb,
          log.totalReb, log.assists, log.steals, log.blocks, log.turnovers,
          log.personalFouls, log.plusMinus, log.position, log.isStarter, log.dnp,
        ]
      );
    }
    await client.query('COMMIT');
    return logs.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function rowToLog(row: any): PlayerGameLog {
  return {
    source: row.source,
    gameId: row.game_id,
    apiGameId: row.api_game_id,
    playerId: row.player_id,
    playerName: row.player_name,
    teamId: row.team_id,
    teamName: row.team_name,
    minutes: row.minutes ? parseFloat(row.minutes) : null,
    points: row.points,
    fgm: row.fgm,
    fga: row.fga,
    ftm: row.ftm,
    fta: row.fta,
    tpm: row.tpm,
    tpa: row.tpa,
    offReb: row.off_reb,
    defReb: row.def_reb,
    totalReb: row.total_reb,
    assists: row.assists,
    steals: row.steals,
    blocks: row.blocks,
    turnovers: row.turnovers,
    personalFouls: row.personal_fouls,
    plusMinus: row.plus_minus,
    position: row.position,
    isStarter: row.is_starter,
    dnp: row.dnp,
  };
}

/**
 * Get last N games for a player — for projection modeling.
 */
export async function getPlayerRecentLogs(
  playerId: number,
  limit: number = 20
): Promise<PlayerGameLog[]> {
  await ensureBbSchema();
  const pool = getBbPool();
  const res = await pool.query(
    `
    SELECT pgl.* FROM bb_player_game_logs pgl
    JOIN bb_games g ON pgl.game_id = g.id
    WHERE pgl.player_id = $1 AND pgl.dnp = FALSE
      AND g.home_score IS NOT NULL
    ORDER BY g.game_date DESC
    LIMIT $2
    `,
    [playerId, limit]
  );
  return res.rows.map(rowToLog);
}

/**
 * All player logs for a team's games this season — for team player rotation
 * + usage rate analysis.
 */
export async function getTeamSeasonPlayerLogs(
  teamId: number,
  season: string
): Promise<PlayerGameLog[]> {
  await ensureBbSchema();
  const pool = getBbPool();
  const res = await pool.query(
    `
    SELECT pgl.* FROM bb_player_game_logs pgl
    JOIN bb_games g ON pgl.game_id = g.id
    WHERE pgl.team_id = $1 AND g.season = $2
      AND pgl.dnp = FALSE
    ORDER BY g.game_date DESC, pgl.minutes DESC
    `,
    [teamId, season]
  );
  return res.rows.map(rowToLog);
}
