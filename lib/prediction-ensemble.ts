import weightsConfig from '@/lib/config/prediction-ensemble-weights.json';
import {
  AgreementAnalysis,
  BankoSelection,
  BothTeamsScorePrediction,
  CardsPrediction,
  ConfidenceBreakdown,
  ConfidenceScore,
  ConfidenceSummary,
  CornersPrediction,
  EnsembleInput,
  EnsemblePrediction,
  EnsembleWeights,
  ExactScorePrediction,
  FirstHalfGoalsPrediction,
  FirstHalfResultPrediction,
  GoalLinePrediction,
  GoalsPrediction,
  MarketDiagnostic,
  MarketType,
  MatchResultPrediction,
  ProbabilitySet,
  SourceAvailability,
  SourceContribution,
  SourceDiagnostics,
  SourceWeightConfig,
} from '@/lib/types/ensemble-types';
import {
  applyAgreementBonus,
  applyConfidenceWeighting,
  applyDisagreementPenalty,
  calculateConsensusScore,
  calculateVariance,
  calculateWeightedAverage,
  combineMultipleDistributions,
  hasRequiredFields,
  identifyOutliers,
  isPercentageString,
  isValidProbability,
  logisticFunction,
  normalizePercentageString,
  normalizeProbabilitySet,
  poissonProbability,
  roundToPrecision,
  sanitizeProbabilities,
} from '@/lib/utils/probability-utils';

const SOURCE_KEYS: Array<keyof SourceAvailability> = ['apiFootball', 'basicEngine', 'advancedEngine'];

type SourceKey = keyof SourceAvailability;

type MarketDiagnosticsBundle = {
  diagnostics: MarketDiagnostic[];
  cardsConfidence?: ConfidenceScore;
  cornersConfidence?: ConfidenceScore;
  exactScoreConfidence?: ConfidenceScore;
  predictions: {
    cards?: CardsPrediction;
    corners?: CornersPrediction;
    exactScores?: ExactScorePrediction[];
  };
};

export class PredictionEnsemble {
  private readonly config: EnsembleWeights;

  private readonly precision: number;

  constructor(config: EnsembleWeights = weightsConfig as EnsembleWeights) {
    this.config = config;
    this.precision = config.normalization?.decimalPrecision ?? 4;
  }

  public combine(input: EnsembleInput): EnsemblePrediction {
    const availability = this.resolveAvailability(input);
    const diagnostics: MarketDiagnostic[] = [];

    const matchResultBundle = this.combineMatchResult(input, availability);
    diagnostics.push(matchResultBundle.diagnostic);

    const goalsBundle = this.combineOverUnderGoals(input, availability);
    diagnostics.push(goalsBundle.diagnostic);

    const bttsBundle = this.combineBothTeamsScore(input, availability);
    diagnostics.push(bttsBundle.diagnostic);

    const firstHalfBundle = this.combineFirstHalfPredictions(input, availability);
    diagnostics.push(firstHalfBundle.resultDiagnostic, firstHalfBundle.goalsDiagnostic);

    const specialBundle = this.combineSpecialMarkets(input, availability);
    diagnostics.push(...specialBundle.diagnostics);

    const overallConsensus = this.calculateOverallConsensus(diagnostics);

    const confidenceSummary = this.buildConfidenceSummary({
      matchResult: matchResultBundle.result.confidence,
      overUnderGoals: goalsBundle.confidence,
      bothTeamsToScore: bttsBundle.confidence,
      firstHalfResult: firstHalfBundle.result.confidence,
      firstHalfGoals: firstHalfBundle.goals.confidence,
      cards: specialBundle.cardsConfidence,
      corners: specialBundle.cornersConfidence,
      exactScore: specialBundle.exactScoreConfidence,
    });

    const bankoSelections = this.selectBankoPredictions(
      {
        matchResult: matchResultBundle.result,
        goals: goalsBundle.result,
        bothTeamsScore: bttsBundle.result,
        firstHalfResult: firstHalfBundle.result,
        firstHalfGoals: firstHalfBundle.goals,
        cards: specialBundle.predictions.cards,
        corners: specialBundle.predictions.corners,
        exactScores: specialBundle.predictions.exactScores,
      },
      diagnostics
    );

    const sourceDiagnostics: SourceDiagnostics = {
      availability,
      reliabilityWeights: { ...this.config.sourceReliability },
      markets: diagnostics,
      overallConsensus,
    };

    return {
      matchResult: matchResultBundle.result,
      goals: goalsBundle.result,
      bothTeamsScore: bttsBundle.result,
      firstHalf: {
        result: firstHalfBundle.result,
        goals: firstHalfBundle.goals,
      },
      specialMarkets: specialBundle.predictions,
      confidence: confidenceSummary,
      bankoSelections,
      diagnostics: sourceDiagnostics,
    };
  }

  private resolveAvailability(input: EnsembleInput): SourceAvailability {
    const base: SourceAvailability = {
      apiFootball: Boolean(input.apiFootball),
      basicEngine: Boolean(input.basicPrediction),
      advancedEngine: Boolean(input.advancedPrediction),
    };

    if (input.availability) {
      SOURCE_KEYS.forEach(key => {
        if (input.availability && key in input.availability && input.availability[key] !== undefined) {
          base[key] = Boolean(input.availability[key]);
        }
      });
    }

    return base;
  }

