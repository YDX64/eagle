import { NextRequest, NextResponse } from 'next/server';
import type { Fixture, Standing } from '@/lib/api-football';
import { ApiFootballService } from '@/lib/api-football';
import type { AdvancedMatchPrediction } from '@/lib/advanced-prediction-engine';
import { AdvancedPredictionEngine } from '@/lib/advanced-prediction-engine';
import type { MatchPrediction } from '@/lib/prediction-engine';
import { PredictionEngine } from '@/lib/prediction-engine';
import { CacheService } from '@/lib/cache';
import { cache, PredictionCache } from '@/lib/db/json-cache';

type HeadToHeadSummary = {
  total_matches: number;
  team1_wins: number;
  team2_wins: number;
  draws: number;
};

type BatchPredictionContext = {
  leagueFixtures: Map<string, Fixture[]>;
  standings: Map<string, Standing[]>;
  headToHead: Map<string, HeadToHeadSummary>;
};

type BatchAnalyzeRequest = {
  matchIds: number[];
  forceUpdate?: boolean;
};

const PREDICTION_TTL_SECONDS = CacheService.TTL?.PREDICTIONS ?? 1800;
const PREDICTION_EXPIRY_MS = PREDICTION_TTL_SECONDS * 1000;
const RATE_LIMIT_DELAY_MS = 250;

let nextAvailableSlot = Date.now();

function createContext(): BatchPredictionContext {
  return {
    leagueFixtures: new Map(),
    standings: new Map(),
    headToHead: new Map()
  };
}

async function withRateLimit<T>(operation: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const waitTime = Math.max(0, nextAvailableSlot - now);

  if (waitTime > 0) {
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  const result = await operation();
  nextAvailableSlot = Date.now() + RATE_LIMIT_DELAY_MS;
  return result;
}

async function safeCacheGet<T>(key: string): Promise<T | null> {
  try {
    return await CacheService.get<T>(key);
  } catch (error) {
    console.warn(`CacheService.get failed for key ${key}:`, error);
    return null;
  }
}

async function safeCacheSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  try {
    await CacheService.set(key, value, ttlSeconds);
  } catch (error) {
    console.warn(`CacheService.set failed for key ${key}:`, error);
  }
}

async function fetchFixture(matchId: number): Promise<Fixture | null> {
  const cacheKey = CacheService.generateApiKey('fixture', { matchId });
  const cached = await safeCacheGet<Fixture>(cacheKey);
  if (cached) return cached;

  const fixture = await withRateLimit(() => ApiFootballService.getFixture(matchId));
  if (fixture) {
    await safeCacheSet(cacheKey, fixture, CacheService.TTL.FIXTURES_TODAY);
  }
  return fixture;
}

async function fetchLeagueFixtures(
  leagueId: number,
  season: number,
  context: BatchPredictionContext
): Promise<Fixture[]> {
  const contextKey = `${leagueId}-${season}`;
  const cached = context.leagueFixtures.get(contextKey);
  if (cached) return cached;

  const cacheKey = CacheService.generateApiKey('fixtures', { leagueId, season, status: 'FT' });
  const stored = await safeCacheGet<Fixture[]>(cacheKey);
  if (stored) {
    context.leagueFixtures.set(contextKey, stored);
    return stored;
  }

  const fixtures = await withRateLimit(() => ApiFootballService.getFixturesByLeague(leagueId, season, 'FT'));
  const normalized = fixtures || [];
  context.leagueFixtures.set(contextKey, normalized);
  await safeCacheSet(cacheKey, normalized, CacheService.TTL.FIXTURES_PAST);
  return normalized;
}

async function fetchStandings(
  leagueId: number,
  season: number,
  context: BatchPredictionContext
): Promise<Standing[]> {
  const contextKey = `${leagueId}-${season}`;
  const cached = context.standings.get(contextKey);
  if (cached) return cached;

  const cacheKey = CacheService.generateApiKey('standings', { leagueId, season });
  const stored = await safeCacheGet<Standing[]>(cacheKey);
  if (stored) {
    context.standings.set(contextKey, stored);
    return stored;
  }

  const standings = await withRateLimit(() => ApiFootballService.getStandings(leagueId, season));
  const normalized = standings || [];
  context.standings.set(contextKey, normalized);
  await safeCacheSet(cacheKey, normalized, CacheService.TTL.LEAGUE_STANDINGS);
  return normalized;
}

