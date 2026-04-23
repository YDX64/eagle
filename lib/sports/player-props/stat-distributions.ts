/**
 * Hand-rolled statistical distributions for player-prop pricing.
 *
 * We keep zero external stats dependencies — every CDF and PMF is implemented
 * here with numerical stability in mind (log-gamma for large factorials,
 * Lanczos approximation, incomplete-beta for NB/binomial tail probabilities).
 *
 * Distribution selection heuristic:
 *   - Poisson:     rebounds, assists (moderate means), hockey goals / assists /
 *                  points, blocked shots, strikeouts, hits, home runs, RBIs, runs.
 *                  Chosen when Var ≈ Mean (counting process with roughly
 *                  constant per-minute intensity).
 *   - Negative binomial: points, three-pointers, shots on goal, PRA, total bases.
 *                  Chosen when Var > Mean (over-dispersed counting). We fit via
 *                  method-of-moments: r = μ²/(σ²-μ), p = μ/σ².
 *   - Normal (fallback): used as a safety net if the distribution family can't
 *                  be sensibly fit from the input moments — should be very rare.
 *
 * Every CDF returns P(X ≤ x), so over-probability = 1 - CDF(floor(line)).
 * For non-integer sportsbook lines (e.g. 24.5) we use CDF(⌊line⌋) which is
 * exactly right — over_prob = 1 - P(X ≤ ⌊line⌋) = P(X ≥ ⌈line⌉).
 */

import type { StatDistribution } from './types';

// ---------------------------------------------------------------------------
// Core numerical helpers
// ---------------------------------------------------------------------------

