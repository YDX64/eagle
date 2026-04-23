/**
 * Team Season Aggregates Repository — bb_team_season_aggregates table
 *
 * Caches Four Factors + pace + ratings per (source, league, season, team).
 * Refreshed nightly by the cron job after new games are ingested.
 */

import { getBbPool } from './connection';
import { ensureBbSchema } from './migrations';

export interface TeamSeasonAggregate {
  source: 'nba' | 'basketball';
  leagueId: number;
  season: string;
  teamId: number;
  teamName: string | null;

  gamesPlayed: number;
  points: number | null;
  pointsAllowed: number | null;
  fgm: number | null;
  fga: number | null;
  ftm: number | null;
  fta: number | null;
  tpm: number | null;
  tpa: number | null;
  offReb: number | null;
  defReb: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  personalFouls: number | null;

  // Four Factors
  efgPct: number | null;
  tovPct: number | null;
  orbPct: number | null;
  ftRate: number | null;
  oppEfgPct: number | null;
  oppTovPct: number | null;
  oppOrbPct: number | null;
  oppFtRate: number | null;

  // Pace + ratings
  pace: number | null;
  offRating: number | null;
  defRating: number | null;
  netRating: number | null;

  homeGames: number;
  homeWins: number;
  awayGames: number;
  awayWins: number;

  computedAt?: string;
}

export async function upsertTeamSeasonAggregate(
  agg: TeamSeasonAggregate
): Promise<void> {
  await ensureBbSchema();
  const pool = getBbPool();
  await pool.query(
    `
    INSERT INTO bb_team_season_aggregates (
      source, league_id, season, team_id, team_name, games_played,
      points, points_allowed, fgm, fga, ftm, fta, tpm, tpa,
      off_reb, def_reb, assists, steals, blocks, turnovers, personal_fouls,
      efg_pct, tov_pct, orb_pct, ft_rate,
      opp_efg_pct, opp_tov_pct, opp_orb_pct, opp_ft_rate,
      pace, off_rating, def_rating, net_rating,
      home_games, home_wins, away_games, away_wins, computed_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
      $15, $16, $17, $18, $19, $20, $21,
      $22, $23, $24, $25, $26, $27, $28, $29,
      $30, $31, $32, $33, $34, $35, $36, $37, NOW()
    )
    ON CONFLICT (source, league_id, season, team_id) DO UPDATE SET
      team_name = EXCLUDED.team_name,
      games_played = EXCLUDED.games_played,
      points = EXCLUDED.points,
      points_allowed = EXCLUDED.points_allowed,
      fgm = EXCLUDED.fgm, fga = EXCLUDED.fga,
      ftm = EXCLUDED.ftm, fta = EXCLUDED.fta,
      tpm = EXCLUDED.tpm, tpa = EXCLUDED.tpa,
      off_reb = EXCLUDED.off_reb, def_reb = EXCLUDED.def_reb,
      assists = EXCLUDED.assists, steals = EXCLUDED.steals,
      blocks = EXCLUDED.blocks, turnovers = EXCLUDED.turnovers,
      personal_fouls = EXCLUDED.personal_fouls,
      efg_pct = EXCLUDED.efg_pct, tov_pct = EXCLUDED.tov_pct,
      orb_pct = EXCLUDED.orb_pct, ft_rate = EXCLUDED.ft_rate,
      opp_efg_pct = EXCLUDED.opp_efg_pct, opp_tov_pct = EXCLUDED.opp_tov_pct,
      opp_orb_pct = EXCLUDED.opp_orb_pct, opp_ft_rate = EXCLUDED.opp_ft_rate,
      pace = EXCLUDED.pace, off_rating = EXCLUDED.off_rating,
      def_rating = EXCLUDED.def_rating, net_rating = EXCLUDED.net_rating,
      home_games = EXCLUDED.home_games, home_wins = EXCLUDED.home_wins,
      away_games = EXCLUDED.away_games, away_wins = EXCLUDED.away_wins,
      computed_at = NOW()
    `,
    [
      agg.source, agg.leagueId, agg.season, agg.teamId, agg.teamName, agg.gamesPlayed,
      agg.points, agg.pointsAllowed, agg.fgm, agg.fga, agg.ftm, agg.fta, agg.tpm, agg.tpa,
      agg.offReb, agg.defReb, agg.assists, agg.steals, agg.blocks, agg.turnovers, agg.personalFouls,
      agg.efgPct, agg.tovPct, agg.orbPct, agg.ftRate,
      agg.oppEfgPct, agg.oppTovPct, agg.oppOrbPct, agg.oppFtRate,
      agg.pace, agg.offRating, agg.defRating, agg.netRating,
      agg.homeGames, agg.homeWins, agg.awayGames, agg.awayWins,
    ]
  );
}

