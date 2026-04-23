/**
 * Monte Carlo Game Simulator
 *
 * Simulates a basketball game N times (default 10K) by sampling each team's
 * point output from a normal distribution parameterized by predicted mean
 * and variance. From the sample distribution we can derive ANY market's
 * probability empirically:
 *
 *   - P(home wins)         = #(home > away) / N
 *   - P(total > 220.5)     = #(home + away > 220.5) / N
 *   - P(home covers -5.5)  = #(home - away > 5.5) / N
 *   - P(home wins by 3-7)  = margin band counts
 *   - exact score buckets  = histogram of (home, away) pairs
 *
 * Why simulation vs analytic? For 1D markets (moneyline, totals), analytic
 * normal CDF is faster and equally accurate. But for joint markets like
 * "home wins by 5-9 AND total > 220" you need to sample joint distributions.
 * Simulation handles every market with one infrastructure.
 *
 * For NBA the typical std dev per team is ~12 points; total std dev is ~17.
 */

import { boxMuller } from './multivariate-normal';

export interface GameSimulationInput {
  expectedHome: number;
  expectedAway: number;
  homeStdDev: number;
  awayStdDev: number;
  // Optional correlation between home and away scores (usually slightly
  // negative — defense + offense are connected, faster pace lifts both)
  correlation?: number;
  numSimulations?: number;
}

export interface GameSimulationResult {
  homeScores: number[];      // sampled scores
  awayScores: number[];
  totals: number[];
  margins: number[];         // home - away
  numSimulations: number;

  // Pre-computed marginal probabilities
  homeWinProb: number;
  awayWinProb: number;
  drawProb: number;          // basketball: ≈ 0 (overtime decides)

  // Mean and stddev of distribution (sanity check)
  meanHomeScore: number;
  meanAwayScore: number;
  meanTotal: number;
  meanMargin: number;
  totalStdDev: number;
}

/**
 * Sample a correlated bivariate normal pair (home, away).
 * Uses Cholesky on 2x2 covariance.
 */
function sampleBivariate(
  meanH: number,
  meanA: number,
  sigmaH: number,
  sigmaA: number,
  correlation: number
): [number, number] {
  // Box-Muller gives us 2 standard normals
  const [z1, z2] = boxMuller();
  // Cholesky for 2x2:
  //   L = [[σ_H, 0], [ρ*σ_A, σ_A*sqrt(1-ρ²)]]
  const home = meanH + sigmaH * z1;
  const away = meanA + correlation * sigmaA * z1 + sigmaA * Math.sqrt(1 - correlation ** 2) * z2;
  return [home, away];
}

/**
 * Run Monte Carlo simulation of a basketball game.
 */
export function simulateGame(input: GameSimulationInput): GameSimulationResult {
  const N = input.numSimulations ?? 10_000;
  const correlation = input.correlation ?? -0.05;

  const homeScores = new Array<number>(N);
  const awayScores = new Array<number>(N);
  const totals = new Array<number>(N);
  const margins = new Array<number>(N);

  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;
  let sumH = 0;
  let sumA = 0;
  let sumTotal = 0;
  let sumMargin = 0;
  let sumTotalSq = 0;

  for (let i = 0; i < N; i++) {
    const [hRaw, aRaw] = sampleBivariate(
      input.expectedHome,
      input.expectedAway,
      input.homeStdDev,
      input.awayStdDev,
      correlation
    );
    // Round to integer (basketball scores are whole numbers; OT can resolve ties)
    const h = Math.max(0, Math.round(hRaw));
    const a = Math.max(0, Math.round(aRaw));

    // If tied, simulate OT — generally home court advantage favors home in OT.
    let finalH = h;
    let finalA = a;
    if (h === a) {
      // OT: simulate ~5 extra possessions per team, normal home edge
      const otHome = 12 + Math.random() * 4 - 2 + 0.5; // ~12 ppg in OT 5 min, +HCA
      const otAway = 12 + Math.random() * 4 - 2;
      finalH += Math.round(otHome);
      finalA += Math.round(otAway);
      if (finalH === finalA) {
        // Double OT — coin flip
        if (Math.random() < 0.55) finalH += 3;
        else finalA += 3;
      }
    }

    homeScores[i] = finalH;
    awayScores[i] = finalA;
    const total = finalH + finalA;
    const margin = finalH - finalA;
    totals[i] = total;
    margins[i] = margin;

    if (margin > 0) homeWins++;
    else if (margin < 0) awayWins++;
    else draws++; // shouldn't happen after OT, but defensive

    sumH += finalH;
    sumA += finalA;
    sumTotal += total;
    sumMargin += margin;
    sumTotalSq += total * total;
  }

  const meanHomeScore = sumH / N;
  const meanAwayScore = sumA / N;
  const meanTotal = sumTotal / N;
  const meanMargin = sumMargin / N;
  const totalVar = sumTotalSq / N - meanTotal * meanTotal;
  const totalStdDev = Math.sqrt(Math.max(0, totalVar));

  return {
    homeScores,
    awayScores,
    totals,
    margins,
    numSimulations: N,
    homeWinProb: homeWins / N,
    awayWinProb: awayWins / N,
    drawProb: draws / N,
    meanHomeScore,
    meanAwayScore,
    meanTotal,
    meanMargin,
    totalStdDev,
  };
}

/**
 * Helper: empirical probability of (sample > threshold).
 */
export function probAbove(samples: number[], threshold: number): number {
  let count = 0;
  for (const s of samples) {
    if (s > threshold) count++;
  }
  return count / samples.length;
}

/**
 * Helper: empirical probability of (sample < threshold).
 */
export function probBelow(samples: number[], threshold: number): number {
  let count = 0;
  for (const s of samples) {
    if (s < threshold) count++;
  }
  return count / samples.length;
}

/**
 * Helper: empirical probability of (lo ≤ sample ≤ hi).
 */
export function probBetween(samples: number[], lo: number, hi: number): number {
  let count = 0;
  for (const s of samples) {
    if (s >= lo && s <= hi) count++;
  }
  return count / samples.length;
}
