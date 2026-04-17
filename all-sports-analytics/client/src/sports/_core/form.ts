/**
 * Form Analysis - Son maç performansı
 * Form string örneği: "WWDLW" (son 5 maç: W=galibiyet, D=beraberlik, L=mağlubiyet)
 */

export function calculateFormScore(form: string | null | undefined): number {
  if (!form) return 50;
  const weights = [1, 1.2, 1.5, 1.8, 2.2]; // Son maçlar daha ağırlıklı
  const chars = form.split('').slice(-5);
  let score = 0;
  let maxScore = 0;

  chars.forEach((c, i) => {
    const weight = weights[i] || 1;
    maxScore += weight * 3;
    const upper = c.toUpperCase();
    if (upper === 'W') score += weight * 3;
    else if (upper === 'D' || upper === 'T') score += weight * 1;
    // L = 0
  });

  return maxScore > 0 ? (score / maxScore) * 100 : 50;
}

/**
 * Momentum: son N maçın weighted average'ı trend göstergesi
 */
export function calculateMomentum(scores: number[], decay: number = 0.85): number {
  if (scores.length === 0) return 0;
  let total = 0;
  let weightSum = 0;
  scores.forEach((s, i) => {
    const weight = Math.pow(decay, scores.length - 1 - i);
    total += s * weight;
    weightSum += weight;
  });
  return weightSum > 0 ? total / weightSum : 0;
}