  private combineMatchResult(
    input: EnsembleInput,
    availability: SourceAvailability
  ): {
    result: MatchResultPrediction;
    diagnostic: MarketDiagnostic;
  } {
    const distributions: ProbabilitySet[] = [];
    const sourceOrder: SourceKey[] = [];
    const confidences: Array<number | null> = [];
    const contributions: SourceContribution[] = [];
    const notes: string[] = [];

    const apiDistribution = this.extractApiMatchResult(input.apiFootball);
    if (availability.apiFootball && apiDistribution) {
      distributions.push(apiDistribution);
      sourceOrder.push('apiFootball');
      confidences.push(this.estimateDistributionConfidence(apiDistribution));
    } else if (!availability.apiFootball) {
      notes.push('AwaStats tahmini mevcut değil.');
    }

    const basicDistribution = this.extractBasicMatchResult(input.basicPrediction);
    if (availability.basicEngine && basicDistribution) {
      distributions.push(basicDistribution);
      sourceOrder.push('basicEngine');
      confidences.push(
        input.basicPrediction?.match_winner?.confidence ?? this.estimateDistributionConfidence(basicDistribution)
      );
    } else if (!availability.basicEngine) {
      notes.push('Temel motor tahmini mevcut değil.');
    }

    const advancedDistribution = this.extractAdvancedMatchResult(input.advancedPrediction);
    if (availability.advancedEngine && advancedDistribution) {
      distributions.push(advancedDistribution);
      sourceOrder.push('advancedEngine');
      const advancedConfidenceRaw = input.advancedPrediction?.match_result?.confidence;
      confidences.push(
        advancedConfidenceRaw !== undefined && advancedConfidenceRaw !== null
          ? this.normalizeConfidence(advancedConfidenceRaw)
          : this.estimateDistributionConfidence(advancedDistribution)
      );
    } else if (!availability.advancedEngine) {
      notes.push('Gelişmiş motor tahmini mevcut değil.');
    }

    if (!distributions.length) {
      const fallbackProbabilities = { home: 0.34, draw: 0.32, away: 0.34 };
      const fallbackConfidence = this.createConfidenceScore(0.4, [
        { factor: 'fallback', contribution: 0.4, note: 'Hiçbir kaynak bulunamadı, eşit dağılım kullanıldı.' },
      ]);
      return {
        result: {
          market: 'matchResult',
          probabilities: fallbackProbabilities,
          prediction: 'home',
          confidence: fallbackConfidence,
          expectedGoals: { home: null, away: null, total: null },
        },
        diagnostic: {
          market: 'matchResult',
          sourcesUsed: [],
          normalizedProbabilities: fallbackProbabilities,
          agreement: {
            market: 'matchResult',
            variance: 0,
            consensus: 0,
          },
          notes,
        },
      };
    }

    const confidencesBySource: Partial<Record<SourceKey, number>> = {};
    sourceOrder.forEach((source, index) => {
      const confidence = confidences[index];
      if (confidence !== null && confidence !== undefined) {
        confidencesBySource[source] = confidence;
      }
    });

    const resolvedWeights = this.resolveWeights('matchResult', availability, confidencesBySource);
    const weights: number[] = [];
    sourceOrder.forEach(source => {
      weights.push(resolvedWeights[source] ?? 0);
    });

    const combinedRaw = combineMultipleDistributions(distributions, weights, this.precision);
    const combined = this.ensureMatchProbabilitySet(combinedRaw);
    const prediction = this.resolveMatchResultPrediction(combined);

    const perOutcomeProbabilities = sourceOrder.map((source, index) => {
      const distribution = distributions[index];
      return distribution[prediction];
    });

    const variance = calculateVariance(perOutcomeProbabilities);
    const consensus = calculateConsensusScore(perOutcomeProbabilities);
    const spread = Math.max(...perOutcomeProbabilities) - Math.min(...perOutcomeProbabilities);

    let confidenceValue = this.computeBaseConfidence(weights, confidences);
    const breakdown: ConfidenceBreakdown[] = [
      { factor: 'weightedConfidence', contribution: roundToPrecision(confidenceValue, 4) },
      { factor: 'consensus', contribution: roundToPrecision(consensus, 4) },
    ];

    confidenceValue = (confidenceValue * 0.6) + (consensus * 0.4);

    if (spread <= this.config.confidenceAdjustments.highAgreementThreshold) {
      confidenceValue = applyAgreementBonus(confidenceValue, this.config.confidenceAdjustments.highAgreementBoost);
      breakdown.push({
        factor: 'agreementBonus',
        contribution: this.config.confidenceAdjustments.highAgreementBoost,
        note: 'Kaynaklar uyuşuyor',
      });
    } else if (spread >= this.config.confidenceAdjustments.significantDisagreementThreshold) {
      confidenceValue = applyDisagreementPenalty(
        confidenceValue,
        this.config.confidenceAdjustments.significantDisagreementUncertainty
      );
      breakdown.push({
        factor: 'disagreementPenalty',
        contribution: -this.config.confidenceAdjustments.significantDisagreementUncertainty,
        note: 'Kaynaklar belirgin şekilde ayrışıyor',
      });
    }

    const confidence = this.createConfidenceScore(confidenceValue, breakdown);

    const expectedGoals = this.estimateExpectedGoals(input);

    sourceOrder.forEach((source, index) => {
      contributions.push({
        source,
        weight: roundToPrecision(weights[index], 4),
        confidence: confidences[index] ?? null,
        contribution: distributions[index][prediction],
      });
    });

    const agreement: AgreementAnalysis = {
      market: 'matchResult',
      variance,
      consensus,
      disagreeingSources: identifyOutliers(perOutcomeProbabilities).map(index => sourceOrder[index]),
    };

    return {
      result: {
        market: 'matchResult',
        probabilities: combined,
        prediction,
        confidence,
        expectedGoals,
      },
      diagnostic: {
        market: 'matchResult',
        sourcesUsed: contributions,
        normalizedProbabilities: combined,
        agreement,
        notes: notes.length ? notes : undefined,
      },
    };
  }

  private combineOverUnderGoals(
    input: EnsembleInput,
    availability: SourceAvailability
  ): {
    result: GoalsPrediction;
    confidence: ConfidenceScore;
    diagnostic: MarketDiagnostic;
  } {
    const thresholds = [0.5, 1.5, 2.5, 3.5];
    const lines: GoalLinePrediction[] = [];
    const perMarketNotes: string[] = [];
    const sourceConfidences: Partial<Record<SourceKey, number>> = {};
    const agreementSamples: number[] = [];

    thresholds.forEach(threshold => {
      const perSourceOver: number[] = [];
      const perSourceWeightSources: SourceKey[] = [];
      const distributions: ProbabilitySet[] = [];

      const apiProbabilities = this.estimateGoalLineFromApi(input.apiFootball, threshold);
      if (availability.apiFootball && apiProbabilities) {
        perSourceOver.push(apiProbabilities.over);
        perSourceWeightSources.push('apiFootball');
        distributions.push({ over: apiProbabilities.over, under: apiProbabilities.under });
        sourceConfidences.apiFootball = Math.max(
          sourceConfidences.apiFootball ?? 0,
          Math.abs(apiProbabilities.over - 0.5) * 2
        );
      }

      const basicProbabilities = this.estimateGoalLineFromBasic(input.basicPrediction, threshold);
      if (availability.basicEngine && basicProbabilities) {
        perSourceOver.push(basicProbabilities.over);
        perSourceWeightSources.push('basicEngine');
        distributions.push({ over: basicProbabilities.over, under: basicProbabilities.under });
        sourceConfidences.basicEngine = Math.max(
          sourceConfidences.basicEngine ?? 0,
          input.basicPrediction?.over_under_goals?.confidence ?? Math.abs(basicProbabilities.over - 0.5) * 2
        );
      }

      const advancedProbabilities = this.estimateGoalLineFromAdvanced(input.advancedPrediction, threshold);
      if (availability.advancedEngine && advancedProbabilities) {
        perSourceOver.push(advancedProbabilities.over);
        perSourceWeightSources.push('advancedEngine');
        distributions.push({ over: advancedProbabilities.over, under: advancedProbabilities.under });
        const advConfidence = this.normalizeConfidence(
          input.advancedPrediction?.prediction_confidence ?? 60
        );
        sourceConfidences.advancedEngine = Math.max(
          sourceConfidences.advancedEngine ?? 0,
          advConfidence
        );
      }

      if (!distributions.length) {
        perMarketNotes.push(`Eşik ${threshold.toFixed(1)} için yeterli veri yok.`);
        return;
      }

      const weights = this.resolveWeights('overUnderGoals', availability, sourceConfidences);
      const weightArray = perSourceWeightSources.map(source => weights[source] ?? 0);
      const combined = combineMultipleDistributions(distributions, weightArray, this.precision);

      const recommendation = combined.over >= combined.under ? 'over' : 'under';
      const spread = Math.abs(combined.over - combined.under);
      agreementSamples.push(spread);

      const breakdown: ConfidenceBreakdown[] = [
        { factor: `threshold_${threshold}`, contribution: roundToPrecision(spread, 4) },
      ];

      let confidenceValue = (spread * 0.7) + (calculateConsensusScore(perSourceOver) * 0.3);
      if (spread <= this.config.confidenceAdjustments.highAgreementThreshold) {
        confidenceValue = applyAgreementBonus(confidenceValue, 0.05);
        breakdown.push({
          factor: 'agreementBonus',
          contribution: 0.05,
          note: 'Kaynaklar dengeli şekilde aynı tarafı destekliyor',
        });
      }

      lines.push({
        threshold,
        overProbability: roundToPrecision(combined.over, this.precision),
        underProbability: roundToPrecision(combined.under, this.precision),
        recommendation,
        confidence: this.createConfidenceScore(confidenceValue, breakdown),
      });
    });

    const validLines = lines.filter(line => isValidProbability(line.overProbability) && isValidProbability(line.underProbability));

    const expectedGoals = this.estimateExpectedTotalGoals(input, validLines);

    const consensus = validLines.length
      ? calculateConsensusScore(validLines.map(line => Math.abs(line.overProbability - 0.5)))
      : 0;

    const averagedConfidenceValue = validLines.length
      ? validLines.reduce((acc, line) => acc + line.confidence.value, 0) / validLines.length
      : 0.4;

    const overallConfidence = this.createConfidenceScore(averagedConfidenceValue, [
      { factor: 'linesAverage', contribution: roundToPrecision(averagedConfidenceValue, 4) },
      { factor: 'consensus', contribution: roundToPrecision(consensus, 4) },
    ]);

    return {
      result: {
        market: 'overUnderGoals',
        lines: validLines,
        expectedTotalGoals: expectedGoals,
      },
      confidence: overallConfidence,
      diagnostic: {
        market: 'overUnderGoals',
        sourcesUsed: this.buildSourceContributionSummary('overUnderGoals', availability, sourceConfidences),
        normalizedProbabilities: validLines.length
          ? {
              over: roundToPrecision(validLines.reduce((acc, line) => acc + line.overProbability, 0) / validLines.length, this.precision),
              under: roundToPrecision(validLines.reduce((acc, line) => acc + line.underProbability, 0) / validLines.length, this.precision),
            }
          : undefined,
        agreement: {
          market: 'overUnderGoals',
          variance: calculateVariance(agreementSamples),
          consensus,
        },
        notes: perMarketNotes.length ? perMarketNotes : undefined,
      },
    };
  }

