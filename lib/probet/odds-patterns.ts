/**
 * Stub for ProBet odds-pattern engine.
 * The real implementation lives in the production /opt/probet tree on AWAXX
 * and was never committed to this repository. Until it is, pattern matching
 * returns no hits — callers should treat `matchAllPatterns` as a graceful
 * "no pattern data available" source.
 */

export interface LiveOddsSnapshot {
  fixture_id: number;
  snapshot_at?: string | Date;
  bookmakers?: Array<{
    name: string;
    markets: Array<{
      name: string;
      values: Array<{ value: string; odd: number | string }>;
    }>;
  }>;
  odds?: Record<string, Record<string, number>>;
  [key: string]: unknown;
}

export interface PatternMatch {
  pattern_id: string;
  pattern_name: string;
  category?: string;
  hit_rate?: number;
  sample_size?: number;
  is_banko?: boolean;
  predicted_market?: string;
}

/**
 * Match a live odds snapshot against known patterns. The stub implementation
 * returns an empty list — enable the full engine by deploying
 * `lib/probet/odds-patterns.ts` from the AWAXX probet tree.
 */
export function matchAllPatterns(_snap: LiveOddsSnapshot): PatternMatch[] {
  return [];
}
