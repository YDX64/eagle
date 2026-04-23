/**
 * ProBet Prediction Engine
 *
 * Two-tier model architecture inspired by ProphitBet:
 *   1. Base model:  Poisson + xG goal model (Dixon-Coles corrected)
 *   2. Upper model: Gradient Boosting Ensemble (XGBoost / LightGBM / CatBoost-style)
 *
 * The two predictions are blended into a final probability distribution.
 * The upper model is trained per-league using time-based sliding cross-validation
 * to prevent data leakage and overfitting.
 *
 * Pipeline for a single match:
 *   1. Fetch league fixtures (entire season)
 *   2. Extract features for the match using only PRIOR matches (no leakage)
 *   3. Train ensemble on prior matches with sliding CV
 *   4. Get Poisson + xG prediction (no training needed — analytical)
 *   5. Blend the two predictions weighted by ensemble cross-val accuracy
 *   6. Return predictions across multiple markets
 */

import { ApiFootballService, type Fixture } from '../api-football';
import {
  buildTrainingMatrix,
  extractFeaturesForMatch,
  featuresToVector,
  toHistoricalMatches,
  type HistoricalMatch,
  type ProBetFeatures,
} from './feature-engineering';
import {
  predictWithPoissonXG,
  type PoissonXGPrediction,
} from './poisson-xg-model';
import {
  predictEnsemble,
  type EnsembleState,
} from './gradient-boost';
import { slidingCrossValidation, type CVResult } from './time-cross-validation';
import { fetchContextExtras, rawOddsToSnapshot, type ContextExtras, type LiveRawOdds } from './context-enricher';
import { calibrate, type CalibrationSources } from './calibration';
import { lookupKnnMatch, blendWithKnn, type KnnMatchResult } from './odds-knn';
import {
  matchAllPatterns,
  loadPatternCalibration,
  BUILTIN_PATTERNS,
  type PatternMatch,
  type PatternPredictionMarket,
} from './odds-patterns';
import {
  findSystemBetCandidates,
  buildSystemCombos,
  type SystemBetCandidate,
  type SystemComboSuggestion,
} from './system-bet-finder';
import { savePredictionAsync } from './prediction-store';

// Load pattern calibration once on module init
import patternCalibrationData from './odds-pattern-calibration.json';
try {
  const patterns = (patternCalibrationData as any)?.patterns ?? {};
  const calibration: Record<string, { hitRate: number; sampleSize: number; isBanko: boolean }> = {};
  for (const [id, stats] of Object.entries(patterns)) {
    const s = stats as any;
    calibration[id] = {
      hitRate: s.hitRate ?? 0,
      sampleSize: s.sampleSize ?? 0,
      isBanko: s.isBanko ?? false,
    };
  }
  loadPatternCalibration(calibration);
} catch (err) {
  // Calibration file may not exist yet on first run; patterns will fall back to source rates
}

// Cache for trained models per league/season — they are expensive to train.
const modelCache = new Map<
  string,
  { trainedAt: number; cvResult: CVResult; matchCount: number }
>();
const MODEL_TTL_MS = 60 * 60 * 1000; // 1 hour

interface ModelKey {
  leagueId: number;
  season: number;
}

function modelCacheKey(k: ModelKey): string {
  return `${k.leagueId}-${k.season}`;
}

export type MarketKey =
  // 1X2
  | 'HOME_WIN'
  | 'DRAW'
  | 'AWAY_WIN'
  // Double chance
  | 'DC_1X'
  | 'DC_12'
  | 'DC_X2'
  // Draw no bet
  | 'DNB_HOME'
  | 'DNB_AWAY'
  // Total goals
  | 'OVER_05' | 'UNDER_05'
  | 'OVER_15' | 'UNDER_15'
  | 'OVER_25' | 'UNDER_25'
  | 'OVER_35' | 'UNDER_35'
  | 'OVER_45' | 'UNDER_45'
  | 'OVER_55' | 'UNDER_55'
  // BTTS
  | 'BTTS_YES'
  | 'BTTS_NO'
  | 'BTTS_YES_OVER_25'
  | 'BTTS_YES_UNDER_25'
  | 'BTTS_NO_OVER_25'
  | 'BTTS_NO_UNDER_25'
  // Team totals
  | 'HOME_OVER_05' | 'HOME_OVER_15' | 'HOME_OVER_25'
  | 'HOME_UNDER_05' | 'HOME_UNDER_15' | 'HOME_UNDER_25'
  | 'AWAY_OVER_05' | 'AWAY_OVER_15' | 'AWAY_OVER_25'
  | 'AWAY_UNDER_05' | 'AWAY_UNDER_15' | 'AWAY_UNDER_25'
  // Clean sheets / win to nil
  | 'HOME_CLEAN_SHEET'
  | 'AWAY_CLEAN_SHEET'
  | 'HOME_WIN_TO_NIL'
  | 'AWAY_WIN_TO_NIL'
  // Asian Handicap
  | 'AH_HOME_MINUS_1'
  | 'AH_HOME_MINUS_15'
  | 'AH_AWAY_MINUS_1'
  | 'AH_AWAY_MINUS_15'
  | 'AH_HOME_PLUS_1'
  | 'AH_AWAY_PLUS_1'
  // Half-time
  | 'HT_HOME' | 'HT_DRAW' | 'HT_AWAY'
  | 'HT_OVER_05' | 'HT_UNDER_05'
  | 'HT_OVER_15' | 'HT_UNDER_15'
  // HT/FT
  | 'HTFT'
  // Halves
  | 'HSH_FIRST' | 'HSH_SECOND' | 'HSH_EQUAL'
  | 'BOTH_HALVES_OVER_05'
  | 'BOTH_HALVES_OVER_15'
  // Corners
  | 'CORNERS_OVER_75' | 'CORNERS_UNDER_75'
  | 'CORNERS_OVER_85' | 'CORNERS_UNDER_85'
  | 'CORNERS_OVER_95' | 'CORNERS_UNDER_95'
  | 'CORNERS_OVER_105' | 'CORNERS_UNDER_105'
  | 'CORNERS_OVER_115' | 'CORNERS_UNDER_115'
  // Cards
  | 'CARDS_OVER_25' | 'CARDS_UNDER_25'
  | 'CARDS_OVER_35' | 'CARDS_UNDER_35'
  | 'CARDS_OVER_45' | 'CARDS_UNDER_45'
  | 'CARDS_OVER_55' | 'CARDS_UNDER_55'
  // First goal
  | 'FIRST_GOAL_HOME'
  | 'FIRST_GOAL_AWAY'
  | 'FIRST_GOAL_NONE'
  // Correct score
  | 'CORRECT_SCORE';

export type MarketCategory =
  | 'MAÇ_SONUCU'
  | 'GOL_TOPLAMI'
  | 'KG'
  | 'TAKIM_TOPLAMI'
  | 'CLEAN_SHEET'
  | 'HANDIKAP'
  | 'YARI_SONUCU'
  | 'YARI_FULL'
  | 'YARILAR'
  | 'KORNER'
  | 'KART'
  | 'ILK_GOL'
  | 'TAM_SKOR';

export interface MarketPick {
  market: MarketKey;
  marketLabel: string; // e.g. "Üst 2.5"
  pickLabel: string; // e.g. "Üst 2.5 (toplam gol > 2.5)"
  category: MarketCategory;
  probability: number;
  // Score-aware "edge" — distance from coin-flip baseline.
  // For 2-outcome markets baseline = 0.5, for 1X2 baseline = 0.33.
  edge: number;
  // Optional value: for correct score markets only
  scoreValue?: string;
  // Live decimal odds from bookmaker (averaged across many bookmakers).
  // Used to display "@ 1.85" badges in the UI and compute true expected value.
  marketOdds?: number;
  // Expected value: (probability × marketOdds) - 1
  // Positive = value bet. Computed when marketOdds is available.
  expectedValue?: number;
}

export interface ProBetPrediction {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchDate: string;

  // Final blended outcome probabilities
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;

  // Top recommendation (1X2 specifically — kept for backwards compat)
  recommendedOutcome: 'HOME' | 'DRAW' | 'AWAY';
  confidence: number;

  // SMART RECOMMENDATION — highest-confidence pick across ALL markets
  bestPick: MarketPick;
  // Top 5 picks across markets, sorted by weighted score descending
  topPicks: MarketPick[];
  // High-confidence picks: weighted score >= 0.70
  // These are the "safe bets" — at least 70% reliability after weighting
  highConfidencePicks: MarketPick[];
  // ALL markets grouped by category
  allMarkets: Record<MarketCategory, MarketPick[]>;

  // Goal market predictions (from Poisson+xG)
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  over15Prob: number;
  over25Prob: number;
  over35Prob: number;
  under15Prob: number;
  under25Prob: number;
  under35Prob: number;
  bttsYesProb: number;
  bttsNoProb: number;

  // Top 5 most likely scores
  topScores: Array<{ score: string; probability: number }>;

  // Per-component breakdown for transparency
  components: {
    poissonXG: {
      homeWin: number;
      draw: number;
      awayWin: number;
      lambdaHome: number;
      lambdaAway: number;
    };
    ensemble: {
      homeWin: number;
      draw: number;
      awayWin: number;
      modelWeights: Record<string, number>;
    };
    blendWeights: {
      poisson: number;
      ensemble: number;
    };
  };

