/**
 * Basketball v2 Engine — Orchestrator
 *
 * The single entry point that ties everything together. ~150 lines max.
 * This file does NO math itself — it's a coordinator that:
 *
 *   1. Fetches game + team + player data from warehouse
 *   2. Computes features (Four Factors, pace, rest, form, HCA)
 *   3. Computes ratings (ELO + Bayesian + blended)
 *   4. Predicts expected points (using ratings + features)
 *   5. Runs Monte Carlo simulation (10K)
 *   6. Builds all betting markets
 *   7. Builds player prop predictions (NBA only)
 *   8. Returns unified prediction object
 *
 * If anything fails (warehouse empty, missing data), throws clearly so the
 * API route can decide whether to fall back to Tier 1.
 */

import { getGameById, getRecentFinishedGames, getHeadToHead, upsertGame, type CanonicalGame } from './warehouse/games-repo';
import { getTeamSeasonAggregate } from './warehouse/team-season-repo';
import { getRatingAsOf, getCurrentRating, type TeamRating } from './warehouse/ratings-repo';
import { getQuarterShares, DEFAULT_QUARTER_SHARES } from './warehouse/quarter-shares-repo';
import { getTeamPlayerAverages, getTeamPlayerAveragesByName } from './warehouse/player-season-repo';
import { nbaGameToCanonical } from './ingestion/api-clients/nba-adapter';
import { basketballGameToCanonical } from './ingestion/api-clients/basketball-adapter';
import { nbaApi } from '@/lib/sports/nba/api-nba';
import { basketballApi } from '@/lib/sports/basketball/api-basketball';
import { computeTeamForm } from './features/form-momentum';
import { computeHomeCourtAdvantage, blendedHomeCourtAdvantage } from './features/home-court';
import { daysSinceLastGame, countRecentB2Bs, restAdjustmentPoints } from './features/rest-fatigue';
import { projectGamePoints } from './features/pace-adjusted';
import { blendedCompositeSkill } from './ratings/blended-ratings';
import type { BayesianTeamRating } from './ratings/bayesian-hierarchical';
import { buildAllMarkets, type AllMarkets } from './markets/markets-builder';
import { buildPlayerProps, type PlayerPropPrediction } from './markets/player-props';

export interface BasketballV2Prediction {
  engineVersion: 'v2';
  source: 'nba' | 'basketball';
  gameId: string;
  apiGameId: number;
  league: string | null;
  homeTeam: string;
  awayTeam: string;
  gameDate: string;
  status: string;

  // Inputs (for transparency / debugging)
  inputs: {
    expectedHome: number;
    expectedAway: number;
    homeStdDev: number;
    awayStdDev: number;
    homeForm: ReturnType<typeof computeTeamForm>;
    awayForm: ReturnType<typeof computeTeamForm>;
    homeRestDays: number | null;
    awayRestDays: number | null;
    homeRestAdj: number;
    awayRestAdj: number;
    homeHca: number;
    awayHca: number;
    homeEloComposite: number | null;
    awayEloComposite: number | null;
    homeBayesianComposite: number | null;
    awayBayesianComposite: number | null;
    homeBlendedComposite: number;
    awayBlendedComposite: number;
  };

  // Predictions
  markets: AllMarkets;
  playerProps: PlayerPropPrediction[];

  // Quality / confidence
  confidence: number;
  generatedAt: string;
}

