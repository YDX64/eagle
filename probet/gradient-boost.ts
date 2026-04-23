/**
 * Gradient Boosted Decision Trees (XGBoost-style)
 *
 * Pure-TypeScript implementation of gradient boosting for multi-class
 * classification, mimicking the core algorithm behind XGBoost / LightGBM /
 * CatBoost. Used as the upper-tier model in ProBet's ensemble.
 *
 * Key concepts implemented:
 *   - Regression decision trees as base learners
 *   - Multi-class softmax via one-vs-rest tree ensembles
 *   - Gradient/Hessian based leaf scoring
 *   - L2 regularization (lambda)
 *   - Learning rate (shrinkage)
 *   - Subsample of features (max_features) and rows (subsample) per tree
 *   - Early stopping via validation log-loss
 *
 * References:
 *   - Chen, T. & Guestrin, C. (2016). XGBoost: A Scalable Tree Boosting System.
 *   - Friedman, J. (1999). Greedy Function Approximation: A Gradient Boosting Machine.
 */

export interface BoostingHyperparams {
  numClasses: number;
  numTrees: number;
  maxDepth: number;
  minSamplesLeaf: number;
  learningRate: number;
  lambdaReg: number;
  subsample: number; // 0..1
  colSample: number; // 0..1
  randomSeed: number;
}

export const DEFAULT_HYPERPARAMS: BoostingHyperparams = {
  numClasses: 3, // H / D / A
  numTrees: 60,
  maxDepth: 4,
  minSamplesLeaf: 5,
  learningRate: 0.1,
  lambdaReg: 1.0,
  subsample: 0.85,
  colSample: 0.8,
  randomSeed: 42,
};

// ─────────────────────────── Decision Tree ───────────────────────────────────

interface TreeNode {
  isLeaf: boolean;
  value?: number; // leaf value
  featureIdx?: number;
  threshold?: number;
  left?: TreeNode;
  right?: TreeNode;
}

interface SplitCandidate {
  featureIdx: number;
  threshold: number;
  gain: number;
  leftIdxs: number[];
  rightIdxs: number[];
}

/**
 * Seeded pseudo-random number generator (Mulberry32) for reproducibility.
 */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Compute leaf value w using Newton-Raphson on (gradient, hessian).
 * w* = -G / (H + λ)
 */
function leafValue(gradients: number[], hessians: number[], indices: number[], lambdaReg: number): number {
  let G = 0;
  let H = 0;
  for (const i of indices) {
    G += gradients[i];
    H += hessians[i];
  }
  return -G / (H + lambdaReg);
}

/**
 * Gain from splitting a node into (left, right) using XGBoost's gain formula:
 *   Gain = 0.5 * (G_L^2 / (H_L + λ) + G_R^2 / (H_R + λ) - (G_L+G_R)^2 / (H_L+H_R+λ))
 */
function splitGain(
  gradients: number[],
  hessians: number[],
  leftIdxs: number[],
  rightIdxs: number[],
  lambdaReg: number
): number {
  let GL = 0,
    HL = 0,
    GR = 0,
    HR = 0;
  for (const i of leftIdxs) {
    GL += gradients[i];
    HL += hessians[i];
  }
  for (const i of rightIdxs) {
    GR += gradients[i];
    HR += hessians[i];
  }
  const term =
    (GL * GL) / (HL + lambdaReg) +
    (GR * GR) / (HR + lambdaReg) -
    ((GL + GR) * (GL + GR)) / (HL + HR + lambdaReg);
  return 0.5 * term;
}

/**
 * Find the best split for a node using a simple greedy search over
 * a column-subsample of features.
 */
