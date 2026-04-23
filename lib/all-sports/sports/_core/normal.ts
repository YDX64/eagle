/**
 * Normal (Gaussian) Distribution - Yüksek skorlu sporlar için
 * Kullanım: Basketbol, NBA, Amerikan Futbolu, Ragbi, AFL
 *
 * High-scoring sports where total points >> 10, Normal distribution
 * is a much better approximation than Poisson.
 */

export function normalPdf(x: number, mean: number, stdDev: number): number {
  const z = (x - mean) / stdDev;
  return Math.exp(-0.5 * z * z) / (stdDev * Math.sqrt(2 * Math.PI));
}

/**
 * Standard normal CDF using Abramowitz-Stegun approximation
 * Accurate to ~1.5e-7
 */
export function normalCdf(x: number, mean: number = 0, stdDev: number = 1): number {
  const z = (x - mean) / stdDev;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/**
 * Probability of a normal variable being greater than x
 */
export function normalSurvival(x: number, mean: number, stdDev: number): number {
  return 1 - normalCdf(x, mean, stdDev);
}

export interface NormalOutcomes {
  homeWin: number;
  draw: number;
  awayWin: number;
  overUnder: Record<number, { over: number; under: number }>;
  handicaps: Record<number, { home: number; away: number; push: number }>;
  expectedTotal: number;
  expectedMargin: number;
}

/**
 * Derive outcomes from Normal distribution assumptions
 * Home and Away scores are independent Normal RVs
 * Total score = sum, Margin = difference (both Normal)
 */
export function deriveNormalOutcomes(
  meanHome: number,
  meanAway: number,
  stdDevHome: number,
  stdDevAway: number,
  options: {
    ouLines?: number[];
    handicapLines?: number[];
    drawBuffer?: number; // Points margin considered "draw" (small for high-scoring sports)
  } = {}
): NormalOutcomes {
  const ouLines = options.ouLines ?? [];
  const handicapLines = options.handicapLines ?? [-10.5, -8.5, -6.5, -4.5, -2.5, -1.5, 1.5, 2.5, 4.5, 6.5, 8.5, 10.5];
  const drawBuffer = options.drawBuffer ?? 0.5; // For point-scoring sports

  const meanTotal = meanHome + meanAway;
  const varTotal = stdDevHome ** 2 + stdDevAway ** 2;
  const stdTotal = Math.sqrt(varTotal);

  const meanMargin = meanHome - meanAway;
  const stdMargin = Math.sqrt(varTotal); // Same variance sum

  // Win probabilities
  // P(margin > 0.5) for home, P(margin < -0.5) for away, remainder for draw
  const homeWin = normalSurvival(drawBuffer, meanMargin, stdMargin);
  const awayWin = normalCdf(-drawBuffer, meanMargin, stdMargin);
  const draw = 1 - homeWin - awayWin;

  const overUnder: Record<number, { over: number; under: number }> = {};
  ouLines.forEach(line => {
    const over = normalSurvival(line, meanTotal, stdTotal);
    overUnder[line] = { over, under: 1 - over };
  });

  const handicaps: Record<number, { home: number; away: number; push: number }> = {};
  handicapLines.forEach(line => {
    // Home wins handicap if margin + line > 0.5
    const homeWin = normalSurvival(-line + drawBuffer, meanMargin, stdMargin);
    const awayWin = normalCdf(-line - drawBuffer, meanMargin, stdMargin);
    const push = 1 - homeWin - awayWin;
    handicaps[line] = { home: homeWin, away: awayWin, push: Math.max(0, push) };
  });

  return {
    homeWin,
    draw,
    awayWin,
    overUnder,
    handicaps,
    expectedTotal: meanTotal,
    expectedMargin: meanMargin,
  };
}