async function fetchHeadToHead(
  homeTeamId: number,
  awayTeamId: number,
  context: BatchPredictionContext
): Promise<HeadToHeadSummary | null> {
  const contextKey = `${homeTeamId}-${awayTeamId}`;
  const cached = context.headToHead.get(contextKey);
  if (cached) return cached;

  const cacheKey = CacheService.generateApiKey('headToHead', { homeTeamId, awayTeamId });
  const stored = await safeCacheGet<HeadToHeadSummary>(cacheKey);
  if (stored) {
    context.headToHead.set(contextKey, stored);
    return stored;
  }

  const fixtures = await withRateLimit(() => ApiFootballService.getHeadToHead(`${homeTeamId}-${awayTeamId}`));
  if (!fixtures || fixtures.length === 0) {
    return null;
  }

  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;

  fixtures.forEach(match => {
    if (match.goals.home > match.goals.away) {
      if (match.teams.home.id === homeTeamId) homeWins += 1;
      else awayWins += 1;
    } else if (match.goals.home < match.goals.away) {
      if (match.teams.away.id === homeTeamId) homeWins += 1;
      else awayWins += 1;
    } else {
      draws += 1;
    }
  });

  const summary: HeadToHeadSummary = {
    total_matches: fixtures.length,
    team1_wins: homeWins,
    team2_wins: awayWins,
    draws
  };

  context.headToHead.set(contextKey, summary);
  await safeCacheSet(cacheKey, summary, CacheService.TTL.HEAD_TO_HEAD);
  return summary;
}

async function fetchApiPrediction(matchId: number): Promise<any> {
  const cacheKey = CacheService.generateApiKey('apiPrediction', { matchId });
  const cached = await safeCacheGet<any>(cacheKey);
  if (cached) return cached;

  const prediction = await withRateLimit(() => ApiFootballService.getPredictions(matchId));
  if (prediction) {
    await safeCacheSet(cacheKey, prediction, CacheService.TTL.PREDICTIONS);
  }
  return prediction;
}

function toEngineMatches(fixtures: Fixture[], teamId: number) {
  return fixtures
    .filter(match => match.teams.home.id === teamId || match.teams.away.id === teamId)
    .sort((a, b) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime())
    .slice(0, 10)
    .map(match => ({
      id: match.fixture.id,
      home_team_id: match.teams.home.id,
      away_team_id: match.teams.away.id,
      home_goals: match.goals.home,
      away_goals: match.goals.away,
      date: new Date(match.fixture.date)
    }));
}

function calculateConfidenceScore(
  advanced: AdvancedMatchPrediction | null,
  fallback: MatchPrediction | null,
  apiPrediction: any
): number {
  let weightedScore = 0;
  let weight = 0;

  if (advanced) {
    const confidence = advanced.match_result?.confidence ?? advanced.prediction_confidence ?? 0;
    const peakProbability = Math.max(
      advanced.match_result?.home_win?.probability ?? 0,
      advanced.match_result?.draw?.probability ?? 0,
      advanced.match_result?.away_win?.probability ?? 0
    );

    if (confidence) {
      weightedScore += confidence * 0.6;
      weight += 0.6;
    }

    if (peakProbability) {
      weightedScore += peakProbability * 0.2;
      weight += 0.2;
    }
  }

  if (fallback) {
    const fallbackConfidence = (fallback.match_winner?.confidence ?? 0) * 100;
    const fallbackPeak = Math.max(
      (fallback.match_winner?.home_probability ?? 0) * 100,
      (fallback.match_winner?.draw_probability ?? 0) * 100,
      (fallback.match_winner?.away_probability ?? 0) * 100
    );

    if (fallbackConfidence) {
      weightedScore += fallbackConfidence * 0.15;
      weight += 0.15;
    }

    if (fallbackPeak) {
      weightedScore += fallbackPeak * 0.05;
      weight += 0.05;
    }
  }

  const apiConfidence = apiPrediction?.comparison?.winner?.confidence as number | undefined;
  if (typeof apiConfidence === 'number' && Number.isFinite(apiConfidence)) {
    weightedScore += apiConfidence * 0.15;
    weight += 0.15;
  }

  if (weight === 0) {
    return 0;
  }

  const score = weightedScore / weight;
  return Math.round(Math.min(100, Math.max(0, score)));
}

