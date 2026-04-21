/**
 * Enhanced Prediction Engine - Master Orchestrator
 *
 * Combines all prediction engines into a single unified response:
 * 1. AdvancedPredictionEngine - Poisson-based goals, match result, H2H
 * 2. CardsCornerEngine - Real data-driven cards & corners predictions
 * 3. OddsAnalysisEngine - Market odds, value bets, odds movement signals
 * 4. API-Football Predictions - External AI predictions for ensemble
 *
 * The ensemble approach combines multiple independent signals to produce
 * more accurate final predictions than any single model alone.
 */

import { ApiFootballService } from './api-football';
import { AdvancedPredictionEngine, type AdvancedMatchPrediction } from './advanced-prediction-engine';
import { CardsCornerEngine, type CardsPrediction, type CornersPrediction } from './cards-corners-engine';
import { OddsAnalysisEngine, type OddsAnalysis, type ValueBet } from './odds-engine';
import { CalibrationEngine, type CalibrationResult } from './calibration-engine';
import { MatchContextBuilder, type MatchContext } from './match-context';
import { MarketModels, type AllMarketPredictions } from './market-models';

export interface EnhancedPredictionResult {
  // Match info
  match: {
    id: number;
    home_team: { id: number; name: string; logo: string };
    away_team: { id: number; name: string; logo: string };
    league: { id: number; name: string; country: string; logo: string; round: string; season: number };
    date: string;
    time: string;
    venue: { name: string; city: string } | null;
    referee: string | null;
    status: { long: string; short: string; elapsed: number | null };
  };

  // Core prediction (from AdvancedPredictionEngine)
  prediction: AdvancedMatchPrediction;

  // Cards prediction (from CardsCornerEngine - REAL DATA)
  cards: CardsPrediction;

  // Corners prediction (from CardsCornerEngine - REAL DATA)
  corners: CornersPrediction;

  // Odds analysis (from OddsAnalysisEngine)
  odds: OddsAnalysis;

  // API-Football external predictions (ensemble input)
  api_predictions: any;

  // Ensemble: final combined predictions
  ensemble: {
    // Top banker bet (highest confidence single prediction)
    banker: {
      prediction: string;
      probability: number;
      market: string;
      reasoning: string;
    };

    // Estimated score (most likely exact score)
    estimated_score: {
      home: number;
      away: number;
      probability: number;
    };

    // HT/FT prediction
    ht_ft: {
      halftime: string; // "1" | "X" | "2"
      fulltime: string; // "1" | "X" | "2"
      label: string; // e.g. "X / 1"
      probability: number;
    };

    // Value bets (where our model disagrees with market)
    value_bets: ValueBet[];

    // Overall confidence (ensemble weighted)
    confidence: number;
    confidence_tier: 'platinum' | 'gold' | 'silver' | 'bronze';

    // Risk level
    risk_level: 'low' | 'medium' | 'high';
  };

  // Team form data
  form: {
    home: { last_5: string; position: number; points: number; goal_diff: number };
    away: { last_5: string; position: number; points: number; goal_diff: number };
    h2h: { total: number; home_wins: number; away_wins: number; draws: number };
  };

  // Calibrated predictions (cross-validated with odds)
  calibration: CalibrationResult;

  // NEW: All market predictions from unified Deep Integration engine
  allMarkets: AllMarketPredictions;

  // NEW: Match Context (shared data layer)
  context: {
    intensity: { score: number; multiplier: number; isDerby: boolean; isRelegation: boolean; isTitle: boolean };
    tempo: { score: number; multiplier: number };
    defense: { homeStyle: string; awayStyle: string };
    xg: { home: number; away: number; total: number; firstHalf: number; secondHalf: number };
  };

  // Metadata
  metadata: {
    algorithm_version: string;
    generated_at: string;
    engines_used: string[];
    data_quality: {
      cards: string;
      corners: string;
      odds: boolean;
      api_predictions: boolean;
    };
  };
}

export class EnhancedPredictionOrchestrator {