/** Lanczos approximation of log Γ(z). Accurate to ~1e-13 for z > 0. */
export function logGamma(z: number): number {
  if (z < 0.5) {
    // Reflection formula
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  const g = 7;
  const c = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  let x = c[0];
  for (let i = 1; i < g + 2; i++) {
    x += c[i] / (z + i);
  }
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Numerically stable log-factorial. */
export function logFactorial(n: number): number {
  if (n < 0) return NaN;
  if (n < 2) return 0;
  return logGamma(n + 1);
}

/** Logarithm of the binomial coefficient C(n, k). */
export function logBinomial(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

/** Clamp x into [lo, hi]. */
export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

// ---------------------------------------------------------------------------
// Poisson
// ---------------------------------------------------------------------------

/** P(X = k) when X ~ Poisson(λ). Uses log-space to avoid overflow for large λ. */
export function poissonPmf(k: number, lambda: number): number {
  if (lambda < 0 || k < 0) return 0;
  if (lambda === 0) return k === 0 ? 1 : 0;
  const logP = k * Math.log(lambda) - lambda - logFactorial(k);
  return Math.exp(logP);
}

/**
 * Poisson CDF P(X ≤ k).  For small λ we sum directly; for large λ we use the
 * Q-function relationship with the upper incomplete gamma function.
 */
export function poissonCdf(k: number, lambda: number): number {
  if (lambda < 0) return NaN;
  if (k < 0) return 0;
  if (lambda === 0) return 1;
  // For large k+λ, direct summation in log space is still stable.
  // Cap iteration safety at 1000 to avoid pathological loops.
  const kInt = Math.floor(k);
  const upper = Math.min(kInt, 1000);
  let sum = 0;
  let term = Math.exp(-lambda); // P(X=0)
  if (!isFinite(term) || term === 0) {
    // Fall back to log-space accumulation if underflow hits.
    return logSpacePoissonCdf(upper, lambda);
  }
  sum += term;
  for (let i = 1; i <= upper; i++) {
    term *= lambda / i; // recurrence: P(i)/P(i-1) = λ/i
    sum += term;
    if (term < 1e-18 && i > lambda) break; // far enough into the tail
  }
  return clamp(sum, 0, 1);
}

/** Log-space fallback for very large λ. */
function logSpacePoissonCdf(k: number, lambda: number): number {
  // log(sum) via log-sum-exp over individual log-PMFs.
  const logPMFs: number[] = [];
  for (let i = 0; i <= k; i++) {
    logPMFs.push(i * Math.log(lambda) - lambda - logFactorial(i));
  }
  return Math.exp(logSumExp(logPMFs));
}

function logSumExp(values: number[]): number {
  if (values.length === 0) return -Infinity;
  const max = Math.max(...values);
  if (!isFinite(max)) return max;
  let s = 0;
  for (const v of values) s += Math.exp(v - max);
  return max + Math.log(s);
}

// ---------------------------------------------------------------------------
// Negative binomial
// ---------------------------------------------------------------------------
// Parameterisation used here: NB(r, p) = P(X=k) = C(k+r-1, k) p^r (1-p)^k
// where r > 0 (not necessarily integer), p ∈ (0, 1).
// Mean    μ = r(1-p)/p
// Var     σ² = r(1-p)/p²   ⇒ σ² = μ/p  ⇒ p = μ/σ², r = μ²/(σ²-μ)
// This is the "over-dispersed Poisson" parameterisation.
// ---------------------------------------------------------------------------

export interface NegBinomParams {
  r: number;
  p: number;
}

/**
 * Fit NB parameters from the first two moments. If σ² ≤ μ (under-dispersed or
 * exactly Poisson), the Poisson limit is returned as {r=Infinity, p=1} and the
 * caller should fall back to the Poisson CDF.
 */
export function fitNegativeBinomialFromMoments(mean: number, variance: number): NegBinomParams | null {
  if (mean <= 0) return null;
  if (variance <= mean) {
    // Poisson-limit: NB degenerates. Caller should use Poisson.
    return null;
  }
  const p = mean / variance;
  const r = (mean * mean) / (variance - mean);
  if (!isFinite(p) || !isFinite(r) || p <= 0 || p >= 1 || r <= 0) return null;
  return { r, p };
}

/** Log PMF of NB(r, p) at k (k = 0, 1, 2, …). */
export function negBinomLogPmf(k: number, r: number, p: number): number {
  if (k < 0) return -Infinity;
  // log C(k+r-1, k) = logΓ(k+r) - logΓ(r) - log k!
  return logGamma(k + r) - logGamma(r) - logFactorial(k) + r * Math.log(p) + k * Math.log(1 - p);
}

export function negBinomPmf(k: number, r: number, p: number): number {
  return Math.exp(negBinomLogPmf(k, r, p));
}

/**
 * NB CDF via direct summation with the recurrence
 *   P(k)/P(k-1) = (k + r - 1) / k × (1 - p)
 * which is numerically stable for modest k. For very large k we fall back to
 * the regularised incomplete beta function identity:
 *   P(X ≤ k) = I_p(r, k+1)
 */
export function negBinomCdf(k: number, r: number, p: number): number {
  if (k < 0) return 0;
  const kInt = Math.floor(k);
  if (kInt > 400) {
    return regularisedIncompleteBeta(p, r, kInt + 1);
  }
  let term = Math.pow(p, r); // P(X=0)
  if (!isFinite(term) || term === 0) {
    // Use log-space fallback for tiny p^r
    const logTerms: number[] = [];
    for (let i = 0; i <= kInt; i++) logTerms.push(negBinomLogPmf(i, r, p));
    return clamp(Math.exp(logSumExp(logTerms)), 0, 1);
  }
  let sum = term;
  for (let i = 1; i <= kInt; i++) {
    term *= ((i + r - 1) / i) * (1 - p);
    sum += term;
    if (term < 1e-18 && i > r) break;
  }
  return clamp(sum, 0, 1);
}

// ---------------------------------------------------------------------------
// Regularised incomplete beta function (used for NB tail when k is huge)
// ---------------------------------------------------------------------------

/**
 * I_x(a, b) via continued fraction (Numerical Recipes §6.4).
 * Accurate to ~1e-10 for reasonable (a, b, x).
 */
export function regularisedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;
  if (x < (a + 1) / (a + b + 2)) {
    return front * betacf(x, a, b);
  }
  return 1 - front * betacf(1 - x, b, a) * (a / b);
}

function betacf(x: number, a: number, b: number): number {
  const MAX_ITER = 200;
  const EPS = 3e-7;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h / a;
}

// ---------------------------------------------------------------------------
// Normal fallback
// ---------------------------------------------------------------------------

/** Standard normal CDF via Abramowitz-Stegun 26.2.17 (accurate to ~7.5e-8). */
export function normalCdfStd(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327;
  const p =
    d *
    Math.exp((-z * z) / 2) *
    (t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.8212560 + t * 1.3302744)))));
  return z > 0 ? 1 - p : p;
}