  private combineBothTeamsScore(
    input: EnsembleInput,
    availability: SourceAvailability
  ): {
    result: BothTeamsScorePrediction;
    confidence: ConfidenceScore;
    diagnostic: MarketDiagnostic;
  } {
    const perSourceValues: Array<{ source: SourceKey; yes: number; no: number; confidence: number }>
      = [];

    if (availability.apiFootball) {
      const apiBtts = input.apiFootball?.predictions?.btts;
      if (apiBtts) {
        const yes = normalizePercentageString(apiBtts.yes ?? null) ?? this.estimateBttsFromApi(input.apiFootball);
        const no = normalizePercentageString(apiBtts.no ?? null);
        if (yes !== null && no !== null) {
          const normalized = sanitizeProbabilities({ yes, no });
          perSourceValues.push({
            source: 'apiFootball',
            yes: normalized.yes,
            no: normalized.no,
            confidence: Math.abs(normalized.yes - 0.5) * 2,
          });
        }
      }
    }

    if (availability.basicEngine && input.basicPrediction) {
      const yesProbability = input.basicPrediction.both_teams_score.prediction === 'yes'
        ? Math.max(0.5, input.basicPrediction.both_teams_score.confidence)
        : 1 - input.basicPrediction.both_teams_score.confidence;
      const noProbability = 1 - yesProbability;
      perSourceValues.push({
        source: 'basicEngine',
        yes: yesProbability,
        no: noProbability,
        confidence: input.basicPrediction.both_teams_score.confidence,
      });
    }

    if (availability.advancedEngine && input.advancedPrediction) {
      const yesPercentage = input.advancedPrediction.both_teams_score.probability;
      if (yesPercentage !== undefined) {
        const yes = this.normalizeConfidence(yesPercentage);
        const no = 1 - yes;
        perSourceValues.push({
          source: 'advancedEngine',
          yes,
          no,
          confidence: this.normalizeConfidence(input.advancedPrediction.prediction_confidence ?? 65),
        });
      }
    }

    if (!perSourceValues.length) {
      const placeholderConfidence = this.createConfidenceScore(0.35, [
        { factor: 'fallback', contribution: 0.35, note: 'İki kaynak bulunamadı, varsayılan dağılım döndürüldü.' },
      ]);
      return {
        result: {
          market: 'bothTeamsToScore',
          yesProbability: 0.5,
          noProbability: 0.5,
          prediction: 'yes',
          confidence: placeholderConfidence,
        },
        confidence: placeholderConfidence,
        diagnostic: {
          market: 'bothTeamsToScore',
          sourcesUsed: [],
          agreement: {
            market: 'bothTeamsToScore',
            variance: 0,
            consensus: 0,
          },
          notes: ['BTTS tahminleri için kaynak verisi bulunamadı.'],
        },
      };
    }

    const confidencesBySource: Partial<Record<SourceKey, number>> = {};
    perSourceValues.forEach(entry => {
      confidencesBySource[entry.source] = entry.confidence;
    });

    const weights = this.resolveWeights('bothTeamsToScore', availability, confidencesBySource);
    const weightArray = perSourceValues.map(entry => weights[entry.source] ?? 0);
    const combinedYes = calculateWeightedAverage(perSourceValues.map(entry => entry.yes), weightArray);
    const combinedNo = 1 - combinedYes;

    const consensus = calculateConsensusScore(perSourceValues.map(entry => entry.yes));
    let confidenceValue = calculateWeightedAverage(
      perSourceValues.map(entry => entry.confidence),
      weightArray
    );
    confidenceValue = (confidenceValue * 0.5) + (consensus * 0.5);

    const prediction = combinedYes >= combinedNo ? 'yes' : 'no';
    const confidence = this.createConfidenceScore(confidenceValue, [
      { factor: 'weightedConfidence', contribution: roundToPrecision(confidenceValue, 4) },
      { factor: 'consensus', contribution: roundToPrecision(consensus, 4) },
    ]);

    return {
      result: {
        market: 'bothTeamsToScore',
        yesProbability: roundToPrecision(combinedYes, this.precision),
        noProbability: roundToPrecision(combinedNo, this.precision),
        prediction,
        confidence,
      },
      confidence,
      diagnostic: {
        market: 'bothTeamsToScore',
        sourcesUsed: perSourceValues.map((entry, index) => ({
          source: entry.source,
          weight: roundToPrecision(weightArray[index], 4),
          confidence: entry.confidence,
          contribution: entry[prediction],
        })),
        normalizedProbabilities: {
          yes: roundToPrecision(combinedYes, this.precision),
          no: roundToPrecision(combinedNo, this.precision),
        },
        agreement: {
          market: 'bothTeamsToScore',
          variance: calculateVariance(perSourceValues.map(entry => entry.yes)),
          consensus,
        },
      },
    };
  }

  private combineFirstHalfPredictions(
    input: EnsembleInput,
    availability: SourceAvailability
  ): {
    result: FirstHalfResultPrediction;
    goals: FirstHalfGoalsPrediction;
    resultDiagnostic: MarketDiagnostic;
    goalsDiagnostic: MarketDiagnostic;
  } {
    const resultDistributions: ProbabilitySet[] = [];
    const resultSources: SourceKey[] = [];
    const resultConfidences: Array<number | null> = [];

    if (availability.apiFootball) {
      const apiFirstHalf = this.extractApiFirstHalfResult(input.apiFootball);
      if (apiFirstHalf) {
        resultDistributions.push(apiFirstHalf);
        resultSources.push('apiFootball');
        resultConfidences.push(this.estimateDistributionConfidence(apiFirstHalf));
      }
    }

    if (availability.basicEngine && input.basicPrediction) {
      const basicFirstHalf = this.extractBasicFirstHalfResult(input.basicPrediction);
      if (basicFirstHalf) {
        resultDistributions.push(basicFirstHalf);
        resultSources.push('basicEngine');
        resultConfidences.push(input.basicPrediction.first_half_goals.confidence);
      }
    }

    if (availability.advancedEngine && input.advancedPrediction) {
      const advancedFirstHalf = this.extractAdvancedFirstHalfResult(input.advancedPrediction);
      if (advancedFirstHalf) {
        resultDistributions.push(advancedFirstHalf);
        resultSources.push('advancedEngine');
        resultConfidences.push(
          this.normalizeConfidence(input.advancedPrediction.prediction_confidence ?? 0.6)
        );
      }
    }

    const resultWeights = this.resolveWeights('firstHalfResult', availability, Object.fromEntries(
      resultSources.map((source, index) => [source, resultConfidences[index] ?? 0.5])
    ) as Partial<Record<SourceKey, number>>);

    const resultWeightArray = resultSources.map(source => resultWeights[source] ?? 0);

    const combinedFirstHalfRaw = resultDistributions.length
      ? combineMultipleDistributions(resultDistributions, resultWeightArray, this.precision)
      : { home: 0.37, draw: 0.4, away: 0.23 };
    const combinedFirstHalf = this.ensureMatchProbabilitySet(combinedFirstHalfRaw);

    const firstHalfPrediction = this.resolveMatchResultPrediction(combinedFirstHalf);
    const firstHalfConsensus = resultDistributions.length
      ? calculateConsensusScore(resultDistributions.map(dist => dist[firstHalfPrediction]))
      : 0;
    let firstHalfConfidence = resultDistributions.length
      ? calculateWeightedAverage(resultConfidences.map(c => c ?? 0.5), resultWeightArray)
      : 0.35;
    firstHalfConfidence = (firstHalfConfidence * 0.6) + (firstHalfConsensus * 0.4);

    const firstHalfResult: FirstHalfResultPrediction = {
      market: 'firstHalfResult',
      probabilities: combinedFirstHalf,
      prediction: firstHalfPrediction,
      confidence: this.createConfidenceScore(firstHalfConfidence, [
        { factor: 'consensus', contribution: roundToPrecision(firstHalfConsensus, 4) },
      ]),
    };

    const goalsPrediction = this.combineFirstHalfGoals(input, availability);

    return {
      result: firstHalfResult,
      goals: goalsPrediction.prediction,
      resultDiagnostic: {
        market: 'firstHalfResult',
        sourcesUsed: resultSources.map((source, index) => ({
          source,
          weight: roundToPrecision(resultWeightArray[index], 4),
          confidence: resultConfidences[index] ?? null,
          contribution: resultDistributions[index]?.[firstHalfPrediction],
        })),
        normalizedProbabilities: combinedFirstHalf,
        agreement: {
          market: 'firstHalfResult',
          variance: calculateVariance(resultDistributions.map(dist => dist[firstHalfPrediction] ?? 0)),
          consensus: firstHalfConsensus,
        },
      },
      goalsDiagnostic: goalsPrediction.diagnostic,
    };
  }

