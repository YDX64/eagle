/**
 * ProBet Backtest Engine
 *
 * Replays the ProBet pipeline on historical FT matches and compares the
 * predictions to actual outcomes. Critically, for each backtest match it
 * uses ONLY the matches that occurred STRICTLY BEFORE that match — so the
 * model never sees the future when making a prediction. This is the gold
 * standard for time-series ML evaluation.
 *
 * Key metrics computed:
 *  - Hit rate (1X2 accuracy)
 *  - Brier score (probabilistic calibration)
 *  - Log loss (cross-entropy)
 *  - ROI at different confidence thresholds (assuming fair odds = 1/p)
 *  - Per-confidence-bucket accuracy (calibration plot data)
 *
 * Pipeline:
 *  1. For each league in scope, fetch ALL FT fixtures of the season
 *  2. Sort chronologically
 *  3. Build the training matrix of (features, labels) row by row, where each
 *     row's features come from prior matches only
 *  4. For each backtest match (must be in the requested date range):
 *     a. Train ensemble on features built from PRIOR matches only
 *     b. Make Poisson + xG prediction analytically (no training)
 *     c. Blend, score against actual result
 *  5. Aggregate metrics
 */

import { ApiFootballService, type Fixture, type MatchStatistics, MAJOR_LEAGUES, PROBET_LEAGUE_IDS, inferSeason } from '../api-football';
import {
  extractFeaturesForMatch,
  buildTrainingMatrix,
  toHistoricalMatches,
  featuresToVector,
  type HistoricalMatch,
} from './feature-engineering';
import { predictWithPoissonXG } from './poisson-xg-model';
import {
  trainEnsemble,
  predictEnsemble,
  type EnsembleState,
} from './gradient-boost';

export interface BacktestMatchResult {
  fixtureId: number;
  date: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  actualResult: 'H' | 'D' | 'A';
  actualScore: string;

  predictedOutcome: 'H' | 'D' | 'A';
  predictedConfidence: number;

  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;

  expectedHomeGoals: number;
  expectedAwayGoals: number;

  hit: boolean;
  brierContribution: number;
  logLossContribution: number;

  // Market predictions (for breakdown analysis)
  predictedOver15: boolean;
  actualOver15: boolean;
  over15Hit: boolean;
  predictedOver25: boolean;
  actualOver25: boolean;
  over25Hit: boolean;
  predictedOver35: boolean;
  actualOver35: boolean;
  over35Hit: boolean;
  predictedBTTS: boolean;
  actualBTTS: boolean;
  bttsHit: boolean;
  topPredictedScore: string;
  exactScoreHit: boolean;
  isClearFavorite: boolean; // |xG_home - xG_away| > 1.5
  isCloseMatch: boolean; // |xG_home - xG_away| < 0.5

  // Corners (new)
  predictedCorners: number | null;
  actualCorners: number | null;
  predictedCornersOver85: boolean | null;
  cornersOver85Hit: boolean | null;
  predictedCornersOver95: boolean | null;
  cornersOver95Hit: boolean | null;
  predictedCornersOver105: boolean | null;
  cornersOver105Hit: boolean | null;

  // Cards (new)
  predictedCards: number | null;
  actualCards: number | null;
  predictedCardsOver35: boolean | null;
  cardsOver35Hit: boolean | null;
  predictedCardsOver45: boolean | null;
  cardsOver45Hit: boolean | null;

  // First goal (new)
  predictedFirstGoal: 'H' | 'A' | 'NONE';
  actualFirstGoal: 'H' | 'A' | 'NONE' | null;
  firstGoalHit: boolean | null;

  // SMART PICK: which market had the highest confidence and was it correct?
  smartPickMarket: string; // e.g. "OVER_25", "BTTS_YES", "HOME_WIN"
  smartPickLabel: string; // e.g. "Üst 2.5"
  smartPickConfidence: number;
  smartPickHit: boolean;

  // HTFT (Half Time / Full Time) — 9 outcome matrix
  predictedHtft: string; // 'H/H' | 'H/D' | 'H/A' | 'D/H' | 'D/D' | 'D/A' | 'A/H' | 'A/D' | 'A/A'
  predictedHtftConfidence: number;
  actualHtft: string | null;
  htftHit: boolean | null;

  // Top-N exact score hit — does actual score fall in top-3 / top-5 predictions?
  top3Scores: string[]; // e.g. ['1-0', '0-0', '1-1']
  top5Scores: string[];
  top3ScoreHit: boolean;
  top5ScoreHit: boolean;

  // 1X2 confidence bucket for calibration plot
  matchResultConfidenceBucket: '>65%' | '55-65%' | '45-55%' | '35-45%' | '<35%';

  // Poisson+xG vs Ensemble breakdown
  poissonProbs: { H: number; D: number; A: number };
  ensembleProbs: { H: number; D: number; A: number };
}

export interface ConfidenceBucket {
  threshold: number; // e.g., 0.4 → matches with confidence >= 0.4
  count: number;
  hits: number;
  accuracy: number;
  roi: number; // (winnings - stakes) / stakes, assuming fair odds
}

export interface LeagueBreakdown {
  leagueName: string;
  count: number;
  hits: number;
  accuracy: number;
  brierScore: number;
}