function findBestSplit(
  X: number[][],
  gradients: number[],
  hessians: number[],
  indices: number[],
  featureIdxs: number[],
  lambdaReg: number,
  minSamplesLeaf: number
): SplitCandidate | null {
  let best: SplitCandidate | null = null;

  for (const fIdx of featureIdxs) {
    // Collect (value, idx) and sort
    const values: Array<[number, number]> = indices.map((i) => [X[i][fIdx], i]);
    values.sort((a, b) => a[0] - b[0]);

    // Try splits between consecutive distinct values.
    // We use ~10 quantile-based candidate thresholds for speed.
    const n = values.length;
    if (n < 2 * minSamplesLeaf) continue;

    const candidates: number[] = [];
    const numCandidates = Math.min(10, n - 1);
    for (let q = 1; q <= numCandidates; q++) {
      const idx = Math.floor((q * n) / (numCandidates + 1));
      const v = values[idx][0];
      const vNext = idx + 1 < n ? values[idx + 1][0] : v;
      if (v !== vNext) candidates.push((v + vNext) / 2);
      else candidates.push(v);
    }

    // Deduplicate
    const uniqueCandidates = Array.from(new Set(candidates));

    for (const threshold of uniqueCandidates) {
      const leftIdxs: number[] = [];
      const rightIdxs: number[] = [];
      for (const i of indices) {
        if (X[i][fIdx] <= threshold) leftIdxs.push(i);
        else rightIdxs.push(i);
      }
      if (leftIdxs.length < minSamplesLeaf || rightIdxs.length < minSamplesLeaf) continue;

      const gain = splitGain(gradients, hessians, leftIdxs, rightIdxs, lambdaReg);
      if (gain > 0 && (best === null || gain > best.gain)) {
        best = { featureIdx: fIdx, threshold, gain, leftIdxs, rightIdxs };
      }
    }
  }
  return best;
}

/**
 * Recursively build a regression tree.
 */
function buildTree(
  X: number[][],
  gradients: number[],
  hessians: number[],
  indices: number[],
  depth: number,
  hp: BoostingHyperparams,
  rng: () => number
): TreeNode {
  const numFeatures = X[0].length;
  const numFeaturesToUse = Math.max(1, Math.floor(numFeatures * hp.colSample));

  if (depth >= hp.maxDepth || indices.length < 2 * hp.minSamplesLeaf) {
    return { isLeaf: true, value: leafValue(gradients, hessians, indices, hp.lambdaReg) };
  }

  // Random column subsample
  const allFeatures = Array.from({ length: numFeatures }, (_, i) => i);
  for (let i = allFeatures.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [allFeatures[i], allFeatures[j]] = [allFeatures[j], allFeatures[i]];
  }
  const featureIdxs = allFeatures.slice(0, numFeaturesToUse);

  const split = findBestSplit(X, gradients, hessians, indices, featureIdxs, hp.lambdaReg, hp.minSamplesLeaf);
  if (!split) {
    return { isLeaf: true, value: leafValue(gradients, hessians, indices, hp.lambdaReg) };
  }

  return {
    isLeaf: false,
    featureIdx: split.featureIdx,
    threshold: split.threshold,
    left: buildTree(X, gradients, hessians, split.leftIdxs, depth + 1, hp, rng),
    right: buildTree(X, gradients, hessians, split.rightIdxs, depth + 1, hp, rng),
  };
}

function predictTree(node: TreeNode, x: number[]): number {
  if (node.isLeaf) return node.value!;
  if (x[node.featureIdx!] <= node.threshold!) return predictTree(node.left!, x);
  return predictTree(node.right!, x);
}

// ─────────────────────────── Boosting Loop ───────────────────────────────────

/**
 * Stable softmax over an array of logits.
 */
function softmax(logits: number[]): number[] {
  const maxLogit = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - maxLogit));
  const sum = exps.reduce((s, e) => s + e, 0);
  return exps.map((e) => e / sum);
}

export interface GBClassifierState {
  hyperparams: BoostingHyperparams;
  // trees[treeIdx][classIdx] = tree
  trees: TreeNode[][];
  initialLogits: number[];
  trainHistory: number[];
  evalHistory: number[];
}