  private combineFirstHalfGoals(
    input: EnsembleInput,
    availability: SourceAvailability
  ): {
    prediction: FirstHalfGoalsPrediction;
    diagnostic: MarketDiagnostic;
  } {
    const perSourceValues: Array<{ source: SourceKey; over05: number; over15: number; home: number; away: number; btts: number; confidence: number }>
      = [];

    if (availability.apiFootball) {
      const apiValues = this.estimateFirstHalfFromApi(input.apiFootball);
      if (apiValues) {
        perSourceValues.push({
          source: 'apiFootball',
          over05: apiValues.over05,
          over15: apiValues.over15,
          home: apiValues.home,
          away: apiValues.away,
          btts: apiValues.btts,
          confidence: apiValues.confidence,
        });
      }
    }

    if (availability.basicEngine && input.basicPrediction) {
      const firstHalf = input.basicPrediction.first_half_goals;
      perSourceValues.push({
        source: 'basicEngine',
        over05: firstHalf.over_0_5_probability,
        over15: firstHalf.over_1_5_probability,
        home: firstHalf.home_first_half_probability,
        away: firstHalf.away_first_half_probability,
        btts: firstHalf.prediction === 'yes' ? 0.6 : 0.4,
        confidence: firstHalf.confidence,
      });
    }

    if (availability.advancedEngine && input.advancedPrediction) {
      const advanced = input.advancedPrediction.first_half_goals;
      perSourceValues.push({
        source: 'advancedEngine',
        over05: this.normalizeConfidence(advanced.over_0_5.probability),
        over15: this.normalizeConfidence(advanced.over_1_5.probability),
        home: this.normalizeConfidence(advanced.home_team_score.probability),
        away: this.normalizeConfidence(advanced.away_team_score.probability),
        btts: this.normalizeConfidence(advanced.both_teams_score.probability),
        confidence: this.normalizeConfidence(input.advancedPrediction.prediction_confidence ?? 60),
      });
    }

    if (!perSourceValues.length) {
      const confidence = this.createConfidenceScore(0.3, [
        { factor: 'fallback', contribution: 0.3, note: 'İlk yarı verisi bulunamadı' },
      ]);
      return {
        prediction: {
          market: 'firstHalfGoals',
          over05: null,
          over15: null,
          homeScore: null,
          awayScore: null,
          bothTeamsScore: null,
          confidence,
        },
        diagnostic: {
          market: 'firstHalfGoals',
          sourcesUsed: [],
          agreement: {
            market: 'firstHalfGoals',
            variance: 0,
            consensus: 0,
          },
        },
      };
    }

    const confidencesBySource = Object.fromEntries(
      perSourceValues.map(entry => [entry.source, entry.confidence])
    ) as Partial<Record<SourceKey, number>>;
    const weights = this.resolveWeights('firstHalfResult', availability, confidencesBySource);
    const weightArray = perSourceValues.map(entry => weights[entry.source] ?? 0);

    const combined = {
      over05: calculateWeightedAverage(perSourceValues.map(entry => entry.over05), weightArray),
      over15: calculateWeightedAverage(perSourceValues.map(entry => entry.over15), weightArray),
      home: calculateWeightedAverage(perSourceValues.map(entry => entry.home), weightArray),
      away: calculateWeightedAverage(perSourceValues.map(entry => entry.away), weightArray),
      btts: calculateWeightedAverage(perSourceValues.map(entry => entry.btts), weightArray),
    };

    const consensus = calculateConsensusScore(perSourceValues.map(entry => entry.over05));
    const confidenceValue = (calculateWeightedAverage(perSourceValues.map(entry => entry.confidence), weightArray) * 0.6)
      + (consensus * 0.4);

    const prediction: FirstHalfGoalsPrediction = {
      market: 'firstHalfGoals',
      over05: roundToPrecision(combined.over05, this.precision),
      over15: roundToPrecision(combined.over15, this.precision),
      homeScore: roundToPrecision(combined.home, this.precision),
      awayScore: roundToPrecision(combined.away, this.precision),
      bothTeamsScore: roundToPrecision(combined.btts, this.precision),
      confidence: this.createConfidenceScore(confidenceValue, [
        { factor: 'consensus', contribution: roundToPrecision(consensus, 4) },
      ]),
    };

    return {
      prediction,
      diagnostic: {
        market: 'firstHalfGoals',
        sourcesUsed: perSourceValues.map((entry, index) => ({
          source: entry.source,
          weight: roundToPrecision(weightArray[index], 4),
          confidence: entry.confidence,
        })),
        agreement: {
          market: 'firstHalfGoals',
          variance: calculateVariance(perSourceValues.map(entry => entry.over05)),
          consensus,
        },
      },
    };
  }

  private combineSpecialMarkets(
    input: EnsembleInput,
    availability: SourceAvailability
  ): MarketDiagnosticsBundle {
    const diagnostics: MarketDiagnostic[] = [];

    const cards = this.combineCardsMarket(input, availability);
    diagnostics.push(cards.diagnostic);

    const corners = this.combineCornersMarket(input, availability);
    diagnostics.push(corners.diagnostic);

    const exactScores = this.combineExactScoreMarket(input, availability);
    diagnostics.push(exactScores.diagnostic);

    return {
      diagnostics,
      cardsConfidence: cards.prediction?.confidence,
      cornersConfidence: corners.prediction?.confidence,
      exactScoreConfidence: exactScores.prediction?.confidence,
      predictions: {
        cards: cards.prediction ?? undefined,
        corners: corners.prediction ?? undefined,
        exactScores: exactScores.prediction?.scores,
      },
    };
  }