export interface MarketBreakdown {
  // Hit rates and Brier on different sub-markets to find what the model is good at
  matchResult: { count: number; hits: number; accuracy: number };
  over15: { count: number; hits: number; accuracy: number };
  over25: { count: number; hits: number; accuracy: number };
  over35: { count: number; hits: number; accuracy: number };
  bttsCorrect: { count: number; hits: number; accuracy: number };
  exactScoreTopPick: { count: number; hits: number; accuracy: number };
  // SMART pick: pick whichever market the model is most confident on, per fixture
  smartPick: { count: number; hits: number; accuracy: number };
  // High xG difference matches (>1.5 goal gap) — should be easier to predict
  clearFavorites: { count: number; hits: number; accuracy: number };
  // Close matches where xG difference < 0.5 — harder
  closeMatches: { count: number; hits: number; accuracy: number };
  // Corners (new)
  cornersOver85: { count: number; hits: number; accuracy: number };
  cornersOver95: { count: number; hits: number; accuracy: number };
  cornersOver105: { count: number; hits: number; accuracy: number };
  // Cards (new)
  cardsOver35: { count: number; hits: number; accuracy: number };
  cardsOver45: { count: number; hits: number; accuracy: number };
  // First goal (new)
  firstGoal: { count: number; hits: number; accuracy: number };
  // HTFT overall (any of the 9 outcomes correctly predicted)
  htft: { count: number; hits: number; accuracy: number };
  // HTFT per outcome breakdown (1/1, 2/1, X/X, etc)
  htftSpecific: Record<string, { count: number; hits: number; accuracy: number }>;
  // Exact score top-3 / top-5 accuracy
  exactScoreTop3: { count: number; hits: number; accuracy: number };
  exactScoreTop5: { count: number; hits: number; accuracy: number };
  // 1X2 accuracy broken down by confidence bucket (calibration plot)
  matchResultByConfidence: Record<string, { count: number; hits: number; accuracy: number }>;
}

export interface StrengthInsights {
  // Auto-generated narrative findings
  bestLeague: string | null;
  worstLeague: string | null;
  bestMarket: string;
  bestConfidenceThreshold: number;
  highlights: string[];
  weaknesses: string[];
}

export interface BacktestResult {
  // Scope
  leaguesUsed: number[];
  fromDate: string;
  toDate: string;

  // Aggregate metrics
  totalMatches: number;
  hits: number;
  hitRate: number;
  brierScore: number;
  logLoss: number;

  // Per-outcome accuracy
  homeWinAccuracy: number;
  drawAccuracy: number;
  awayWinAccuracy: number;

  // Per-confidence buckets (calibration)
  confidenceBuckets: ConfidenceBucket[];

  // Per-league breakdown — find which leagues the model handles best
  leagueBreakdowns: LeagueBreakdown[];

  // Per-market breakdown — find which markets the model excels at
  marketBreakdowns: MarketBreakdown;

  // Auto-generated insights
  insights: StrengthInsights;

  // Sample of match-level results (top hits + losses)
  sampleResults: BacktestMatchResult[];
}

interface LeagueState {
  history: HistoricalMatch[]; // sorted ascending
  ensembleCache: Map<number, EnsembleState>; // keyed by training set size for retrain frequency
}

// Default = full PROBET_LEAGUE_IDS (top + 2nd divisions, no cups)
const DEFAULT_LEAGUE_IDS = PROBET_LEAGUE_IDS;

/**
 * Parse fixture statistics from API-Football to extract total corners and cards.
 * Returns null if data is missing or incomplete.
 */
function extractCornersAndCards(stats: MatchStatistics[]): {
  totalCorners: number | null;
  totalCards: number | null;
} {
  if (!stats || stats.length < 2) {
    return { totalCorners: null, totalCards: null };
  }

  let totalCorners = 0;
  let totalCards = 0;
  let hasCornerData = false;
  let hasCardData = false;

  for (const teamStat of stats) {
    for (const item of teamStat.statistics || []) {
      const type = item.type?.toLowerCase() || '';
      const value = item.value;
      const numValue =
        typeof value === 'number' ? value : typeof value === 'string' ? parseInt(value, 10) : 0;
      if (Number.isNaN(numValue)) continue;

      if (type.includes('corner')) {
        totalCorners += numValue;
        hasCornerData = true;
      } else if (type === 'yellow cards' || type === 'red cards') {
        totalCards += numValue;
        hasCardData = true;
      }
    }
  }

  return {
    totalCorners: hasCornerData ? totalCorners : null,
    totalCards: hasCardData ? totalCards : null,
  };
}

/**
 * Parse fixture events to determine who scored first.
 * Returns 'H', 'A', or 'NONE' if no goals.
 *
 * API-Football returns events as an array where each event has:
 *   type: 'Goal' | 'Card' | 'subst' | 'Var'
 *   detail: 'Normal Goal' | 'Own Goal' | 'Penalty' | 'Missed Penalty' | ...
 *   team: { id, name, ... }
 *   time: { elapsed, extra? }
 */
function extractFirstGoal(
  events: any[],
  homeTeamId: number
): 'H' | 'A' | 'NONE' {
  if (!Array.isArray(events) || events.length === 0) return 'NONE';
  const goals = events
    .filter((e) => {
      const type = (e?.type || '').toLowerCase();
      const detail = (e?.detail || '').toLowerCase();
      // Match 'Goal' type but exclude missed penalties
      return type === 'goal' && !detail.includes('missed');
    })
    .sort((a, b) => {
      const ta = (a?.time?.elapsed ?? 999) * 60 + (a?.time?.extra ?? 0);
      const tb = (b?.time?.elapsed ?? 999) * 60 + (b?.time?.extra ?? 0);
      return ta - tb;
    });
  if (goals.length === 0) return 'NONE';
  const firstGoal = goals[0];
  const teamId = firstGoal?.team?.id;
  if (teamId === undefined) return 'NONE';
  // For own goals, the scoring team is the OPPOSITE of the player's team.
  // API-Football's `team.id` is the team that BENEFITS from the goal, so
  // this is already correct for own goals.
  return teamId === homeTeamId ? 'H' : 'A';
}

export interface BacktestConfig {
  leagueIds?: number[];
  /** If omitted, season is inferred from toDate. */
  season?: number;
  /** If true, also fetch matches from the previous season (for >1 year backtests). */
  includePreviousSeason?: boolean;
  fromDate: string; // YYYY-MM-DD inclusive
  toDate: string; // YYYY-MM-DD inclusive
  maxMatches?: number; // safety cap
  retrainEvery?: number; // retrain ensemble every N matches (otherwise reuse)
  /**
   * Fast mode: skip ensemble entirely, use Poisson + xG only.
   * 5-10x faster, slightly lower accuracy. Recommended for >500 match backtests.
   */
  fastMode?: boolean;
  /**
   * Fetch fixture statistics (corners, cards) for each match.
   * Costs 1 extra API call per match. With Mega plan (900 r/m) this is
   * ~67 seconds for 1000 matches. Enables corner/card market backtesting.
   */
  fetchStatistics?: boolean;
  /**
   * Fetch fixture events (for first-goal market backtesting).
   * Costs 1 extra API call per match.
   */
  fetchEvents?: boolean;
}

