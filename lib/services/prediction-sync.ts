import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { ApiFootballService } from '../api-football';
import { AdvancedPredictionEngine } from '../advanced-prediction-engine';

interface SyncOptions {
  date: string;
  limit?: number;
  force?: boolean;
  skipIfFreshMinutes?: number;
}

export interface PredictionSyncSummary {
  date: string;
  fixturesFound: number;
  processed: number;
  skipped: number;
  failed: number;
  errors: Array<{ fixtureId: number; message: string }>;
}

function toDateRange(date: string) {
  const start = new Date(`${date}T00:00:00Z`);
  const end = new Date(`${date}T23:59:59.999Z`);
  return { start, end };
}

function withApiCaching<T>(fn: () => Promise<T>): Promise<T> {
  const fixturesCache = new Map<string, Promise<any>>();
  const standingsCache = new Map<string, Promise<any>>();
  const teamStatsCache = new Map<string, Promise<any>>();
  const h2hCache = new Map<string, Promise<any>>();

  const originalGetFixturesByLeague = ApiFootballService.getFixturesByLeague.bind(ApiFootballService);
  const originalGetStandings = ApiFootballService.getStandings.bind(ApiFootballService);
  const originalGetTeamStatistics = ApiFootballService.getTeamStatistics.bind(ApiFootballService);
  const originalGetHeadToHead = ApiFootballService.getHeadToHead.bind(ApiFootballService);

  (ApiFootballService as any).getFixturesByLeague = (league: number, season: number, status?: string) => {
    const key = `${league}-${season}-${status ?? 'all'}`;
    if (!fixturesCache.has(key)) {
      fixturesCache.set(key, originalGetFixturesByLeague(league, season, status));
    }
    return fixturesCache.get(key);
  };

  (ApiFootballService as any).getStandings = (league: number, season: number) => {
    const key = `${league}-${season}`;
    if (!standingsCache.has(key)) {
      standingsCache.set(key, originalGetStandings(league, season));
    }
    return standingsCache.get(key);
  };

  (ApiFootballService as any).getTeamStatistics = (league: number, season: number, team: number) => {
    const key = `${league}-${season}-${team}`;
    if (!teamStatsCache.has(key)) {
      teamStatsCache.set(key, originalGetTeamStatistics(league, season, team));
    }
    return teamStatsCache.get(key);
  };

  (ApiFootballService as any).getHeadToHead = (h2h: string) => {
    if (!h2hCache.has(h2h)) {
      h2hCache.set(h2h, originalGetHeadToHead(h2h));
    }
    return h2hCache.get(h2h);
  };

  const cleanup = () => {
    (ApiFootballService as any).getFixturesByLeague = originalGetFixturesByLeague;
    (ApiFootballService as any).getStandings = originalGetStandings;
    (ApiFootballService as any).getTeamStatistics = originalGetTeamStatistics;
    (ApiFootballService as any).getHeadToHead = originalGetHeadToHead;
  };

  return fn().finally(cleanup);
}

async function upsertLeague(league: any) {
  await prisma.league.upsert({
    where: { id: league.id },
    update: {
      season: league.season,
      name: league.name,
      country: league.country,
      logo: league.logo ?? undefined,
      type: league.type ?? 'league',
      current: true,
    },
    create: {
      id: league.id,
      season: league.season,
      name: league.name,
      country: league.country,
      logo: league.logo ?? undefined,
      type: league.type ?? 'league',
      current: true,
    },
  });
}

async function upsertTeam(team: any, leagueCountry?: string) {
  await prisma.team.upsert({
    where: { id: team.id },
    update: {
      name: team.name,
      logo: team.logo ?? undefined,
      country: team.country ?? leagueCountry ?? undefined,
    },
    create: {
      id: team.id,
      name: team.name,
      logo: team.logo ?? undefined,
      country: team.country ?? leagueCountry ?? undefined,
    },
  });
}

