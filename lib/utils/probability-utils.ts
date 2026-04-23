import { ConfidenceScore, ConfidenceBreakdown, ProbabilitySet } from '@/lib/types/ensemble-types';

const EPSILON = 1e-9;

export function normalizePercentageString(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }
    return value > 1 ? value / 100 : Math.max(0, Math.min(1, value));
  }

  const cleaned = value.replace('%', '').replace(',', '.').trim();
  const parsed = parseFloat(cleaned);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed > 1 ? parsed / 100 : Math.max(0, Math.min(1, parsed));
}

export function roundToPrecision(value: number, precision = 4): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function normalizeProbabilitySet(values: Record<string, number>, precision?: number): Record<string, number>;
export function normalizeProbabilitySet(values: number[], precision?: number): number[];
export function normalizeProbabilitySet(
  values: Record<string, number> | number[],
  precision = 4
): Record<string, number> | number[] {
  const entries = Array.isArray(values)
    ? values.map((val, index) => [index, val] as const)
    : Object.entries(values);

  let sum = 0;
  const sanitized = entries.map(([key, val]) => {
    const numeric = Number.isFinite(val) ? Math.max(0, val) : 0;
    sum += numeric;
    return [key, numeric] as const;
  });

  if (sum <= EPSILON) {
    const equalShare = roundToPrecision(1 / sanitized.length, precision);
    if (Array.isArray(values)) {
      return sanitized.map(() => equalShare);
    }
    return Object.fromEntries(sanitized.map(([key]) => [key, equalShare]));
  }

  if (Array.isArray(values)) {
    return sanitized.map(([, val]) => roundToPrecision(val / sum, precision));
  }
  return Object.fromEntries(
    sanitized.map(([key, val]) => [key, roundToPrecision(val / sum, precision)])
  );
}

export function calculateWeightedAverage(values: number[], weights: number[]): number {
  if (!values.length || values.length !== weights.length) {
    return 0;
  }

  let totalWeight = 0;
  let weightedSum = 0;

  for (let i = 0; i < values.length; i += 1) {
    const value = Number.isFinite(values[i]) ? values[i] : 0;
    const weight = Number.isFinite(weights[i]) ? Math.max(0, weights[i]) : 0;
    weightedSum += value * weight;
    totalWeight += weight;
  }

  if (totalWeight <= EPSILON) {
    return values.reduce((acc, curr) => acc + curr, 0) / values.length;
  }

  return weightedSum / totalWeight;
}

export function combineMultipleDistributions(
  distributions: ProbabilitySet[],
  weights: number[],
  precision = 4
): ProbabilitySet {
  const combined: Record<string, number> = {};

  distributions.forEach((distribution, index) => {
    const weight = Number.isFinite(weights[index]) ? Math.max(0, weights[index]) : 0;
    if (weight <= EPSILON) {
      return;
    }

    Object.entries(distribution).forEach(([key, value]) => {
      if (!Number.isFinite(value)) {
        return;
      }
      combined[key] = (combined[key] ?? 0) + value * weight;
    });
  });

  return normalizeProbabilitySet(combined, precision);
}

export function applyConfidenceWeighting(
  weights: number[],
  confidences: Array<number | null | undefined>,
  threshold: number,
  penaltyFactor: number
): number[] {
  if (!weights.length || weights.length !== confidences.length) {
    return weights;
  }

  const adjusted = weights.map((weight, index) => {
    const confidence = confidences[index];
    if (confidence === null || confidence === undefined) {
      return weight;
    }
    if (confidence < threshold) {
      return Math.max(0, weight * (1 - penaltyFactor));
    }
    return weight;
  });

  return normalizeProbabilitySet(adjusted) as number[];
}

export function calculateVariance(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  const mean = values.reduce((acc, curr) => acc + curr, 0) / values.length;
  const variance = values.reduce((acc, curr) => acc + (curr - mean) ** 2, 0) / values.length;
  return variance;
}