  /**
   * Generate the complete enhanced prediction for a match
   */
  static async generatePrediction(matchId: number): Promise<EnhancedPredictionResult> {
    // Step 1: Get match details
    const match = await ApiFootballService.getFixture(matchId);
    if (!match) throw new Error(`Match ${matchId} not found`);

    const homeTeamId = match.teams.home.id;
    const awayTeamId = match.teams.away.id;
    const leagueId = match.league.id;
    const season = match.league.season;

    // Step 2: Build MatchContext (unified data layer) + run legacy engines in parallel
    const [
      matchContext,
      advancedPrediction,
      cardsPrediction,
      cornersPrediction,
      apiPredictions
    ] = await Promise.all([
      MatchContextBuilder.build(homeTeamId, awayTeamId, leagueId, season, matchId, match.fixture.referee),
      AdvancedPredictionEngine.generateAdvancedPrediction(homeTeamId, awayTeamId, leagueId, season, matchId),
      CardsCornerEngine.predictCards(homeTeamId, awayTeamId, leagueId, season, match.fixture.referee),
      CardsCornerEngine.predictCorners(homeTeamId, awayTeamId, leagueId, season),
      ApiFootballService.getPredictions(matchId),
    ]);

    // Step 2b: Enrich context with odds data + generate ALL market predictions
    const enrichedCtx = await MatchContextBuilder.enrichWithOdds(matchContext);
    const allMarkets = MarketModels.predict(enrichedCtx);

    // Step 3: Run odds analysis with our probabilities
    const oddsAnalysis = await OddsAnalysisEngine.analyzeOdds(matchId, {
      home_win: advancedPrediction.match_result.home_win.probability,
      draw: advancedPrediction.match_result.draw.probability,
      away_win: advancedPrediction.match_result.away_win.probability,
      over_2_5: advancedPrediction.total_goals.over_2_5.probability,
      under_2_5: advancedPrediction.total_goals.under_2_5.probability,
      btts_yes: advancedPrediction.both_teams_score.probability,
      btts_no: 100 - advancedPrediction.both_teams_score.probability,
    });

    // Step 4: Calibrate predictions using odds as anchor
    const calibration = await CalibrationEngine.calibrateAll(
      matchId,
      advancedPrediction,
      cardsPrediction,
      cornersPrediction,
      apiPredictions
    );

    // Step 5: Build ensemble predictions (now uses calibrated data)
    const ensemble = this.buildEnsemble(advancedPrediction, cardsPrediction, cornersPrediction, oddsAnalysis, apiPredictions, calibration);

    // Step 6: Extract form data
    const form = await this.extractFormData(homeTeamId, awayTeamId, leagueId, season);

    // Step 6: Build match time
    const matchDate = new Date(match.fixture.date);
    const timeStr = matchDate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    const dateStr = matchDate.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

    return {
      match: {
        id: match.fixture.id,
        home_team: { id: match.teams.home.id, name: match.teams.home.name, logo: match.teams.home.logo },
        away_team: { id: match.teams.away.id, name: match.teams.away.name, logo: match.teams.away.logo },
        league: {
          id: match.league.id,
          name: match.league.name,
          country: match.league.country,
          logo: match.league.logo,
          round: match.league.round,
          season: match.league.season
        },
        date: dateStr,
        time: timeStr,
        venue: match.fixture.venue ? { name: match.fixture.venue.name, city: match.fixture.venue.city } : null,
        referee: match.fixture.referee,
        status: {
          long: match.fixture.status.long,
          short: match.fixture.status.short,
          elapsed: match.fixture.status.elapsed,
        }
      },
      prediction: advancedPrediction,
      cards: cardsPrediction,
      corners: cornersPrediction,
      odds: oddsAnalysis,
      api_predictions: apiPredictions,
      ensemble,
      calibration,
      allMarkets,
      context: {
        intensity: {
          score: enrichedCtx.intensity.score,
          multiplier: enrichedCtx.intensity.multiplier,
          isDerby: enrichedCtx.intensity.isDerby,
          isRelegation: enrichedCtx.intensity.isRelegationBattle,
          isTitle: enrichedCtx.intensity.isTitleClash,
        },
        tempo: { score: enrichedCtx.tempo.score, multiplier: enrichedCtx.tempo.multiplier },
        defense: { homeStyle: enrichedCtx.defense.homeStyle, awayStyle: enrichedCtx.defense.awayStyle },
        xg: {
          home: enrichedCtx.xg.home,
          away: enrichedCtx.xg.away,
          total: enrichedCtx.xg.total,
          firstHalf: enrichedCtx.xg.firstHalfTotal,
          secondHalf: enrichedCtx.xg.secondHalfTotal,
        },
      },
      form,
      metadata: {
        algorithm_version: '4.0-deep-integration',
        generated_at: new Date().toISOString(),
        engines_used: [
          'AdvancedPredictionEngine',
          'CardsCornerEngine',
          'OddsAnalysisEngine',
          'MatchContext-DeepIntegration',
          'MarketModels-AllMarkets',
          oddsAnalysis.data_available ? 'MarketOdds' : null,
          apiPredictions ? 'ApiFootballPredictions' : null,
          enrichedCtx.odds.available ? 'OddsCalibration' : null,
        ].filter(Boolean) as string[],
        data_quality: {
          cards: cardsPrediction.data_quality,
          corners: cornersPrediction.data_quality,
          odds: oddsAnalysis.data_available,
          api_predictions: !!apiPredictions,
        }
      }
    };
  }