  private combineCardsMarket(
    input: EnsembleInput,
    availability: SourceAvailability
  ): {
    prediction: CardsPrediction | null;
    diagnostic: MarketDiagnostic;
  } {
    const perSourceValues: Array<{ source: SourceKey; over35: number; over45: number; under35: number; under45: number; confidence: number }>
      = [];

    if (availability.apiFootball) {
      const apiValue = this.estimateCardsFromApi(input.apiFootball);
      if (apiValue) {
        perSourceValues.push(apiValue);
      }
    }

    if (availability.basicEngine) {
      const basicValue = this.estimateCardsFromBasic();
      if (basicValue) {
        perSourceValues.push(basicValue);
      }
    }

    if (availability.advancedEngine && input.advancedPrediction) {
      const cards = input.advancedPrediction.cards;
      if (cards) {
        perSourceValues.push({
          source: 'advancedEngine',
          over35: this.normalizeConfidence(cards.total_over_3_5),
          over45: this.normalizeConfidence(cards.total_over_4_5),
          under35: this.normalizeConfidence(cards.total_under_3_5),
          under45: this.normalizeConfidence(cards.total_under_4_5),
          confidence: this.normalizeConfidence(input.advancedPrediction.prediction_confidence ?? 70),
        });
      }
    }

    if (!perSourceValues.length) {
      return {
        prediction: null,
        diagnostic: {
          market: 'cards',
          sourcesUsed: [],
          notes: ['Kart piyasası için veri bulunamadı.'],
          agreement: {
            market: 'cards',
            variance: 0,
            consensus: 0,
          },
        },
      };
    }

    const confidences = Object.fromEntries(perSourceValues.map(entry => [entry.source, entry.confidence])) as Partial<Record<SourceKey, number>>;
    const weights = this.resolveWeights('cards', availability, confidences);
    const weightArray = perSourceValues.map(entry => weights[entry.source] ?? 0);

    const combined = {
      over35: calculateWeightedAverage(perSourceValues.map(entry => entry.over35), weightArray),
      over45: calculateWeightedAverage(perSourceValues.map(entry => entry.over45), weightArray),
      under35: calculateWeightedAverage(perSourceValues.map(entry => entry.under35), weightArray),
      under45: calculateWeightedAverage(perSourceValues.map(entry => entry.under45), weightArray),
    };

    const consensus = calculateConsensusScore(perSourceValues.map(entry => entry.over35));
    const confidenceValue = (calculateWeightedAverage(perSourceValues.map(entry => entry.confidence), weightArray) * 0.5)
      + (consensus * 0.5);

    const prediction: CardsPrediction = {
      over35: roundToPrecision(combined.over35, this.precision),
      over45: roundToPrecision(combined.over45, this.precision),
      under35: roundToPrecision(combined.under35, this.precision),
      under45: roundToPrecision(combined.under45, this.precision),
      confidence: this.createConfidenceScore(confidenceValue, [
        { factor: 'consensus', contribution: roundToPrecision(consensus, 4) },
      ]),
    };

    return {
      prediction,
      diagnostic: {
        market: 'cards',
        sourcesUsed: perSourceValues.map((entry, index) => ({
          source: entry.source,
          weight: roundToPrecision(weightArray[index], 4),
          confidence: entry.confidence,
        })),
        agreement: {
          market: 'cards',
          variance: calculateVariance(perSourceValues.map(entry => entry.over35)),
          consensus,
        },
      },
    };
  }

  private combineCornersMarket(
    input: EnsembleInput,
    availability: SourceAvailability
  ): {
    prediction: CornersPrediction | null;
    diagnostic: MarketDiagnostic;
  } {
    const perSourceValues: Array<{ source: SourceKey; over85: number; over95: number; under85: number; under95: number; confidence: number }>
      = [];

    if (availability.apiFootball) {
      const apiValue = this.estimateCornersFromApi(input.apiFootball);
      if (apiValue) {
        perSourceValues.push(apiValue);
      }
    }

    if (availability.basicEngine) {
      const basicValue = this.estimateCornersFromBasic();
      if (basicValue) {
        perSourceValues.push(basicValue);
      }
    }

    if (availability.advancedEngine && input.advancedPrediction) {
      const corners = input.advancedPrediction.corners;
      if (corners) {
        perSourceValues.push({
          source: 'advancedEngine',
          over85: this.normalizeConfidence(corners.total_over_8_5),
          over95: this.normalizeConfidence(corners.total_over_9_5),
          under85: this.normalizeConfidence(corners.total_under_8_5),
          under95: this.normalizeConfidence(corners.total_under_9_5),
          confidence: this.normalizeConfidence(input.advancedPrediction.prediction_confidence ?? 65),
        });
      }
    }

    if (!perSourceValues.length) {
      return {
        prediction: null,
        diagnostic: {
          market: 'corners',
          sourcesUsed: [],
          notes: ['Korner piyasası için veri bulunamadı.'],
          agreement: {
            market: 'corners',
            variance: 0,
            consensus: 0,
          },
        },
      };
    }

    const confidences = Object.fromEntries(perSourceValues.map(entry => [entry.source, entry.confidence])) as Partial<Record<SourceKey, number>>;
    const weights = this.resolveWeights('corners', availability, confidences);
    const weightArray = perSourceValues.map(entry => weights[entry.source] ?? 0);

    const combined = {
      over85: calculateWeightedAverage(perSourceValues.map(entry => entry.over85), weightArray),
      over95: calculateWeightedAverage(perSourceValues.map(entry => entry.over95), weightArray),
      under85: calculateWeightedAverage(perSourceValues.map(entry => entry.under85), weightArray),
      under95: calculateWeightedAverage(perSourceValues.map(entry => entry.under95), weightArray),
    };

    const consensus = calculateConsensusScore(perSourceValues.map(entry => entry.over85));
    const confidenceValue = (calculateWeightedAverage(perSourceValues.map(entry => entry.confidence), weightArray) * 0.5)
      + (consensus * 0.5);

    const prediction: CornersPrediction = {
      over85: roundToPrecision(combined.over85, this.precision),
      over95: roundToPrecision(combined.over95, this.precision),
      under85: roundToPrecision(combined.under85, this.precision),
      under95: roundToPrecision(combined.under95, this.precision),
      confidence: this.createConfidenceScore(confidenceValue, [
        { factor: 'consensus', contribution: roundToPrecision(consensus, 4) },
      ]),
    };

    return {
      prediction,
      diagnostic: {
        market: 'corners',
        sourcesUsed: perSourceValues.map((entry, index) => ({
          source: entry.source,
          weight: roundToPrecision(weightArray[index], 4),
          confidence: entry.confidence,
        })),
        agreement: {
          market: 'corners',
          variance: calculateVariance(perSourceValues.map(entry => entry.over85)),
          consensus,
        },
      },
    };
  }

  private combineExactScoreMarket(
    input: EnsembleInput,
    availability: SourceAvailability
  ): {
    prediction: { scores: ExactScorePrediction[]; confidence: ConfidenceScore } | null;
    diagnostic: MarketDiagnostic;
  } {
    const scores: ExactScorePrediction[] = [];
    const notes: string[] = [];

    if (availability.advancedEngine && input.advancedPrediction) {
      input.advancedPrediction.exact_scores?.slice(0, 5).forEach(score => {
        if (score && typeof score.probability === 'number') {
          const probability = this.normalizeConfidence(score.probability);
          scores.push({
            score: score.score,
            probability,
            confidence: this.createConfidenceScore(
              Math.max(0.4, probability),
              [{ factor: 'advancedEngine', contribution: probability }]
            ),
          });
        }
      });
    }

    if (availability.apiFootball && input.apiFootball?.predictions?.correct_score) {
      if (hasRequiredFields<{ home: string; away: string }>(input.apiFootball.predictions.correct_score, ['home', 'away'])) {
        notes.push('AwaStats doğru skor önerileri desteklenmiyor, gelişmiş motor verisi kullanıldı.');
      }
    }

    if (!scores.length) {
      return {
        prediction: null,
        diagnostic: {
          market: 'exactScore',
          sourcesUsed: [],
          notes: ['Doğru skor önerileri için veri bulunamadı.'],
          agreement: {
            market: 'exactScore',
            variance: 0,
            consensus: 0,
          },
        },
      };
    }

    const confidenceValue = scores.reduce((acc, score) => acc + score.confidence.value, 0) / scores.length;
    const consensus = calculateConsensusScore(scores.map(score => score.probability));

    const aggregatedConfidence = this.createConfidenceScore(confidenceValue, [
      { factor: 'scoresAverage', contribution: roundToPrecision(confidenceValue, 4) },
      { factor: 'consensus', contribution: roundToPrecision(consensus, 4) },
    ]);

    return {
      prediction: {
        scores,
        confidence: aggregatedConfidence,
      },
      diagnostic: {
        market: 'exactScore',
        sourcesUsed: scores.map(score => ({
          source: 'advancedEngine',
          weight: 1 / scores.length,
          confidence: score.confidence.value,
          contribution: score.probability,
        })),
        agreement: {
          market: 'exactScore',
          variance: calculateVariance(scores.map(score => score.probability)),
          consensus,
        },
        notes: notes.length ? notes : undefined,
      },
    };
  }

