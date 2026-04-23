/**
 * Team Season Aggregate Calculator
 *
 * Computes Four Factors, pace, and offensive/defensive ratings for every
 * team in every (source, league, season) from the warehouse and saves them
 * to bb_team_season_aggregates.
 *
 * Basketball v1 API doesn't expose per-game box stats (FGM, FTA, TOV, etc),
 * so for basketball source we can only compute basic ppg/opp_ppg from game
 * totals. For NBA source we have full box scores via the NBA /teams/statistics
 * endpoint — that gets a richer aggregation.
 *
 * IMPORTANT: This is per-team aggregation, computed from raw data. Four Factors
 * require box score stats, so we use:
 *   - NBA: direct API call to /teams/statistics (season totals) + own calc
 *   - Basketball: fallback to ppg/opp_ppg only (incomplete Four Factors)
 */

import { getBbPool } from '../warehouse/connection';
import { ensureBbSchema } from '../warehouse/migrations';
import { upsertTeamSeasonAggregate } from '../warehouse/team-season-repo';
import { nbaApi } from '@/lib/sports/nba/api-nba';

/**
 * Compute aggregates for a single team from game-level data in the warehouse.
 * This is the "basic" path — only uses final scores, not box stats.
 */
async function computeBasicAggregate(
  source: 'nba' | 'basketball',
  leagueId: number,
  season: string,
  teamId: number,
  teamName: string | null
): Promise<void> {
  const pool = getBbPool();

  // Fetch all finished games for this team in this season
  const res = await pool.query(
    `
    SELECT
      home_team_id, away_team_id, home_score, away_score, home_linescore, away_linescore
    FROM bb_games
    WHERE source = $1 AND league_id = $2 AND season = $3
      AND (home_team_id = $4 OR away_team_id = $4)
      AND home_score IS NOT NULL AND away_score IS NOT NULL
    `,
    [source, leagueId, season, teamId]
  );

  if (res.rows.length === 0) return;

  let games = 0;
  let points = 0;
  let pointsAllowed = 0;
  let homeGames = 0;
  let homeWins = 0;
  let awayGames = 0;
  let awayWins = 0;

  for (const g of res.rows) {
    games++;
    const isHome = g.home_team_id === teamId;
    const teamPts = isHome ? g.home_score : g.away_score;
    const oppPts = isHome ? g.away_score : g.home_score;
    points += teamPts;
    pointsAllowed += oppPts;
    if (isHome) {
      homeGames++;
      if (teamPts > oppPts) homeWins++;
    } else {
      awayGames++;
      if (teamPts > oppPts) awayWins++;
    }
  }

  const ppg = points / games;
  const oppPpg = pointsAllowed / games;
  // Basketball pace proxy: (ppg + opp_ppg) / 2 / ~1 (no possession data)
  const paceProxy = (ppg + oppPpg) / 2 / 1.0;

  await upsertTeamSeasonAggregate({
    source,
    leagueId,
    season,
    teamId,
    teamName,
    gamesPlayed: games,
    points,
    pointsAllowed,
    fgm: null, fga: null, ftm: null, fta: null, tpm: null, tpa: null,
    offReb: null, defReb: null, assists: null, steals: null, blocks: null,
    turnovers: null, personalFouls: null,
    efgPct: null, tovPct: null, orbPct: null, ftRate: null,
    oppEfgPct: null, oppTovPct: null, oppOrbPct: null, oppFtRate: null,
    pace: paceProxy,
    offRating: ppg / (paceProxy / 100),
    defRating: oppPpg / (paceProxy / 100),
    netRating: (ppg - oppPpg) / (paceProxy / 100),
    homeGames,
    homeWins,
    awayGames,
    awayWins,
  });
}

/**
 * Compute NBA team aggregates using NBA API /teams/statistics endpoint.
 * This gives us real Four Factors (with FGA, TOV, etc).
 */
