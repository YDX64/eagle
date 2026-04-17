/**
 * Kelly Criterion - Optimal bahis miktarı hesaplama
 *
 * Kelly = (bp - q) / b
 *   b = odds - 1 (net odds)
 *   p = true probability of winning
 *   q = 1 - p
 *
 * Fractional Kelly (%25) kullanıyoruz = daha güvenli, volatilitede ölüm riski düşük.
 */

export function kellyStake(probability: number, odds: number, fraction: number = 0.25): number {
  if (odds <= 1 || probability <= 0 || probability >= 1) return 0;
  const b = odds - 1;
  const p = probability;
  const q = 1 - p;
  const kelly = (b * p - q) / b;
  return Math.max(0, kelly * fraction);
}

/**
 * Expected value of bet
 * EV > 0 = value bet
 */
export function expectedValue(probability: number, odds: number, stake: number = 1): number {
  const profit = (odds - 1) * stake;
  const loss = stake;
  return probability * profit - (1 - probability) * loss;
}

/**
 * Edge percentage
 * edge = (true_prob - implied_prob) / implied_prob
 */
export function calculateEdge(trueProbability: number, odds: number): number {
  const impliedProb = 1 / odds;
  return (trueProbability - impliedProb) / impliedProb;
}

/**
 * Rate value bet quality
 */
export function rateValueBet(edge: number): 'excellent' | 'good' | 'moderate' | 'low' {
  if (edge > 0.25) return 'excellent';
  if (edge > 0.15) return 'good';
  if (edge > 0.08) return 'moderate';
  return 'low';
}