async function upsertMatch(fixture: any) {
  const { fixture: fx, league, teams, goals, score } = fixture;
  await prisma.match.upsert({
    where: { id: fx.id },
    update: {
      referee: fx.referee ?? undefined,
      timezone: fx.timezone ?? undefined,
      date: new Date(fx.date),
      timestamp: fx.timestamp,
      venue_id: fx.venue?.id ?? undefined,
      venue_name: fx.venue?.name ?? undefined,
      venue_city: fx.venue?.city ?? undefined,
      status_long: fx.status?.long ?? 'Unknown',
      status_short: fx.status?.short ?? 'NS',
      status_elapsed: fx.status?.elapsed ?? undefined,
      league_round: league.round ?? undefined,
      home_goals: goals?.home ?? undefined,
      away_goals: goals?.away ?? undefined,
      home_score_ht: score?.halftime?.home ?? undefined,
      away_score_ht: score?.halftime?.away ?? undefined,
      home_score_ft: score?.fulltime?.home ?? undefined,
      away_score_ft: score?.fulltime?.away ?? undefined,
      home_score_et: score?.extratime?.home ?? undefined,
      away_score_et: score?.extratime?.away ?? undefined,
      home_score_pen: score?.penalty?.home ?? undefined,
      away_score_pen: score?.penalty?.away ?? undefined,
      last_analysis_at: new Date(),
    },
    create: {
      id: fx.id,
      referee: fx.referee ?? undefined,
      timezone: fx.timezone ?? undefined,
      date: new Date(fx.date),
      timestamp: fx.timestamp,
      venue_id: fx.venue?.id ?? undefined,
      venue_name: fx.venue?.name ?? undefined,
      venue_city: fx.venue?.city ?? undefined,
      status_long: fx.status?.long ?? 'Unknown',
      status_short: fx.status?.short ?? 'NS',
      status_elapsed: fx.status?.elapsed ?? undefined,
      league_id: league.id,
      league_season: league.season,
      league_round: league.round ?? undefined,
      home_team_id: teams.home.id,
      away_team_id: teams.away.id,
      home_goals: goals?.home ?? undefined,
      away_goals: goals?.away ?? undefined,
      home_score_ht: score?.halftime?.home ?? undefined,
      away_score_ht: score?.halftime?.away ?? undefined,
      home_score_ft: score?.fulltime?.home ?? undefined,
      away_score_ft: score?.fulltime?.away ?? undefined,
      home_score_et: score?.extratime?.home ?? undefined,
      away_score_et: score?.extratime?.away ?? undefined,
      home_score_pen: score?.penalty?.home ?? undefined,
      away_score_pen: score?.penalty?.away ?? undefined,
      has_high_confidence_prediction: false,
      last_analysis_at: new Date(),
    },
  });
}

async function storePredictions(matchId: number, advancedPrediction: any) {
  const predictionsToSave: Array<Prisma.PredictionUncheckedCreateInput> = [];

  const homeProb = advancedPrediction.match_result.home_win.probability / 100;
  const drawProb = advancedPrediction.match_result.draw.probability / 100;
  const awayProb = advancedPrediction.match_result.away_win.probability / 100;

  const entries = [
    { value: 'home' as const, confidence: homeProb },
    { value: 'draw' as const, confidence: drawProb },
    { value: 'away' as const, confidence: awayProb },
  ].sort((a, b) => b.confidence - a.confidence);

  const mainPrediction = entries[0];

  predictionsToSave.push({
    match_id: matchId,
    prediction_type: 'match_winner',
    predicted_value: mainPrediction.value,
    confidence_score: mainPrediction.confidence,
    algorithm_version: 'advanced-1.0',
    factors_used: advancedPrediction.analysis_factors,
  });

  const bttsProb = advancedPrediction.both_teams_score.probability / 100;
  const bttsPredictedValue = bttsProb >= 0.5 ? 'yes' : 'no';
  const bttsConfidence = bttsPredictedValue === 'yes' ? bttsProb : 1 - bttsProb;

  predictionsToSave.push({
    match_id: matchId,
    prediction_type: 'both_teams_score',
    predicted_value: bttsPredictedValue,
    confidence_score: bttsConfidence,
    algorithm_version: 'advanced-1.0',
    factors_used: { probability: bttsProb },
  });

  const overProb = advancedPrediction.total_goals.over_2_5.probability / 100;
  const underProb = 1 - overProb;
  const ouPredictedValue = overProb >= underProb ? 'over' : 'under';
  const ouConfidence = Math.max(overProb, underProb);

  predictionsToSave.push({
    match_id: matchId,
    prediction_type: 'over_under_goals',
    predicted_value: ouPredictedValue,
    confidence_score: ouConfidence,
    algorithm_version: 'advanced-1.0',
    factors_used: {
      over_2_5_probability: overProb,
      under_2_5_probability: underProb,
    },
  });

  await prisma.prediction.deleteMany({
    where: {
      match_id: matchId,
      prediction_type: { in: predictionsToSave.map((p) => p.prediction_type) },
    },
  });

  for (const payload of predictionsToSave) {
    await prisma.prediction.create({ data: payload });
  }
}