/**
 * Train a gradient boosted classifier (XGBoost-style softmax).
 *
 * @param X       feature matrix (n_samples × n_features)
 * @param y       integer class labels (0..numClasses-1)
 * @param X_eval  optional held-out X for early-stopping logging
 * @param y_eval  optional held-out labels
 * @param hp      hyperparameters
 */
export function trainGradientBoosting(
  X: number[][],
  y: number[],
  X_eval: number[][] | null,
  y_eval: number[] | null,
  hp: Partial<BoostingHyperparams> = {}
): GBClassifierState {
  const params: BoostingHyperparams = { ...DEFAULT_HYPERPARAMS, ...hp };
  const rng = makeRng(params.randomSeed);
  const n = X.length;
  const C = params.numClasses;

  if (n === 0) throw new Error('Empty training set.');

  // Class prior used as initial logits
  const classCounts = new Array(C).fill(0);
  for (const yi of y) classCounts[yi]++;
  const initialLogits = classCounts.map((c) => Math.log((c + 1) / (n + C)));

  // Current logits for each sample (n × C)
  const F: number[][] = [];
  for (let i = 0; i < n; i++) F.push([...initialLogits]);

  const trees: TreeNode[][] = [];
  const trainHistory: number[] = [];
  const evalHistory: number[] = [];

  let bestEvalLoss = Infinity;
  let bestRound = 0;
  const earlyStoppingRounds = 10;

  for (let t = 0; t < params.numTrees; t++) {
    const probs: number[][] = F.map((logits) => softmax(logits));

    // Compute gradients and hessians for each class (multinomial logistic)
    const treesForThisRound: TreeNode[] = [];
    for (let c = 0; c < C; c++) {
      const grad: number[] = new Array(n);
      const hess: number[] = new Array(n);
      for (let i = 0; i < n; i++) {
        const yc = y[i] === c ? 1 : 0;
        grad[i] = probs[i][c] - yc;
        hess[i] = probs[i][c] * (1 - probs[i][c]);
      }

      // Row subsample
      const rowIdxs: number[] = [];
      for (let i = 0; i < n; i++) {
        if (rng() < params.subsample) rowIdxs.push(i);
      }
      if (rowIdxs.length < 2 * params.minSamplesLeaf) {
        for (let i = 0; i < n; i++) rowIdxs.push(i);
      }

      const tree = buildTree(X, grad, hess, rowIdxs, 0, params, rng);
      treesForThisRound.push(tree);

      // Apply tree update
      for (let i = 0; i < n; i++) {
        F[i][c] += params.learningRate * predictTree(tree, X[i]);
      }
    }
    trees.push(treesForThisRound);

    // Track losses
    const trainLoss = computeLogLoss(F, y);
    trainHistory.push(trainLoss);

    if (X_eval && y_eval) {
      const F_eval = predictRawLogits(
        { hyperparams: params, trees, initialLogits, trainHistory: [], evalHistory: [] },
        X_eval
      );
      const evalLoss = computeLogLoss(F_eval, y_eval);
      evalHistory.push(evalLoss);

      if (evalLoss < bestEvalLoss) {
        bestEvalLoss = evalLoss;
        bestRound = t;
      } else if (t - bestRound >= earlyStoppingRounds) {
        // Early stopping
        break;
      }
    }
  }

  return {
    hyperparams: params,
    trees,
    initialLogits,
    trainHistory,
    evalHistory,
  };
}

function predictRawLogits(state: GBClassifierState, X: number[][]): number[][] {
  const result: number[][] = [];
  for (const x of X) {
    const logits = [...state.initialLogits];
    for (const trees of state.trees) {
      for (let c = 0; c < state.hyperparams.numClasses; c++) {
        logits[c] += state.hyperparams.learningRate * predictTree(trees[c], x);
      }
    }
    result.push(logits);
  }
  return result;
}

/**
 * Predict class probabilities for new samples.
 */