function rowToAgg(row: any): TeamSeasonAggregate {
  return {
    source: row.source,
    leagueId: row.league_id,
    season: row.season,
    teamId: row.team_id,
    teamName: row.team_name,
    gamesPlayed: row.games_played,
    points: row.points,
    pointsAllowed: row.points_allowed,
    fgm: row.fgm,
    fga: row.fga,
    ftm: row.ftm,
    fta: row.fta,
    tpm: row.tpm,
    tpa: row.tpa,
    offReb: row.off_reb,
    defReb: row.def_reb,
    assists: row.assists,
    steals: row.steals,
    blocks: row.blocks,
    turnovers: row.turnovers,
    personalFouls: row.personal_fouls,
    efgPct: row.efg_pct ? parseFloat(row.efg_pct) : null,
    tovPct: row.tov_pct ? parseFloat(row.tov_pct) : null,
    orbPct: row.orb_pct ? parseFloat(row.orb_pct) : null,
    ftRate: row.ft_rate ? parseFloat(row.ft_rate) : null,
    oppEfgPct: row.opp_efg_pct ? parseFloat(row.opp_efg_pct) : null,
    oppTovPct: row.opp_tov_pct ? parseFloat(row.opp_tov_pct) : null,
    oppOrbPct: row.opp_orb_pct ? parseFloat(row.opp_orb_pct) : null,
    oppFtRate: row.opp_ft_rate ? parseFloat(row.opp_ft_rate) : null,
    pace: row.pace ? parseFloat(row.pace) : null,
    offRating: row.off_rating ? parseFloat(row.off_rating) : null,
    defRating: row.def_rating ? parseFloat(row.def_rating) : null,
    netRating: row.net_rating ? parseFloat(row.net_rating) : null,
    homeGames: row.home_games,
    homeWins: row.home_wins,
    awayGames: row.away_games,
    awayWins: row.away_wins,
    computedAt: row.computed_at instanceof Date
      ? row.computed_at.toISOString()
      : row.computed_at,
  };
}

export async function getTeamSeasonAggregate(
  source: 'nba' | 'basketball',
  leagueId: number,
  season: string,
  teamId: number
): Promise<TeamSeasonAggregate | null> {
  await ensureBbSchema();
  const pool = getBbPool();
  const res = await pool.query(
    `SELECT * FROM bb_team_season_aggregates
     WHERE source = $1 AND league_id = $2 AND season = $3 AND team_id = $4`,
    [source, leagueId, season, teamId]
  );
  return res.rows[0] ? rowToAgg(res.rows[0]) : null;
}

export async function getLeagueSeasonAggregates(
  source: 'nba' | 'basketball',
  leagueId: number,
  season: string
): Promise<TeamSeasonAggregate[]> {
  await ensureBbSchema();
  const pool = getBbPool();
  const res = await pool.query(
    `SELECT * FROM bb_team_season_aggregates
     WHERE source = $1 AND league_id = $2 AND season = $3
     ORDER BY team_name`,
    [source, leagueId, season]
  );
  return res.rows.map(rowToAgg);
}