  private calculateOverallConsensus(diagnostics: MarketDiagnostic[]): number {
    const consensuses = diagnostics
      .map(diag => diag.agreement?.consensus)
      .filter((value): value is number => value !== undefined && value !== null);

    if (!consensuses.length) {
      return 0;
    }

    return roundToPrecision(
      consensuses.reduce((acc, value) => acc + value, 0) / consensuses.length,
      this.precision
    );
  }

  private buildConfidenceSummary(confidenceMap: Partial<Record<MarketType, ConfidenceScore | undefined>>): ConfidenceSummary {
    const breakdown: Record<MarketType, ConfidenceScore> = {
      matchResult: confidenceMap.matchResult ?? this.createConfidenceScore(0.4),
      overUnderGoals: confidenceMap.overUnderGoals ?? this.createConfidenceScore(0.4),
      bothTeamsToScore: confidenceMap.bothTeamsToScore ?? this.createConfidenceScore(0.4),
      firstHalfResult: confidenceMap.firstHalfResult ?? this.createConfidenceScore(0.35),
      firstHalfGoals: confidenceMap.firstHalfGoals ?? this.createConfidenceScore(0.35),
      cards: confidenceMap.cards ?? this.createConfidenceScore(0.3),
      corners: confidenceMap.corners ?? this.createConfidenceScore(0.3),
      exactScore: confidenceMap.exactScore ?? this.createConfidenceScore(0.25),
    };

    const values = Object.values(breakdown).map(entry => entry.value);
    const overallAverage = values.reduce((acc, curr) => acc + curr, 0) / values.length;

    return {
      overall: this.createConfidenceScore(overallAverage, [
        { factor: 'aggregate', contribution: roundToPrecision(overallAverage, 4) },
      ]),
      marketBreakdown: breakdown,
    };
  }

  private selectBankoPredictions(
    predictions: {
      matchResult: MatchResultPrediction;
      goals: GoalsPrediction;
      bothTeamsScore: BothTeamsScorePrediction;
      firstHalfResult: FirstHalfResultPrediction;
      firstHalfGoals: FirstHalfGoalsPrediction;
      cards?: CardsPrediction;
      corners?: CornersPrediction;
      exactScores?: ExactScorePrediction[];
    },
    diagnostics: MarketDiagnostic[]
  ): BankoSelection[] {
    const selections: BankoSelection[] = [];
    const criteria = this.config.bankoCriteria;

    const evaluate = (
      market: MarketType,
      label: string,
      probability: number,
      confidence: ConfidenceScore,
      rationale: string[]
    ) => {
      const override = criteria.marketOverrides?.[market];
      const minimumConfidence = override?.minimumConfidence ?? criteria.minimumConfidence;
      const agreementWindow = override?.agreementWindow ?? criteria.agreementWindow;
      const requiredSources = override?.requiredSources ?? criteria.requiredSources;
      const advancedMinimum = override?.advancedEngineMinimum ?? criteria.advancedEngineMinimum;

      if (confidence.value < minimumConfidence) {
        return;
      }

      const diagnostic = diagnostics.find(diag => diag.market === market);
      const consensus = diagnostic?.agreement?.consensus ?? 0;
      const spread = diagnostic && diagnostic.normalizedProbabilities
        ? Math.max(...Object.values(diagnostic.normalizedProbabilities))
          - Math.min(...Object.values(diagnostic.normalizedProbabilities))
        : 0;

      const activeSources = diagnostic?.sourcesUsed?.filter(entry => (entry.weight ?? 0) > 0.05).length ?? 0;
      if (activeSources < requiredSources) {
        return;
      }

      if (advancedMinimum > 0) {
        const advancedSource = diagnostic?.sourcesUsed?.find(entry => entry.source === 'advancedEngine');
        const advancedValue = advancedSource
          ? (advancedSource.contribution ?? advancedSource.confidence ?? advancedSource.weight)
          : 0;
        if (advancedValue < advancedMinimum) {
          return;
        }
      }

      if (consensus < (1 - agreementWindow) || spread > agreementWindow * 2) {
        return;
      }

      selections.push({
        market,
        label,
        confidence: roundToPrecision(confidence.value, 4),
        rationale,
      });
    };

    const matchResultOutcome = predictions.matchResult.prediction;
    const matchProbability = predictions.matchResult.probabilities[matchResultOutcome];
    evaluate(
      'matchResult',
      `Maç sonucu ${matchResultOutcome}`,
      matchProbability,
      predictions.matchResult.confidence,
      ['Maç sonucu piyasasında yüksek güven.', 'Kaynaklar arasında güçlü mutabakat.']
    );

    const bestGoalsLine = predictions.goals.lines.slice().sort((a, b) => b.confidence.value - a.confidence.value)[0];
    if (bestGoalsLine) {
      evaluate(
        'overUnderGoals',
        `${bestGoalsLine.recommendation === 'over' ? 'Üst' : 'Alt'} ${bestGoalsLine.threshold.toFixed(1)}`,
        bestGoalsLine.recommendation === 'over' ? bestGoalsLine.overProbability : bestGoalsLine.underProbability,
        bestGoalsLine.confidence,
        [`${bestGoalsLine.threshold.toFixed(1)} gol çizgisi için en yüksek güven.`]
      );
    }

    evaluate(
      'bothTeamsToScore',
      predictions.bothTeamsScore.prediction === 'yes' ? 'İki takım da gol atar' : 'BTTS: Hayır',
      predictions.bothTeamsScore.prediction === 'yes'
        ? predictions.bothTeamsScore.yesProbability
        : predictions.bothTeamsScore.noProbability,
      predictions.bothTeamsScore.confidence,
      ['BTTS piyasasında güven skoru kriterleri karşılıyor.']
    );

    if (predictions.cards) {
      const cardsProbability = Math.max(predictions.cards.over35 ?? 0, predictions.cards.over45 ?? 0);
      evaluate(
        'cards',
        cardsProbability === (predictions.cards.over35 ?? 0) ? 'Kart üst 3.5' : 'Kart üst 4.5',
        cardsProbability,
        predictions.cards.confidence,
        ['Kart piyasası ağırlıklı olarak gelişmiş motor tarafından destekleniyor.']
      );
    }

    return selections;
  }

  private resolveWeights(
    market: MarketType,
    availability: SourceAvailability,
    confidences: Partial<Record<SourceKey, number>>
  ): Record<SourceKey, number> {
    const marketConfig = this.config.markets[market] ?? null;
    let weights: SourceWeightConfig = {
      ...this.config.sourceReliability,
      ...(marketConfig?.weights ?? {}),
    };

    if (!availability.apiFootball && availability.basicEngine && availability.advancedEngine) {
      weights = {
        ...weights,
        ...(this.config.fallbacks.whenApiFootballMissing ?? {}),
      };
    }

    if (!availability.advancedEngine && availability.apiFootball && availability.basicEngine) {
      weights = {
        ...weights,
        ...(this.config.fallbacks.whenAdvancedEngineMissing ?? {}),
      };
    }

    if (!availability.basicEngine && availability.apiFootball && availability.advancedEngine) {
      weights = {
        ...weights,
        ...(this.config.fallbacks.whenBasicEngineMissing ?? {}),
      };
    }

    const availableSources = SOURCE_KEYS.filter(source => availability[source]);
    if (!availableSources.length) {
      return { apiFootball: 0, basicEngine: 0, advancedEngine: 0 };
    }

    const weightArray = availableSources.map(source => weights[source] ?? 0);
    const confidenceArray = availableSources.map(source => confidences[source] ?? null);

    const adjusted = applyConfidenceWeighting(
      weightArray,
      confidenceArray,
      this.config.confidenceAdjustments.lowConfidenceThreshold,
      this.config.confidenceAdjustments.lowConfidenceWeightPenalty
    );

    const result: Record<SourceKey, number> = { apiFootball: 0, basicEngine: 0, advancedEngine: 0 };
    availableSources.forEach((source, index) => {
      result[source] = roundToPrecision(adjusted[index], 4);
    });

    return result;
  }