export function predictProba(state: GBClassifierState, X: number[][]): number[][] {
  return predictRawLogits(state, X).map(softmax);
}

export function predictProbaSingle(state: GBClassifierState, x: number[]): number[] {
  return predictProba(state, [x])[0];
}

function computeLogLoss(F: number[][], y: number[]): number {
  const eps = 1e-12;
  let sum = 0;
  for (let i = 0; i < F.length; i++) {
    const probs = softmax(F[i]);
    const p = Math.max(eps, Math.min(1 - eps, probs[y[i]]));
    sum -= Math.log(p);
  }
  return sum / F.length;
}

/**
 * Compute classification accuracy.
 */
export function computeAccuracy(probs: number[][], y: number[]): number {
  let correct = 0;
  for (let i = 0; i < probs.length; i++) {
    const pred = probs[i].indexOf(Math.max(...probs[i]));
    if (pred === y[i]) correct++;
  }
  return correct / probs.length;
}

/**
 * Train an ensemble of 3 boosted models with diverse hyperparameters,
 * mimicking the XGBoost / LightGBM / CatBoost ensemble approach.
 *
 * Each model is trained on the same data but with slightly different
 * configurations to capture different aspects of the data.
 */
export interface EnsembleState {
  models: GBClassifierState[];
  modelNames: string[];
  weights: number[]; // weighted average for predictions
}

export function trainEnsemble(
  X: number[][],
  y: number[],
  X_eval: number[][] | null,
  y_eval: number[] | null
): EnsembleState {
  // XGBoost-style: deeper trees, mid learning rate
  const xgb = trainGradientBoosting(X, y, X_eval, y_eval, {
    numTrees: 80,
    maxDepth: 5,
    learningRate: 0.08,
    lambdaReg: 1.0,
    subsample: 0.85,
    colSample: 0.8,
    randomSeed: 42,
  });

  // LightGBM-style: more trees, smaller LR, slightly shallower
  const lgbm = trainGradientBoosting(X, y, X_eval, y_eval, {
    numTrees: 100,
    maxDepth: 4,
    learningRate: 0.05,
    lambdaReg: 0.5,
    subsample: 0.8,
    colSample: 0.75,
    randomSeed: 1337,
  });

  // CatBoost-style: heavy regularization, conservative
  const cat = trainGradientBoosting(X, y, X_eval, y_eval, {
    numTrees: 60,
    maxDepth: 6,
    learningRate: 0.1,
    lambdaReg: 2.0,
    subsample: 0.9,
    colSample: 0.85,
    randomSeed: 7,
  });

  // Compute weights based on inverse final eval loss (or train loss as fallback).
  const losses = [xgb, lgbm, cat].map((m) => {
    const arr = m.evalHistory.length > 0 ? m.evalHistory : m.trainHistory;
    return arr.length > 0 ? arr[arr.length - 1] : 1.0;
  });
  const invLosses = losses.map((l) => 1 / Math.max(l, 1e-6));
  const sumInv = invLosses.reduce((s, v) => s + v, 0);
  const weights = invLosses.map((v) => v / sumInv);

  return {
    models: [xgb, lgbm, cat],
    modelNames: ['XGBoost-style', 'LightGBM-style', 'CatBoost-style'],
    weights,
  };
}

/**
 * Predict class probabilities by weighted-averaging the ensemble members.
 */
export function predictEnsemble(ens: EnsembleState, x: number[]): number[] {
  const numClasses = ens.models[0].hyperparams.numClasses;
  const out = new Array(numClasses).fill(0);
  for (let m = 0; m < ens.models.length; m++) {
    const p = predictProbaSingle(ens.models[m], x);
    for (let c = 0; c < numClasses; c++) {
      out[c] += ens.weights[m] * p[c];
    }
  }
  // Normalize (defensive — should already sum to ~1)
  const sum = out.reduce((s, v) => s + v, 0);
  return out.map((v) => v / sum);
}