export function calculateConsensusScore(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  const variance = calculateVariance(values);
  const maxSpread = Math.max(...values) - Math.min(...values);
  if (maxSpread <= EPSILON) {
    return 1;
  }
  const normalizedVariance = variance / Math.max(EPSILON, maxSpread ** 2);
  return Math.max(0, Math.min(1, 1 - normalizedVariance));
}

export function identifyOutliers(values: number[], threshold = 0.2): number[] {
  if (!values.length) {
    return [];
  }
  const mean = values.reduce((acc, curr) => acc + curr, 0) / values.length;
  return values
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => Math.abs(value - mean) > threshold)
    .map(({ index }) => index);
}

export function calculateEnsembleConfidence(
  base: number,
  consensus: number,
  breakdown: ConfidenceBreakdown[] = []
): ConfidenceScore {
  const normalizedBase = Math.max(0, Math.min(1, base));
  const normalizedConsensus = Math.max(0, Math.min(1, consensus));
  const combined = Math.max(0, Math.min(1, (normalizedBase * 0.6) + (normalizedConsensus * 0.4)));

  let label: ConfidenceScore['label'] = 'low';
  if (combined >= 0.75) {
    label = 'high';
  } else if (combined >= 0.55) {
    label = 'medium';
  }

  return {
    value: roundToPrecision(combined, 4),
    label,
    breakdown: breakdown.length ? breakdown : undefined,
  };
}

export function applyAgreementBonus(confidence: number, bonus: number): number {
  return Math.max(0, Math.min(1, confidence + bonus));
}

export function applyDisagreementPenalty(confidence: number, penalty: number): number {
  return Math.max(0, Math.min(1, confidence - penalty));
}

export function validateProbabilitySet(probabilities: ProbabilitySet): boolean {
  const values = Object.values(probabilities);
  if (!values.length) {
    return false;
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  if (sum <= EPSILON) {
    return false;
  }
  return values.every(value => value >= -EPSILON && value <= 1 + EPSILON);
}

export function validateSourceData<T extends Record<string, unknown>>(
  data: T | null | undefined,
  requiredKeys: (keyof T)[]
): data is T {
  if (!data) {
    return false;
  }
  return requiredKeys.every(key => data[key] !== undefined && data[key] !== null);
}

export function sanitizeProbabilities(probabilities: ProbabilitySet, precision = 4): ProbabilitySet {
  const clamped: ProbabilitySet = {};
  Object.entries(probabilities).forEach(([key, value]) => {
    if (!Number.isFinite(value)) {
      return;
    }
    const normalized = Math.max(0, Math.min(1, value));
    clamped[key] = normalized;
  });
  return normalizeProbabilitySet(clamped, precision);
}

export function poissonProbability(k: number, lambda: number): number {
  if (lambda < 0 || k < 0) {
    return 0;
  }
  const factorial = (n: number): number => {
    if (n <= 1) {
      return 1;
    }
    let result = 1;
    for (let i = 2; i <= n; i += 1) {
      result *= i;
    }
    return result;
  };
  return (lambda ** k * Math.exp(-lambda)) / factorial(Math.floor(k));
}

export function binomialProbability(trials: number, successes: number, probability: number): number {
  if (probability < 0 || probability > 1 || trials < 0 || successes < 0 || successes > trials) {
    return 0;
  }
  const combination = (n: number, r: number): number => {
    if (r === 0 || r === n) {
      return 1;
    }
    let result = 1;
    for (let i = 1; i <= r; i += 1) {
      result *= (n - (r - i)) / i;
    }
    return result;
  };
  return combination(trials, successes) * probability ** successes * (1 - probability) ** (trials - successes);
}

export function logisticFunction(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function isValidProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function isPercentageString(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  return /^\s*\d+(\.\d+)?%?\s*$/.test(value);
}

export function hasRequiredFields<T extends Record<string, unknown>>(
  value: unknown,
  fields: (keyof T)[]
): value is T {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return fields.every(field => field in (value as Record<string, unknown>));
}