/**
 * Run a full backtest. The most expensive operation by far is training the
 * ensemble; we amortize by retraining only every `retrainEvery` matches
 * within a league (default 20). Predictions between retrains use the latest
 * trained model (which still has no leakage — it was trained on data up to
 * the retrain point).
 */
export async function runBacktest(config: BacktestConfig): Promise<BacktestResult> {
  const leagueIds =
    config.leagueIds && config.leagueIds.length > 0 ? config.leagueIds : DEFAULT_LEAGUE_IDS;
  const fromDate = new Date(config.fromDate);
  const toDate = new Date(config.toDate);
  toDate.setHours(23, 59, 59, 999);
  const maxMatches = config.maxMatches ?? 200;
  const retrainEvery = config.retrainEvery ?? 20;
  const fastMode = !!config.fastMode;

  // Auto-detect season from the toDate, optionally include previous season too
  const primarySeason = config.season ?? inferSeason(toDate);
  const seasonsToFetch = config.includePreviousSeason
    ? [primarySeason, primarySeason - 1]
    : [primarySeason];

  const matchResults: BacktestMatchResult[] = [];
  const leagueStates = new Map<number, LeagueState>();

  // Pre-fetch all leagues' season data in parallel.
  // For 25 leagues × 2 seasons = 50 API calls in parallel.
  const fetchPromises: Promise<{ leagueId: number; fixtures: Fixture[] }>[] = [];
  for (const leagueId of leagueIds) {
    for (const season of seasonsToFetch) {
      fetchPromises.push(
        (async () => {
          try {
            const fixtures = await ApiFootballService.getFixturesByLeague(leagueId, season, 'FT');
            return { leagueId, fixtures };
          } catch (e) {
            return { leagueId, fixtures: [] as Fixture[] };
          }
        })()
      );
    }
  }
  const allFetched = await Promise.all(fetchPromises);

  // Combine fixtures per league across seasons
  const leagueFixturesMap = new Map<number, Fixture[]>();
  for (const lf of allFetched) {
    if (!leagueFixturesMap.has(lf.leagueId)) leagueFixturesMap.set(lf.leagueId, []);
    leagueFixturesMap.get(lf.leagueId)!.push(...lf.fixtures);
  }

  const leagueData: Array<{ leagueId: number; fixtures: Fixture[] }> = Array.from(
    leagueFixturesMap.entries()
  ).map(([leagueId, fixtures]) => ({ leagueId, fixtures }));

  // Build league states (sorted by date asc inside toHistoricalMatches)
  for (const ld of leagueData) {
    const history = toHistoricalMatches(ld.fixtures);
    if (history.length === 0) continue;
    leagueStates.set(ld.leagueId, {
      history,
      ensembleCache: new Map(),
    });
  }

  // Collect candidate matches: those in the date range across all leagues
  type Candidate = { fixture: Fixture; leagueId: number };
  const candidates: Candidate[] = [];
  for (const ld of leagueData) {
    for (const f of ld.fixtures) {
      if (f.fixture.status.short !== 'FT') continue;
      const d = new Date(f.fixture.date);
      if (d.getTime() < fromDate.getTime() || d.getTime() > toDate.getTime()) continue;
      candidates.push({ fixture: f, leagueId: ld.leagueId });
    }
  }
  // Sort by date DESC to take the most recent N first when capping...
  candidates.sort((a, b) => b.fixture.fixture.timestamp - a.fixture.fixture.timestamp);
  const cappedCandidates = candidates.slice(0, maxMatches);
  // ...then re-sort ASC for chronological walk-forward processing
  cappedCandidates.sort((a, b) => a.fixture.fixture.timestamp - b.fixture.fixture.timestamp);
  const targetCandidates = cappedCandidates;

  // Walk-forward through each match
  for (const cand of targetCandidates) {
    const leagueState = leagueStates.get(cand.leagueId);
    if (!leagueState) continue;

    const matchDate = new Date(cand.fixture.fixture.date);
    const priorHistory = leagueState.history.filter(
      (m) => m.date.getTime() < matchDate.getTime()
    );

    if (priorHistory.length < 30) continue; // not enough data yet

    // Build/cache ensemble for this league at this point in history
    // We use the size of the prior history (rounded down to nearest retrainEvery)
    // as the cache key — so neighboring matches reuse the same trained model.
    let eH = 0;
    let eD = 0;
    let eA = 0;

    if (!fastMode) {
      const priorSize = priorHistory.length;
      const cacheBucket = Math.floor(priorSize / retrainEvery);
      let ensemble = leagueState.ensembleCache.get(cacheBucket);

      if (!ensemble) {
        const { X, y } = buildTrainingMatrix(priorHistory);
        if (X.length < 25) {
          // fall back to fast-mode for this single match
        } else {
          ensemble = trainEnsemble(X, y, null, null);
          leagueState.ensembleCache.set(cacheBucket, ensemble);
        }
      }

      if (ensemble) {
        // Extract features for THIS match using ONLY priorHistory
        const featuresForEnsemble = extractFeaturesForMatch(
          cand.fixture.teams.home.id,
          cand.fixture.teams.away.id,
          matchDate,
          priorHistory
        );
        const fv = featuresToVector(featuresForEnsemble);
        const ensembleProbs = predictEnsemble(ensemble, fv);
        eH = ensembleProbs[0];
        eD = ensembleProbs[1];
        eA = ensembleProbs[2];
      }
    }

    // Extract features for THIS match using ONLY priorHistory
    const features = extractFeaturesForMatch(
      cand.fixture.teams.home.id,
      cand.fixture.teams.away.id,
      matchDate,
      priorHistory
    );

    // Poisson + xG (analytic, no training)
    const poissonPred = predictWithPoissonXG(features);

    // Blend: in fast mode use 100% Poisson, else 50/50
    let blendH: number, blendD: number, blendA: number;
    if (fastMode || (eH === 0 && eD === 0 && eA === 0)) {
      blendH = poissonPred.homeWinProb;
      blendD = poissonPred.drawProb;
      blendA = poissonPred.awayWinProb;
      eH = poissonPred.homeWinProb;
      eD = poissonPred.drawProb;
      eA = poissonPred.awayWinProb;
    } else {
      blendH = 0.5 * poissonPred.homeWinProb + 0.5 * eH;
      blendD = 0.5 * poissonPred.drawProb + 0.5 * eD;
      blendA = 0.5 * poissonPred.awayWinProb + 0.5 * eA;
    }
    const total = blendH + blendD + blendA;
    const probs = [blendH / total, blendD / total, blendA / total];

    // Determine actual result
    const homeGoals = cand.fixture.goals.home ?? 0;
    const awayGoals = cand.fixture.goals.away ?? 0;
    let actualResult: 'H' | 'D' | 'A' = 'D';
    if (homeGoals > awayGoals) actualResult = 'H';
    else if (homeGoals < awayGoals) actualResult = 'A';

    const actualIdx = actualResult === 'H' ? 0 : actualResult === 'D' ? 1 : 2;
    const predIdx = probs.indexOf(Math.max(...probs));
    const predictedOutcome: 'H' | 'D' | 'A' = predIdx === 0 ? 'H' : predIdx === 1 ? 'D' : 'A';
    const hit = predictedOutcome === actualResult;

    // Confidence = max prob
    const confidence = probs[predIdx];

    // Brier
    let brier = 0;
    for (let c = 0; c < 3; c++) {
      const t = c === actualIdx ? 1 : 0;
      brier += (probs[c] - t) ** 2;
    }

    // Log loss
    const eps = 1e-12;
    const pTrue = Math.max(eps, Math.min(1 - eps, probs[actualIdx]));
    const logLoss = -Math.log(pTrue);

    // Market-level predictions
    const totalActual = homeGoals + awayGoals;
    const actualOver15 = totalActual > 1.5;
    const predictedOver15 = poissonPred.over15 > 0.5;
    const over15Hit = actualOver15 === predictedOver15;

    const actualOver25 = totalActual > 2.5;
    const predictedOver25 = poissonPred.over25 > 0.5;
    const over25Hit = actualOver25 === predictedOver25;

    const actualOver35 = totalActual > 3.5;
    const predictedOver35 = poissonPred.over35 > 0.5;
    const over35Hit = actualOver35 === predictedOver35;

    const actualBTTS = homeGoals > 0 && awayGoals > 0;
    const predictedBTTS = poissonPred.bttsYes > 0.5;
    const bttsHit = actualBTTS === predictedBTTS;

    const topPredictedScore = poissonPred.topScores[0]?.score ?? '';
    const actualScoreStr = `${homeGoals}-${awayGoals}`;
    const exactScoreHit = topPredictedScore === actualScoreStr;

    // Top-3 / Top-5 exact score predictions — actual score falls within them?
    const top3Scores = poissonPred.topScores.slice(0, 3).map((s) => s.score);
    const top5Scores = poissonPred.topScores.slice(0, 5).map((s) => s.score);
    const top3ScoreHit = top3Scores.includes(actualScoreStr);
    const top5ScoreHit = top5Scores.includes(actualScoreStr);

    // HTFT prediction: find highest-probability entry in the 9-outcome matrix
    // Poisson model uses 'H', 'D', 'A' labels; we convert to standard '1/1', '1/X', ... format
    const htftEntries = Object.entries(poissonPred.htft) as [string, number][];
    htftEntries.sort((a, b) => b[1] - a[1]);
    const [rawPredictedHtft, predictedHtftConfidence] = htftEntries[0] ?? ['D/D', 0];
    const predictedHtft = rawPredictedHtft; // e.g. 'H/H', 'A/D'

    // Actual HTFT — use API-Football's score.halftime
    const htHome = cand.fixture.score?.halftime?.home;
    const htAway = cand.fixture.score?.halftime?.away;
    let actualHtft: string | null = null;
    let htftHit: boolean | null = null;
    if (htHome !== null && htHome !== undefined && htAway !== null && htAway !== undefined) {
      const htSide = htHome > htAway ? 'H' : htHome < htAway ? 'A' : 'D';
      const ftSide = homeGoals > awayGoals ? 'H' : homeGoals < awayGoals ? 'A' : 'D';
      actualHtft = `${htSide}/${ftSide}`;
      htftHit = actualHtft === predictedHtft;
    }

    // Confidence bucket for 1X2 calibration
    let matchResultConfidenceBucket: BacktestMatchResult['matchResultConfidenceBucket'];
    if (confidence >= 0.65) matchResultConfidenceBucket = '>65%';
    else if (confidence >= 0.55) matchResultConfidenceBucket = '55-65%';
    else if (confidence >= 0.45) matchResultConfidenceBucket = '45-55%';
    else if (confidence >= 0.35) matchResultConfidenceBucket = '35-45%';
    else matchResultConfidenceBucket = '<35%';

    const xgGap = Math.abs(poissonPred.expectedHomeGoals - poissonPred.expectedAwayGoals);
    const isClearFavorite = xgGap > 1.5;
    const isCloseMatch = xgGap < 0.5;

    // === Fetch fixture statistics / events in parallel (optional) ===
    let actualCorners: number | null = null;
    let actualCards: number | null = null;
    let actualFirstGoal: 'H' | 'A' | 'NONE' | null = null;

    if (config.fetchStatistics || config.fetchEvents) {
      const promises: Promise<any>[] = [];
      if (config.fetchStatistics) {
        promises.push(
          ApiFootballService.getMatchStatistics(cand.fixture.fixture.id).catch(() => [])
        );
      }
      if (config.fetchEvents) {
        promises.push(
          ApiFootballService.getEvents(cand.fixture.fixture.id).catch(() => [])
        );
      }
      const results = await Promise.all(promises);
      let idx = 0;
      if (config.fetchStatistics) {
        const stats = results[idx++] as MatchStatistics[];
        const { totalCorners, totalCards } = extractCornersAndCards(stats);
        actualCorners = totalCorners;
        actualCards = totalCards;
      }
      if (config.fetchEvents) {
        const events = results[idx++];
        actualFirstGoal = extractFirstGoal(events, cand.fixture.teams.home.id);
      }
    }

    // === Corners predictions ===
    const predictedCorners = poissonPred.expectedCornersTotal;
    const predCornersOver85 = poissonPred.cornersOver85 > 0.5;
    const predCornersOver95 = poissonPred.cornersOver95 > 0.5;
    const predCornersOver105 = poissonPred.cornersOver105 > 0.5;
    const cornersOver85Hit =
      actualCorners !== null ? predCornersOver85 === actualCorners > 8.5 : null;
    const cornersOver95Hit =
      actualCorners !== null ? predCornersOver95 === actualCorners > 9.5 : null;
    const cornersOver105Hit =
      actualCorners !== null ? predCornersOver105 === actualCorners > 10.5 : null;

    // === Cards predictions ===
    const predictedCards = poissonPred.expectedCardsTotal;
    const predCardsOver35 = poissonPred.cardsOver35 > 0.5;
    const predCardsOver45 = poissonPred.cardsOver45 > 0.5;
    const cardsOver35Hit =
      actualCards !== null ? predCardsOver35 === actualCards > 3.5 : null;
    const cardsOver45Hit =
      actualCards !== null ? predCardsOver45 === actualCards > 4.5 : null;

    // === First goal prediction ===
    let predictedFirstGoal: 'H' | 'A' | 'NONE' = 'NONE';
    if (
      poissonPred.firstGoalHome > poissonPred.firstGoalAway &&
      poissonPred.firstGoalHome > poissonPred.firstGoalNone
    ) {
      predictedFirstGoal = 'H';
    } else if (
      poissonPred.firstGoalAway > poissonPred.firstGoalHome &&
      poissonPred.firstGoalAway > poissonPred.firstGoalNone
    ) {
      predictedFirstGoal = 'A';
    }
    const firstGoalHit =
      actualFirstGoal !== null ? predictedFirstGoal === actualFirstGoal : null;

    // === SMART PICK: highest-confidence market across ALL markets ===
    type Cand = { key: string; label: string; prob: number; correct: boolean };
    const smartCandidates: Cand[] = [
      { key: 'HOME_WIN', label: '1 (Ev sahibi)', prob: probs[0], correct: actualResult === 'H' },
      { key: 'DRAW', label: 'X (Beraberlik)', prob: probs[1], correct: actualResult === 'D' },
      { key: 'AWAY_WIN', label: '2 (Deplasman)', prob: probs[2], correct: actualResult === 'A' },
      { key: 'OVER_15', label: 'Üst 1.5', prob: poissonPred.over15, correct: actualOver15 },
      { key: 'UNDER_15', label: 'Alt 1.5', prob: poissonPred.under15, correct: !actualOver15 },
      { key: 'OVER_25', label: 'Üst 2.5', prob: poissonPred.over25, correct: actualOver25 },
      { key: 'UNDER_25', label: 'Alt 2.5', prob: poissonPred.under25, correct: !actualOver25 },
      { key: 'OVER_35', label: 'Üst 3.5', prob: poissonPred.over35, correct: actualOver35 },
      { key: 'UNDER_35', label: 'Alt 3.5', prob: poissonPred.under35, correct: !actualOver35 },
      { key: 'BTTS_YES', label: 'KG Var', prob: poissonPred.bttsYes, correct: actualBTTS },
      { key: 'BTTS_NO', label: 'KG Yok', prob: poissonPred.bttsNo, correct: !actualBTTS },
    ];
    smartCandidates.sort((a, b) => b.prob - a.prob);
    const smartBest = smartCandidates[0];

    matchResults.push({
      fixtureId: cand.fixture.fixture.id,
      date: cand.fixture.fixture.date,
      league: cand.fixture.league.name,
      homeTeam: cand.fixture.teams.home.name,
      awayTeam: cand.fixture.teams.away.name,
      actualResult,
      actualScore: `${homeGoals}-${awayGoals}`,
      predictedOutcome,
      predictedConfidence: confidence,
      homeWinProb: probs[0],
      drawProb: probs[1],
      awayWinProb: probs[2],
      expectedHomeGoals: poissonPred.expectedHomeGoals,
      expectedAwayGoals: poissonPred.expectedAwayGoals,
      hit,
      brierContribution: brier,
      logLossContribution: logLoss,
      predictedOver15,
      actualOver15,
      over15Hit,
      predictedOver25,
      actualOver25,
      over25Hit,
      predictedOver35,
      actualOver35,
      over35Hit,
      predictedBTTS,
      actualBTTS,
      bttsHit,
      topPredictedScore,
      exactScoreHit,
      isClearFavorite,
      isCloseMatch,
      smartPickMarket: smartBest.key,
      smartPickLabel: smartBest.label,
      smartPickConfidence: smartBest.prob,
      smartPickHit: smartBest.correct,

      // Corners
      predictedCorners,
      actualCorners,
      predictedCornersOver85: predCornersOver85,
      cornersOver85Hit,
      predictedCornersOver95: predCornersOver95,
      cornersOver95Hit,
      predictedCornersOver105: predCornersOver105,
      cornersOver105Hit,

      // Cards
      predictedCards,
      actualCards,
      predictedCardsOver35: predCardsOver35,
      cardsOver35Hit,
      predictedCardsOver45: predCardsOver45,
      cardsOver45Hit,

      // First goal
      predictedFirstGoal,
      actualFirstGoal,
      firstGoalHit,

      // HTFT
      predictedHtft,
      predictedHtftConfidence,
      actualHtft,
      htftHit,

      // Top-N score
      top3Scores,
      top5Scores,
      top3ScoreHit,
      top5ScoreHit,

      // Confidence bucket
      matchResultConfidenceBucket,

      poissonProbs: {
        H: poissonPred.homeWinProb,
        D: poissonPred.drawProb,
        A: poissonPred.awayWinProb,
      },
      ensembleProbs: { H: eH, D: eD, A: eA },
    });
  }

  // Aggregate metrics
  const totalMatches = matchResults.length;
  const hits = matchResults.filter((m) => m.hit).length;
  const hitRate = totalMatches > 0 ? hits / totalMatches : 0;
  const brierScore =
    totalMatches > 0
      ? matchResults.reduce((s, m) => s + m.brierContribution, 0) / totalMatches
      : 0;
  const logLoss =
    totalMatches > 0
      ? matchResults.reduce((s, m) => s + m.logLossContribution, 0) / totalMatches
      : 0;

  // Per-outcome accuracy
  const homeMatches = matchResults.filter((m) => m.actualResult === 'H');
  const drawMatches = matchResults.filter((m) => m.actualResult === 'D');
  const awayMatches = matchResults.filter((m) => m.actualResult === 'A');
  const homeWinAccuracy =
    homeMatches.length > 0 ? homeMatches.filter((m) => m.hit).length / homeMatches.length : 0;
  const drawAccuracy =
    drawMatches.length > 0 ? drawMatches.filter((m) => m.hit).length / drawMatches.length : 0;
  const awayWinAccuracy =
    awayMatches.length > 0 ? awayMatches.filter((m) => m.hit).length / awayMatches.length : 0;

  // Confidence buckets
  const thresholds = [0.4, 0.45, 0.5, 0.55, 0.6, 0.65];
  const confidenceBuckets: ConfidenceBucket[] = thresholds.map((t) => {
    const filtered = matchResults.filter((m) => m.predictedConfidence >= t);
    const bucketHits = filtered.filter((m) => m.hit).length;
    const accuracy = filtered.length > 0 ? bucketHits / filtered.length : 0;
    // ROI assuming we bet 1 unit per match at fair odds = 1/predictedProbability
    let totalStake = 0;
    let totalReturn = 0;
    for (const m of filtered) {
      const stake = 1;
      totalStake += stake;
      if (m.hit) {
        const fairOdds = 1 / m.predictedConfidence;
        totalReturn += stake * fairOdds;
      }
    }
    const roi = totalStake > 0 ? (totalReturn - totalStake) / totalStake : 0;
    return {
      threshold: t,
      count: filtered.length,
      hits: bucketHits,
      accuracy,
      roi,
    };
  });

  // Per-league breakdown
  const leagueMap = new Map<string, BacktestMatchResult[]>();
  for (const m of matchResults) {
    const key = m.league;
    if (!leagueMap.has(key)) leagueMap.set(key, []);
    leagueMap.get(key)!.push(m);
  }
  const leagueBreakdowns: LeagueBreakdown[] = Array.from(leagueMap.entries())
    .map(([leagueName, ms]) => {
      const lHits = ms.filter((m) => m.hit).length;
      const lBrier = ms.reduce((s, m) => s + m.brierContribution, 0) / ms.length;
      return {
        leagueName,
        count: ms.length,
        hits: lHits,
        accuracy: lHits / ms.length,
        brierScore: lBrier,
      };
    })
    .sort((a, b) => b.accuracy - a.accuracy);

  // Per-market breakdown
  const clearFavorites = matchResults.filter((m) => m.isClearFavorite);
  const closeMatches = matchResults.filter((m) => m.isCloseMatch);
  const over15Hits = matchResults.filter((m) => m.over15Hit).length;
  const over25Hits = matchResults.filter((m) => m.over25Hit).length;
  const over35Hits = matchResults.filter((m) => m.over35Hit).length;
  const bttsHits = matchResults.filter((m) => m.bttsHit).length;
  const exactHits = matchResults.filter((m) => m.exactScoreHit).length;
  const smartHits = matchResults.filter((m) => m.smartPickHit).length;
  const cfHits = clearFavorites.filter((m) => m.hit).length;
  const cmHits = closeMatches.filter((m) => m.hit).length;

  // Corners / cards / first-goal breakdown (only count matches where we have
  // actual data — i.e. fetchStatistics/fetchEvents was enabled)
  const cornersTracked = matchResults.filter((m) => m.cornersOver85Hit !== null);
  const cornersOver85Hits = cornersTracked.filter((m) => m.cornersOver85Hit === true).length;
  const cornersOver95Tracked = matchResults.filter((m) => m.cornersOver95Hit !== null);
  const cornersOver95Hits = cornersOver95Tracked.filter((m) => m.cornersOver95Hit === true).length;
  const cornersOver105Tracked = matchResults.filter((m) => m.cornersOver105Hit !== null);
  const cornersOver105Hits = cornersOver105Tracked.filter((m) => m.cornersOver105Hit === true).length;
  const cardsOver35Tracked = matchResults.filter((m) => m.cardsOver35Hit !== null);
  const cardsOver35Hits = cardsOver35Tracked.filter((m) => m.cardsOver35Hit === true).length;
  const cardsOver45Tracked = matchResults.filter((m) => m.cardsOver45Hit !== null);
  const cardsOver45Hits = cardsOver45Tracked.filter((m) => m.cardsOver45Hit === true).length;
  const firstGoalTracked = matchResults.filter((m) => m.firstGoalHit !== null);
  const firstGoalHits = firstGoalTracked.filter((m) => m.firstGoalHit === true).length;

  // HTFT aggregation — only matches where halftime score was available
  const htftTracked = matchResults.filter((m) => m.htftHit !== null);
  const htftHits = htftTracked.filter((m) => m.htftHit === true).length;

  // HTFT per-outcome breakdown: group by predictedHtft value, compute hit rate
  const htftSpecific: Record<string, { count: number; hits: number; accuracy: number }> = {};
  const HTFT_OUTCOMES = ['H/H', 'H/D', 'H/A', 'D/H', 'D/D', 'D/A', 'A/H', 'A/D', 'A/A'] as const;
  for (const outcome of HTFT_OUTCOMES) {
    const matches = htftTracked.filter((m) => m.predictedHtft === outcome);
    const outcomeHits = matches.filter((m) => m.htftHit === true).length;
    htftSpecific[outcome] = {
      count: matches.length,
      hits: outcomeHits,
      accuracy: matches.length > 0 ? outcomeHits / matches.length : 0,
    };
  }

  // Exact score top-3 and top-5
  const top3Hits = matchResults.filter((m) => m.top3ScoreHit).length;
  const top5Hits = matchResults.filter((m) => m.top5ScoreHit).length;

  // 1X2 by confidence bucket
  const CONFIDENCE_BUCKETS = ['>65%', '55-65%', '45-55%', '35-45%', '<35%'] as const;
  const matchResultByConfidence: Record<string, { count: number; hits: number; accuracy: number }> = {};
  for (const bucket of CONFIDENCE_BUCKETS) {
    const matches = matchResults.filter((m) => m.matchResultConfidenceBucket === bucket);
    const bucketHits = matches.filter((m) => m.hit).length;
    matchResultByConfidence[bucket] = {
      count: matches.length,
      hits: bucketHits,
      accuracy: matches.length > 0 ? bucketHits / matches.length : 0,
    };
  }
  const marketBreakdowns: MarketBreakdown = {
    matchResult: { count: totalMatches, hits, accuracy: hitRate },
    over15: {
      count: totalMatches,
      hits: over15Hits,
      accuracy: totalMatches > 0 ? over15Hits / totalMatches : 0,
    },
    over25: {
      count: totalMatches,
      hits: over25Hits,
      accuracy: totalMatches > 0 ? over25Hits / totalMatches : 0,
    },
    over35: {
      count: totalMatches,
      hits: over35Hits,
      accuracy: totalMatches > 0 ? over35Hits / totalMatches : 0,
    },
    bttsCorrect: {
      count: totalMatches,
      hits: bttsHits,
      accuracy: totalMatches > 0 ? bttsHits / totalMatches : 0,
    },
    exactScoreTopPick: {
      count: totalMatches,
      hits: exactHits,
      accuracy: totalMatches > 0 ? exactHits / totalMatches : 0,
    },
    smartPick: {
      count: totalMatches,
      hits: smartHits,
      accuracy: totalMatches > 0 ? smartHits / totalMatches : 0,
    },
    clearFavorites: {
      count: clearFavorites.length,
      hits: cfHits,
      accuracy: clearFavorites.length > 0 ? cfHits / clearFavorites.length : 0,
    },
    closeMatches: {
      count: closeMatches.length,
      hits: cmHits,
      accuracy: closeMatches.length > 0 ? cmHits / closeMatches.length : 0,
    },
    cornersOver85: {
      count: cornersTracked.length,
      hits: cornersOver85Hits,
      accuracy: cornersTracked.length > 0 ? cornersOver85Hits / cornersTracked.length : 0,
    },
    cornersOver95: {
      count: cornersOver95Tracked.length,
      hits: cornersOver95Hits,
      accuracy: cornersOver95Tracked.length > 0 ? cornersOver95Hits / cornersOver95Tracked.length : 0,
    },
    cornersOver105: {
      count: cornersOver105Tracked.length,
      hits: cornersOver105Hits,
      accuracy: cornersOver105Tracked.length > 0 ? cornersOver105Hits / cornersOver105Tracked.length : 0,
    },
    cardsOver35: {
      count: cardsOver35Tracked.length,
      hits: cardsOver35Hits,
      accuracy: cardsOver35Tracked.length > 0 ? cardsOver35Hits / cardsOver35Tracked.length : 0,
    },
    cardsOver45: {
      count: cardsOver45Tracked.length,
      hits: cardsOver45Hits,
      accuracy: cardsOver45Tracked.length > 0 ? cardsOver45Hits / cardsOver45Tracked.length : 0,
    },
    firstGoal: {
      count: firstGoalTracked.length,
      hits: firstGoalHits,
      accuracy: firstGoalTracked.length > 0 ? firstGoalHits / firstGoalTracked.length : 0,
    },
    htft: {
      count: htftTracked.length,
      hits: htftHits,
      accuracy: htftTracked.length > 0 ? htftHits / htftTracked.length : 0,
    },
    htftSpecific,
    exactScoreTop3: {
      count: totalMatches,
      hits: top3Hits,
      accuracy: totalMatches > 0 ? top3Hits / totalMatches : 0,
    },
    exactScoreTop5: {
      count: totalMatches,
      hits: top5Hits,
      accuracy: totalMatches > 0 ? top5Hits / totalMatches : 0,
    },
    matchResultByConfidence,
  };

  // Auto-generate insights
  const insights = generateInsights({
    hitRate,
    homeWinAccuracy,
    drawAccuracy,
    awayWinAccuracy,
    leagueBreakdowns,
    marketBreakdowns,
    confidenceBuckets,
  });

  // Sample = top 5 hits + 5 misses sorted by confidence
  const sortedByConfidence = [...matchResults].sort(
    (a, b) => b.predictedConfidence - a.predictedConfidence
  );
  const topHits = sortedByConfidence.filter((m) => m.hit).slice(0, 5);
  const topMisses = sortedByConfidence.filter((m) => !m.hit).slice(0, 5);
  const sampleResults = [...topHits, ...topMisses];

  return {
    leaguesUsed: leagueIds,
    fromDate: config.fromDate,
    toDate: config.toDate,
    totalMatches,
    hits,
    hitRate,
    brierScore,
    logLoss,
    homeWinAccuracy,
    drawAccuracy,
    awayWinAccuracy,
    leagueBreakdowns,
    marketBreakdowns,
    insights,
    confidenceBuckets,
    sampleResults,
  };
}

