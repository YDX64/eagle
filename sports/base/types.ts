
export type SportType = 'football' | 'basketball' | 'hockey' | 'volleyball' | 'handball';

// Common API-Sports response envelope (same across all sports)
export interface ApiSportsResponse<T> {
  get: string;
  parameters: Record<string, string | number>;
  errors: Record<string, string> | string[];
  results: number;
  paging: { current: number; total: number };
  response: T[];
}

// Common team structure
export interface SportTeam {
  id: number;
  name: string;
  logo: string;
}

// Common league structure
export interface SportLeague {
  id: number;
  name: string;
  type: string;
  logo: string;
  country: {
    id: number;
    name: string;
    code: string | null;
    flag: string | null;
  };
  season: string | number;
}

// Common game status
export interface GameStatus {
  long: string;
  short: string;
  timer?: number | null;
}

// Base game structure (extended by each sport)
export interface BaseGame {
  id: number;
  date: string;
  time: string;
  timestamp: number;
  timezone: string;
  week: string | null;
  status: GameStatus;
  league: SportLeague;
  country: {
    id: number;
    name: string;
    code: string | null;
    flag: string | null;
  };
  teams: {
    home: SportTeam;
    away: SportTeam;
  };
}

// Basketball scores
export interface BasketballScores {
  home: {
    quarter_1: number | null;
    quarter_2: number | null;
    quarter_3: number | null;
    quarter_4: number | null;
    over_time: number | null;
    total: number | null;
  };
  away: {
    quarter_1: number | null;
    quarter_2: number | null;
    quarter_3: number | null;
    quarter_4: number | null;
    over_time: number | null;
    total: number | null;
  };
}

// Hockey scores
export interface HockeyScores {
  home: {
    period_1: number | null;
    period_2: number | null;
    period_3: number | null;
    overtime: number | null;
    penalties: number | null;
    total: number | null;
  };
  away: {
    period_1: number | null;
    period_2: number | null;
    period_3: number | null;
    overtime: number | null;
    penalties: number | null;
    total: number | null;
  };
}

// Volleyball scores
export interface VolleyballScores {
  home: {
    set_1: number | null;
    set_2: number | null;
    set_3: number | null;
    set_4: number | null;
    set_5: number | null;
    total: number | null;
  };
  away: {
    set_1: number | null;
    set_2: number | null;
    set_3: number | null;
    set_4: number | null;
    set_5: number | null;
    total: number | null;
  };
}

// Handball scores
export interface HandballScores {
  home: {
    half_1: number | null;
    half_2: number | null;
    extra_time: number | null;
    penalties: number | null;
    total: number | null;
  };
  away: {
    half_1: number | null;
    half_2: number | null;
    extra_time: number | null;
    penalties: number | null;
    total: number | null;
  };
}

// Sport-specific game types
export interface BasketballGame extends BaseGame {
  scores: BasketballScores;
}

export interface HockeyGame extends BaseGame {
  scores: HockeyScores;
}

export interface VolleyballGame extends BaseGame {
  scores: VolleyballScores;
}

export interface HandballGame extends BaseGame {
  scores: HandballScores;
}

// Common standing structure
export interface SportStanding {
  position: number;
  stage: string | null;
  group: { name: string; points: number | null } | null;
  team: SportTeam;
  league: { id: number; name: string; type: string; season: string | number; logo: string };
  country: { id: number; name: string; code: string | null; flag: string | null };
  games: {
    played: number;
    win: { total: number; percentage: string | null };
    lose: { total: number; percentage: string | null };
    draw?: { total: number; percentage: string | null };
  };
  points: { for: number; against: number; difference?: number } | null;
  form: string | null;
  description: string | null;
}

// Confidence tiers
export type ConfidenceTier = 'platinum' | 'gold' | 'silver';

// Value bet interface
export interface ValueBet {
  sport: SportType;
  game_id: number;
  home_team: string;
  away_team: string;
  league_name: string;
  game_date: string;
  market: string;
  selection: string;
  our_probability: number;
  market_odds: number;
  implied_probability: number;
  value_edge: number;
  expected_value: number;
  kelly_percentage: number;
  confidence_tier: ConfidenceTier;
  confidence_score: number;
  reasoning: string;
}

// Base prediction result
export interface SportPredictionResult {
  sport: SportType;
  game_id: number;
  match_result: {
    home_win: { probability: number; odds: number };
    away_win: { probability: number; odds: number };
    draw?: { probability: number; odds: number };
    confidence: number;
  };
  high_confidence_bets: Array<{
    title: string;
    description: string;
    confidence: number;
    reason: string;
    recommendation: string;
    market: string;
    selection: string;
    estimated_odds: number;
  }>;
  medium_risk_bets: Array<{
    title: string;
    description: string;
    confidence: number;
    reason: string;
    recommendation: string;
  }>;
  high_risk_bets: Array<{
    title: string;
    description: string;
    confidence: number;
    reason: string;
    recommendation: string;
  }>;
  prediction_confidence: number;
  confidence_tier: ConfidenceTier | null;
  analysis_factors: Record<string, number>;
  odds_data?: any;
  value_bets?: Array<{
    market: string;
    selection: string;
    model_probability: number;
    implied_probability: number;
    edge: number;
    bookmaker_odds?: number;
    is_value: boolean;
  }>;
  [key: string]: any; // Allow sport-specific additional fields
}

// Team form for any sport
export interface SportTeamForm {
  recent_matches: number;
  wins: number;
  losses: number;
  draws: number;
  points_for: number;
  points_against: number;
  form_score: number; // 0-1 scale
  form_string: string; // "WWLWL"
  home_form_score: number;
  away_form_score: number;
}
