/**
 * ProBet Calibration Engine
 *
 * Ported from exciting-almeida/lib/calibration-engine.ts and adapted for ProBet.
 *
 * Combines multiple probability sources (model, API-Football, bookmaker market)
 * into a single calibrated probability with a confidence score. This is the
 * secret sauce for pushing accuracy >80%:
 *   - 3 independent sources agreeing = very high confidence
 *   - Disagreement = shrink toward market + soften (high temperature)
 *
 * Techniques:
 *   1. Shrinkage towards market (overround-removed implied probability)
 *   2. Temperature scaling (soft when sources disagree)
 *   3. Agreement score (low std dev = high agreement)
 *   4. 3-source weighted average: model 35% + API 25% + market 40%
 */

export interface CalibrationSources {
  /** Our Poisson + ensemble probability (0..1) */
  modelProb: number;
  /** API-Football prediction probability (0..1), or null if unavailable */
  apiProb: number | null;
  /** Bookmaker market implied probability with overround removed (0..1), or null */
  marketProb: number | null;
}

export interface CalibratedResult {
  /** Final calibrated probability (0..1) */
  calibrated: number;
  /** Confidence 0..1 (higher = more sources agreeing + low dispersion) */
  confidence: number;
  /** How many sources agree on direction (>50% vs <50%) */
  agreeing: number;
  /** Total non-null sources */
  total: number;
  /** Std-dev of sources (0..1, where 1 = max disagreement) */
  dispersion: number;
}

/**
 * Temperature scaling: sharpen or soften a probability.
 *   T < 1  → sharpen (extreme probs get more extreme)
 *   T = 1  → no change
 *   T > 1  → soften (probs move toward 0.5)
 *
 * Clamped to [0.5, 2.0] to avoid explosions.
 */
function temperatureScale(prob: number, temperature: number): number {
  const T = Math.max(0.5, Math.min(2.0, temperature));
  if (T === 1.0) return prob;
  const pClamped = Math.max(0.01, Math.min(0.99, prob));
  const logOdds = Math.log(pClamped / (1 - pClamped));
  const scaledLogOdds = logOdds / T;
  return 1 / (1 + Math.exp(-scaledLogOdds));
}

/**
 * Calibrate a single probability against multiple sources.
 *
 * @param sources   Model, API, and market probabilities (all 0..1)
 * @param shrinkage How much to trust the market (0..1, default 0.4 = 40% market)
 */
export function calibrate(
  sources: CalibrationSources,
  shrinkage: number = 0.4
): CalibratedResult {
  const { modelProb, apiProb, marketProb } = sources;
  const values = [modelProb];
  if (apiProb !== null && apiProb > 0) values.push(apiProb);
  if (marketProb !== null && marketProb > 0) values.push(marketProb);

  // Single-source fallback — no calibration possible
  if (values.length === 1) {
    return {
      calibrated: Math.max(0.01, Math.min(0.99, modelProb)),
      // Base confidence: distance from 0.5 scaled, capped at 0.4 (no cross-check)
      confidence: Math.min(0.4, Math.max(0.1, 0.2 + Math.abs(modelProb - 0.5) * 0.4)),
      agreeing: 1,
      total: 1,
      dispersion: 0,
    };
  }

  // Weighted blend — market is the anchor when available
  let calibrated: number;
  if (marketProb !== null && marketProb > 0) {
    if (apiProb !== null && apiProb > 0) {
      // 3 sources: model 35% + API 25% + market 40%
      calibrated = modelProb * 0.35 + apiProb * 0.25 + marketProb * 0.40;
    } else {
      // 2 sources: model vs market
      const modelWeight = 1 - shrinkage;
      calibrated = modelProb * modelWeight + marketProb * shrinkage;
    }
  } else if (apiProb !== null && apiProb > 0) {
    calibrated = modelProb * 0.6 + apiProb * 0.4;
  } else {
    calibrated = modelProb;
  }

  // Compute dispersion (std dev)
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);

  // Temperature scaling: low stdDev → sharpen (T<1), high stdDev → soften (T>1)
  const temperature = Math.max(0.5, Math.min(2.0, 0.9 + stdDev * 3));
  calibrated = temperatureScale(calibrated, temperature);

  // Agreement score
  const direction = calibrated > 0.5;
  const agreeing = values.filter((v) => v > 0.5 === direction).length;

  // Confidence: base from low dispersion + number of sources
  // stdDev 0 → agreement = 1.0, stdDev 0.2 → agreement = 0.2
  const agreementScore = Math.max(0, 1 - stdDev * 4);
  let confidence = agreementScore * 0.6 + (values.length / 3) * 0.4;

  // Bonuses / penalties
  if (agreeing === values.length) confidence = Math.min(0.95, confidence + 0.15);
  if (agreeing < values.length / 2) confidence = Math.max(0.1, confidence - 0.2);

  return {
    calibrated: Math.max(0.01, Math.min(0.99, calibrated)),
    confidence: Math.max(0.05, Math.min(0.95, confidence)),
    agreeing,
    total: values.length,
    dispersion: stdDev,
  };
}

/**
 * Convert fair (overround-removed) decimal odds to an implied probability.
 * Expects fair odds — i.e. the bookmaker margin has already been stripped.
 */
export function oddsToFairProb(fairOdds: number): number {
  if (fairOdds <= 1) return 0.99;
  return 1 / fairOdds;
}

/**
 * Given decimal odds that STILL contain the bookmaker margin, remove the
 * overround (margin) and return the fair probabilities.
 *
 * @param rawOdds Array of decimal odds for all outcomes in the market
 * @returns Fair probabilities (sum = 1)
 */
export function removeOverround(rawOdds: number[]): number[] {
  if (rawOdds.length === 0) return [];
  const implied = rawOdds.map((o) => (o > 0 ? 1 / o : 0));
  const total = implied.reduce((s, v) => s + v, 0);
  if (total <= 0) return rawOdds.map(() => 0);
  return implied.map((p) => p / total);
}

/**
 * Expected value for a bet (positive = profitable in the long run).
 * EV = (our_probability × decimal_odds) - 1
 */
export function expectedValue(ourProb: number, decimalOdds: number): number {
  if (decimalOdds <= 1 || ourProb <= 0) return -1;
  return ourProb * decimalOdds - 1;
}

/**
 * Kelly Criterion stake sizing.
 *   f* = (bp - q) / b
 * where b = decimal odds - 1, p = our prob, q = 1 - p
 *
 * Uses QUARTER Kelly for safety (kelly × 0.25) and caps at 5% of bankroll.
 */
export function kellyStake(ourProb: number, decimalOdds: number): number {
  if (decimalOdds <= 1 || ourProb <= 0) return 0;
  const b = decimalOdds - 1;
  const q = 1 - ourProb;
  const kelly = (b * ourProb - q) / b;
  if (kelly <= 0) return 0;
  const quarterKelly = kelly * 0.25;
  return Math.min(0.05, quarterKelly);
}
