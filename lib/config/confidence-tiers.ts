/**
 * Single source of truth for confidence tier thresholds.
 *
 * Historically three engines each had their own cut-offs which caused the
 * same 0.65 confidence to be classified as "high" in one place and
 * "medium" elsewhere, leading to inconsistent stake sizing. This module
 * must be the only place any tier decision happens.
 */

export interface ConfidenceTierDefinition {
  name: 'platinum' | 'gold' | 'silver' | 'bronze' | 'discard';
  min: number; // inclusive lower bound
  label: string;
  allowBanko: boolean;
}

/** Ordered from strongest to weakest. */
export const CONFIDENCE_TIERS: readonly ConfidenceTierDefinition[] = [
  { name: 'platinum', min: 0.85, label: 'Platinum', allowBanko: true },
  { name: 'gold',     min: 0.75, label: 'Gold',     allowBanko: true },
  { name: 'silver',   min: 0.65, label: 'Silver',   allowBanko: false },
  { name: 'bronze',   min: 0.50, label: 'Bronze',   allowBanko: false },
  { name: 'discard',  min: 0.00, label: 'Low',      allowBanko: false },
] as const;

export interface MarketThresholds {
  /** Probability above which we flip to the "yes" / "over" side. */
  pickCutoff: number;
  /** Probability above which we treat the pick as high-confidence. */
  highConfidence: number;
  /** Probability below which we treat the pick as high-confidence on the opposite side. */
  highConfidenceOpposite: number;
}

export const MARKET_THRESHOLDS = {
  btts: { pickCutoff: 0.5, highConfidence: 0.72, highConfidenceOpposite: 0.28 },
  overUnder25: { pickCutoff: 0.5, highConfidence: 0.68, highConfidenceOpposite: 0.32 },
  matchWinner: { pickCutoff: 0.5, highConfidence: 0.65, highConfidenceOpposite: 0.35 },
  firstHalfOver05: { pickCutoff: 0.5, highConfidence: 0.70, highConfidenceOpposite: 0.30 },
} satisfies Record<string, MarketThresholds>;

export function classifyConfidence(confidence: number): ConfidenceTierDefinition {
  const c = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;
  for (const tier of CONFIDENCE_TIERS) {
    if (c >= tier.min) return tier;
  }
  return CONFIDENCE_TIERS[CONFIDENCE_TIERS.length - 1];
}

export function isHighConfidence(confidence: number): boolean {
  return classifyConfidence(confidence).allowBanko;
}

/** Legacy buckets consumed by backtest engines. */
export const BACKTEST_BUCKETS = {
  high: 0.70,
  medium: 0.50,
} as const;
