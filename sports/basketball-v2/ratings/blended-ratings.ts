/**
 * Blended Ratings (ELO + Bayesian + Massey Ensemble)
 *
 * Combines multiple rating systems into a single composite score.
 * The blender weights are tunable but defaulted to:
 *   - Bayesian: 50% (most reliable, accounts for uncertainty)
 *   - ELO:      35% (fast-reactive, captures momentum)
 *   - Massey:   15% (linear baseline, sanity check)
 *
 * The composite is mapped to expected point margin via:
 *   margin = (home_composite - away_composite) * scale_factor
 */

import type { BayesianTeamRating } from './bayesian-hierarchical';

export interface BlendingWeights {
  bayesian: number;
  elo: number;
  massey: number;
}

export const DEFAULT_WEIGHTS: BlendingWeights = {
  bayesian: 0.50,
  elo: 0.35,
  massey: 0.15,
};

/**
 * Convert ELO to a "composite skill" comparable to Bayesian offense/defense.
 * ELO 1500 = 0 (league average), each 100 ELO ≈ 3 net points.
 */
export function eloToCompositeSkill(elo: number): number {
  return ((elo - 1500) / 100) * 3.0;
}

/**
 * Convert Bayesian net rating (off - def) to composite skill.
 */
export function bayesianToCompositeSkill(rating: BayesianTeamRating): number {
  return rating.offMean - rating.defMean;
}

/**
 * Compute blended composite skill from multiple rating systems.
 */
export function blendedCompositeSkill(args: {
  bayesian?: BayesianTeamRating | null;
  elo?: number | null;
  massey?: number | null;
  weights?: BlendingWeights;
}): number {
  const w = args.weights ?? DEFAULT_WEIGHTS;
  const components: Array<{ value: number; weight: number }> = [];

  if (args.bayesian) {
    components.push({
      value: bayesianToCompositeSkill(args.bayesian),
      weight: w.bayesian,
    });
  }
  if (args.elo !== null && args.elo !== undefined) {
    components.push({
      value: eloToCompositeSkill(args.elo),
      weight: w.elo,
    });
  }
  if (args.massey !== null && args.massey !== undefined) {
    components.push({
      value: args.massey,
      weight: w.massey,
    });
  }

  if (components.length === 0) return 0;

  const totalWeight = components.reduce((s, c) => s + c.weight, 0);
  const weighted = components.reduce((s, c) => s + c.value * c.weight, 0);
  return weighted / totalWeight;
}

/**
 * Predict point spread from two teams' blended composites + home court adv.
 */
export function predictSpread(
  homeComposite: number,
  awayComposite: number,
  homeCourtAdv: number = 3.0
): number {
  // Negative spread = home favored
  return -(homeComposite - awayComposite + homeCourtAdv);
}
