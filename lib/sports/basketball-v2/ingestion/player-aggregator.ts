/**
 * Player Aggregator
 *
 * Computes per-player season averages + standard deviations + empirical
 * stat correlations from bb_player_game_logs and writes to bb_player_season_averages.
 *
 * Critical for player props — without this the player props array is empty
 * because the engine looks up `getTeamPlayerAverages()` which reads from this table.
 */

import { getBbPool } from '../warehouse/connection';
import { ensureBbSchema } from '../warehouse/migrations';
import { upsertPlayerSeasonAverage } from '../warehouse/player-season-repo';

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = avg(arr);
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

/**
 * Pearson correlation between two parallel arrays.
 */
function correlation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;
  const meanX = avg(x);
  const meanY = avg(y);
  let num = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  const denom = Math.sqrt(denomX * denomY);
  return denom > 0 ? num / denom : 0;
}

/**
 * Aggregate one player's season from their game logs.
 */
async function aggregateOnePlayer(playerId: number, season: string): Promise<void> {
  const pool = getBbPool();

  // Fetch all of this player's games for this season (joined with games for season filter)
  const res = await pool.query(
    `
    SELECT pgl.*, g.season
    FROM bb_player_game_logs pgl
    JOIN bb_games g ON pgl.game_id = g.id
    WHERE pgl.player_id = $1 AND g.season = $2
      AND pgl.dnp = FALSE
      AND pgl.minutes IS NOT NULL AND pgl.minutes > 0
    ORDER BY g.game_date ASC
    `,
    [playerId, season]
  );

  if (res.rows.length === 0) return;

  const rows = res.rows;
  const points = rows.map((r) => r.points || 0);
  const rebounds = rows.map((r) => r.total_reb || 0);
  const assists = rows.map((r) => r.assists || 0);
  const tpm = rows.map((r) => r.tpm || 0);
  const tpa = rows.map((r) => r.tpa || 0);
  const steals = rows.map((r) => r.steals || 0);
  const blocks = rows.map((r) => r.blocks || 0);
  const turnovers = rows.map((r) => r.turnovers || 0);
  const minutes = rows.map((r) => parseFloat(r.minutes) || 0);
  const fgm = rows.reduce((s, r) => s + (r.fgm || 0), 0);
  const fga = rows.reduce((s, r) => s + (r.fga || 0), 0);
  const ftm = rows.reduce((s, r) => s + (r.ftm || 0), 0);
  const fta = rows.reduce((s, r) => s + (r.fta || 0), 0);
  const tpmTotal = rows.reduce((s, r) => s + (r.tpm || 0), 0);
  const tpaTotal = rows.reduce((s, r) => s + (r.tpa || 0), 0);

  // Empirical correlations
  const correlations = {
    pts_reb: correlation(points, rebounds),
    pts_ast: correlation(points, assists),
    reb_ast: correlation(rebounds, assists),
    pts_3pm: correlation(points, tpm),
    ast_3pm: correlation(assists, tpm),
    reb_3pm: correlation(rebounds, tpm),
  };

  await upsertPlayerSeasonAverage({
    source: 'nba',
    playerId,
    playerName: rows[0].player_name,
    teamId: rows[0].team_id,
    teamName: rows[0].team_name,
    season,
    gamesPlayed: rows.length,
    gamesStarted: 0,
    mpg: avg(minutes),
    ppg: avg(points),
    rpg: avg(rebounds),
    apg: avg(assists),
    spg: avg(steals),
    bpg: avg(blocks),
    topg: avg(turnovers),
    tpmpg: avg(tpm),
    tpapg: avg(tpa),
    fgPct: fga > 0 ? (fgm / fga) * 100 : 0,
    ftPct: fta > 0 ? (ftm / fta) * 100 : 0,
    tpPct: tpaTotal > 0 ? (tpmTotal / tpaTotal) * 100 : 0,
    plusMinusAvg: 0,
    usageRate: null,
    ppgStd: stddev(points),
    rpgStd: stddev(rebounds),
    apgStd: stddev(assists),
    tpmpgStd: stddev(tpm),
    correlations,
  });
}

/**
 * Aggregate ALL players who have logs in a given season.
 */
export async function aggregatePlayersForSeason(season: string): Promise<number> {
  await ensureBbSchema();
  const pool = getBbPool();

  // Find all unique (player_id) in this season
  const res = await pool.query(
    `
    SELECT DISTINCT pgl.player_id
    FROM bb_player_game_logs pgl
    JOIN bb_games g ON pgl.game_id = g.id
    WHERE g.season = $1 AND pgl.dnp = FALSE
    `,
    [season]
  );

  let count = 0;
  for (const row of res.rows) {
    try {
      await aggregateOnePlayer(row.player_id, season);
      count++;
    } catch (err) {
      console.warn(`[player-agg] player ${row.player_id}/${season}:`, err);
    }
  }
  return count;
}

/**
 * Aggregate all players in all seasons.
 */
export async function aggregateAllPlayers(): Promise<number> {
  await ensureBbSchema();
  const pool = getBbPool();

  const res = await pool.query(`
    SELECT DISTINCT g.season FROM bb_player_game_logs pgl
    JOIN bb_games g ON pgl.game_id = g.id
  `);

  let total = 0;
  for (const row of res.rows) {
    total += await aggregatePlayersForSeason(row.season);
  }
  return total;
}