async function computeNbaAggregateFromApi(
  leagueId: number,
  season: string,
  teamId: number,
  teamName: string | null
): Promise<void> {
  try {
    const seasonYear = parseInt(season, 10);
    const stats = await nbaApi.getTeamStatistics(teamId, seasonYear);
    if (!stats || stats.games === 0) {
      // Fallback to basic aggregation
      await computeBasicAggregate('nba', leagueId, season, teamId, teamName);
      return;
    }

    // Pace estimation: possessions = FGA - OREB + TO + 0.44*FTA (Dean Oliver)
    const possessions = stats.fga - stats.offReb + stats.turnovers + 0.44 * stats.fta;
    const pacePerGame = possessions / stats.games;

    // Four Factors (offense)
    const efgPct = stats.fga > 0 ? (stats.fgm + 0.5 * stats.tpm) / stats.fga : null;
    const tovPct =
      stats.fga + 0.44 * stats.fta + stats.turnovers > 0
        ? stats.turnovers / (stats.fga + 0.44 * stats.fta + stats.turnovers)
        : null;
    const ftRate = stats.fga > 0 ? stats.ftm / stats.fga : null;
    // ORB% requires opponent DRB which isn't in /teams/statistics — leave null
    // or approximate via: own_orb / (own_orb + 30 * games * league_avg_drb_rate)
    const orbPct = stats.offReb > 0 && stats.games > 0
      ? stats.offReb / stats.games / 45  // Rough proxy: total possible ORB ≈ 45 per game
      : null;

    const ppg = stats.points / stats.games;
    const oppPpg = ppg - stats.plusMinus / stats.games;
    const offRating = (ppg / pacePerGame) * 100;
    const defRating = (oppPpg / pacePerGame) * 100;

    await upsertTeamSeasonAggregate({
      source: 'nba',
      leagueId,
      season,
      teamId,
      teamName,
      gamesPlayed: stats.games,
      points: stats.points,
      pointsAllowed: Math.round(oppPpg * stats.games),
      fgm: stats.fgm,
      fga: stats.fga,
      ftm: stats.ftm,
      fta: stats.fta,
      tpm: stats.tpm,
      tpa: stats.tpa,
      offReb: stats.offReb,
      defReb: stats.defReb,
      assists: stats.assists,
      steals: stats.steals,
      blocks: stats.blocks,
      turnovers: stats.turnovers,
      personalFouls: stats.pFouls,
      efgPct,
      tovPct,
      orbPct,
      ftRate,
      // Defensive Four Factors: need opponent aggregates, which NBA /teams/statistics
      // doesn't provide directly. Compute from warehouse instead (post-backfill).
      oppEfgPct: null,
      oppTovPct: null,
      oppOrbPct: null,
      oppFtRate: null,
      pace: pacePerGame,
      offRating,
      defRating,
      netRating: offRating - defRating,
      homeGames: 0,
      homeWins: 0,
      awayGames: 0,
      awayWins: 0,
    });
  } catch (err) {
    console.warn(`[aggregate-calc] NBA team ${teamId}/${season}:`, err);
    // Fallback
    await computeBasicAggregate('nba', leagueId, season, teamId, teamName);
  }
}

/**
 * Recompute aggregates for ALL teams in a given (source, league, season).
 */
export async function recomputeLeagueSeasonAggregates(
  source: 'nba' | 'basketball',
  leagueId: number,
  season: string
): Promise<number> {
  await ensureBbSchema();
  const pool = getBbPool();

  // Find unique team IDs that played in this season
  const res = await pool.query(
    `
    SELECT DISTINCT team_id, team_name FROM (
      SELECT home_team_id as team_id, home_team_name as team_name FROM bb_games
      WHERE source = $1 AND league_id = $2 AND season = $3
      UNION
      SELECT away_team_id as team_id, away_team_name as team_name FROM bb_games
      WHERE source = $1 AND league_id = $2 AND season = $3
    ) t
    `,
    [source, leagueId, season]
  );

  let count = 0;
  for (const row of res.rows) {
    try {
      if (source === 'nba') {
        await computeNbaAggregateFromApi(leagueId, season, row.team_id, row.team_name);
      } else {
        await computeBasicAggregate(source, leagueId, season, row.team_id, row.team_name);
      }
      count++;
    } catch (err) {
      console.warn(`[aggregate-calc] ${source} team ${row.team_id}/${season}:`, err);
    }
  }

  return count;
}

/**
 * Recompute aggregates for ALL (source, league, season) combos in the warehouse.
 */
export async function recomputeAllAggregates(): Promise<number> {
  await ensureBbSchema();
  const pool = getBbPool();

  const res = await pool.query(`
    SELECT DISTINCT source, league_id, season FROM bb_games
    WHERE home_score IS NOT NULL AND away_score IS NOT NULL
  `);

  let count = 0;
  for (const row of res.rows) {
    count += await recomputeLeagueSeasonAggregates(row.source, row.league_id, row.season);
  }
  return count;
}