/**
 * Auto-generate human-readable insights about the model's strengths and weaknesses.
 * This is the "where is the model good?" analysis the user asked for.
 */
function generateInsights(args: {
  hitRate: number;
  homeWinAccuracy: number;
  drawAccuracy: number;
  awayWinAccuracy: number;
  leagueBreakdowns: LeagueBreakdown[];
  marketBreakdowns: MarketBreakdown;
  confidenceBuckets: ConfidenceBucket[];
}): StrengthInsights {
  const {
    hitRate,
    homeWinAccuracy,
    drawAccuracy,
    awayWinAccuracy,
    leagueBreakdowns,
    marketBreakdowns,
    confidenceBuckets,
  } = args;

  const highlights: string[] = [];
  const weaknesses: string[] = [];

  // Best/worst league (only consider those with at least 5 matches for stability)
  const eligibleLeagues = leagueBreakdowns.filter((l) => l.count >= 5);
  const bestLeague = eligibleLeagues.length > 0 ? eligibleLeagues[0].leagueName : null;
  const worstLeague =
    eligibleLeagues.length > 0
      ? eligibleLeagues[eligibleLeagues.length - 1].leagueName
      : null;

  if (bestLeague && eligibleLeagues[0].accuracy > hitRate + 0.05) {
    highlights.push(
      `${bestLeague} ligi: %${(eligibleLeagues[0].accuracy * 100).toFixed(0)} doğruluk (${eligibleLeagues[0].hits}/${eligibleLeagues[0].count}) — ortalamadan belirgin biçimde iyi.`
    );
  }
  if (worstLeague && bestLeague !== worstLeague) {
    const w = eligibleLeagues[eligibleLeagues.length - 1];
    if (w.accuracy < hitRate - 0.05) {
      weaknesses.push(
        `${worstLeague} ligi: sadece %${(w.accuracy * 100).toFixed(0)} doğruluk (${w.hits}/${w.count}) — bu ligde model zayıf.`
      );
    }
  }

  // Per-outcome strengths
  const outcomes: Array<{ name: string; acc: number }> = [
    { name: 'Ev sahibi galibiyetleri', acc: homeWinAccuracy },
    { name: 'Beraberlikler', acc: drawAccuracy },
    { name: 'Deplasman galibiyetleri', acc: awayWinAccuracy },
  ];
  outcomes.sort((a, b) => b.acc - a.acc);

  if (outcomes[0].acc > 0.55) {
    highlights.push(
      `${outcomes[0].name} %${(outcomes[0].acc * 100).toFixed(0)} doğrulukla tahmin ediliyor — modelin güçlü yanı.`
    );
  }
  if (outcomes[outcomes.length - 1].acc < 0.25) {
    weaknesses.push(
      `${outcomes[outcomes.length - 1].name} sadece %${(outcomes[outcomes.length - 1].acc * 100).toFixed(0)} yakalanıyor — modelin zayıf yanı.`
    );
  }

  // Market strengths
  const markets: Array<{ name: string; acc: number; key: string }> = [
    { name: '1X2 (maç sonucu)', acc: marketBreakdowns.matchResult.accuracy, key: 'matchResult' },
    { name: 'Üst/Alt 2.5', acc: marketBreakdowns.over25.accuracy, key: 'over25' },
    { name: 'KG Var/Yok', acc: marketBreakdowns.bttsCorrect.accuracy, key: 'bttsCorrect' },
    {
      name: 'En olası tam skor',
      acc: marketBreakdowns.exactScoreTopPick.accuracy,
      key: 'exactScoreTopPick',
    },
  ];
  markets.sort((a, b) => b.acc - a.acc);
  const bestMarket = markets[0].name;
  highlights.push(
    `En başarılı market: ${markets[0].name} (%${(markets[0].acc * 100).toFixed(0)} doğruluk).`
  );

  // Clear favorites vs close matches
  if (marketBreakdowns.clearFavorites.count >= 5) {
    if (marketBreakdowns.clearFavorites.accuracy > hitRate + 0.1) {
      highlights.push(
        `Açık favori olan maçlarda (xG farkı > 1.5) doğruluk %${(marketBreakdowns.clearFavorites.accuracy * 100).toFixed(0)} — net favori çıkaramayan derbiler dışında çok güvenilir.`
      );
    }
  }
  if (marketBreakdowns.closeMatches.count >= 5) {
    if (marketBreakdowns.closeMatches.accuracy < hitRate - 0.05) {
      weaknesses.push(
        `Yakın güçteki maçlarda (xG farkı < 0.5) doğruluk sadece %${(marketBreakdowns.closeMatches.accuracy * 100).toFixed(0)} — denk takımlarda model zorlanıyor.`
      );
    }
  }

  // Best confidence threshold (highest accuracy with at least 5 matches)
  const eligibleBuckets = confidenceBuckets.filter((b) => b.count >= 5);
  let bestConfidenceThreshold = 0.4;
  if (eligibleBuckets.length > 0) {
    const sortedByAcc = [...eligibleBuckets].sort((a, b) => b.accuracy - a.accuracy);
    bestConfidenceThreshold = sortedByAcc[0].threshold;
    if (sortedByAcc[0].accuracy > hitRate + 0.05) {
      highlights.push(
        `Güven eşiği ≥ %${(bestConfidenceThreshold * 100).toFixed(0)}: doğruluk %${(sortedByAcc[0].accuracy * 100).toFixed(0)}'a yükseliyor (${sortedByAcc[0].hits}/${sortedByAcc[0].count}). Düşük güvenli tahminleri filtrelemek model performansını artırıyor.`
      );
    }
  }

  return {
    bestLeague,
    worstLeague,
    bestMarket,
    bestConfidenceThreshold,
    highlights,
    weaknesses,
  };
}
