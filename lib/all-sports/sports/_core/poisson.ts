/**
 * Poisson Distribution - Düşük-orta skorlu sporlar için
 * Kullanım: Futbol, hockey, hentbol, beyzbol
 *
 * P(X=k) = (λ^k * e^-λ) / k!
 *
 * λ = beklenen gol/sayı sayısı
 */

export function factorial(n: number): number {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

export function poissonProb(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

/**
 * Calculate full match outcome probabilities using two independent Poissons
 * Returns joint probability matrix for scores up to maxGoals
 */
export function calculatePoissonMatrix(
  lambdaHome: number,
  lambdaAway: number,
  maxGoals: number = 15
): number[][] {
  const matrix: number[][] = [];
  for (let h = 0; h <= maxGoals; h++) {
    matrix[h] = [];
    for (let a = 0; a <= maxGoals; a++) {
      matrix[h][a] = poissonProb(lambdaHome, h) * poissonProb(lambdaAway, a);
    }
  }
  return matrix;
}

export interface PoissonOutcomes {
  homeWin: number;
  draw: number;
  awayWin: number;
  overUnder: Record<number, { over: number; under: number }>;
  btts: { yes: number; no: number };
  exactScores: { home: number; away: number; probability: number }[];
  handicaps: Record<number, { home: number; away: number; push: number }>;
  oddEven: { odd: number; even: number };
}

/**
 * Derive all outcomes from a Poisson matrix
 * Returns normalized probabilities
 */
export function deriveOutcomes(
  lambdaHome: number,
  lambdaAway: number,
  options: {
    maxGoals?: number;
    ouLines?: number[];
    handicapLines?: number[];
  } = {}
): PoissonOutcomes {
  const maxGoals = options.maxGoals ?? 15;
  const ouLines = options.ouLines ?? [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5];
  const handicapLines = options.handicapLines ?? [-3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5];

  const matrix = calculatePoissonMatrix(lambdaHome, lambdaAway, maxGoals);

  let homeWin = 0, draw = 0, awayWin = 0;
  let bttsYes = 0;
  let oddTotal = 0, evenTotal = 0;
  const ouAccum: Record<number, number> = {};
  const hcAccum: Record<number, { home: number; away: number; push: number }> = {};
  const exactScores: { home: number; away: number; probability: number }[] = [];

  ouLines.forEach(l => { ouAccum[l] = 0; });
  handicapLines.forEach(l => { hcAccum[l] = { home: 0, away: 0, push: 0 }; });

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = matrix[h][a];
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;

      if (h > 0 && a > 0) bttsYes += p;

      const total = h + a;
      if (total % 2 === 1) oddTotal += p;
      else evenTotal += p;

      ouLines.forEach(line => {
        if (total > line) ouAccum[line] += p;
      });

      handicapLines.forEach(line => {
        const diff = h - a + line; // handicap applied to home
        if (diff > 0) hcAccum[line].home += p;
        else if (diff < 0) hcAccum[line].away += p;
        else hcAccum[line].push += p;
      });

      if (h <= 8 && a <= 8) {
        exactScores.push({ home: h, away: a, probability: p });
      }
    }
  }

  // Normalize (should already sum ~1)
  const sum = homeWin + draw + awayWin;
  if (sum > 0) {
    homeWin /= sum;
    draw /= sum;
    awayWin /= sum;
  }

  const overUnder: Record<number, { over: number; under: number }> = {};
  ouLines.forEach(line => {
    overUnder[line] = { over: ouAccum[line], under: 1 - ouAccum[line] };
  });

  return {
    homeWin,
    draw,
    awayWin,
    overUnder,
    btts: { yes: bttsYes, no: 1 - bttsYes },
    exactScores: exactScores.sort((a, b) => b.probability - a.probability),
    handicaps: hcAccum,
    oddEven: { odd: oddTotal, even: evenTotal },
  };
}

/**
 * Calculate split handicap (Iddaa Kırık Handikap)
 * Example: "-0.5, -1" = half stake on -0.5, half stake on -1
 * Returns combined effective probability
 */
export function splitHandicapProb(
  lambdaHome: number,
  lambdaAway: number,
  line1: number,
  line2: number,
  forHome: boolean,
  maxGoals: number = 15
): number {
  // Calculate outcome for each line
  const matrix = calculatePoissonMatrix(lambdaHome, lambdaAway, maxGoals);
  let total = 0;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = matrix[h][a];
      const diff1 = forHome ? (h - a + line1) : (a - h + line1);
      const diff2 = forHome ? (h - a + line2) : (a - h + line2);
      // Half win on each; if win = 1, push = 0.5, loss = 0 effective
      const score1 = diff1 > 0 ? 1 : diff1 === 0 ? 0.5 : 0;
      const score2 = diff2 > 0 ? 1 : diff2 === 0 ? 0.5 : 0;
      // Combined effective probability of "breaking even or winning"
      const combined = (score1 + score2) / 2;
      total += p * combined;
    }
  }
  return total;
}