  // Training metrics (from cross-validation)
  modelMetrics: {
    cvAccuracy: number;
    cvLogLoss: number;
    cvBrierScore: number;
    trainingSamples: number;
    foldsCompleted: number;
  };

  // === Optional context enrichment from API-Football ===
  contextExtras?: ContextExtras;

  // Value bets — markets where model > bookmaker implied probability
  valueBets?: Array<{ market: string; modelProb: number; marketProb: number; edge: number }>;

  // k-NN historical odds lookup (from 700K Pinnacle closing-odds archive)
  knnMatch?: {
    sampleSize: number;
    bucketKey: string;
    indexUsed: string;
    reliable: boolean;
    historicalHomeWinRate: number;
    historicalDrawRate: number;
    historicalAwayWinRate: number;
    historicalOver25Rate: number;
    historicalBttsRate: number;
    historicalAvgGoals: number;
  };

  // === Phase 2D: Odds pattern matches ===
  // High-confidence pattern matches found by scanning live odds against
  // 30+ built-in patterns + adaptive discovered patterns. Each match is
  // a "🎯 Banko candidate" if empirically validated.
  patternMatches?: PatternMatch[];

  // === Phase 4A: System bet candidates ===
  // High-EV picks suitable for system coupons (3-39 toplam oran range).
  // Higher-odds picks like HTFT, exact scores, underdog upsets.
  systemBetCandidates?: SystemBetCandidate[];
  systemCombos?: SystemComboSuggestion[];
}

export interface PredictionFailure {
  fixtureId: number;
  reason: string;
}

/**
 * Main entry point: predict a single fixture using the ProBet pipeline.
 *
 * @param fixture     The fixture to predict
 * @param withExtras  If true, also fetch context extras (injuries/odds/predictions/lineups)
 *                    in parallel with league fixtures. Adds 1 round-trip but enriches output.
 */