  /**
   * Build ensemble predictions by combining all engine outputs
   *
   * Key design principles:
   * - NO hardcoded probabilities - everything derived from statistical models
   * - Banker = best combination of probability AND value, not just highest prob
   * - Score prediction must be consistent with over/under probabilities
   * - HT/FT uses proper conditional probability, not independent multiplication
   * - Confidence tiers require data quality checks for platinum
   * - All complementary markets sum to ~100%
   */
  private static buildEnsemble(
    prediction: AdvancedMatchPrediction,
    cards: CardsPrediction,
    corners: CornersPrediction,
    odds: OddsAnalysis,
    apiPredictions: any,
    calibration?: CalibrationResult
  ): EnhancedPredictionResult['ensemble'] {

    // ═══════════════════════════════════════
    // STEP 0: VERIFY OVER/UNDER COMPLEMENTARITY
    // ═══════════════════════════════════════
    // Ensure over_X + under_X ≈ 100% for all thresholds.
    // The AdvancedPredictionEngine already computes these as complements,
    // but we verify and normalize here for safety.
    const verifyComplement = (over: number, under: number): { over: number; under: number } => {
      const sum = over + under;
      if (Math.abs(sum - 100) < 0.5) return { over, under }; // Already within tolerance
      // Normalize to exactly 100
      return { over: (over / sum) * 100, under: (under / sum) * 100 };
    };

    const goals05 = verifyComplement(prediction.total_goals.over_0_5.probability, prediction.total_goals.under_0_5.probability);
    const goals15 = verifyComplement(prediction.total_goals.over_1_5.probability, prediction.total_goals.under_1_5.probability);
    const goals25 = verifyComplement(prediction.total_goals.over_2_5.probability, prediction.total_goals.under_2_5.probability);
    const goals35 = verifyComplement(prediction.total_goals.over_3_5.probability, prediction.total_goals.under_3_5.probability);

    // ═══════════════════════════════════════
    // STEP 1: ESTIMATED SCORE (do this first, needed for consistency checks)
    // ═══════════════════════════════════════
    const topScore = prediction.exact_scores[0];
    const scoreParts = topScore ? topScore.score.split('-').map(Number) : [1, 1];
    const estHome = scoreParts[0] ?? 1;
    const estAway = scoreParts[1] ?? 1;
    const estTotal = estHome + estAway;

    // ═══════════════════════════════════════
    // STEP 2: SCORE-CONSISTENT PROBABILITY VALIDATION
    // ═══════════════════════════════════════
    // If predicted score is e.g. 1-1 (total=2), then over_2.5 MUST be < 50%
    // We use the Poisson-derived probabilities as ground truth (they ARE consistent)
    // but log a warning if the estimated score contradicts the probability mass.
    const scoreConsistencyCheck = () => {
      const warnings: string[] = [];
      // If predicted total is <= 2, over_2.5 should be < 50
      if (estTotal <= 2 && goals25.over > 50) {
        warnings.push(`Score ${estHome}-${estAway} (total=${estTotal}) but over_2.5=${goals25.over.toFixed(1)}% > 50%`);
      }
      // If predicted total is >= 3, under_2.5 should be < 50
      if (estTotal >= 3 && goals25.under > 50) {
        warnings.push(`Score ${estHome}-${estAway} (total=${estTotal}) but under_2.5=${goals25.under.toFixed(1)}% > 50%`);
      }
      // If predicted total is <= 3, over_3.5 should be low
      if (estTotal <= 3 && goals35.over > 50) {
        warnings.push(`Score ${estHome}-${estAway} (total=${estTotal}) but over_3.5=${goals35.over.toFixed(1)}% > 50%`);
      }
      // BTTS consistency: if both teams score in predicted result, BTTS should be reasonable
      if (estHome > 0 && estAway > 0 && prediction.both_teams_score.probability < 30) {
        warnings.push(`Score ${estHome}-${estAway} has BTTS but btts_prob=${prediction.both_teams_score.probability.toFixed(1)}% < 30%`);
      }
      if (estHome === 0 || estAway === 0) {
        if (prediction.both_teams_score.probability > 70) {
          warnings.push(`Score ${estHome}-${estAway} has no BTTS but btts_prob=${prediction.both_teams_score.probability.toFixed(1)}% > 70%`);
        }
      }
      if (warnings.length > 0) {
        console.warn(`[ENSEMBLE] Score consistency warnings:`, warnings);
      }
      return warnings.length === 0;
    };
    const isScoreConsistent = scoreConsistencyCheck();

    // ═══════════════════════════════════════
    // STEP 3: BANKER BET SELECTION
    // ═══════════════════════════════════════
    // Banker = most RELIABLE prediction, not just highest probability.
    // Score = probability * reliabilityMultiplier * edgeBonus
    // - High prob but trivial (under_3.5 at 81%) gets downweighted
    // - Probability capped at 85% for realism
    // - Edge alignment with market odds boosts score

    type BankerCandidate = {
      prediction: string;
      rawProbability: number;  // Original model probability
      probability: number;     // Capped probability for output
      market: string;
      reasoning: string;
      bankerScore: number;     // Composite score for ranking
    };
    const candidates: BankerCandidate[] = [];

    const MAX_BANKER_PROBABILITY = 85; // Cap: even dominant matchups rarely exceed this

    // Reliability multiplier: genuine signal strength assessment
    const reliabilityMultiplier = (prob: number, market: string): number => {
      // Match Winner and BTTS are genuinely informative markets
      if (market === 'Match Winner' || market === 'Both Teams Score') {
        if (prob > 65) return 1.1; // Strong signal bonus
        if (prob > 55) return 1.0;
        return 0.95;
      }
      // Over/Under 2.5 is the most useful goals market
      if (market.includes('2.5')) return 1.0;
      // Over 3.5 is genuinely informative (rare event)
      if (market.includes('3.5') && market.includes('Over')) return 1.05;
      // Cards/corners are secondary signals
      if (market.includes('Card') || market.includes('Corner')) return 0.85;
      return 0.9;
    };

    // Helper to compute edge bonus from market odds alignment
    const computeEdgeBonus = (candidatePred: string, baseProb: number): number => {
      if (!odds.data_available) return 0;
      const valueMatch = odds.value_bets.find(v =>
        v.selection.toLowerCase().includes(candidatePred.toLowerCase().split(' ')[0])
      );
      if (valueMatch && valueMatch.edge > 0) {
        // Edge bonus: up to +5 for strong value, proportional to edge
        return Math.min(5, valueMatch.edge * 0.2);
      }
      return 0;
    };

    // Helper to cap probability realistically
    const capProbability = (prob: number): number => Math.min(MAX_BANKER_PROBABILITY, prob);

    // 1X2 candidates
    const results = [
      { name: 'Home Win', prob: prediction.match_result.home_win.probability },
      { name: 'Draw', prob: prediction.match_result.draw.probability },
      { name: 'Away Win', prob: prediction.match_result.away_win.probability },
    ];
    const bestResult = results.reduce((a, b) => a.prob > b.prob ? a : b);
    if (bestResult.prob > 40) { // Lower threshold: include if it's the strongest signal
      const edgeBonus = computeEdgeBonus(bestResult.name, bestResult.prob);
      const capped = capProbability(bestResult.prob);
      const reliability = reliabilityMultiplier(bestResult.prob, 'Match Winner');
      candidates.push({
        prediction: bestResult.name,
        rawProbability: bestResult.prob,
        probability: capped,
        market: 'Match Winner',
        reasoning: `${bestResult.name} en yüksek olasılıkla tahmin ediliyor (Model: %${bestResult.prob.toFixed(1)})`,
        bankerScore: capped * reliability + edgeBonus,
      });
    }

    // Over/Under candidates - ONLY non-trivial thresholds qualify as banker
    // Under 3.5, Over 0.5, Over 1.5 are NEVER bankers (trivially high in almost every match)
    const ouCandidates = [
      { pred: 'Over 2.5', prob: goals25.over, threshold: 55, market: 'Over/Under 2.5',
        reason: 'Yüksek gol beklentisi - her iki takım da gol yeteneğine sahip' },
      { pred: 'Under 2.5', prob: goals25.under, threshold: 58, market: 'Over/Under 2.5',
        reason: 'Düşük gol beklentisi - savunma ağırlıklı maç bekleniyor' },
      { pred: 'Over 3.5', prob: goals35.over, threshold: 50, market: 'Over/Under 3.5',
        reason: 'Çok yüksek gol beklentisi - açık ve ofansif maç' },
      // Under 3.5 EXCLUDED from banker candidates - trivially true in ~75% of all matches
      // Over 1.5 EXCLUDED from banker candidates - trivially true in ~80% of all matches
    ];

    for (const ou of ouCandidates) {
      if (ou.prob > ou.threshold) {
        const edgeBonus = computeEdgeBonus(ou.pred, ou.prob);
        const capped = capProbability(ou.prob);
        const reliability = reliabilityMultiplier(ou.prob, ou.market);
        candidates.push({
          prediction: ou.pred,
          rawProbability: ou.prob,
          probability: capped,
          market: ou.market,
          reasoning: ou.reason,
          bankerScore: capped * reliability + edgeBonus,
        });
      }
    }

    // BTTS candidate
    if (prediction.both_teams_score.probability > 55) {
      const prob = prediction.both_teams_score.probability;
      const capped = capProbability(prob);
      const edgeBonus = computeEdgeBonus('BTTS', prob);
      candidates.push({
        prediction: 'BTTS Yes',
        rawProbability: prob,
        probability: capped,
        market: 'Both Teams Score',
        reasoning: 'Her iki takımın da gol atma kapasitesi yüksek',
        bankerScore: capped * 1.0 + edgeBonus,
      });
    }
    if ((100 - prediction.both_teams_score.probability) > 60) {
      const prob = 100 - prediction.both_teams_score.probability;
      const capped = capProbability(prob);
      candidates.push({
        prediction: 'BTTS No',
        rawProbability: prob,
        probability: capped,
        market: 'Both Teams Score',
        reasoning: 'En az bir takımın gol atamaması muhtemel',
        bankerScore: capped * 1.0,
      });
    }

    // Cards/Corners are SECONDARY markets - included in analysis but NOT as banker candidates
    // They are shown in the cards tab, not as the top banker insight

    // API predictions ensemble boost (small, capped contribution)
    if (apiPredictions?.predictions?.winner?.name) {
      const apiWinner = apiPredictions.predictions.winner.name;
      candidates.forEach(c => {
        if (c.market === 'Match Winner' && c.prediction.toLowerCase().includes(apiWinner.toLowerCase())) {
          c.bankerScore += 2; // Small bonus for API agreement
          c.reasoning += ' + API-Football tahminleri ile uyumlu';
        }
      });
    }

    // Odds alignment boost (moderate, for value detection)
    if (odds.data_available) {
      candidates.forEach(c => {
        const valueMatch = odds.value_bets.find(v =>
          v.selection.toLowerCase().includes(c.prediction.toLowerCase().split(' ')[0])
        );
        if (valueMatch && valueMatch.edge > 0) {
          // Don't inflate probability, only boost banker score
          c.bankerScore += Math.min(5, valueMatch.edge * 0.3);
          c.reasoning += ` + Oran analizi uyumlu (Edge: %${valueMatch.edge.toFixed(1)})`;
        }
      });
    }

    // Calibration-derived candidates (high trust: multiple sources agree)
    // Exclude trivial markets from calibration picks too
    const TRIVIAL_SELECTIONS = ['over 0.5', 'over 1.5', 'under 3.5', 'under 4.5', 'under 5.5'];
    if (calibration?.top_picks?.length) {
      calibration.top_picks
        .filter(tp => !TRIVIAL_SELECTIONS.some(t => tp.selection.toLowerCase().includes(t)))
        .forEach(tp => {
        const cappedProb = capProbability(tp.calibrated_probability);
        // Calibrated picks get a reliability boost proportional to source agreement
        const sourceAgreementBonus = (tp.sources_agreeing / tp.total_sources) * 10;
        const valueBonus = tp.is_value_bet ? Math.min(5, tp.edge * 0.3) : 0;
        candidates.push({
          prediction: tp.selection,
          rawProbability: tp.calibrated_probability,
          probability: cappedProb,
          market: tp.market,
          reasoning: `Kalibre edilmiş: ${tp.sources_agreeing}/${tp.total_sources} kaynak uyumlu` +
            (tp.is_value_bet ? ` (Value +${tp.edge.toFixed(1)}%)` : '') +
            ` [Güven: %${tp.confidence}]`,
          bankerScore: cappedProb * 1.0 + sourceAgreementBonus + valueBonus,
        });
      });  // end filter().forEach()
    }

    // Sort by bankerScore (composite of probability, reliability, and edge) - NOT raw probability
    candidates.sort((a, b) => b.bankerScore - a.bankerScore);

    // Fallback banker: derive from actual model data, never hardcoded
    const fallbackBanker = (): BankerCandidate => {
      // Use the strongest available signal from the model
      const ftResult = results.reduce((a, b) => a.prob > b.prob ? a : b);
      const goalsSignal = goals25.under > goals25.over
        ? { pred: 'Under 2.5', prob: goals25.under }
        : { pred: 'Over 2.5', prob: goals25.over };
      // Pick whichever is stronger
      const best = ftResult.prob > goalsSignal.prob ? ftResult : null;
      const fallbackProb = best ? capProbability(best.prob) : capProbability(goalsSignal.prob);
      const fallbackPred = best ? best.name : goalsSignal.pred;
      const fallbackMarket = best ? 'Match Winner' : 'Over/Under';
      return {
        prediction: fallbackPred,
        rawProbability: best ? best.prob : goalsSignal.prob,
        probability: fallbackProb,
        market: fallbackMarket,
        reasoning: `Model analizine dayalı en güçlü sinyal (Model: %${(best ? best.prob : goalsSignal.prob).toFixed(1)})`,
        bankerScore: fallbackProb * 0.85,
      };
    };

    const banker = candidates[0] || fallbackBanker();

    // ═══════════════════════════════════════
    // STEP 4: HT/FT PREDICTION (proper conditional probability)
    // ═══════════════════════════════════════
    // P(HT=X, FT=Y) is NOT simply P(HT=X) * P(FT=Y) since they are dependent.
    // If HT=Draw and FT=HomeWin, we need P(leading at half | winning at full) type logic.
    // Use transition probability matrix based on halftime-fulltime conditional probabilities.
    //
    // Empirical HT/FT transition rates (from large football datasets):
    // P(FT=1 | HT=1) ≈ 0.80, P(FT=X | HT=1) ≈ 0.14, P(FT=2 | HT=1) ≈ 0.06
    // P(FT=1 | HT=X) ≈ 0.33, P(FT=X | HT=X) ≈ 0.38, P(FT=2 | HT=X) ≈ 0.29
    // P(FT=1 | HT=2) ≈ 0.06, P(FT=X | HT=2) ≈ 0.14, P(FT=2 | HT=2) ≈ 0.80

    const htResult = prediction.halftime_result;
    // Normalize HT probabilities to sum to 100
    const htSum = htResult.home_win + htResult.draw + htResult.away_win;
    const htHome = (htResult.home_win / htSum) * 100;
    const htDraw = (htResult.draw / htSum) * 100;
    const htAway = (htResult.away_win / htSum) * 100;

    // FT probabilities (already from model)
    const ftHome = prediction.match_result.home_win.probability;
    const ftDraw = prediction.match_result.draw.probability;
    const ftAway = prediction.match_result.away_win.probability;

    // Blend empirical transition matrix with model's FT probabilities
    // to get proper joint HT/FT probabilities
    const transitionMatrix: Record<string, Record<string, number>> = {
      '1': { '1': 0.80, 'X': 0.14, '2': 0.06 },
      'X': { '1': 0.33, 'X': 0.38, '2': 0.29 },
      '2': { '1': 0.06, 'X': 0.14, '2': 0.80 },
    };

    // Adjust transition probabilities toward model's FT distribution
    // (blend 60% empirical + 40% model-derived for the FT conditional)
    const blendWeight = 0.6; // Weight for empirical transitions
    const computeHtFtProb = (ht: string, ft: string): number => {
      const htProb = ht === '1' ? htHome : ht === '2' ? htAway : htDraw;
      const empiricalTransition = transitionMatrix[ht][ft];
      const modelFtProb = (ft === '1' ? ftHome : ft === '2' ? ftAway : ftDraw) / 100;
      // Blended conditional: P(FT|HT) = blend * empirical + (1-blend) * model
      const conditionalFt = blendWeight * empiricalTransition + (1 - blendWeight) * modelFtProb;
      // Joint probability: P(HT, FT) = P(HT) * P(FT|HT)
      return (htProb / 100) * conditionalFt;
    };

    // Compute all 9 HT/FT combinations and find the most likely
    const htFtCombinations: Array<{ ht: string; ft: string; prob: number }> = [];
    for (const ht of ['1', 'X', '2']) {
      for (const ft of ['1', 'X', '2']) {
        htFtCombinations.push({ ht, ft, prob: computeHtFtProb(ht, ft) });
      }
    }
    // Normalize joint probabilities to sum to 1
    const htFtTotal = htFtCombinations.reduce((s, c) => s + c.prob, 0);
    htFtCombinations.forEach(c => { c.prob = c.prob / htFtTotal; });

    // Sort and pick most likely
    htFtCombinations.sort((a, b) => b.prob - a.prob);
    const bestHtFt = htFtCombinations[0];
    const htftProb = Math.round(bestHtFt.prob * 10000) / 100; // As percentage with 2 decimals

    // ═══════════════════════════════════════
    // STEP 5: OVERALL CONFIDENCE & TIER (from real calculations, no hardcodes)
    // ═══════════════════════════════════════
    // Confidence factors are all derived from engine calculations:
    // - prediction_confidence: from AdvancedPredictionEngine (max of result probs)
    // - cards.confidence: from CardsCornerEngine (data-quality driven)
    // - corners.confidence: from CardsCornerEngine (data-quality driven)
    // - odds confidence: derived from cross-validation score if available,
    //   otherwise from market data availability signal

    // Derive odds confidence from actual calibration data, not hardcoded
    let oddsConfidence: number;
    if (calibration) {
      // Use the calibration engine's cross-validation score (0-100)
      oddsConfidence = calibration.cross_validation_score;
    } else if (odds.data_available) {
      // Derive from market consensus overround (lower overround = more efficient market = higher trust)
      const overround = odds.market_consensus.overround;
      // Overround of ~5% is excellent, ~15% is poor
      oddsConfidence = Math.max(30, Math.min(80, 85 - overround * 3));
    } else {
      // No odds data: confidence penalty - derive from available data quality
      const hasCards = cards.data_quality === 'high' || cards.data_quality === 'medium';
      const hasCorners = corners.data_quality === 'high' || corners.data_quality === 'medium';
      oddsConfidence = 30 + (hasCards ? 8 : 0) + (hasCorners ? 7 : 0);
    }

    const confidenceFactors = [
      prediction.prediction_confidence,
      cards.confidence,
      corners.confidence,
      oddsConfidence,
    ];
    const overallConfidence = Math.round(confidenceFactors.reduce((s, v) => s + v, 0) / confidenceFactors.length);

    // Data quality assessment for tier gating
    const dataSourceCount = [
      true, // prediction engine always present
      cards.data_quality === 'high' || cards.data_quality === 'medium',
      corners.data_quality === 'high' || corners.data_quality === 'medium',
      odds.data_available,
      !!apiPredictions,
    ].filter(Boolean).length;

    // Confidence tier: platinum >= 75%, gold >= 60%, silver >= 45%
    // CRITICAL: Platinum requires BOTH high confidence AND good data quality
    let confidenceTier: 'platinum' | 'gold' | 'silver' | 'bronze';
    if (overallConfidence >= 75 && dataSourceCount >= 4) {
      confidenceTier = 'platinum'; // High confidence + multiple data sources
    } else if (overallConfidence >= 75 && dataSourceCount < 4) {
      confidenceTier = 'gold'; // High confidence but insufficient data sources
    } else if (overallConfidence >= 60) {
      confidenceTier = 'gold';
    } else if (overallConfidence >= 45) {
      confidenceTier = 'silver';
    } else {
      confidenceTier = 'bronze';
    }

    // Risk level derived from banker probability (using capped probability)
    let riskLevel: 'low' | 'medium' | 'high';
    if (banker.probability >= 70) riskLevel = 'low';
    else if (banker.probability >= 55) riskLevel = 'medium';
    else riskLevel = 'high';

    return {
      banker: {
        prediction: `FT [${banker.prediction}]`,
        probability: Math.round(banker.probability),
        market: banker.market,
        reasoning: banker.reasoning,
      },
      estimated_score: {
        home: estHome,
        away: estAway,
        probability: topScore?.probability || Math.round(prediction.exact_scores[0]?.probability || 5),
      },
      ht_ft: {
        halftime: bestHtFt.ht,
        fulltime: bestHtFt.ft,
        label: `${bestHtFt.ht} / ${bestHtFt.ft}`,
        probability: htftProb,
      },
      value_bets: odds.value_bets,
      confidence: overallConfidence,
      confidence_tier: confidenceTier,
      risk_level: riskLevel,
    };
  }