function determineRecommendedBet(
  advanced: AdvancedMatchPrediction | null,
  fallback: MatchPrediction | null,
  apiPrediction: any,
  confidence: number
): string {
  if (confidence < 60) {
    return 'Düşük Güven - Bahis Önerilmez';
  }

  const highConfidence = advanced?.risk_analysis?.high_confidence_bets;
  if (Array.isArray(highConfidence) && highConfidence.length > 0) {
    const best = [...highConfidence].sort((a, b) => b.confidence - a.confidence)[0];
    return `${best.title} - ${best.recommendation}`;
  }

  if (advanced?.match_result) {
    const outcomes = [
      { label: 'Ev Sahibi Kazanır', probability: advanced.match_result.home_win?.probability ?? 0 },
      { label: 'Beraberlik', probability: advanced.match_result.draw?.probability ?? 0 },
      { label: 'Deplasman Kazanır', probability: advanced.match_result.away_win?.probability ?? 0 }
    ];

    const best = outcomes.sort((a, b) => b.probability - a.probability)[0];
    if (best.probability >= 45) {
      return `${best.label} (${best.probability.toFixed(1)}% olasılık)`;
    }
  }

  if (fallback?.match_winner) {
    const labelMap: Record<'home' | 'draw' | 'away', string> = {
      home: 'Ev Sahibi Kazanır',
      draw: 'Beraberlik Seçeneği',
      away: 'Deplasman Kazanır'
    };

    const probability = Math.max(
      fallback.match_winner.home_probability,
      fallback.match_winner.draw_probability,
      fallback.match_winner.away_probability
    );

    return `${labelMap[fallback.match_winner.prediction]} (${Math.round(probability * 100)}% olasılık)`;
  }

  const apiRecommendation = apiPrediction?.predictions?.[0]?.advice as string | undefined;
  if (apiRecommendation) {
    return apiRecommendation;
  }

  return 'Analiz Devam Ediyor';
}

async function buildPrediction(matchId: number, context: BatchPredictionContext): Promise<PredictionCache | null> {
  const fixture = await fetchFixture(matchId);
  if (!fixture) {
    console.warn(`Fixture not found for match ${matchId}`);
    return null;
  }

  const leagueId = fixture.league.id;
  const season = fixture.league.season;
  const homeTeamId = fixture.teams.home.id;
  const awayTeamId = fixture.teams.away.id;

  const leagueFixtures = await fetchLeagueFixtures(leagueId, season, context);
  const homeMatches = toEngineMatches(leagueFixtures, homeTeamId);
  const awayMatches = toEngineMatches(leagueFixtures, awayTeamId);

  const homeForm = PredictionEngine.calculateTeamForm(homeMatches as any[], homeTeamId);
  const awayForm = PredictionEngine.calculateTeamForm(awayMatches as any[], awayTeamId);

  const headToHead = await fetchHeadToHead(homeTeamId, awayTeamId, context);

  const standings = await fetchStandings(leagueId, season, context);
  const homeStanding = standings.find(entry => entry.team.id === homeTeamId);
  const awayStanding = standings.find(entry => entry.team.id === awayTeamId);

  let advancedPrediction: AdvancedMatchPrediction | null = null;
  try {
    advancedPrediction = await withRateLimit(() =>
      AdvancedPredictionEngine.generateAdvancedPrediction(homeTeamId, awayTeamId, leagueId, season, matchId)
    );
  } catch (error) {
    console.error(`Advanced prediction failed for match ${matchId}:`, error);
  }

  let fallbackPrediction: MatchPrediction | null = null;
  try {
    fallbackPrediction = await PredictionEngine.predictMatch(
      fixture.teams.home as any,
      fixture.teams.away as any,
      homeForm,
      awayForm,
      headToHead as any,
      homeStanding ? { rank: homeStanding.rank, points: homeStanding.points } as any : undefined,
      awayStanding ? { rank: awayStanding.rank, points: awayStanding.points } as any : undefined
    );
  } catch (error) {
    console.error(`Fallback prediction failed for match ${matchId}:`, error);
  }

  if (!advancedPrediction && !fallbackPrediction) {
    return null;
  }

  const apiPrediction = await fetchApiPrediction(matchId);
  const confidenceScore = calculateConfidenceScore(advancedPrediction, fallbackPrediction, apiPrediction);
  const recommendedBet = determineRecommendedBet(advancedPrediction, fallbackPrediction, apiPrediction, confidenceScore);

  return {
    match_id: matchId,
    confidence_score: confidenceScore,
    recommended_bet: recommendedBet,
    prediction_data: {
      advanced: advancedPrediction,
      fallback: fallbackPrediction,
      api: apiPrediction,
      league_id: leagueId,
      season
    },
    value_bets: advancedPrediction?.risk_analysis ?? null,
    last_updated: new Date().toISOString(),
    expiry_time: new Date(Date.now() + PREDICTION_EXPIRY_MS).toISOString()
  };
}

function toSummary(prediction: PredictionCache) {
  return {
    match_id: prediction.match_id,
    confidence_score: prediction.confidence_score,
    recommended_bet: prediction.recommended_bet,
    last_updated: prediction.last_updated
  };
}

