/**
 * Shared types for the cross-sport prediction tracking system.
 *
 * The system persists every market prediction from every sport into the
 * `predictions` + `picks` tables (+ `player_prop_picks` for player markets),
 * then settles them post-match using authoritative game results.
 */

export type SportCode =
  | 'football'
  | 'basketball'
  | 'nba'
  | 'hockey'
  | 'handball'
  | 'volleyball'
  | 'baseball';

/** Canonical market family — used for cross-sport analytics grouping. */
export type MarketFamily =
  | 'match_winner' // 1X2, moneyline, 2-way match result
  | 'double_chance' // 1X, X2, 12
  | 'draw_no_bet' // DNB
  | 'handicap' // Asian handicap, puck line, point spread, runline
  | 'totals' // over/under team/match totals (goals, points, runs)
  | 'team_totals' // home/away team totals
  | 'btts' // both teams to score
  | 'ht_ft' // half-time/full-time combo
  | 'correct_score'
  | 'cards' // booking markets
  | 'corners' // corner markets (football)
  | 'first_half'
  | 'second_half'
  | 'quarter' // basketball quarter markets
  | 'period' // hockey period markets
  | 'set' // volleyball set markets
  | 'innings' // baseball innings markets
  | 'player_props' // player-specific
  | 'other';

export type MarketCategory = 'main' | 'side' | 'special' | 'player';

export type ConfidenceTier = 'platinum' | 'gold' | 'silver' | 'bronze';

/**
 * A single market pick from a prediction engine, normalized for persistence.
 * The persister converts engine-specific output into this shape.
 */
export interface NormalizedPick {
  market: string; // canonical market_code from taxonomy
  market_label?: string;
  pick_label?: string; // human-readable Turkish label
  category?: MarketCategory;
  probability: number; // 0..1
  market_odds?: number; // bookmaker odds if known
  expected_value?: number;
  is_best?: boolean;
  is_high_confidence?: boolean;
  score_value?: string; // for correct-score, ht-ft, etc.
}

/** A player-level prop pick (basketball/hockey/baseball). */
export interface NormalizedPlayerProp {
  player_id: number;
  player_name: string;
  team_id?: number;
  team_name?: string;
  position?: string;
  market: string; // POINTS, REBOUNDS, ASSISTS, GOALS, SHOTS, STRIKEOUTS, HITS, ...
  market_label?: string;
  line: number;
  selection: 'OVER' | 'UNDER' | 'YES' | 'NO';
  pick_label?: string;
  probability: number;
  market_odds?: number;
  expected_value?: number;
  is_high_confidence?: boolean;
  is_best?: boolean;
  category?: MarketCategory;
  confidence_tier?: ConfidenceTier;
  reasoning?: string;
  factors_used?: Record<string, unknown>;
}

/** Shape emitted by every sport's prediction engine → persister input. */
export interface NormalizedPrediction {
  sport: SportCode;
  api_game_id: number;
  home_team: string;
  away_team: string;
  league?: string;
  league_id?: number;
  match_date: Date | string;

  // Winner probabilities (if applicable)
  home_win_prob?: number;
  draw_prob?: number;
  away_win_prob?: number;

  // Overall match confidence
  confidence?: number;

  // Market picks — every bet the engine produced
  picks: NormalizedPick[];
  player_props?: NormalizedPlayerProp[];

  // System bet recommendations (multi-leg coupons)
  system_bets?: Array<{
    market: string;
    pick_label?: string;
    model_probability: number;
    market_odds?: number;
    expected_value?: number;
    kelly_stake?: number;
    risk_level?: string;
    category?: string;
  }>;

  // Pattern-matches from odds/historical patterns (optional)
  patterns?: Array<{
    pattern_id: string;
    pattern_name?: string;
    pattern_category?: string;
    hit_rate?: number;
    sample_size?: number;
    is_banko?: boolean;
    predicted_market?: string;
  }>;

  // Engine metadata for the payload JSONB column
  engine_version?: string;
  engine_name?: string;
  raw_payload?: Record<string, unknown>;
}

/** Result returned by the settlement engine for one prediction. */
export interface SettlementResult {
  prediction_id: string;
  sport: SportCode;
  api_game_id: number;
  picks_settled: number;
  picks_hit: number;
  system_bets_settled: number;
  system_bets_hit: number;
  player_props_settled: number;
  player_props_hit: number;
  errors: string[];
}

/** Analytics filters — common across performance/leaderboard endpoints. */
export interface AnalyticsFilters {
  sports?: SportCode[];
  markets?: string[];
  families?: MarketFamily[];
  categories?: MarketCategory[];
  tiers?: ConfidenceTier[];
  date_from?: string; // ISO
  date_to?: string; // ISO
  min_probability?: number;
  min_expected_value?: number;
  only_high_confidence?: boolean;
}

export interface MarketPerformanceRow {
  sport: SportCode;
  market: string;
  market_label?: string;
  family?: MarketFamily;
  total: number;
  hit: number;
  win_rate: number;
  avg_odds: number;
  avg_probability: number;
  total_stake: number; // assume 1 unit each
  total_return: number;
  roi: number;
  profit: number;
}