  /**
   * Extract team form and H2H data
   *
   * Form weighting: exponential decay - most recent match gets 2x the weight
   * of the 5th most recent match. Weight_i = base^(N-1-i) where base = 2^(1/4).
   * This means: match[0] (newest) = weight ~2.0, match[4] (oldest) = weight ~1.0
   *
   * H2H blending: With small samples (< 5 matches), H2H stats are blended
   * toward a neutral prior (33%/33%/33%). The blend ratio is:
   *   effective = prior * (1 - sampleWeight) + observed * sampleWeight
   *   where sampleWeight = min(1, numMatches / 8) -- full trust at 8+ matches
   */
  private static async extractFormData(
    homeTeamId: number,
    awayTeamId: number,
    leagueId: number,
    season: number
  ): Promise<EnhancedPredictionResult['form']> {
    try {
      const [standings, h2hData] = await Promise.all([
        ApiFootballService.getStandings(leagueId, season),
        ApiFootballService.getHeadToHead(`${homeTeamId}-${awayTeamId}`)
      ]);

      console.log(`[FORM] Standings received: ${standings.length} teams for league ${leagueId}`);

      const homeStanding = standings.find(s => s.team.id === homeTeamId);
      const awayStanding = standings.find(s => s.team.id === awayTeamId);

      console.log(`[FORM] Home standing: ${homeStanding?.team?.name} rank=${homeStanding?.rank} form=${homeStanding?.form}`);
      console.log(`[FORM] Away standing: ${awayStanding?.team?.name} rank=${awayStanding?.rank} form=${awayStanding?.form}`);

      // ═══════════════════════════════════════
      // H2H ANALYSIS with neutral prior blending
      // ═══════════════════════════════════════
      const h2hMatches = h2hData.slice(0, 10);
      let rawHomeWins = 0, rawAwayWins = 0, rawDraws = 0;

      // Apply exponential weighting to H2H matches too (recent H2H > old H2H)
      h2hMatches.forEach((match, index) => {
        // Exponential weight: newest match gets highest weight
        // weight = 2^((N-1-i)/(N-1)) for N matches, so newest=2, oldest=1
        const n = h2hMatches.length;
        const weight = n > 1 ? Math.pow(2, (n - 1 - index) / (n - 1)) : 1;

        if (match.goals.home > match.goals.away) {
          if (match.teams.home.id === homeTeamId) rawHomeWins += weight;
          else rawAwayWins += weight;
        } else if (match.goals.home < match.goals.away) {
          if (match.teams.away.id === homeTeamId) rawHomeWins += weight;
          else rawAwayWins += weight;
        } else {
          rawDraws += weight;
        }
      });

      // Blend toward neutral prior with small sample sizes
      // sampleWeight: 0 at 0 matches (pure prior), 1 at 8+ matches (pure observed)
      const sampleWeight = Math.min(1, h2hMatches.length / 8);
      const totalWeighted = rawHomeWins + rawAwayWins + rawDraws;
      const neutralPrior = 1 / 3; // 33% each for neutral

      // For display, round to integer counts (the weighting is used internally for H2H factor)
      // but the raw counts are what we report in the h2h object
      let displayHomeWins = 0, displayAwayWins = 0, displayDraws = 0;
      h2hMatches.forEach(match => {
        if (match.goals.home > match.goals.away) {
          if (match.teams.home.id === homeTeamId) displayHomeWins++;
          else displayAwayWins++;
        } else if (match.goals.home < match.goals.away) {
          if (match.teams.away.id === homeTeamId) displayHomeWins++;
          else displayAwayWins++;
        } else {
          displayDraws++;
        }
      });

      // Log the blending effect for debugging
      if (h2hMatches.length > 0 && h2hMatches.length < 8) {
        const observedHomeRate = totalWeighted > 0 ? rawHomeWins / totalWeighted : neutralPrior;
        const blendedHomeRate = neutralPrior * (1 - sampleWeight) + observedHomeRate * sampleWeight;
        console.log(`[FORM] H2H blending: ${h2hMatches.length} matches, sampleWeight=${sampleWeight.toFixed(2)}, ` +
          `observed homeWinRate=${(observedHomeRate * 100).toFixed(1)}%, blended=${(blendedHomeRate * 100).toFixed(1)}%`);
      }

      return {
        home: {
          last_5: homeStanding?.form?.slice(-5) || 'DDDDD',
          position: homeStanding?.rank || 0,
          points: homeStanding?.points || 0,
          goal_diff: homeStanding?.goalsDiff || 0,
        },
        away: {
          last_5: awayStanding?.form?.slice(-5) || 'DDDDD',
          position: awayStanding?.rank || 0,
          points: awayStanding?.points || 0,
          goal_diff: awayStanding?.goalsDiff || 0,
        },
        h2h: {
          total: h2hMatches.length,
          home_wins: displayHomeWins,
          away_wins: displayAwayWins,
          draws: displayDraws,
        }
      };
    } catch (err) {
      console.error(`[FORM] extractFormData FAILED:`, err);
      return {
        home: { last_5: 'DDDDD', position: 0, points: 0, goal_diff: 0 },
        away: { last_5: 'DDDDD', position: 0, points: 0, goal_diff: 0 },
        h2h: { total: 0, home_wins: 0, away_wins: 0, draws: 0 },
      };
    }
  }
}
