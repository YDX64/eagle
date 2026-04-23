/**
 * Player-prop prediction engine types.
 *
 * This module defines every market the cross-sport player-prop engine
 * supports. Market codes are deliberately normalized so the settlement and
 * tracking layers can persist them as `BB_PLAYER_POINTS_OVER_245`, etc.
 */

import type { ConfidenceTier, MarketCategory, NormalizedPlayerProp, SportCode } from '@/lib/tracking/types';

/** All player-prop markets the engine can currently emit. */
export type PlayerPropMarket =
  // Basketball
  | 'POINTS'
  | 'REBOUNDS'
  | 'ASSISTS'
  | 'THREE_POINTERS'
  | 'STEALS'
  | 'BLOCKS'
  | 'PRA' // points + rebounds + assists
  // Hockey
  | 'GOALS'
  | 'SHOTS_ON_GOAL'
  | 'HOCKEY_ASSISTS' // distinguished from basketball assists
  | 'HOCKEY_POINTS' // goals + assists
  | 'BLOCKED_SHOTS'
  // Baseball
  | 'STRIKEOUTS'
  | 'HITS'
  | 'HOME_RUNS'
  | 'RBIS'
  | 'RUNS'
  | 'TOTAL_BASES';

/** Sport prefix used when building canonical market codes. */
export type SportPrefix = 'BB' | 'HO' | 'BS';

/** Sports this engine supports (subset of SportCode). */
export type PlayerPropSport = Extract<SportCode, 'basketball' | 'hockey' | 'baseball'>;

/** Statistical distribution driving the over/under probability integral. */
export type StatDistribution = 'poisson' | 'negative_binomial' | 'normal';

/** A single over/under line produced for a player×market pair. */
export interface PlayerPropLine {
  player_id: number;
  player_name: string;
  team_id: number;
  team_name: string;
  position: string | null;

  /** Canonical market (e.g. POINTS, SHOTS_ON_GOAL, STRIKEOUTS). */
  market: PlayerPropMarket;

  /** Canonical market code used on the wire: BB_PLAYER_POINTS_OVER_245 etc. */
  market_code: string;

  /** Human-readable market label in Turkish for UI display. */
  market_label: string;

  /** Over/under line (e.g. 24.5, 5.5). */
  line: number;

  /** Selection side: OVER or UNDER (player-prop engine never emits YES/NO). */
  selection: 'OVER' | 'UNDER';

  /** Model probability the player's stat will finish strictly above the line. */
  over_prob: number;

  /** Complement: probability at or below the line (accounting for integer push behavior). */
  under_prob: number;

  /** Bookmaker odds if attached upstream — optional, populated when API odds present. */
  over_odds?: number;
  under_odds?: number;

  /** Turkish natural-language recommendation ("LeBron James 24.5 üstü"). */
  recommendation: string;

  /** 0..1 confidence = max(over_prob, under_prob) clamped to recommendation side. */
  confidence: number;

  /** Tier derived from confidence: platinum ≥0.70, gold ≥0.60, silver ≥0.55. */
  confidence_tier: ConfidenceTier;

  /** Turkish reasoning: which factors drove the pick. */
  reasoning: string;

  /** Snapshot of numeric inputs for audit/tracking. */
  factors: PlayerPropFactors;
}

/** Inputs used in a prediction; stored alongside the pick for explainability. */
export interface PlayerPropFactors {
  projected_mean: number;
  projected_std_dev: number;
  distribution: StatDistribution;
  /** Raw season-average statistic before matchup/pace adjustments. */
  baseline_mean: number;
  /** Multiplicative matchup factor (1.0 = neutral). */
  matchup_factor: number;
  /** Multiplicative pace factor (1.0 = neutral). */
  pace_factor: number;
  /** Home/away additive-or-multiplicative adjustment applied (as fraction, e.g. +0.04). */
  home_adjustment: number;
  /** Sample size used to compute the baseline (games_played etc.). */
  sample_size: number;
  /** Expected minutes / innings / ice-time if known — otherwise null. */
  expected_usage: number | null;
}

/** Container returned by every sport-specific generator. */
export interface PlayerPropPredictionResult {
  sport: PlayerPropSport;
  game_id: number;
  league_id: number | null;
  league_name: string | null;
  season: string | number | null;
  home_team: string;
  home_team_id: number;
  away_team: string;
  away_team_id: number;
  game_date: string;
  players: PlayerPropLine[];
  high_confidence: PlayerPropLine[];
  generated_at: string;
  /**
   * Non-fatal messages from the generator — e.g. "no player data source
   * available for this sport/league, returning empty players[]".
   * Populated so consumers can surface the reason upstream.
   */
  notes?: string[];
  /** Counts for quick UI display. */
  summary?: {
    home_roster_size: number;
    away_roster_size: number;
    lines_emitted: number;
    platinum_count: number;
    gold_count: number;
    silver_count: number;
  };
}