  private resolveMatchResultPrediction(probabilities: ProbabilitySet): 'home' | 'draw' | 'away' {
    const entries = Object.entries(probabilities);
    if (!entries.length) {
      return 'home';
    }
    entries.sort((a, b) => b[1] - a[1]);
    const winner = entries[0][0];
    if (winner === 'home' || winner === 'away' || winner === 'draw') {
      return winner;
    }
    return 'home';
  }

  private estimateDistributionConfidence(distribution: ProbabilitySet): number {
    const values = Object.values(distribution);
    if (!values.length) {
      return 0;
    }
    const sorted = [...values].sort((a, b) => b - a);
    const spread = sorted[0] - (sorted[1] ?? 0);
    return Math.max(0.3, Math.min(0.95, spread));
  }

  private estimateExpectedGoals(input: EnsembleInput): { home: number | null; away: number | null; total: number | null } {
    const apiGoals = this.parseMaybeNumber(input.apiFootball?.predictions?.goals?.home);
    const apiGoalsAway = this.parseMaybeNumber(input.apiFootball?.predictions?.goals?.away);
    const apiTotal = this.parseMaybeNumber(input.apiFootball?.predictions?.goals?.total);

    const basicExpected = input.basicPrediction?.factors?.goal_analysis;
    const advanced = input.advancedPrediction;

    const home = apiGoals ?? basicExpected?.home_avg_goals_for ?? (advanced ? this.estimateExpectedFromAdvanced(advanced.home_team_goals) : null);
    const away = apiGoalsAway ?? basicExpected?.away_avg_goals_for ?? (advanced ? this.estimateExpectedFromAdvanced(advanced.away_team_goals) : null);

    const total = apiTotal ?? (home !== null && away !== null ? home + away : null);

    return {
      home: home !== null ? roundToPrecision(home, 2) : null,
      away: away !== null ? roundToPrecision(away, 2) : null,
      total: total !== null ? roundToPrecision(total, 2) : null,
    };
  }

  private estimateExpectedFromAdvanced(goalMarket: { over_0_5: number; over_1_5: number; over_2_5: number } | undefined): number | null {
    if (!goalMarket) {
      return null;
    }
    const over05 = this.normalizeConfidence(goalMarket.over_0_5);
    const over15 = this.normalizeConfidence(goalMarket.over_1_5);
    const over25 = this.normalizeConfidence(goalMarket.over_2_5);
    const expectedGoals = (over05 * 0.7) + (over15 * 1.4) + (over25 * 2.1);
    return expectedGoals;
  }

  private estimateGoalLineFromApi(api: EnsembleInput['apiFootball'], threshold: number): { over: number; under: number } | null {
    if (!api) {
      return null;
    }
    const totalGoals = this.parseMaybeNumber(api.predictions?.goals?.total);
    if (totalGoals === null) {
      return null;
    }
    const differential = totalGoals - threshold;
    const over = logisticFunction(differential);
    const under = 1 - over;
    return { over, under };
  }

  private estimateGoalLineFromBasic(basic: EnsembleInput['basicPrediction'], threshold: number): { over: number; under: number } | null {
    if (!basic) {
      return null;
    }
    const { over_under_goals: overUnder } = basic;
    if (!overUnder || overUnder.threshold !== threshold) {
      return null;
    }
    const confidence = Math.max(0.5, overUnder.confidence ?? 0.5);
    return overUnder.prediction === 'over'
      ? { over: confidence, under: 1 - confidence }
      : { over: 1 - confidence, under: confidence };
  }

  private estimateGoalLineFromAdvanced(
    advanced: EnsembleInput['advancedPrediction'],
    threshold: number
  ): { over: number; under: number } | null {
    if (!advanced) {
      return null;
    }
    const map: Record<string, { over?: number; under?: number }> = {
      '0.5': {
        over: advanced.total_goals.over_0_5?.probability,
        under: advanced.total_goals.under_0_5?.probability,
      },
      '1.5': {
        over: advanced.total_goals.over_1_5?.probability,
        under: advanced.total_goals.under_1_5?.probability,
      },
      '2.5': {
        over: advanced.total_goals.over_2_5?.probability,
        under: advanced.total_goals.under_2_5?.probability,
      },
      '3.5': {
        over: advanced.total_goals.over_3_5?.probability,
        under: advanced.total_goals.under_3_5?.probability,
      },
    };

    const entry = map[threshold.toFixed(1)];
    if (!entry) {
      return null;
    }
    const over = entry.over !== undefined ? this.normalizeConfidence(entry.over) : null;
    const under = entry.under !== undefined ? this.normalizeConfidence(entry.under) : null;
    if (over === null || under === null) {
      return null;
    }
    return { over, under };
  }

  private estimateBttsFromApi(api: EnsembleInput['apiFootball']): number {
    if (!api) {
      return 0.5;
    }
    const homeGoals = this.parseMaybeNumber(api.predictions?.goals?.home) ?? 1;
    const awayGoals = this.parseMaybeNumber(api.predictions?.goals?.away) ?? 1;
    const bttsProbability = 1 - poissonProbability(0, homeGoals) * poissonProbability(0, awayGoals);
    return Math.max(0.2, Math.min(0.9, bttsProbability));
  }

  private extractApiMatchResult(api: EnsembleInput['apiFootball']): ProbabilitySet | null {
    if (!api) {
      return null;
    }
    const percent = api.predictions?.percent;
    if (!percent) {
      return null;
    }
    const home = normalizePercentageString(percent.home ?? null);
    const draw = normalizePercentageString(percent.draw ?? null);
    const away = normalizePercentageString(percent.away ?? null);

    if (home === null || draw === null || away === null) {
      return null;
    }

    return sanitizeProbabilities({ home, draw, away }, this.precision);
  }

  private extractBasicMatchResult(basic: EnsembleInput['basicPrediction']): ProbabilitySet | null {
    if (!basic?.match_winner) {
      return null;
    }
    const { home_probability: home, draw_probability: draw, away_probability: away } = basic.match_winner;
    return sanitizeProbabilities({ home, draw, away }, this.precision);
  }

  private extractAdvancedMatchResult(advanced: EnsembleInput['advancedPrediction']): ProbabilitySet | null {
    if (!advanced?.match_result) {
      return null;
    }
    const home = this.normalizeConfidence(advanced.match_result.home_win.probability);
    const draw = this.normalizeConfidence(advanced.match_result.draw.probability);
    const away = this.normalizeConfidence(advanced.match_result.away_win.probability);
    return sanitizeProbabilities({ home, draw, away }, this.precision);
  }

  private extractApiFirstHalfResult(api: EnsembleInput['apiFootball']): ProbabilitySet | null {
    if (!api?.comparison?.form) {
      return null;
    }
    const homeForm = this.parseMaybeNumber(api.comparison.form.home);
    const awayForm = this.parseMaybeNumber(api.comparison.form.away);
    if (homeForm === null || awayForm === null) {
      return null;
    }
    const home = logisticFunction((homeForm - awayForm) / 20);
    const away = logisticFunction((awayForm - homeForm) / 20);
    const draw = Math.max(0.1, 1 - home - away);
    return normalizeProbabilitySet({ home, draw, away }, this.precision);
  }

