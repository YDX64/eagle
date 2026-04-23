/**
 * Stub for the ProBet prediction engine.
 * Real implementation is in the production /opt/probet tree; this file only
 * exports the shape consumers import so the main build stays green.
 */

export interface ProBetPrediction {
  fixture_id: number;
  sport?: string;
  home_team?: string;
  away_team?: string;
  generated_at?: string;
  // Main market summary
  match_winner?: { home: number; draw?: number; away: number };
  btts?: { yes: number; no: number };
  over_under_25?: { over: number; under: number };
  // Optional extended fields
  [key: string]: unknown;
}

export function isProBetPrediction(obj: unknown): obj is ProBetPrediction {
  return !!obj && typeof obj === 'object' && 'fixture_id' in (obj as any);
}