export async function predictFixture(
  fixture: Fixture,
  withExtras: boolean = true
): Promise<ProBetPrediction | PredictionFailure> {
  const fixtureId = fixture.fixture.id;
  const leagueId = fixture.league.id;
  const season = fixture.league.season;
  const matchDate = new Date(fixture.fixture.date);

  try {
    // Kick off context extras fetch in parallel with the league fetch
    const extrasPromise = withExtras ? fetchContextExtras(fixture).catch(() => null) : Promise.resolve(null);

    // 1. Fetch all finished league matches for this season
    const fixtures = await ApiFootballService.getFixturesByLeague(leagueId, season, 'FT');
    if (!fixtures || fixtures.length === 0) {
      return {
        fixtureId,
        reason: 'Lig için geçmiş maç verisi bulunamadı',
      };
    }

    const history = toHistoricalMatches(fixtures).filter(
      (m) => m.date.getTime() < matchDate.getTime()
    );

    if (history.length < 30) {
      return {
        fixtureId,
        reason: `Eğitim için yetersiz veri (${history.length} maç, en az 30 gerekli)`,
      };
    }

    // 2. Train (or fetch cached) ensemble model for this league
    const cacheKey = modelCacheKey({ leagueId, season });
    let cached = modelCache.get(cacheKey);
    const needsRetrain =
      !cached ||
      Date.now() - cached.trainedAt > MODEL_TTL_MS ||
      Math.abs(cached.matchCount - history.length) >= 5;

    if (needsRetrain || !cached) {
      const { X, y } = buildTrainingMatrix(history);
      if (X.length < 25) {
        return {
          fixtureId,
          reason: `Özellik çıkarımı sonrası yetersiz örnek (${X.length})`,
        };
      }
      const cvResult = slidingCrossValidation(X, y, 4);
      cached = {
        trainedAt: Date.now(),
        cvResult,
        matchCount: history.length,
      };
      modelCache.set(cacheKey, cached);
    }

    const cvResult = cached.cvResult;
    const finalEnsemble = cvResult.finalModel;

    // 3. Extract features for THIS match using prior history only
    const features = extractFeaturesForMatch(
      fixture.teams.home.id,
      fixture.teams.away.id,
      matchDate,
      history
    );

    // 4. Poisson + xG prediction
    const poissonPred = predictWithPoissonXG(features);

    // 5. Ensemble prediction
    const featureVector = featuresToVector(features);
    const ensembleProbs = predictEnsemble(finalEnsemble, featureVector);
    const [eHome, eDraw, eAway] = ensembleProbs;

    // 6. Wait for context extras (started in parallel with league fetch)
    const extras = (await extrasPromise) ?? null;

    // 7. Three-way blend: Poisson + Ensemble + (optional) API-Football prediction
    // Weights:
    //   - Poisson: 1 - ensembleWeight
    //   - Ensemble: 0.3 .. 0.75 based on CV accuracy
    //   - API-Football: small contribution (10%) when available — they have access to
    //     odds, lineups, etc. that we don't, so it's a useful sanity-check
    let ensembleWeight = Math.max(0.3, Math.min(0.75, cvResult.meanAccuracy));
    let poissonWeight = 1 - ensembleWeight;
    let apiWeight = 0;

    const apiH = extras?.apiPredictionPercentHome ?? null;
    const apiD = extras?.apiPredictionPercentDraw ?? null;
    const apiA = extras?.apiPredictionPercentAway ?? null;
    const hasApiPred = apiH !== null && apiD !== null && apiA !== null;

    if (hasApiPred) {
      // Reserve 10% weight for API-Football's prediction
      apiWeight = 0.1;
      ensembleWeight *= 0.9;
      poissonWeight *= 0.9;
    }

    const homeWinProb =
      poissonWeight * poissonPred.homeWinProb +
      ensembleWeight * eHome +
      apiWeight * (apiH ?? 0);
    const drawProb =
      poissonWeight * poissonPred.drawProb +
      ensembleWeight * eDraw +
      apiWeight * (apiD ?? 0);
    const awayWinProb =
      poissonWeight * poissonPred.awayWinProb +
      ensembleWeight * eAway +
      apiWeight * (apiA ?? 0);

    // Normalize to ensure they sum to 1
    const total = homeWinProb + drawProb + awayWinProb;
    let finalHome = homeWinProb / total;
    let finalDraw = drawProb / total;
    let finalAway = awayWinProb / total;

    // ═══════════════════════════════════════════════════════════════════
    // CALIBRATION LAYER — blend our model with bookmaker market consensus
    // This is the biggest single accuracy improvement. Bookmaker odds
    // encode the aggregated knowledge of professional traders, which is
    // often more accurate than any single model. We shrink our predictions
    // toward the market when available, with temperature scaling applied
    // based on source agreement.
    // ═══════════════════════════════════════════════════════════════════
    let calibrationConfidence = 0.5; // Default — will be overridden if calibration runs

    if (extras?.bookmakerCount && extras.bookmakerCount > 0) {
      // 1X2 calibration
      const homeCal = calibrate({
        modelProb: finalHome,
        apiProb: apiH,
        marketProb: extras.bookmakerHomeProb,
      });
      const drawCal = calibrate({
        modelProb: finalDraw,
        apiProb: apiD,
        marketProb: extras.bookmakerDrawProb,
      });
      const awayCal = calibrate({
        modelProb: finalAway,
        apiProb: apiA,
        marketProb: extras.bookmakerAwayProb,
      });

      finalHome = homeCal.calibrated;
      finalDraw = drawCal.calibrated;
      finalAway = awayCal.calibrated;

      // Re-normalize after calibration (different markets calibrated independently)
      const calTotal = finalHome + finalDraw + finalAway;
      finalHome /= calTotal;
      finalDraw /= calTotal;
      finalAway /= calTotal;

      // Average calibration confidence across the 1X2 markets
      calibrationConfidence = (homeCal.confidence + drawCal.confidence + awayCal.confidence) / 3;

      // Calibrate over 2.5 using market data (most bookmakers publish this)
      if (extras.bookmakerOver25Prob !== null && extras.bookmakerOver25Prob > 0) {
        const over25Cal = calibrate({
          modelProb: poissonPred.over25,
          apiProb: null,
          marketProb: extras.bookmakerOver25Prob,
        });
        // Write back calibrated value
        poissonPred.over25 = over25Cal.calibrated;
        poissonPred.under25 = 1 - over25Cal.calibrated;
      }

      // Calibrate BTTS
      if (extras.bookmakerBttsYesProb !== null && extras.bookmakerBttsYesProb > 0) {
        const bttsCal = calibrate({
          modelProb: poissonPred.bttsYes,
          apiProb: null,
          marketProb: extras.bookmakerBttsYesProb,
        });
        poissonPred.bttsYes = bttsCal.calibrated;
        poissonPred.bttsNo = 1 - bttsCal.calibrated;
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // k-NN HISTORICAL ODDS LOOKUP
    // For each live odds profile, find similar past matches (from 700K
    // Pinnacle closing-odds dataset) and blend their empirical outcome
    // rates into the calibrated probabilities. This is a data-driven prior
    // that grounds every prediction in 20 years of real-world football.
    // ═══════════════════════════════════════════════════════════════════
    let knnResult: KnnMatchResult | null = null;
    if (extras?.bookmakerCount && extras.bookmakerCount > 0 && extras.bookmakerHomeProb !== null) {
      knnResult = lookupKnnMatch({
        homeProb: extras.bookmakerHomeProb,
        drawProb: extras.bookmakerDrawProb ?? finalDraw,
        awayProb: extras.bookmakerAwayProb ?? finalAway,
        over25Prob: extras.bookmakerOver25Prob ?? undefined,
      });

      if (knnResult && knnResult.reliable) {
        // Blend 1X2 with k-NN historical rates (35% weight when reliable)
        const blended = blendWithKnn(
          { home: finalHome, draw: finalDraw, away: finalAway },
          knnResult,
          0.35
        );
        finalHome = blended.home;
        finalDraw = blended.draw;
        finalAway = blended.away;

        // Also blend Over 2.5 and BTTS with historical rates
        const sampleFactor = Math.min(1, knnResult.sampleSize / 500);
        const knnWeight = 0.35 * sampleFactor;
        poissonPred.over25 = poissonPred.over25 * (1 - knnWeight) + knnResult.over25Rate * knnWeight;
        poissonPred.under25 = 1 - poissonPred.over25;
        poissonPred.over15 = poissonPred.over15 * (1 - knnWeight) + knnResult.over15Rate * knnWeight;
        poissonPred.under15 = 1 - poissonPred.over15;
        poissonPred.over35 = poissonPred.over35 * (1 - knnWeight) + knnResult.over35Rate * knnWeight;
        poissonPred.under35 = 1 - poissonPred.over35;
        poissonPred.bttsYes = poissonPred.bttsYes * (1 - knnWeight) + knnResult.bttsRate * knnWeight;
        poissonPred.bttsNo = 1 - poissonPred.bttsYes;

        // Boost calibration confidence — if we have a reliable k-NN match,
        // our probability estimate has a strong empirical anchor
        calibrationConfidence = Math.min(0.95, calibrationConfidence + 0.15);
      }
    }
    // ═══════════════════════════════════════════════════════════════════

    // Determine recommendation and confidence
    const probs = [finalHome, finalDraw, finalAway];
    const maxProb = Math.max(...probs);
    const maxIdx = probs.indexOf(maxProb);
    const recommendedOutcome: 'HOME' | 'DRAW' | 'AWAY' =
      maxIdx === 0 ? 'HOME' : maxIdx === 1 ? 'DRAW' : 'AWAY';

    // Confidence: 1 - normalized entropy
    const entropy = -probs.filter((p) => p > 0).reduce((s, p) => s + p * Math.log(p), 0);
    const maxEntropy = Math.log(3);
    const confidence = Math.max(0, Math.min(1, 1 - entropy / maxEntropy));

    // Build per-model weight breakdown
    const modelWeights: Record<string, number> = {};
    finalEnsemble.modelNames.forEach((name: string, i: number) => {
      modelWeights[name] = finalEnsemble.weights[i];
    });

    // SMART RECOMMENDATION: pick the highest-probability market across ALL markets.
    // We compute 50+ markets across 10 categories.
    const homeName = fixture.teams.home.name;
    const awayName = fixture.teams.away.name;
    const candidates: MarketPick[] = [
      // === 1X2 ===
      { market: 'HOME_WIN', marketLabel: 'MS 1', pickLabel: `${homeName} kazanır (1)`, category: 'MAÇ_SONUCU', probability: finalHome, edge: finalHome - 1 / 3 },
      { market: 'DRAW', marketLabel: 'MS X', pickLabel: 'Beraberlik (X)', category: 'MAÇ_SONUCU', probability: finalDraw, edge: finalDraw - 1 / 3 },
      { market: 'AWAY_WIN', marketLabel: 'MS 2', pickLabel: `${awayName} kazanır (2)`, category: 'MAÇ_SONUCU', probability: finalAway, edge: finalAway - 1 / 3 },

      // === Double Chance ===
      { market: 'DC_1X', marketLabel: 'ÇŞ 1X', pickLabel: `Çifte Şans 1X — ${homeName} kazanır veya beraberlik`, category: 'MAÇ_SONUCU', probability: finalHome + finalDraw, edge: finalHome + finalDraw - 2 / 3 },
      { market: 'DC_12', marketLabel: 'ÇŞ 12', pickLabel: 'Çifte Şans 12 — beraberlik olmaz', category: 'MAÇ_SONUCU', probability: finalHome + finalAway, edge: finalHome + finalAway - 2 / 3 },
      { market: 'DC_X2', marketLabel: 'ÇŞ X2', pickLabel: `Çifte Şans X2 — ${awayName} kazanır veya beraberlik`, category: 'MAÇ_SONUCU', probability: finalDraw + finalAway, edge: finalDraw + finalAway - 2 / 3 },

      // === Draw No Bet ===
      { market: 'DNB_HOME', marketLabel: 'DNB Ev', pickLabel: `${homeName} kazanır (beraberlikte iade)`, category: 'MAÇ_SONUCU', probability: poissonPred.dnbHome, edge: poissonPred.dnbHome - 0.5 },
      { market: 'DNB_AWAY', marketLabel: 'DNB Deplasman', pickLabel: `${awayName} kazanır (beraberlikte iade)`, category: 'MAÇ_SONUCU', probability: poissonPred.dnbAway, edge: poissonPred.dnbAway - 0.5 },

      // === Total Goals ===
      { market: 'OVER_05', marketLabel: '0.5 Üst', pickLabel: '0.5 Üst (toplam ≥1 gol)', category: 'GOL_TOPLAMI', probability: poissonPred.over05, edge: poissonPred.over05 - 0.5 },
      { market: 'UNDER_05', marketLabel: '0.5 Alt', pickLabel: '0.5 Alt (gol yok)', category: 'GOL_TOPLAMI', probability: 1 - poissonPred.over05, edge: (1 - poissonPred.over05) - 0.5 },
      { market: 'OVER_15', marketLabel: '1.5 Üst', pickLabel: '1.5 Üst (toplam ≥2 gol)', category: 'GOL_TOPLAMI', probability: poissonPred.over15, edge: poissonPred.over15 - 0.5 },
      { market: 'UNDER_15', marketLabel: '1.5 Alt', pickLabel: '1.5 Alt (toplam ≤1 gol)', category: 'GOL_TOPLAMI', probability: poissonPred.under15, edge: poissonPred.under15 - 0.5 },
      { market: 'OVER_25', marketLabel: '2.5 Üst', pickLabel: '2.5 Üst (toplam ≥3 gol)', category: 'GOL_TOPLAMI', probability: poissonPred.over25, edge: poissonPred.over25 - 0.5 },
      { market: 'UNDER_25', marketLabel: '2.5 Alt', pickLabel: '2.5 Alt (toplam ≤2 gol)', category: 'GOL_TOPLAMI', probability: poissonPred.under25, edge: poissonPred.under25 - 0.5 },
      { market: 'OVER_35', marketLabel: '3.5 Üst', pickLabel: '3.5 Üst (toplam ≥4 gol)', category: 'GOL_TOPLAMI', probability: poissonPred.over35, edge: poissonPred.over35 - 0.5 },
      { market: 'UNDER_35', marketLabel: '3.5 Alt', pickLabel: '3.5 Alt (toplam ≤3 gol)', category: 'GOL_TOPLAMI', probability: poissonPred.under35, edge: poissonPred.under35 - 0.5 },
      { market: 'OVER_45', marketLabel: '4.5 Üst', pickLabel: '4.5 Üst (toplam ≥5 gol)', category: 'GOL_TOPLAMI', probability: poissonPred.over45, edge: poissonPred.over45 - 0.5 },
      { market: 'UNDER_45', marketLabel: '4.5 Alt', pickLabel: '4.5 Alt (toplam ≤4 gol)', category: 'GOL_TOPLAMI', probability: poissonPred.under45, edge: poissonPred.under45 - 0.5 },
      { market: 'OVER_55', marketLabel: '5.5 Üst', pickLabel: '5.5 Üst (toplam ≥6 gol)', category: 'GOL_TOPLAMI', probability: poissonPred.over55, edge: poissonPred.over55 - 0.5 },
      { market: 'UNDER_55', marketLabel: '5.5 Alt', pickLabel: '5.5 Alt (toplam ≤5 gol)', category: 'GOL_TOPLAMI', probability: poissonPred.under55, edge: poissonPred.under55 - 0.5 },

      // === BTTS ===
      { market: 'BTTS_YES', marketLabel: 'KG Var', pickLabel: 'KG Var (her iki takım gol atar)', category: 'KG', probability: poissonPred.bttsYes, edge: poissonPred.bttsYes - 0.5 },
      { market: 'BTTS_NO', marketLabel: 'KG Yok', pickLabel: 'KG Yok (en az bir takım gol atmaz)', category: 'KG', probability: poissonPred.bttsNo, edge: poissonPred.bttsNo - 0.5 },
      { market: 'BTTS_YES_OVER_25', marketLabel: 'KG Var & 2.5 Üst', pickLabel: 'KG Var & 2.5 Üst (her iki takım golüyle 3+ toplam)', category: 'KG', probability: poissonPred.bttsYesAndOver25, edge: poissonPred.bttsYesAndOver25 - 0.25 },
      { market: 'BTTS_YES_UNDER_25', marketLabel: 'KG Var & 2.5 Alt', pickLabel: 'KG Var & 2.5 Alt (her iki takım gol fakat ≤2 toplam)', category: 'KG', probability: poissonPred.bttsYesAndUnder25, edge: poissonPred.bttsYesAndUnder25 - 0.25 },
      { market: 'BTTS_NO_OVER_25', marketLabel: 'KG Yok & 2.5 Üst', pickLabel: 'KG Yok & 2.5 Üst (tek takım 3+ gol)', category: 'KG', probability: poissonPred.bttsNoAndOver25, edge: poissonPred.bttsNoAndOver25 - 0.25 },
      { market: 'BTTS_NO_UNDER_25', marketLabel: 'KG Yok & 2.5 Alt', pickLabel: 'KG Yok & 2.5 Alt (en az bir takım gol atmaz, ≤2 toplam)', category: 'KG', probability: poissonPred.bttsNoAndUnder25, edge: poissonPred.bttsNoAndUnder25 - 0.25 },

      // === Team Totals — Home ===
      { market: 'HOME_OVER_05', marketLabel: `${homeName} 0.5 Üst`, pickLabel: `${homeName} 0.5 Üst (en az 1 gol atar)`, category: 'TAKIM_TOPLAMI', probability: poissonPred.homeOver05, edge: poissonPred.homeOver05 - 0.5 },
      { market: 'HOME_OVER_15', marketLabel: `${homeName} 1.5 Üst`, pickLabel: `${homeName} 1.5 Üst (en az 2 gol atar)`, category: 'TAKIM_TOPLAMI', probability: poissonPred.homeOver15, edge: poissonPred.homeOver15 - 0.5 },
      { market: 'HOME_OVER_25', marketLabel: `${homeName} 2.5 Üst`, pickLabel: `${homeName} 2.5 Üst (en az 3 gol atar)`, category: 'TAKIM_TOPLAMI', probability: poissonPred.homeOver25, edge: poissonPred.homeOver25 - 0.5 },
      { market: 'HOME_UNDER_15', marketLabel: `${homeName} 1.5 Alt`, pickLabel: `${homeName} 1.5 Alt (en fazla 1 gol atar)`, category: 'TAKIM_TOPLAMI', probability: poissonPred.homeUnder15, edge: poissonPred.homeUnder15 - 0.5 },
      { market: 'HOME_UNDER_25', marketLabel: `${homeName} 2.5 Alt`, pickLabel: `${homeName} 2.5 Alt (en fazla 2 gol atar)`, category: 'TAKIM_TOPLAMI', probability: poissonPred.homeUnder25, edge: poissonPred.homeUnder25 - 0.5 },

      // === Team Totals — Away ===
      { market: 'AWAY_OVER_05', marketLabel: `${awayName} 0.5 Üst`, pickLabel: `${awayName} 0.5 Üst (en az 1 gol atar)`, category: 'TAKIM_TOPLAMI', probability: poissonPred.awayOver05, edge: poissonPred.awayOver05 - 0.5 },
      { market: 'AWAY_OVER_15', marketLabel: `${awayName} 1.5 Üst`, pickLabel: `${awayName} 1.5 Üst (en az 2 gol atar)`, category: 'TAKIM_TOPLAMI', probability: poissonPred.awayOver15, edge: poissonPred.awayOver15 - 0.5 },
      { market: 'AWAY_OVER_25', marketLabel: `${awayName} 2.5 Üst`, pickLabel: `${awayName} 2.5 Üst (en az 3 gol atar)`, category: 'TAKIM_TOPLAMI', probability: poissonPred.awayOver25, edge: poissonPred.awayOver25 - 0.5 },
      { market: 'AWAY_UNDER_15', marketLabel: `${awayName} 1.5 Alt`, pickLabel: `${awayName} 1.5 Alt (en fazla 1 gol atar)`, category: 'TAKIM_TOPLAMI', probability: poissonPred.awayUnder15, edge: poissonPred.awayUnder15 - 0.5 },
      { market: 'AWAY_UNDER_25', marketLabel: `${awayName} 2.5 Alt`, pickLabel: `${awayName} 2.5 Alt (en fazla 2 gol atar)`, category: 'TAKIM_TOPLAMI', probability: poissonPred.awayUnder25, edge: poissonPred.awayUnder25 - 0.5 },

      // === Clean sheets / Win to nil ===
      { market: 'HOME_CLEAN_SHEET', marketLabel: `${homeName} Gol Yemez`, pickLabel: `${homeName} gol yemez (rakip 0 gol)`, category: 'CLEAN_SHEET', probability: poissonPred.homeCleanSheet, edge: poissonPred.homeCleanSheet - 0.5 },
      { market: 'AWAY_CLEAN_SHEET', marketLabel: `${awayName} Gol Yemez`, pickLabel: `${awayName} gol yemez (rakip 0 gol)`, category: 'CLEAN_SHEET', probability: poissonPred.awayCleanSheet, edge: poissonPred.awayCleanSheet - 0.5 },
      { market: 'HOME_WIN_TO_NIL', marketLabel: `${homeName} Gol Yemeden Kazanır`, pickLabel: `${homeName} gol yemeden kazanır (Win-to-Nil)`, category: 'CLEAN_SHEET', probability: poissonPred.homeWinToNil, edge: poissonPred.homeWinToNil - 0.5 },
      { market: 'AWAY_WIN_TO_NIL', marketLabel: `${awayName} Gol Yemeden Kazanır`, pickLabel: `${awayName} gol yemeden kazanır (Win-to-Nil)`, category: 'CLEAN_SHEET', probability: poissonPred.awayWinToNil, edge: poissonPred.awayWinToNil - 0.5 },

      // === Asian Handicap ===
      { market: 'AH_HOME_MINUS_1', marketLabel: `${homeName} AH -1`, pickLabel: `${homeName} -1 AH (en az 2 farkla kazanır)`, category: 'HANDIKAP', probability: poissonPred.ahHomeMinus1, edge: poissonPred.ahHomeMinus1 - 0.5 },
      { market: 'AH_HOME_MINUS_15', marketLabel: `${homeName} AH -1.5`, pickLabel: `${homeName} -1.5 AH (en az 2 farkla kazanır)`, category: 'HANDIKAP', probability: poissonPred.ahHomeMinus15, edge: poissonPred.ahHomeMinus15 - 0.5 },
      { market: 'AH_AWAY_MINUS_1', marketLabel: `${awayName} AH -1`, pickLabel: `${awayName} -1 AH (en az 2 farkla kazanır)`, category: 'HANDIKAP', probability: poissonPred.ahAwayMinus1, edge: poissonPred.ahAwayMinus1 - 0.5 },
      { market: 'AH_AWAY_MINUS_15', marketLabel: `${awayName} AH -1.5`, pickLabel: `${awayName} -1.5 AH (en az 2 farkla kazanır)`, category: 'HANDIKAP', probability: poissonPred.ahAwayMinus15, edge: poissonPred.ahAwayMinus15 - 0.5 },
      { market: 'AH_HOME_PLUS_1', marketLabel: `${homeName} AH +1`, pickLabel: `${homeName} +1 AH (yenilmemesi yeterli)`, category: 'HANDIKAP', probability: poissonPred.ahHomePlus1, edge: poissonPred.ahHomePlus1 - 0.5 },
      { market: 'AH_AWAY_PLUS_1', marketLabel: `${awayName} AH +1`, pickLabel: `${awayName} +1 AH (yenilmemesi yeterli)`, category: 'HANDIKAP', probability: poissonPred.ahAwayPlus1, edge: poissonPred.ahAwayPlus1 - 0.5 },

      // === Half-Time markets ===
      { market: 'HT_HOME', marketLabel: 'İY 1X2', pickLabel: `İlk yarı ${homeName} önde (İY 1)`, category: 'YARI_SONUCU', probability: poissonPred.htHomeWin, edge: poissonPred.htHomeWin - 1 / 3 },
      { market: 'HT_DRAW', marketLabel: 'İY 1X2', pickLabel: 'İlk yarı beraberlik (İY X)', category: 'YARI_SONUCU', probability: poissonPred.htDraw, edge: poissonPred.htDraw - 1 / 3 },
      { market: 'HT_AWAY', marketLabel: 'İY 1X2', pickLabel: `İlk yarı ${awayName} önde (İY 2)`, category: 'YARI_SONUCU', probability: poissonPred.htAwayWin, edge: poissonPred.htAwayWin - 1 / 3 },
      { market: 'HT_OVER_05', marketLabel: 'İY 0.5 Üst', pickLabel: 'İlk yarı 0.5 Üst (en az 1 gol)', category: 'YARI_SONUCU', probability: poissonPred.htOver05, edge: poissonPred.htOver05 - 0.5 },
      { market: 'HT_UNDER_05', marketLabel: 'İY 0.5 Alt', pickLabel: 'İlk yarı 0.5 Alt (gol yok)', category: 'YARI_SONUCU', probability: poissonPred.htUnder05, edge: poissonPred.htUnder05 - 0.5 },
      { market: 'HT_OVER_15', marketLabel: 'İY 1.5 Üst', pickLabel: 'İlk yarı 1.5 Üst (en az 2 gol)', category: 'YARI_SONUCU', probability: poissonPred.htOver15, edge: poissonPred.htOver15 - 0.5 },
      { market: 'HT_UNDER_15', marketLabel: 'İY 1.5 Alt', pickLabel: 'İlk yarı 1.5 Alt (en fazla 1 gol)', category: 'YARI_SONUCU', probability: poissonPred.htUnder15, edge: poissonPred.htUnder15 - 0.5 },

      // === Halves ===
      { market: 'HSH_FIRST', marketLabel: '1. Yarı Yüksek Skor', pickLabel: '1. yarı 2. yarıdan daha çok gol içerir', category: 'YARILAR', probability: poissonPred.highestScoringHalf.firstHalf, edge: poissonPred.highestScoringHalf.firstHalf - 1 / 3 },
      { market: 'HSH_SECOND', marketLabel: '2. Yarı Yüksek Skor', pickLabel: '2. yarı 1. yarıdan daha çok gol içerir', category: 'YARILAR', probability: poissonPred.highestScoringHalf.secondHalf, edge: poissonPred.highestScoringHalf.secondHalf - 1 / 3 },
      { market: 'HSH_EQUAL', marketLabel: 'Eşit Yarılar', pickLabel: 'Her iki yarıda eşit sayıda gol', category: 'YARILAR', probability: poissonPred.highestScoringHalf.equal, edge: poissonPred.highestScoringHalf.equal - 1 / 3 },
      { market: 'BOTH_HALVES_OVER_05', marketLabel: 'Her İki Yarı 0.5 Üst', pickLabel: 'Her iki yarıda da en az 1 gol var', category: 'YARILAR', probability: poissonPred.bothHalvesOver05, edge: poissonPred.bothHalvesOver05 - 0.5 },
      { market: 'BOTH_HALVES_OVER_15', marketLabel: 'Her İki Yarı 1.5 Üst', pickLabel: 'Her iki yarıda da en az 2 gol var', category: 'YARILAR', probability: poissonPred.bothHalvesOver15, edge: poissonPred.bothHalvesOver15 - 0.5 },

      // === CORNERS ===
      { market: 'CORNERS_OVER_75', marketLabel: 'Korner 7.5 Üst', pickLabel: 'Korner 7.5 Üst (en az 8 korner)', category: 'KORNER', probability: poissonPred.cornersOver75, edge: poissonPred.cornersOver75 - 0.5 },
      { market: 'CORNERS_UNDER_75', marketLabel: 'Korner 7.5 Alt', pickLabel: 'Korner 7.5 Alt (en fazla 7 korner)', category: 'KORNER', probability: poissonPred.cornersUnder75, edge: poissonPred.cornersUnder75 - 0.5 },
      { market: 'CORNERS_OVER_85', marketLabel: 'Korner 8.5 Üst', pickLabel: 'Korner 8.5 Üst (en az 9 korner)', category: 'KORNER', probability: poissonPred.cornersOver85, edge: poissonPred.cornersOver85 - 0.5 },
      { market: 'CORNERS_UNDER_85', marketLabel: 'Korner 8.5 Alt', pickLabel: 'Korner 8.5 Alt (en fazla 8 korner)', category: 'KORNER', probability: poissonPred.cornersUnder85, edge: poissonPred.cornersUnder85 - 0.5 },
      { market: 'CORNERS_OVER_95', marketLabel: 'Korner 9.5 Üst', pickLabel: 'Korner 9.5 Üst (en az 10 korner)', category: 'KORNER', probability: poissonPred.cornersOver95, edge: poissonPred.cornersOver95 - 0.5 },
      { market: 'CORNERS_UNDER_95', marketLabel: 'Korner 9.5 Alt', pickLabel: 'Korner 9.5 Alt (en fazla 9 korner)', category: 'KORNER', probability: poissonPred.cornersUnder95, edge: poissonPred.cornersUnder95 - 0.5 },
      { market: 'CORNERS_OVER_105', marketLabel: 'Korner 10.5 Üst', pickLabel: 'Korner 10.5 Üst (en az 11 korner)', category: 'KORNER', probability: poissonPred.cornersOver105, edge: poissonPred.cornersOver105 - 0.5 },
      { market: 'CORNERS_UNDER_105', marketLabel: 'Korner 10.5 Alt', pickLabel: 'Korner 10.5 Alt (en fazla 10 korner)', category: 'KORNER', probability: poissonPred.cornersUnder105, edge: poissonPred.cornersUnder105 - 0.5 },
      { market: 'CORNERS_OVER_115', marketLabel: 'Korner 11.5 Üst', pickLabel: 'Korner 11.5 Üst (en az 12 korner)', category: 'KORNER', probability: poissonPred.cornersOver115, edge: poissonPred.cornersOver115 - 0.5 },
      { market: 'CORNERS_UNDER_115', marketLabel: 'Korner 11.5 Alt', pickLabel: 'Korner 11.5 Alt (en fazla 11 korner)', category: 'KORNER', probability: poissonPred.cornersUnder115, edge: poissonPred.cornersUnder115 - 0.5 },

      // === CARDS ===
      { market: 'CARDS_OVER_25', marketLabel: 'Kart 2.5 Üst', pickLabel: 'Kart 2.5 Üst (en az 3 kart)', category: 'KART', probability: poissonPred.cardsOver25, edge: poissonPred.cardsOver25 - 0.5 },
      { market: 'CARDS_UNDER_25', marketLabel: 'Kart 2.5 Alt', pickLabel: 'Kart 2.5 Alt (en fazla 2 kart)', category: 'KART', probability: poissonPred.cardsUnder25, edge: poissonPred.cardsUnder25 - 0.5 },
      { market: 'CARDS_OVER_35', marketLabel: 'Kart 3.5 Üst', pickLabel: 'Kart 3.5 Üst (en az 4 kart)', category: 'KART', probability: poissonPred.cardsOver35, edge: poissonPred.cardsOver35 - 0.5 },
      { market: 'CARDS_UNDER_35', marketLabel: 'Kart 3.5 Alt', pickLabel: 'Kart 3.5 Alt (en fazla 3 kart)', category: 'KART', probability: poissonPred.cardsUnder35, edge: poissonPred.cardsUnder35 - 0.5 },
      { market: 'CARDS_OVER_45', marketLabel: 'Kart 4.5 Üst', pickLabel: 'Kart 4.5 Üst (en az 5 kart)', category: 'KART', probability: poissonPred.cardsOver45, edge: poissonPred.cardsOver45 - 0.5 },
      { market: 'CARDS_UNDER_45', marketLabel: 'Kart 4.5 Alt', pickLabel: 'Kart 4.5 Alt (en fazla 4 kart)', category: 'KART', probability: poissonPred.cardsUnder45, edge: poissonPred.cardsUnder45 - 0.5 },
      { market: 'CARDS_OVER_55', marketLabel: 'Kart 5.5 Üst', pickLabel: 'Kart 5.5 Üst (en az 6 kart)', category: 'KART', probability: poissonPred.cardsOver55, edge: poissonPred.cardsOver55 - 0.5 },
      { market: 'CARDS_UNDER_55', marketLabel: 'Kart 5.5 Alt', pickLabel: 'Kart 5.5 Alt (en fazla 5 kart)', category: 'KART', probability: poissonPred.cardsUnder55, edge: poissonPred.cardsUnder55 - 0.5 },

      // === FIRST GOAL ===
      { market: 'FIRST_GOAL_HOME', marketLabel: `İlk Gol: ${homeName}`, pickLabel: `İlk golü ${homeName} atar`, category: 'ILK_GOL', probability: poissonPred.firstGoalHome, edge: poissonPred.firstGoalHome - 1 / 3 },
      { market: 'FIRST_GOAL_AWAY', marketLabel: `İlk Gol: ${awayName}`, pickLabel: `İlk golü ${awayName} atar`, category: 'ILK_GOL', probability: poissonPred.firstGoalAway, edge: poissonPred.firstGoalAway - 1 / 3 },
      { market: 'FIRST_GOAL_NONE', marketLabel: 'İlk Gol: Yok', pickLabel: 'Maçta hiç gol olmaz (0-0)', category: 'ILK_GOL', probability: poissonPred.firstGoalNone, edge: poissonPred.firstGoalNone - 1 / 3 },
    ];

    // Add HT/FT picks (9 outcomes)
    for (const [combo, p] of Object.entries(poissonPred.htft)) {
      const [ht, ft] = combo.split('/');
      const htCode = ht === 'H' ? '1' : ht === 'A' ? '2' : 'X';
      const ftCode = ft === 'H' ? '1' : ft === 'A' ? '2' : 'X';
      const htName = ht === 'H' ? homeName : ht === 'A' ? awayName : 'Beraberlik';
      const ftName = ft === 'H' ? homeName : ft === 'A' ? awayName : 'Beraberlik';
      candidates.push({
        market: 'HTFT',
        marketLabel: `İY/MS ${htCode}/${ftCode}`,
        pickLabel: `İlk Yarı ${htName} → Maç Sonu ${ftName} (İY ${htCode} / MS ${ftCode})`,
        category: 'YARI_FULL',
        probability: p,
        edge: p - 1 / 9,
      });
    }

    // Add top 3 correct scores
    poissonPred.topScores.slice(0, 3).forEach((score, idx) => {
      candidates.push({
        market: 'CORRECT_SCORE',
        marketLabel: `Tam Skor ${score.score}`,
        pickLabel: `Tam Skor: ${score.score}${idx === 0 ? ' (en olası)' : idx === 1 ? ' (2. en olası)' : ' (3. en olası)'}`,
        category: 'TAM_SKOR',
        probability: score.probability,
        edge: score.probability - 1 / 36,
        scoreValue: score.score,
      });
    });

    // Smart-pick scoring: multiply raw probability by a historical reliability
    // weight derived from backtests. Markets that historically perform well
    // (Over 1.5, Over 3.5, Cards 3.5) get higher weight; weak markets
    // (First Goal, Exact Score) get lower weight so they only win when
    // the raw probability is extremely high.
    //
    // Weights tuned from 400-match backtest (April 2026).
    const MARKET_RELIABILITY: Partial<Record<MarketKey, number>> = {
      // Goal totals — very reliable
      OVER_15: 1.0,
      UNDER_15: 1.0,
      OVER_35: 0.98,
      UNDER_35: 0.98,
      OVER_25: 0.88,
      UNDER_25: 0.88,
      OVER_45: 0.92,
      UNDER_45: 0.92,
      // Team totals — decent
      HOME_OVER_05: 0.92,
      HOME_OVER_15: 0.92,
      HOME_OVER_25: 0.88,
      HOME_UNDER_15: 0.92,
      HOME_UNDER_25: 0.88,
      AWAY_OVER_05: 0.92,
      AWAY_OVER_15: 0.9,
      AWAY_OVER_25: 0.88,
      AWAY_UNDER_15: 0.9,
      AWAY_UNDER_25: 0.88,
      // Double chance (reliable because it covers 2 of 3 outcomes)
      DC_1X: 0.95,
      DC_12: 0.95,
      DC_X2: 0.95,
      DNB_HOME: 0.85,
      DNB_AWAY: 0.85,
      // Cards — decent
      CARDS_OVER_25: 0.95,
      CARDS_OVER_35: 0.92,
      CARDS_UNDER_35: 0.92,
      CARDS_OVER_45: 0.82,
      CARDS_UNDER_45: 0.82,
      CARDS_OVER_55: 0.8,
      CARDS_UNDER_55: 0.8,
      CARDS_UNDER_25: 0.8,
      // Corners — ok
      CORNERS_OVER_75: 0.88,
      CORNERS_UNDER_75: 0.85,
      CORNERS_OVER_85: 0.83,
      CORNERS_UNDER_85: 0.8,
      CORNERS_OVER_95: 0.78,
      CORNERS_UNDER_95: 0.78,
      CORNERS_OVER_105: 0.82,
      CORNERS_UNDER_105: 0.8,
      CORNERS_OVER_115: 0.78,
      CORNERS_UNDER_115: 0.78,
      // BTTS — mediocre
      BTTS_YES: 0.72,
      BTTS_NO: 0.72,
      BTTS_YES_OVER_25: 0.7,
      BTTS_YES_UNDER_25: 0.68,
      BTTS_NO_OVER_25: 0.68,
      BTTS_NO_UNDER_25: 0.68,
      // Clean sheets
      HOME_CLEAN_SHEET: 0.7,
      AWAY_CLEAN_SHEET: 0.7,
      HOME_WIN_TO_NIL: 0.7,
      AWAY_WIN_TO_NIL: 0.7,
      // Asian Handicap
      AH_HOME_PLUS_1: 0.85,
      AH_AWAY_PLUS_1: 0.85,
      AH_HOME_MINUS_1: 0.75,
      AH_HOME_MINUS_15: 0.7,
      AH_AWAY_MINUS_1: 0.75,
      AH_AWAY_MINUS_15: 0.7,
      // 1X2 — not great
      HOME_WIN: 0.65,
      DRAW: 0.55,
      AWAY_WIN: 0.65,
      // Half-time markets
      HT_HOME: 0.55,
      HT_DRAW: 0.5,
      HT_AWAY: 0.55,
      HT_OVER_05: 0.75,
      HT_UNDER_05: 0.72,
      HT_OVER_15: 0.7,
      HT_UNDER_15: 0.72,
      // HT/FT — very hard
      HTFT: 0.4,
      // Halves
      HSH_FIRST: 0.5,
      HSH_SECOND: 0.5,
      HSH_EQUAL: 0.4,
      BOTH_HALVES_OVER_05: 0.72,
      BOTH_HALVES_OVER_15: 0.68,
      // First goal — very weak (27% in backtest, below random)
      FIRST_GOAL_HOME: 0.25,
      FIRST_GOAL_AWAY: 0.25,
      FIRST_GOAL_NONE: 0.25,
      // Correct score — extremely weak (10%)
      CORRECT_SCORE: 0.25,
    };

    // Compute a "weighted probability" score for smart-pick ordering.
    // The raw probability is still shown in the UI — only the sort key is weighted.
    //
    // Scoring formula:
    //   score = raw_prob × market_reliability_weight × calibration_bonus × edge_bonus
    //
    // where:
    //   - market_reliability_weight: historical backtest accuracy per market
    //   - calibration_bonus: 1.0 + (calibration_confidence - 0.5) × 0.4, range [0.8, 1.2]
    //     (Reward picks where bookmaker/model agreement is high)
    //   - edge_bonus: 1.0 + max(0, edge × 0.5), range [1.0, 1.25]
    //     (Slightly favor bigger-edge picks over marginal ones)
    //
    // Plus: if calibration_confidence < 0.35 (very disagreeing sources),
    // we APPLY a 0.85 penalty to 1X2/DC/DNB markets because those are
    // the ones most affected by odds-based disagreements.
    const calBonus = 1.0 + (calibrationConfidence - 0.5) * 0.4;
    const isOutcomeMarket = (m: MarketKey) =>
      m === 'HOME_WIN' || m === 'DRAW' || m === 'AWAY_WIN' ||
      m === 'DC_1X' || m === 'DC_12' || m === 'DC_X2' ||
      m === 'DNB_HOME' || m === 'DNB_AWAY';

    const candidatesWithScore = candidates.map((c) => {
      const weight = MARKET_RELIABILITY[c.market] ?? 0.7;
      let score = c.probability * weight;

      // Apply calibration bonus only to outcome markets (where we have
      // 1X2 bookmaker data to calibrate against).
      if (isOutcomeMarket(c.market)) {
        score *= calBonus;
        // Extra penalty when sources strongly disagree on the outcome
        if (calibrationConfidence < 0.35) score *= 0.85;
      }

      // Edge bonus — prefer picks that strongly beat the baseline
      const edgeBonus = 1.0 + Math.max(0, Math.min(0.25, c.edge * 0.5));
      score *= edgeBonus;

      return { pick: c, score };
    });
    candidatesWithScore.sort((a, b) => b.score - a.score);
    const bestPick = candidatesWithScore[0].pick;
    const topPicks = candidatesWithScore.slice(0, 5).map((x) => x.pick);

    // High-confidence picks: weighted score >= 0.70
    // These are the "safe bets" — at least 70% reliability after weighting
    // market quality, calibration confidence, and edge.
    const highConfidencePicks = candidatesWithScore
      .filter((x) => x.score >= 0.70)
      .map((x) => x.pick);

    // Also keep a raw-probability-sorted list for display purposes
    candidates.sort((a, b) => b.probability - a.probability);

    // ═══════════════════════════════════════════════════════════════════
    // Phase 3B: Attach live decimal odds to all picks
    // For each pick, look up the live bookmaker odds (averaged across many
    // bookmakers) and store them on the pick. The UI shows "@ 1.85" badges,
    // and we use these to compute true expected value.
    // ═══════════════════════════════════════════════════════════════════
    if (extras?.rawOdds) {
      attachLiveOdds(candidates, extras.rawOdds);
      attachLiveOdds(topPicks, extras.rawOdds);
      attachLiveOdds(highConfidencePicks, extras.rawOdds);
      // bestPick is already in topPicks; attachLiveOdds mutates so it's covered
    }

    // Group all markets by category
    const allMarkets: Record<MarketCategory, MarketPick[]> = {
      MAÇ_SONUCU: [],
      GOL_TOPLAMI: [],
      KG: [],
      TAKIM_TOPLAMI: [],
      CLEAN_SHEET: [],
      HANDIKAP: [],
      YARI_SONUCU: [],
      YARI_FULL: [],
      YARILAR: [],
      KORNER: [],
      KART: [],
      ILK_GOL: [],
      TAM_SKOR: [],
    };
    for (const c of candidates) {
      allMarkets[c.category].push(c);
    }
    // Sort each category by probability descending
    for (const cat of Object.keys(allMarkets) as MarketCategory[]) {
      allMarkets[cat].sort((a, b) => b.probability - a.probability);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Phase 2D: Odds Pattern Matching
    // Run all built-in odds patterns against the live odds snapshot.
    // Each match returns evidence + empirical hit rate. Banko patterns
    // (validated ≥65% hit rate, ≥500 sample) are highlighted as picks.
    // ═══════════════════════════════════════════════════════════════════
    let patternMatches: PatternMatch[] = [];
    if (extras?.rawOdds) {
      const snapshot = rawOddsToSnapshot(extras.rawOdds);
      patternMatches = matchAllPatterns(snapshot, {
        leagueId,
        minHitRate: 0.5,
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // Phase 4A: System Bet Finder
    // Build a partial prediction object so the system bet finder can scan
    // across all markets and find HTFT/score/upset candidates.
    // ═══════════════════════════════════════════════════════════════════
    const partialPrediction = {
      fixtureId,
      homeTeam: fixture.teams.home.name,
      awayTeam: fixture.teams.away.name,
      league: fixture.league.name,
      matchDate: fixture.fixture.date,
      homeWinProb: finalHome,
      drawProb: finalDraw,
      awayWinProb: finalAway,
      recommendedOutcome,
      confidence,
      bestPick,
      topPicks,
      highConfidencePicks,
      allMarkets,
      topScores: poissonPred.topScores,
    } as ProBetPrediction;

    let systemBetCandidates: SystemBetCandidate[] = [];
    let systemCombos: SystemComboSuggestion[] = [];
    if (extras?.rawOdds) {
      systemBetCandidates = findSystemBetCandidates(partialPrediction, extras.rawOdds, 0.10);
      systemCombos = buildSystemCombos(systemBetCandidates, [3, 39]);
    }

    // ═══════════════════════════════════════════════════════════════════
    // PERSISTENCE: fire-and-forget save to the tracking DB (postgres).
    // This runs in the background — a DB outage never blocks predictions.
    // Every prediction is captured for later win/loss resolution + stats.
    // ═══════════════════════════════════════════════════════════════════
    savePredictionAsync({
      sport: 'football',
      fixtureId,
      homeTeam: fixture.teams.home.name,
      awayTeam: fixture.teams.away.name,
      league: fixture.league.name,
      matchDate: fixture.fixture.date,
      homeWinProb: finalHome,
      drawProb: finalDraw,
      awayWinProb: finalAway,
      confidence,
      bestPick: {
        market: bestPick.market,
        marketLabel: bestPick.marketLabel,
        pickLabel: bestPick.pickLabel,
        category: bestPick.category,
        probability: bestPick.probability,
        marketOdds: bestPick.marketOdds,
        expectedValue: bestPick.expectedValue,
        scoreValue: bestPick.scoreValue,
      },
      topPicks: topPicks.map((p) => ({
        market: p.market,
        marketLabel: p.marketLabel,
        pickLabel: p.pickLabel,
        category: p.category,
        probability: p.probability,
        marketOdds: p.marketOdds,
        expectedValue: p.expectedValue,
        scoreValue: p.scoreValue,
      })),
      highConfidencePicks: highConfidencePicks.map((p) => ({
        market: p.market,
        marketLabel: p.marketLabel,
        pickLabel: p.pickLabel,
        category: p.category,
        probability: p.probability,
        marketOdds: p.marketOdds,
        expectedValue: p.expectedValue,
        scoreValue: p.scoreValue,
      })),
      patternMatches: patternMatches.map((m) => ({
        pattern: {
          id: m.pattern.id,
          name: m.pattern.name,
          category: m.pattern.category,
          prediction: m.pattern.prediction,
        },
        hitRate: m.hitRate,
        sampleSize: m.sampleSize,
        isBanko: m.isBanko,
      })),
      systemBetCandidates: systemBetCandidates.map((sb) => ({
        market: sb.market,
        pickLabel: sb.pickLabel,
        category: sb.category,
        modelProbability: sb.modelProbability,
        marketOdds: sb.marketOdds,
        expectedValue: sb.expectedValue,
        kellyStake: sb.kellyStake,
        riskLevel: sb.riskLevel,
      })),
    });

    return {
      fixtureId,
      homeTeam: fixture.teams.home.name,
      awayTeam: fixture.teams.away.name,
      league: fixture.league.name,
      matchDate: fixture.fixture.date,

      homeWinProb: finalHome,
      drawProb: finalDraw,
      awayWinProb: finalAway,

      recommendedOutcome,
      confidence,

      bestPick,
      topPicks,
      highConfidencePicks,
      allMarkets,

      expectedHomeGoals: poissonPred.expectedHomeGoals,
      expectedAwayGoals: poissonPred.expectedAwayGoals,
      over15Prob: poissonPred.over15,
      over25Prob: poissonPred.over25,
      over35Prob: poissonPred.over35,
      under15Prob: poissonPred.under15,
      under25Prob: poissonPred.under25,
      under35Prob: poissonPred.under35,
      bttsYesProb: poissonPred.bttsYes,
      bttsNoProb: poissonPred.bttsNo,
      topScores: poissonPred.topScores,

      components: {
        poissonXG: {
          homeWin: poissonPred.homeWinProb,
          draw: poissonPred.drawProb,
          awayWin: poissonPred.awayWinProb,
          lambdaHome: poissonPred.expectedHomeGoals,
          lambdaAway: poissonPred.expectedAwayGoals,
        },
        ensemble: {
          homeWin: eHome,
          draw: eDraw,
          awayWin: eAway,
          modelWeights,
        },
        blendWeights: {
          poisson: poissonWeight,
          ensemble: ensembleWeight,
        },
      },

      modelMetrics: {
        cvAccuracy: cvResult.meanAccuracy,
        cvLogLoss: cvResult.meanLogLoss,
        cvBrierScore: cvResult.meanBrierScore,
        trainingSamples: history.length,
        foldsCompleted: cvResult.foldsMetrics.length,
      },

      contextExtras: extras ?? undefined,

      // Compute value bets if bookmaker data is available
      valueBets: extras ? buildValueBets(finalHome, finalDraw, finalAway, poissonPred, extras) : undefined,

      // k-NN historical match data
      knnMatch: knnResult
        ? {
            sampleSize: knnResult.sampleSize,
            bucketKey: knnResult.bucketKey,
            indexUsed: knnResult.indexUsed,
            reliable: knnResult.reliable,
            historicalHomeWinRate: knnResult.homeWinRate,
            historicalDrawRate: knnResult.drawRate,
            historicalAwayWinRate: knnResult.awayWinRate,
            historicalOver25Rate: knnResult.over25Rate,
            historicalBttsRate: knnResult.bttsRate,
            historicalAvgGoals: knnResult.avgGoals,
          }
        : undefined,

      // === Phase 2D: Pattern matches ===
      patternMatches: patternMatches.length > 0 ? patternMatches : undefined,

      // === Phase 4A: System bet candidates ===
      systemBetCandidates: systemBetCandidates.length > 0 ? systemBetCandidates : undefined,
      systemCombos: systemCombos.length > 0 ? systemCombos : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      fixtureId,
      reason: `Hata: ${message}`,
    };
  }
}

/**
 * Compare model probabilities to bookmaker implied probabilities and
 * return markets where the model thinks the outcome is more likely than
 * the market suggests (positive edge → potential value bet).
 */
function buildValueBets(
  finalHome: number,
  finalDraw: number,
  finalAway: number,
  poissonPred: PoissonXGPrediction,
  extras: ContextExtras
): Array<{ market: string; modelProb: number; marketProb: number; edge: number }> {
  const out: Array<{ market: string; modelProb: number; marketProb: number; edge: number }> = [];
  const push = (market: string, modelProb: number, marketProb: number | null) => {
    if (marketProb === null || marketProb <= 0) return;
    const edge = modelProb - marketProb;
    if (edge > 0.05) out.push({ market, modelProb, marketProb, edge });
  };
  push('Ev sahibi (1)', finalHome, extras.bookmakerHomeProb);
  push('Beraberlik (X)', finalDraw, extras.bookmakerDrawProb);
  push('Deplasman (2)', finalAway, extras.bookmakerAwayProb);
  push('Üst 2.5', poissonPred.over25, extras.bookmakerOver25Prob);
  push('Alt 2.5', poissonPred.under25, extras.bookmakerUnder25Prob);
  push('KG Var', poissonPred.bttsYes, extras.bookmakerBttsYesProb);
  push('KG Yok', poissonPred.bttsNo, extras.bookmakerBttsNoProb);
  out.sort((a, b) => b.edge - a.edge);
  return out;
}

/**
 * Predict an array of fixtures with limited concurrency to avoid overwhelming
 * the upstream API. Models are cached per league, so subsequent fixtures in
 * the same league share the trained model.
 */
export async function predictFixtures(
  fixtures: Fixture[],
  concurrency: number = 10
): Promise<Array<ProBetPrediction | PredictionFailure>> {
  const results: Array<ProBetPrediction | PredictionFailure> = [];
  const queue = [...fixtures];

  async function worker() {
    while (queue.length > 0) {
      const f = queue.shift();
      if (!f) return;
      const result = await predictFixture(f);
      results.push(result);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, fixtures.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Type guard to filter out failures.
 */
export function isPrediction(
  r: ProBetPrediction | PredictionFailure
): r is ProBetPrediction {
  return 'recommendedOutcome' in r;
}

/**
 * Attach live decimal odds from rawOdds to each market pick. Mutates picks
 * in place — adds `marketOdds` and `expectedValue` fields where available.
 *
 * Mapping logic: each `MarketKey` maps to a path in `LiveRawOdds`. Some markets
 * (HTFT, CORRECT_SCORE) need special handling because they're keyed by outcome.
 */
export function attachLiveOdds(picks: MarketPick[], rawOdds: LiveRawOdds | null): void {
  if (!rawOdds) return;
  for (const pick of picks) {
    let odd: number | null | undefined = undefined;
    switch (pick.market) {
      case 'HOME_WIN': odd = rawOdds.home; break;
      case 'DRAW': odd = rawOdds.draw; break;
      case 'AWAY_WIN': odd = rawOdds.away; break;
      case 'DC_1X': odd = rawOdds.dc_1x; break;
      case 'DC_12': odd = rawOdds.dc_12; break;
      case 'DC_X2': odd = rawOdds.dc_x2; break;
      case 'DNB_HOME': odd = rawOdds.dnb_home; break;
      case 'DNB_AWAY': odd = rawOdds.dnb_away; break;
      case 'OVER_05': odd = rawOdds.over_05; break;
      case 'UNDER_05': odd = rawOdds.under_05; break;
      case 'OVER_15': odd = rawOdds.over_15; break;
      case 'UNDER_15': odd = rawOdds.under_15; break;
      case 'OVER_25': odd = rawOdds.over_25; break;
      case 'UNDER_25': odd = rawOdds.under_25; break;
      case 'OVER_35': odd = rawOdds.over_35; break;
      case 'UNDER_35': odd = rawOdds.under_35; break;
      case 'OVER_45': odd = rawOdds.over_45; break;
      case 'BTTS_YES': odd = rawOdds.btts_yes; break;
      case 'BTTS_NO': odd = rawOdds.btts_no; break;
      case 'HT_HOME': odd = rawOdds.ht_home; break;
      case 'HT_DRAW': odd = rawOdds.ht_draw; break;
      case 'HT_AWAY': odd = rawOdds.ht_away; break;
      case 'HT_OVER_05': odd = rawOdds.ht_05_over; break;
      case 'HT_UNDER_05': odd = rawOdds.ht_05_under; break;
      case 'HT_OVER_15': odd = rawOdds.ht_15_over; break;
      case 'HT_UNDER_15': odd = rawOdds.ht_15_under; break;
      case 'AH_HOME_MINUS_1': odd = rawOdds.ah_home_minus_1; break;
      case 'AH_HOME_PLUS_1': odd = rawOdds.ah_home_plus_1; break; // home +1 = ev sahibi +1 AH orani
      case 'AH_AWAY_PLUS_1': odd = rawOdds.ah_away_minus_1; break; // away -1 = deplasman +1 AH orani
      case 'HTFT': {
        // pick.marketLabel is now "İY/MS X/Y" — extract X and Y from there
        const ml = pick.marketLabel.match(/İY\/MS ([1X2])\/([1X2])/);
        if (ml) {
          const key = `${ml[1]}/${ml[2]}`;
          odd = rawOdds.htft[key] ?? undefined;
        }
        break;
      }
      case 'CORRECT_SCORE': {
        if (pick.scoreValue) {
          odd = rawOdds.correct_scores[pick.scoreValue] ?? undefined;
        }
        break;
      }
      default:
        odd = undefined;
    }

    if (odd !== null && odd !== undefined && Number.isFinite(odd) && odd > 1.0) {
      pick.marketOdds = odd;
      pick.expectedValue = pick.probability * odd - 1;
    }
  }
}

/**
 * Convert a pattern's predicted market into a MarketPick that can be displayed
 * alongside model picks.
 */
function patternToPick(match: PatternMatch, rawOdds: LiveRawOdds | null): MarketPick | null {
  const p = match.pattern;
  const map: Record<PatternPredictionMarket, { market: MarketKey; cat: MarketCategory; label: string }> = {
    HOME_WIN: { market: 'HOME_WIN', cat: 'MAÇ_SONUCU', label: '1X2' },
    DRAW: { market: 'DRAW', cat: 'MAÇ_SONUCU', label: '1X2' },
    AWAY_WIN: { market: 'AWAY_WIN', cat: 'MAÇ_SONUCU', label: '1X2' },
    DC_1X: { market: 'DC_1X', cat: 'MAÇ_SONUCU', label: 'Çifte Şans' },
    DC_12: { market: 'DC_12', cat: 'MAÇ_SONUCU', label: 'Çifte Şans' },
    DC_X2: { market: 'DC_X2', cat: 'MAÇ_SONUCU', label: 'Çifte Şans' },
    OVER_05: { market: 'OVER_05', cat: 'GOL_TOPLAMI', label: 'Üst/Alt 0.5' },
    OVER_15: { market: 'OVER_15', cat: 'GOL_TOPLAMI', label: 'Üst/Alt 1.5' },
    OVER_25: { market: 'OVER_25', cat: 'GOL_TOPLAMI', label: 'Üst/Alt 2.5' },
    OVER_35: { market: 'OVER_35', cat: 'GOL_TOPLAMI', label: 'Üst/Alt 3.5' },
    UNDER_15: { market: 'UNDER_15', cat: 'GOL_TOPLAMI', label: 'Üst/Alt 1.5' },
    UNDER_25: { market: 'UNDER_25', cat: 'GOL_TOPLAMI', label: 'Üst/Alt 2.5' },
    UNDER_35: { market: 'UNDER_35', cat: 'GOL_TOPLAMI', label: 'Üst/Alt 3.5' },
    BTTS_YES: { market: 'BTTS_YES', cat: 'KG', label: 'KG' },
    BTTS_NO: { market: 'BTTS_NO', cat: 'KG', label: 'KG' },
    HT_OVER_05: { market: 'HT_OVER_05', cat: 'YARI_SONUCU', label: 'İY 0.5' },
    HT_OVER_15: { market: 'HT_OVER_15', cat: 'YARI_SONUCU', label: 'İY 1.5' },
    HT_UNDER_15: { market: 'HT_UNDER_15', cat: 'YARI_SONUCU', label: 'İY 1.5' },
    HT_HOME: { market: 'HT_HOME', cat: 'YARI_SONUCU', label: 'İY 1X2' },
    HT_DRAW: { market: 'HT_DRAW', cat: 'YARI_SONUCU', label: 'İY 1X2' },
    HT_AWAY: { market: 'HT_AWAY', cat: 'YARI_SONUCU', label: 'İY 1X2' },
    HTFT_11: { market: 'HTFT', cat: 'YARI_FULL', label: 'İY/MS' },
    HTFT_1X: { market: 'HTFT', cat: 'YARI_FULL', label: 'İY/MS' },
    HTFT_12: { market: 'HTFT', cat: 'YARI_FULL', label: 'İY/MS' },
    HTFT_X1: { market: 'HTFT', cat: 'YARI_FULL', label: 'İY/MS' },
    HTFT_XX: { market: 'HTFT', cat: 'YARI_FULL', label: 'İY/MS' },
    HTFT_X2: { market: 'HTFT', cat: 'YARI_FULL', label: 'İY/MS' },
    HTFT_21: { market: 'HTFT', cat: 'YARI_FULL', label: 'İY/MS' },
    HTFT_2X: { market: 'HTFT', cat: 'YARI_FULL', label: 'İY/MS' },
    HTFT_22: { market: 'HTFT', cat: 'YARI_FULL', label: 'İY/MS' },
  };

  const m = map[p.prediction];
  if (!m) return null;

  // Lookup live market odds for this pick
  let odd: number | undefined;
  if (rawOdds) {
    if (p.prediction.startsWith('HTFT_')) {
      const ftCode = p.prediction.replace('HTFT_', '');
      const htCode = ftCode[0];
      const ftCode2 = ftCode[1];
      const key = `${htCode === 'H' ? '1' : htCode === 'A' ? '2' : 'X'}/${ftCode2 === 'H' ? '1' : ftCode2 === 'A' ? '2' : 'X'}`;
      odd = rawOdds.htft[key] ?? undefined;
    } else {
      // Use attachLiveOdds logic by building a temp pick
      const temp: MarketPick = {
        market: m.market,
        marketLabel: m.label,
        pickLabel: p.predictionLabel,
        category: m.cat,
        probability: match.hitRate,
        edge: 0,
      };
      attachLiveOdds([temp], rawOdds);
      odd = temp.marketOdds;
    }
  }

  return {
    market: m.market,
    marketLabel: m.label,
    pickLabel: `🎯 ${p.name} → ${p.predictionLabel}`,
    category: m.cat,
    probability: match.hitRate,
    edge: match.hitRate - 0.5,
    marketOdds: odd,
    expectedValue: odd ? match.hitRate * odd - 1 : undefined,
  };
}