/** Per-market line sets used by the generator. */
export interface MarketLineConfig {
  market: PlayerPropMarket;
  lines: readonly number[];
  distribution: StatDistribution;
  /** Minimum projected mean above which we bother generating a line. */
  min_projected_mean?: number;
  /** Category for persistence — player props are always 'player'. */
  category?: MarketCategory;
}

/** Helper re-export so consumers importing from this module have a one-stop-shop. */
export type { NormalizedPlayerProp };

/**
 * Build the canonical market code that market-taxonomy and the tracking layer expect.
 * Examples:
 *   buildMarketCode('BB', 'POINTS', 24.5, 'OVER')   -> 'BB_PLAYER_POINTS_OVER_245'
 *   buildMarketCode('HO', 'SHOTS_ON_GOAL', 3.5, 'UNDER') -> 'HO_PLAYER_SHOTS_UNDER_35'
 *   buildMarketCode('BS', 'STRIKEOUTS', 6.5, 'OVER') -> 'BS_PLAYER_STRIKEOUTS_OVER_65'
 *
 * We intentionally collapse a few long names to keep market codes compact and
 * human readable (THREE_POINTERS -> THREES, SHOTS_ON_GOAL -> SHOTS,
 * HOCKEY_ASSISTS -> ASSISTS, HOCKEY_POINTS -> POINTS, BLOCKED_SHOTS -> BLOCKS).
 */
export function buildMarketCode(
  prefix: SportPrefix,
  market: PlayerPropMarket,
  line: number,
  selection: 'OVER' | 'UNDER',
): string {
  const short = MARKET_CODE_ALIASES[market] ?? market;
  // 24.5 -> 245 ; 0.5 -> 5 ; 10.5 -> 105 — a-la football OVER_25 convention.
  const lineCode = Math.round(line * 10).toString();
  return `${prefix}_PLAYER_${short}_${selection}_${lineCode}`;
}

/** Alias map so the generated codes line up with the constraints specified by the spec. */
const MARKET_CODE_ALIASES: Partial<Record<PlayerPropMarket, string>> = {
  THREE_POINTERS: 'THREES',
  SHOTS_ON_GOAL: 'SHOTS',
  HOCKEY_ASSISTS: 'ASSISTS',
  HOCKEY_POINTS: 'POINTS',
  BLOCKED_SHOTS: 'BLOCKS',
};

/** Friendly Turkish market label used in PlayerPropLine.market_label. */
export function getTurkishMarketLabel(market: PlayerPropMarket): string {
  switch (market) {
    case 'POINTS':
      return 'Sayı';
    case 'REBOUNDS':
      return 'Ribaund';
    case 'ASSISTS':
      return 'Asist';
    case 'THREE_POINTERS':
      return 'Üçlük';
    case 'STEALS':
      return 'Top Çalma';
    case 'BLOCKS':
      return 'Blok';
    case 'PRA':
      return 'Sayı + Ribaund + Asist';
    case 'GOALS':
      return 'Gol';
    case 'SHOTS_ON_GOAL':
      return 'Kaleye İsabetli Şut';
    case 'HOCKEY_ASSISTS':
      return 'Asist (Hokey)';
    case 'HOCKEY_POINTS':
      return 'Puan (Hokey)';
    case 'BLOCKED_SHOTS':
      return 'Bloklanmış Şut';
    case 'STRIKEOUTS':
      return 'Strikeout';
    case 'HITS':
      return 'Vuruş';
    case 'HOME_RUNS':
      return 'Home Run';
    case 'RBIS':
      return 'RBI';
    case 'RUNS':
      return 'Koşu';
    case 'TOTAL_BASES':
      return 'Toplam Base';
  }
}

/** Confidence tier thresholds used by every sport generator. */
export const CONFIDENCE_THRESHOLDS = {
  platinum: 0.70,
  gold: 0.60,
  silver: 0.55,
} as const;

export function classifyConfidence(confidence: number): ConfidenceTier | null {
  if (confidence >= CONFIDENCE_THRESHOLDS.platinum) return 'platinum';
  if (confidence >= CONFIDENCE_THRESHOLDS.gold) return 'gold';
  if (confidence >= CONFIDENCE_THRESHOLDS.silver) return 'silver';
  return null;
}