export async function predictGameV2(
  source: 'nba' | 'basketball',
  apiGameId: number
): Promise<BasketballV2Prediction> {
  const gameId = `${source}:${apiGameId}`;

  // 1. Fetch game from warehouse (lazy-fetch if missing)
  let game = await getGameById(gameId);
  if (!game) {
    // Lazy-fetch: game isn't in warehouse yet (e.g., tomorrow's games not
    // yet ingested by daily-cron). Fetch from live API and upsert it.
    game = await lazyFetchAndUpsert(source, apiGameId);
    if (!game) {
      throw new Error(
        `v2 warehouse miss: game ${gameId} not found (lazy-fetch also failed — game may not exist)`
      );
    }
  }

  const gameDate = new Date(game.gameDate);

  // 2. Parallel fetch team data
  const [
    homeAgg,
    awayAgg,
    homeRecent,
    awayRecent,
    homeRatingAsOf,
    awayRatingAsOf,
    quarterShares,
    h2h,
  ] = await Promise.all([
    getTeamSeasonAggregate(source, game.leagueId, game.season, game.homeTeamId),
    getTeamSeasonAggregate(source, game.leagueId, game.season, game.awayTeamId),
    getRecentFinishedGames(source, game.homeTeamId, 20, gameDate),
    getRecentFinishedGames(source, game.awayTeamId, 20, gameDate),
    getRatingAsOf(source, game.leagueId, game.season, game.homeTeamId, gameDate),
    getRatingAsOf(source, game.leagueId, game.season, game.awayTeamId, gameDate),
    getQuarterShares(source, game.leagueId, game.season),
    getHeadToHead(source, game.homeTeamId, game.awayTeamId, 10),
  ]);

  // Fallback to current rating if as-of doesn't exist (e.g. recomputing for a
  // finished game where we only stored the season-end snapshot).
  const [homeRating, awayRating]: [TeamRating | null, TeamRating | null] = await Promise.all([
    homeRatingAsOf
      ? Promise.resolve(homeRatingAsOf)
      : getCurrentRating(source, game.leagueId, game.season, game.homeTeamId),
    awayRatingAsOf
      ? Promise.resolve(awayRatingAsOf)
      : getCurrentRating(source, game.leagueId, game.season, game.awayTeamId),
  ]);

  // 3. Compute features
  const homeForm = computeTeamForm(game.homeTeamId, homeRecent, 10);
  const awayForm = computeTeamForm(game.awayTeamId, awayRecent, 10);

  const homeRest = daysSinceLastGame(game.homeTeamId, gameDate, homeRecent);
  const awayRest = daysSinceLastGame(game.awayTeamId, gameDate, awayRecent);
  const homeB2B = countRecentB2Bs(game.homeTeamId, gameDate, homeRecent);
  const awayB2B = countRecentB2Bs(game.awayTeamId, gameDate, awayRecent);
  const homeRestAdj = restAdjustmentPoints(homeRest, homeB2B);
  const awayRestAdj = restAdjustmentPoints(awayRest, awayB2B);

  const homeHcaInfo = computeHomeCourtAdvantage(game.homeTeamId, homeRecent);
  const leagueDefaultHca = 3.0; // NBA standard; could be league-specific
  const homeHca = blendedHomeCourtAdvantage(homeHcaInfo, leagueDefaultHca);

  // 4. Project expected points using pace-adjusted ratings
  const homePace = homeAgg?.pace ?? 100;
  const awayPace = awayAgg?.pace ?? 100;
  const homeOrtg = homeAgg?.offRating ?? 110;
  const homeDrtg = homeAgg?.defRating ?? 110;
  const awayOrtg = awayAgg?.offRating ?? 110;
  const awayDrtg = awayAgg?.defRating ?? 110;

  const projection = projectGamePoints(
    homeOrtg, homeDrtg, homePace,
    awayOrtg, awayDrtg, awayPace,
    homeHca
  );

  // 5. Adjust for rest + form
  const formAdj = (homeForm.weightedFormScore - awayForm.weightedFormScore) * 2.0;
  const expectedHome = projection.expectedHome + homeRestAdj + formAdj / 2;
  const expectedAway = projection.expectedAway + awayRestAdj - formAdj / 2;

  // Std dev: use league baseline if no team-specific data
  const homeStdDev = 12; // Could be tuned per-team from variance of recent games
  const awayStdDev = 12;

  // 6. Compute blended ratings (for transparency in output)
  const homeBayesian: BayesianTeamRating | null =
    homeRating?.offMean !== null && homeRating?.offMean !== undefined
      ? {
          teamId: game.homeTeamId,
          offMean: homeRating.offMean,
          offVar: homeRating.offVar ?? 100,
          defMean: homeRating.defMean ?? 0,
          defVar: homeRating.defVar ?? 100,
          observations: 0,
        }
      : null;
  const awayBayesian: BayesianTeamRating | null =
    awayRating?.offMean !== null && awayRating?.offMean !== undefined
      ? {
          teamId: game.awayTeamId,
          offMean: awayRating.offMean,
          offVar: awayRating.offVar ?? 100,
          defMean: awayRating.defMean ?? 0,
          defVar: awayRating.defVar ?? 100,
          observations: 0,
        }
      : null;
  const homeBlended = blendedCompositeSkill({
    bayesian: homeBayesian,
    elo: homeRating?.elo ?? null,
    massey: homeRating?.massey ?? null,
  });
  const awayBlended = blendedCompositeSkill({
    bayesian: awayBayesian,
    elo: awayRating?.elo ?? null,
    massey: awayRating?.massey ?? null,
  });

  // 7. Use empirical quarter shares (or fall back to defaults)
  const qs = quarterShares ?? DEFAULT_QUARTER_SHARES[source];

  // 8. Build all markets via Monte Carlo
  const markets = buildAllMarkets({
    expectedHome,
    expectedAway,
    homeStdDev,
    awayStdDev,
    homeTeamName: game.homeTeamName,
    awayTeamName: game.awayTeamName,
    quarterShares: qs,
  });

  // 9. Build player props
  // NBA source: direct team_id lookup (same data source)
  // Basketball source + NBA league: cross-reference by team NAME, because
  //   basketball-api and nba-api use different team IDs but share team names.
  //   We reuse NBA player data to enrich basketball-api NBA games.
  // Basketball source + non-NBA league: currently no player data available.
  let playerProps: PlayerPropPrediction[] = [];
  const isNbaLeague = game.leagueId === 12 || (game.leagueName && /NBA/i.test(game.leagueName));

  if (source === 'nba') {
    const seasonStr = game.season;
    const [homePlayers, awayPlayers] = await Promise.all([
      getTeamPlayerAverages(game.homeTeamId, seasonStr).catch(() => []),
      getTeamPlayerAverages(game.awayTeamId, seasonStr).catch(() => []),
    ]);
    const allPlayers = [...homePlayers.slice(0, 8), ...awayPlayers.slice(0, 8)];
    playerProps = buildPlayerProps(allPlayers);
  } else if (source === 'basketball' && isNbaLeague) {
    // Cross-source enrichment: pull NBA player data by team name
    const [homePlayers, awayPlayers] = await Promise.all([
      getTeamPlayerAveragesByName(game.homeTeamName, game.season).catch(() => []),
      getTeamPlayerAveragesByName(game.awayTeamName, game.season).catch(() => []),
    ]);
    const allPlayers = [...homePlayers.slice(0, 8), ...awayPlayers.slice(0, 8)];
    playerProps = buildPlayerProps(allPlayers);
  }

  // 10. Confidence (higher = more certain prediction)
  const confidence = Math.max(markets.matchResult.homeWinProb, markets.matchResult.awayWinProb);

  return {
    engineVersion: 'v2',
    source,
    gameId,
    apiGameId,
    league: game.leagueName,
    homeTeam: game.homeTeamName,
    awayTeam: game.awayTeamName,
    gameDate: game.gameDate,
    status: game.statusLong ?? game.statusShort ?? 'UNK',

    inputs: {
      expectedHome: Math.round(expectedHome * 100) / 100,
      expectedAway: Math.round(expectedAway * 100) / 100,
      homeStdDev,
      awayStdDev,
      homeForm,
      awayForm,
      homeRestDays: homeRest,
      awayRestDays: awayRest,
      homeRestAdj: Math.round(homeRestAdj * 100) / 100,
      awayRestAdj: Math.round(awayRestAdj * 100) / 100,
      homeHca: Math.round(homeHca * 100) / 100,
      awayHca: -Math.round(homeHca * 100) / 100,
      homeEloComposite: homeRating?.elo ?? null,
      awayEloComposite: awayRating?.elo ?? null,
      homeBayesianComposite: homeBayesian ? homeBayesian.offMean - homeBayesian.defMean : null,
      awayBayesianComposite: awayBayesian ? awayBayesian.offMean - awayBayesian.defMean : null,
      homeBlendedComposite: Math.round(homeBlended * 100) / 100,
      awayBlendedComposite: Math.round(awayBlended * 100) / 100,
    },

    markets,
    playerProps,

    confidence,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Lazy-fetch a game from its live API and upsert it into the warehouse.
 *
 * Used when the user clicks a prediction for a game that wasn't in the
 * warehouse yet (typically future games not yet ingested by daily-cron).
 *
 * Returns the CanonicalGame if successful, or null if the game doesn't
 * exist in the upstream API either.
 */
async function lazyFetchAndUpsert(
  source: 'nba' | 'basketball',
  apiGameId: number
): Promise<CanonicalGame | null> {
  try {
    if (source === 'nba') {
      const nbaGame = await nbaApi.getGameById(apiGameId);
      if (!nbaGame) return null;
      const canonical = nbaGameToCanonical(nbaGame);
      await upsertGame(canonical);
    } else if (source === 'basketball') {
      // basketball api doesn't have a direct getGameById, so use getGamesByDate
      // as a wider fetch then filter — but a cheaper path is the raw /games?id=X
      // endpoint which the client exposes as getGameById.
      const bbGame = await basketballApi.getGameById(apiGameId);
      if (!bbGame) return null;
      const canonical = basketballGameToCanonical(bbGame);
      await upsertGame(canonical);
    }
    // Re-fetch from warehouse to get the canonical row (with id, etc)
    return await getGameById(`${source}:${apiGameId}`);
  } catch (err) {
    console.error(`[lazy-fetch] failed for ${source}:${apiGameId}:`, err);
    return null;
  }
}