function mapConfidenceToTier(confidencePercent: number) {
  if (confidencePercent >= 85) return 'platinum';
  if (confidencePercent >= 75) return 'gold';
  return 'silver';
}

async function storeHighConfidence(matchId: number, bets: any[]) {
  await prisma.highConfidenceRecommendation.deleteMany({ where: { match_id: matchId } });

  if (!bets || bets.length === 0) {
    await prisma.match.update({
      where: { id: matchId },
      data: { has_high_confidence_prediction: false },
    });
    return;
  }

  for (const bet of bets) {
    const tier = mapConfidenceToTier(bet.confidence);
    await prisma.highConfidenceRecommendation.create({
      data: {
        match_id: matchId,
        confidence_tier: tier,
        confidence_score: bet.confidence / 100,
        recommendation: `${bet.title}: ${bet.recommendation}`,
        reasoning: `${bet.description} | ${bet.reason}`,
      },
    });
  }

  await prisma.match.update({
    where: { id: matchId },
    data: { has_high_confidence_prediction: true },
  });
}

async function storeConfidenceSummary(matchId: number, overallConfidence: number) {
  const tier = mapConfidenceToTier(overallConfidence);
  await prisma.matchConfidenceSummary.upsert({
    where: { match_id: matchId },
    update: {
      overall_confidence: overallConfidence / 100,
      tier_classification: tier,
      summary_text: `Model confidence ${overallConfidence.toFixed(1)}% (${tier})`,
    },
    create: {
      match_id: matchId,
      overall_confidence: overallConfidence / 100,
      tier_classification: tier,
      summary_text: `Model confidence ${overallConfidence.toFixed(1)}% (${tier})`,
      total_factors: 0,
      strong_factors: 0,
    },
  });
}

async function processFixture(fixture: any, options: { force?: boolean; skipIfFreshMinutes?: number }) {
  const { fixture: fx, league, teams } = fixture;

  const existingMatch = await prisma.match.findUnique({
    where: { id: fx.id },
    select: { last_analysis_at: true },
  });

  if (!options.force && existingMatch?.last_analysis_at && options.skipIfFreshMinutes) {
    const threshold = new Date(Date.now() - options.skipIfFreshMinutes * 60 * 1000);
    if (existingMatch.last_analysis_at > threshold) {
      return 'skipped';
    }
  }

  await upsertLeague(league);
  await upsertTeam(teams.home, league.country);
  await upsertTeam(teams.away, league.country);
  await upsertMatch(fixture);

  const advancedPrediction = await AdvancedPredictionEngine.generateAdvancedPrediction(
    teams.home.id,
    teams.away.id,
    league.id,
    league.season,
    fx.id
  );

  await storePredictions(fx.id, advancedPrediction);
  await storeHighConfidence(fx.id, advancedPrediction.risk_analysis.high_confidence_bets ?? []);
  await storeConfidenceSummary(fx.id, advancedPrediction.prediction_confidence);
  return 'processed';
}

export async function syncPredictionsForDate(options: SyncOptions): Promise<PredictionSyncSummary> {
  const date = options.date;
  const limit = options.limit;
  const force = options.force ?? false;
  const skipIfFreshMinutes = options.skipIfFreshMinutes ?? 60;

  return withApiCaching(async () => {
    const fixtures = await ApiFootballService.getFixturesByDate(date);
    const slice = typeof limit === 'number' ? fixtures.slice(0, limit) : fixtures;

    const summary: PredictionSyncSummary = {
      date,
      fixturesFound: slice.length,
      processed: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    for (const fixture of slice) {
      try {
        const result = await processFixture(fixture, { force, skipIfFreshMinutes });
        if (result === 'skipped') {
          summary.skipped += 1;
        } else {
          summary.processed += 1;
        }

        // Brief delay to avoid rate limits
        await new Promise((resolve) => setTimeout(resolve, 150));
      } catch (error) {
        summary.failed += 1;
        summary.errors.push({
          fixtureId: fixture.fixture?.id ?? 0,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return summary;
  });
}