  private extractBasicFirstHalfResult(basic: EnsembleInput['basicPrediction']): ProbabilitySet | null {
    if (!basic?.first_half_goals) {
      return null;
    }
    const { home_first_half_probability: home, away_first_half_probability: away } = basic.first_half_goals;
    const over05 = basic.first_half_goals.over_0_5_probability;
    const draw = Math.max(0, Math.min(1, over05 - home - away + 0.2));
    return normalizeProbabilitySet({ home, draw, away }, this.precision);
  }

  private extractAdvancedFirstHalfResult(advanced: EnsembleInput['advancedPrediction']): ProbabilitySet | null {
    if (!advanced?.halftime_result) {
      return null;
    }
    const home = this.normalizeConfidence(advanced.halftime_result.home_win);
    const draw = this.normalizeConfidence(advanced.halftime_result.draw);
    const away = this.normalizeConfidence(advanced.halftime_result.away_win);
    return sanitizeProbabilities({ home, draw, away }, this.precision);
  }

  private estimateFirstHalfFromApi(api: EnsembleInput['apiFootball']):
    | { over05: number; over15: number; home: number; away: number; btts: number; confidence: number }
    | null {
    if (!api) {
      return null;
    }
    const totalGoals = this.parseMaybeNumber(api.predictions?.goals?.total);
    if (totalGoals === null) {
      return null;
    }
    const firstHalfFactor = 0.45;
    const expectedFirstHalfGoals = totalGoals * firstHalfFactor;
    const over05 = 1 - Math.exp(-expectedFirstHalfGoals);
    const over15 = 1 - Math.exp(-expectedFirstHalfGoals) * (1 + expectedFirstHalfGoals);
    const home = this.parseMaybeNumber(api.predictions?.goals?.home) ?? expectedFirstHalfGoals / 2;
    const away = this.parseMaybeNumber(api.predictions?.goals?.away) ?? expectedFirstHalfGoals / 2;
    const btts = 1 - poissonProbability(0, home * firstHalfFactor) * poissonProbability(0, away * firstHalfFactor);
    return {
      over05,
      over15,
      home: Math.max(0, Math.min(1, home * firstHalfFactor)),
      away: Math.max(0, Math.min(1, away * firstHalfFactor)),
      btts: Math.max(0, Math.min(1, btts)),
      confidence: Math.max(0.4, Math.min(0.75, over05)),
    };
  }

  private estimateCardsFromApi(api: EnsembleInput['apiFootball']): {
    source: SourceKey;
    over35: number;
    over45: number;
    under35: number;
    under45: number;
    confidence: number;
  } | null {
    if (!api?.teams) {
      return null;
    }
    const homeCards = this.parseMaybeNumber(api.teams.home?.cards_per_game?.yellow) ?? 2.2;
    const awayCards = this.parseMaybeNumber(api.teams.away?.cards_per_game?.yellow) ?? 2.1;
    const total = homeCards + awayCards;
    const over35 = logisticFunction(total - 3.5);
    const over45 = logisticFunction(total - 4.5);
    const under35 = 1 - over35;
    const under45 = 1 - over45;
    const confidence = Math.max(0.4, Math.min(0.75, Math.abs(over35 - 0.5) * 2));
    return {
      source: 'apiFootball',
      over35,
      over45,
      under35,
      under45,
      confidence,
    };
  }

  private estimateCardsFromBasic(): {
    source: SourceKey;
    over35: number;
    over45: number;
    under35: number;
    under45: number;
    confidence: number;
  } | null {
    const baseOver35 = 0.55;
    const over45 = 0.45;
    const under35 = 1 - baseOver35;
    const under45 = 1 - over45;
    return {
      source: 'basicEngine',
      over35: baseOver35,
      over45,
      under35,
      under45,
      confidence: 0.45,
    };
  }

  private estimateCornersFromApi(api: EnsembleInput['apiFootball']): {
    source: SourceKey;
    over85: number;
    over95: number;
    under85: number;
    under95: number;
    confidence: number;
  } | null {
    if (!api?.comparison?.att) {
      return null;
    }
    const homeAttack = this.parseMaybeNumber(api.comparison.att.home) ?? 55;
    const awayAttack = this.parseMaybeNumber(api.comparison.att.away) ?? 52;
    const total = (homeAttack + awayAttack) / 10;
    const over85 = logisticFunction((total - 8.5) / 1.5);
    const over95 = logisticFunction((total - 9.5) / 1.5);
    const under85 = 1 - over85;
    const under95 = 1 - over95;
    const confidence = Math.max(0.4, Math.min(0.7, Math.abs(over85 - 0.5) * 1.6));
    return {
      source: 'apiFootball',
      over85,
      over95,
      under85,
      under95,
      confidence,
    };
  }

  private estimateCornersFromBasic(): {
    source: SourceKey;
    over85: number;
    over95: number;
    under85: number;
    under95: number;
    confidence: number;
  } | null {
    const baseOver85 = 0.48;
    const over95 = 0.42;
    return {
      source: 'basicEngine',
      over85: baseOver85,
      over95,
      under85: 1 - baseOver85,
      under95: 1 - over95,
      confidence: 0.4,
    };
  }

  private estimateExpectedTotalGoals(
    input: EnsembleInput,
    lines: GoalLinePrediction[]
  ): number | null {
    const apiTotal = this.parseMaybeNumber(input.apiFootball?.predictions?.goals?.total);
    if (apiTotal !== null) {
      return roundToPrecision(apiTotal, 2);
    }
    if (!lines.length) {
      return null;
    }
    const weighted = lines.reduce((acc, line) => {
      const implied = line.threshold + (line.overProbability - line.underProbability);
      return acc + implied;
    }, 0) / lines.length;
    return roundToPrecision(weighted, 2);
  }

  private buildSourceContributionSummary(
    market: MarketType,
    availability: SourceAvailability,
    confidences: Partial<Record<SourceKey, number>>
  ): SourceContribution[] {
    const weights = this.resolveWeights(market, availability, confidences);
    return SOURCE_KEYS.filter(source => availability[source]).map(source => ({
      source,
      weight: weights[source] ?? 0,
      confidence: confidences[source] ?? null,
    }));
  }

  private computeBaseConfidence(weights: number[], confidences: Array<number | null>): number {
    if (!weights.length) {
      return 0.4;
    }
    const normalized = normalizeProbabilitySet(weights) as number[];
    const values = confidences.map((confidence, index) => {
      if (confidence === null || confidence === undefined) {
        return 0.5;
      }
      return Math.max(0, Math.min(1, confidence));
    });
    return calculateWeightedAverage(values, normalized);
  }

  private normalizeConfidence(value: number): number {
    if (!Number.isFinite(value)) {
      return 0.5;
    }
    return Math.max(0, Math.min(1, value > 1 ? value / 100 : value));
  }

  private parseMaybeNumber(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        return null;
      }
      return value;
    }
    const cleaned = value.replace('%', '').replace(',', '.');
    const parsed = parseFloat(cleaned);
    return Number.isNaN(parsed) ? null : parsed;
  }

  private ensureMatchProbabilitySet(probabilities: ProbabilitySet): { home: number; draw: number; away: number } {
    const sanitized = sanitizeProbabilities(
      {
        home: probabilities.home ?? 0,
        draw: probabilities.draw ?? 0,
        away: probabilities.away ?? 0,
      },
      this.precision
    );
    return {
      home: roundToPrecision(sanitized.home ?? 0, this.precision),
      draw: roundToPrecision(sanitized.draw ?? 0, this.precision),
      away: roundToPrecision(sanitized.away ?? 0, this.precision),
    };
  }

  private createConfidenceScore(value: number, breakdown: ConfidenceBreakdown[] = []): ConfidenceScore {
    const normalized = Math.max(0, Math.min(1, value));
    let label: ConfidenceScore['label'] = 'low';
    if (normalized >= 0.75) {
      label = 'high';
    } else if (normalized >= 0.55) {
      label = 'medium';
    }
    return {
      value: roundToPrecision(normalized, 4),
      label,
      breakdown: breakdown.length ? breakdown : undefined,
    };
  }
}
