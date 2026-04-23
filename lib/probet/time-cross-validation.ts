/**
 * Time-Based Sliding Cross-Validation
 *
 * Walk-forward validation that respects temporal order — no shuffling.
 * This is critical for time-series problems like sports prediction:
 * if you shuffle, you train on the future and test on the past, which
 * gives wildly optimistic accuracy that doesn't generalize.
 *
 * Mimics ProphitBet's sliding_cross_validation method.
 *
 * Reference:
 *   ProphitBet/src/models/trainer.py — sliding_cross_validation
 */

import {
  trainEnsemble,
  predictEnsemble,
  type EnsembleState,
} from './gradient-boost';

export interface FoldMetrics {
  fold: number;
  trainSize: number;
  evalSize: number;
  accuracy: number;
  logLoss: number;
  brierScore: number;
}

export interface CVResult {
  foldsMetrics: FoldMetrics[];
  meanAccuracy: number;
  meanLogLoss: number;
  meanBrierScore: number;
  finalModel: EnsembleState;
}

/**
 * Run a sliding (walk-forward) cross-validation.
 *
 * Fold 1: train [0..N/k] → test [N/k..2N/k]
 * Fold 2: train [0..2N/k] → test [2N/k..3N/k]
 * ...
 * Final model is trained on the entire history.
 *
 * @param X full feature matrix (chronologically ordered)
 * @param y full labels (chronologically ordered)
 * @param k number of folds
 */
export function slidingCrossValidation(
  X: number[][],
  y: number[],
  k: number = 5
): CVResult {
  const n = X.length;
  if (n < k * 4) {
    // Not enough data for sliding CV — fall back to a single fit/eval split.
    const split = Math.floor(n * 0.8);
    const trainX = X.slice(0, split);
    const trainY = y.slice(0, split);
    const evalX = X.slice(split);
    const evalY = y.slice(split);
    const model = trainEnsemble(trainX, trainY, evalX, evalY);
    const metrics = evaluateFold(model, evalX, evalY);

    return {
      foldsMetrics: [{ fold: 1, trainSize: trainX.length, evalSize: evalX.length, ...metrics }],
      meanAccuracy: metrics.accuracy,
      meanLogLoss: metrics.logLoss,
      meanBrierScore: metrics.brierScore,
      finalModel: trainEnsemble(X, y, null, null), // train on full dataset
    };
  }

  const foldsMetrics: FoldMetrics[] = [];
  const foldSize = Math.floor(n / (k + 1));

  for (let i = 1; i <= k; i++) {
    const trainEnd = i * foldSize;
    const evalEnd = Math.min(trainEnd + foldSize, n);
    const trainX = X.slice(0, trainEnd);
    const trainY = y.slice(0, trainEnd);
    const evalX = X.slice(trainEnd, evalEnd);
    const evalY = y.slice(trainEnd, evalEnd);

    if (trainX.length < 30 || evalX.length < 5) continue;

    const model = trainEnsemble(trainX, trainY, evalX, evalY);
    const metrics = evaluateFold(model, evalX, evalY);

    foldsMetrics.push({
      fold: i,
      trainSize: trainX.length,
      evalSize: evalX.length,
      ...metrics,
    });
  }

  const meanAccuracy =
    foldsMetrics.reduce((s, f) => s + f.accuracy, 0) / Math.max(foldsMetrics.length, 1);
  const meanLogLoss =
    foldsMetrics.reduce((s, f) => s + f.logLoss, 0) / Math.max(foldsMetrics.length, 1);
  const meanBrierScore =
    foldsMetrics.reduce((s, f) => s + f.brierScore, 0) / Math.max(foldsMetrics.length, 1);

  // Final model trained on the entire history
  const finalModel = trainEnsemble(X, y, null, null);

  return {
    foldsMetrics,
    meanAccuracy,
    meanLogLoss,
    meanBrierScore,
    finalModel,
  };
}

function evaluateFold(
  model: EnsembleState,
  X: number[][],
  y: number[]
): { accuracy: number; logLoss: number; brierScore: number } {
  let correct = 0;
  let logLoss = 0;
  let brier = 0;
  const eps = 1e-12;

  for (let i = 0; i < X.length; i++) {
    const probs = predictEnsemble(model, X[i]);
    const pred = probs.indexOf(Math.max(...probs));
    if (pred === y[i]) correct++;

    const p = Math.max(eps, Math.min(1 - eps, probs[y[i]]));
    logLoss -= Math.log(p);

    // Brier score: sum of squared differences between predicted and one-hot truth
    for (let c = 0; c < probs.length; c++) {
      const target = y[i] === c ? 1 : 0;
      brier += (probs[c] - target) ** 2;
    }
  }

  return {
    accuracy: correct / X.length,
    logLoss: logLoss / X.length,
    brierScore: brier / X.length,
  };
}