export async function POST(request: NextRequest) {
  let body: BatchAnalyzeRequest;

  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const { matchIds, forceUpdate = false } = body ?? {};
  if (!Array.isArray(matchIds) || matchIds.length === 0) {
    return NextResponse.json({ success: false, error: 'Match IDs array required' }, { status: 400 });
  }

  const sanitizedIds = Array.from(new Set(matchIds.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0)));
  if (sanitizedIds.length === 0) {
    return NextResponse.json({ success: false, error: 'No valid match IDs provided' }, { status: 400 });
  }

  console.info(`Batch prediction request for ${sanitizedIds.length} matches. Force update: ${forceUpdate}`);

  cache.cleanExpiredPredictions({ reason: 'batch-post-start' });
  await CacheService.cleanExpired().catch(error => console.warn('CacheService cleanup failed:', error));

  const context = createContext();
  const now = new Date();
  const aggregated = new Map<number, PredictionCache>();
  const matchesToProcess: number[] = [];

  for (const matchId of sanitizedIds) {
    if (!forceUpdate) {
      const cacheKey = CacheService.generateApiKey('prediction', { matchId });
      const cachedPrediction = await safeCacheGet<PredictionCache>(cacheKey);

      if (cachedPrediction && new Date(cachedPrediction.expiry_time) > now) {
        aggregated.set(matchId, cachedPrediction);
        cache.savePrediction(cachedPrediction);
        continue;
      }

      const jsonCached = cache.getPrediction(matchId);
      if (jsonCached) {
        aggregated.set(matchId, jsonCached);
        await safeCacheSet(cacheKey, jsonCached, PREDICTION_TTL_SECONDS);
        continue;
      }
    }

    matchesToProcess.push(matchId);
  }

  const freshPredictions: PredictionCache[] = [];
  const failedMatches: number[] = [];

  for (const matchId of matchesToProcess) {
    try {
      const prediction = await buildPrediction(matchId, context);
      if (!prediction) {
        failedMatches.push(matchId);
        continue;
      }

      freshPredictions.push(prediction);
      aggregated.set(matchId, prediction);

      const cacheKey = CacheService.generateApiKey('prediction', { matchId });
      await safeCacheSet(cacheKey, prediction, PREDICTION_TTL_SECONDS);
    } catch (error) {
      console.error(`Failed to build prediction for match ${matchId}:`, error);
      failedMatches.push(matchId);
    }
  }

  if (freshPredictions.length > 0) {
    cache.savePredictionsBatch(freshPredictions);
  }

  const orderedPredictions = sanitizedIds
    .map(matchId => aggregated.get(matchId))
    .filter((prediction): prediction is PredictionCache => Boolean(prediction));

  cache.saveAnalysisLog({
    run_time: new Date().toISOString(),
    matches_analyzed: freshPredictions.length,
    matches_failed: failedMatches.length,
    total_matches: sanitizedIds.length,
    status: failedMatches.length > 0 ? 'partial' : 'completed',
    error_message: failedMatches.length > 0 ? `Failed matches: ${failedMatches.join(', ')}` : undefined
  });

  const source = matchesToProcess.length === 0
    ? 'cache'
    : freshPredictions.length === matchesToProcess.length && failedMatches.length === 0
      ? 'fresh'
      : 'mixed';

  return NextResponse.json({
    success: true,
    source,
    predictions: orderedPredictions,
    analyzed: freshPredictions.length,
    failed: failedMatches.length
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const idsParam = searchParams.get('matchIds');

  if (!idsParam) {
    return NextResponse.json({ success: false, error: 'Match IDs required' }, { status: 400 });
  }

  const matchIds = idsParam
    .split(',')
    .map(raw => Number(raw.trim()))
    .filter(id => Number.isFinite(id) && id > 0);

  if (matchIds.length === 0) {
    return NextResponse.json({ success: false, error: 'No valid match IDs provided' }, { status: 400 });
  }

  cache.cleanExpiredPredictions({ reason: 'batch-get' });

  const now = new Date();
  const summaries: PredictionCache[] = [];

  for (const matchId of matchIds) {
    const cacheKey = CacheService.generateApiKey('prediction', { matchId });
    let prediction = await safeCacheGet<PredictionCache>(cacheKey);

    if (!prediction || new Date(prediction.expiry_time) <= now) {
      prediction = cache.getPrediction(matchId);
      if (prediction) {
        await safeCacheSet(cacheKey, prediction, PREDICTION_TTL_SECONDS);
      }
    }

    if (prediction) {
      summaries.push(prediction);
    }
  }

  const orderedSummaries = matchIds
    .map(matchId => summaries.find(prediction => prediction.match_id === matchId))
    .filter((prediction): prediction is PredictionCache => Boolean(prediction))
    .map(toSummary);

  return NextResponse.json({
    success: true,
    predictions: orderedSummaries
  });
}
