/**
 * Ratings Builder
 *
 * Computes ELO + Bayesian hierarchical ratings from warehouse game data
 * and writes them to bb_team_ratings as a daily time series.
 *
 * Run after games are ingested. The output is one row per team per day
 * (the day after their last game) plus a final "current" row.
 */

import { getBbPool } from '../warehouse/connection';
import { ensureBbSchema } from '../warehouse/migrations';
import type { CanonicalGame } from '../warehouse/games-repo';
import { runEloHistoryWithSnapshots, ELO_DEFAULT } from '../ratings/elo';
import { runBayesianHistory } from '../ratings/bayesian-hierarchical';
import { upsertRating } from '../warehouse/ratings-repo';

/**
 * Compute and persist ratings for a (source, league, season).
 */
export async function buildRatingsForSeason(
  source: 'nba' | 'basketball',
  leagueId: number,
  season: string
): Promise<{ teamsProcessed: number; snapshotsWritten: number }> {
  await ensureBbSchema();
  const pool = getBbPool();

  // Fetch all finished games for this season chronologically
  const res = await pool.query(
    `
    SELECT * FROM bb_games
    WHERE source = $1 AND league_id = $2 AND season = $3
      AND home_score IS NOT NULL AND away_score IS NOT NULL
    ORDER BY game_date ASC
    `,
    [source, leagueId, season]
  );

  if (res.rows.length === 0) {
    return { teamsProcessed: 0, snapshotsWritten: 0 };
  }

  // Map raw rows to CanonicalGame for the ELO/Bayesian functions
  const games: CanonicalGame[] = res.rows.map((row) => ({
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
  }));

  // Compute Bayesian (final per-team ratings)
  const bayesianMap = runBayesianHistory(games);

  // Compute ELO time series
  const eloSnapshots = runEloHistoryWithSnapshots(games);

  // Group ELO snapshots by (teamId, latest date) — keep only the most recent per team
  // for "current ratings" output (we don't write every snapshot to keep DB small).
  const latestEloPerTeam = new Map<number, { rating: number; gamesPlayed: number; date: string }>();
  for (const snap of eloSnapshots) {
    latestEloPerTeam.set(snap.teamId, {
      rating: snap.rating,
      gamesPlayed: snap.gamesPlayed,
      date: snap.gameDate,
    });
  }

  // Determine snapshot date (last game date for the season)
  const lastGameDate = games[games.length - 1].gameDate.slice(0, 10);

  // Write a "current" rating per team
  let written = 0;
  const allTeamIds = new Set<number>();
  for (const g of games) {
    allTeamIds.add(g.homeTeamId);
    allTeamIds.add(g.awayTeamId);
  }

  for (const teamId of allTeamIds) {
    const elo = latestEloPerTeam.get(teamId) ?? { rating: ELO_DEFAULT, gamesPlayed: 0, date: lastGameDate };
    const bayes = bayesianMap.get(teamId);

    await upsertRating({
      source,
      leagueId,
      season,
      teamId,
      asOfDate: lastGameDate,
      elo: elo.rating,
      eloGames: elo.gamesPlayed,
      offMean: bayes?.offMean ?? null,
      offVar: bayes?.offVar ?? null,
      defMean: bayes?.defMean ?? null,
      defVar: bayes?.defVar ?? null,
      massey: null, // Massey not implemented yet
      composite: bayes ? bayes.offMean - bayes.defMean : null,
      homeAdv: 0, // Default — could be learned per team
    });
    written++;
  }

  return { teamsProcessed: allTeamIds.size, snapshotsWritten: written };
}

/**
 * Recompute ratings for all (source, league, season) combos in warehouse.
 */
export async function recomputeAllRatings(): Promise<number> {
  await ensureBbSchema();
  const pool = getBbPool();

  const res = await pool.query(`
    SELECT DISTINCT source, league_id, season FROM bb_games
    WHERE home_score IS NOT NULL AND away_score IS NOT NULL
  `);

  let totalSnapshots = 0;
  for (const row of res.rows) {
    try {
      const result = await buildRatingsForSeason(row.source, row.league_id, row.season);
      totalSnapshots += result.snapshotsWritten;
    } catch (err) {
      console.warn(
        `[ratings-builder] failed ${row.source} ${row.league_id}/${row.season}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  return totalSnapshots;
}