/** P(N(μ, σ) ≤ x). */
export function normalCdf(x: number, mean: number, stdDev: number): number {
  if (stdDev <= 0) return x >= mean ? 1 : 0;
  return normalCdfStd((x - mean) / stdDev);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Over-probability P(X > line) for a discrete sportsbook line.
 *
 * For a half-integer line (e.g. 24.5) this is P(X ≥ 25). For an integer line
 * sportsbooks typically use "push on tie" semantics — we don't model that
 * here; the caller should avoid integer lines when possible (the generators
 * emit half-integer lines only, so this is fine).
 *
 * @param mean     projected mean of the statistic
 * @param stdDev   projected std dev (ignored for Poisson — Poisson has σ² = μ by definition)
 * @param line     sportsbook over/under line (usually half-integer)
 * @param distribution which family to use
 */
export function getOverProbability(
  mean: number,
  stdDev: number,
  line: number,
  distribution: StatDistribution,
): number {
  if (!isFinite(mean) || mean <= 0) return 0;

  if (distribution === 'poisson') {
    const k = Math.floor(line);
    const cdf = poissonCdf(k, mean);
    return clamp(1 - cdf, 0, 1);
  }

  if (distribution === 'negative_binomial') {
    const variance = stdDev * stdDev;
    const params = fitNegativeBinomialFromMoments(mean, variance);
    if (!params) {
      // Under-dispersed — fall back to Poisson.
      return getOverProbability(mean, stdDev, line, 'poisson');
    }
    const k = Math.floor(line);
    const cdf = negBinomCdf(k, params.r, params.p);
    return clamp(1 - cdf, 0, 1);
  }

  // Normal fallback. Use continuity correction (line - 0.5 would be P(X > line)
  // semantically, but the line is already half-integer so this is exact).
  const cdf = normalCdf(line, mean, stdDev);
  return clamp(1 - cdf, 0, 1);
}

/** Convenience: P(X < line) = P(X ≤ line - 1) for integer-valued X. */
export function getUnderProbability(
  mean: number,
  stdDev: number,
  line: number,
  distribution: StatDistribution,
): number {
  // Because lines are half-integer, under = 1 - over exactly (no push mass).
  return clamp(1 - getOverProbability(mean, stdDev, line, distribution), 0, 1);
}

/**
 * Inverse helper: given a target over-probability, find the line (continuous
 * interpolation between adjacent integer lines) where P(X > line) = target.
 * Used to emit sportsbook-style half-integer lines centred on the player's
 * projected mean.
 *
 * Implementation: start from floor(mean) and walk outward until the CDF
 * crosses the target, then linearly interpolate back to a half-integer line.
 */
export function getImpliedLine(
  mean: number,
  stdDev: number,
  overProb: number,
  distribution: StatDistribution,
): number {
  const target = clamp(overProb, 0.01, 0.99);
  // Walk the discrete CDF outward in both directions from ⌊μ⌋.
  const start = Math.max(0, Math.floor(mean));
  for (let step = 0; step < 50; step++) {
    const upper = start + step;
    const overAtUpper = getOverProbability(mean, stdDev, upper + 0.5, distribution);
    if (overAtUpper <= target) {
      // Target sits somewhere in [upper - 1 + 0.5, upper + 0.5]
      const overBelow =
        step === 0
          ? 1
          : getOverProbability(mean, stdDev, upper - 0.5, distribution);
      const span = overBelow - overAtUpper;
      if (span <= 0) return upper + 0.5;
      const frac = (overBelow - target) / span;
      return upper - 0.5 + frac;
    }
  }
  // Walk downward in case μ is tiny (shouldn't usually hit this path).
  for (let k = start; k >= 0; k--) {
    const overAt = getOverProbability(mean, stdDev, k + 0.5, distribution);
    if (overAt >= target) return k + 0.5;
  }
  return Math.max(0.5, mean);
}

/**
 * Given a mean and optional std dev, decide the best distribution family.
 * Exposed so sport-specific generators can decide per-stat without hard-coding.
 */
export function chooseDistribution(
  mean: number,
  stdDev: number | null | undefined,
  preferred: StatDistribution,
): StatDistribution {
  if (!stdDev || stdDev <= 0) return 'poisson';
  if (preferred === 'negative_binomial') {
    const variance = stdDev * stdDev;
    if (variance > mean * 1.05) return 'negative_binomial';
    return 'poisson';
  }
  return preferred;
}
