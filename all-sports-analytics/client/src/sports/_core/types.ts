/**
 * Core Sport Plugin System - Multi-Sport Architecture
 * Her spor bu interface'i implement eder
 *
 * TUTARLILIK GARANTISI: Tek interface, tek matematiksel çerçeve.
 * Sport-specific parametreler SportConfig'te, algoritmalar _core'da.
 */

export type SportId =
  | 'football'
  | 'hockey'
  | 'basketball'
  | 'nba'
  | 'handball'
  | 'americanFootball'
  | 'baseball'
  | 'volleyball'
  | 'rugby'
  | 'mma'
  | 'afl'
  | 'formula1';

export type ScoreMethod = 'poisson' | 'normal' | 'markov-set' | 'fight' | 'position';

export interface SportConfig {
  id: SportId;
  displayName: string;
  displayNameTR: string; // Turkish display name
  apiBase: string;
  apiKey: string;
  avgScoreHome: number; // Expected goals/points baseline home
  avgScoreAway: number; // Expected goals/points baseline away
  homeAdvantage: number; // Multiplier (e.g. 1.1 = 10% home boost)
  scoreMethod: ScoreMethod;
  // For normal distribution sports
  scoreStdDev?: number;
  // For volleyball/tennis: set probability model params
  setWinThreshold?: number;
  // Allowed draw? (basketball, NBA don't have draws in regulation+OT typically)
  allowsDraw: boolean;
  // Iddaa'da "iddaa kodu" - display category
  iddaaCategory: 'FB' | 'BK' | 'NBA' | 'VB' | 'HB' | 'AF' | 'BB' | 'HK' | 'RB' | 'MM' | 'AFL' | 'F1';
  // Available markets
  availableMarkets: string[];
  // API'deki bet type name -> iddaa adı mapping
  marketNameMapping: Record<string, string>;
}

// ===== GAME / MATCH (normalized across sports) =====
export interface NormalizedGame {
  id: number;
  sport: SportId;
  date: string;
  timestamp: number;
  status: {
    short: string;
    long: string;
    live: boolean;
    finished: boolean;
    upcoming: boolean;
  };
  league: {
    id: number;
    name: string;
    logo?: string;
    country?: string;
    season: number | string;
  };
  teams: {
    home: { id: number; name: string; logo?: string };
    away: { id: number; name: string; logo?: string };
  };
  scores: {
    home: number | null;
    away: number | null;
  };
  periods?: Record<string, string | null>;
  events?: boolean;
}

// ===== PREDICTION OUTPUT =====
export interface Prediction {
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  expectedHomeScore: number;
  expectedAwayScore: number;
  expectedTotalScore: number;
  // Over/Under lines with their probabilities
  overUnder: Record<string, { over: number; under: number }>;
  // Both teams to score (applicable to some sports)
  btts?: { yes: number; no: number };
  // Most likely exact scores (Poisson-based)
  mostLikelyScores: { home: number; away: number; probability: number }[];
  // Handicap probabilities (Asian)
  handicaps?: Record<string, { home: number; away: number; push?: number }>;
  // Confidence in prediction (0-100)
  confidence: number;
  // Form/quality inputs used
  homeForm: number;
  awayForm: number;
}

// ===== MARKET DEFINITION =====
export type MarketKind =
  | '1x2' | '2way' | 'double_chance'
  | 'over_under' | 'team_total' | 'btts'
  | 'handicap' | 'split_handicap' | 'spread'
  | 'correct_score' | 'ht_ft' | 'first_scorer'
  | 'odd_even' | 'winning_margin'
  | 'set_betting' | 'total_sets' | 'correct_set_score'
  | 'fighter_winner' | 'method_of_victory' | 'total_rounds'
  | 'race_winner' | 'podium' | 'fastest_lap'
  | 'corners' | 'cards' | 'goal_scorer' | 'half_winner';

export interface MarketDef {
  kind: MarketKind;
  apiName: string; // upstream provider bet name
  iddaaName: string; // iddaa'daki Türkçe adı
  description?: string;
}

// ===== VALUE BET DETECTION =====
export interface ValueBet {
  gameId: number;
  sport: SportId;
  marketKind: MarketKind;
  betType: string; // api name
  iddaaName: string;
  selection: string;
  bookmaker: string;
  odds: number;
  impliedProb: number; // 1/odds
  trueProbability: number; // algorithm's estimate
  edge: number; // (true - implied) / implied
  kellyStake: number; // fractional Kelly (already safety-adjusted)
  rating: 'excellent' | 'good' | 'moderate' | 'low';
  confidence: number;
  homeTeam: string;
  awayTeam: string;
  matchDate: string;
}

// ===== COUPON =====
export interface CouponBet {
  gameId: number;
  sport: SportId;
  sportDisplay: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchDate: string;
  betType: string;
  iddaaName: string;
  selection: string;
  odds: number;
  trueProbability: number;
  edge: number;
  confidence: number;
  result?: 'won' | 'lost' | 'pending' | 'void';
  actualScore?: { home: number; away: number };
}

export interface Coupon {
  id: string;
  name: string;
  createdAt: string;
  bets: CouponBet[];
  totalOdds: number;
  stake: number;
  potentialReturn: number;
  riskLevel: 'low' | 'medium' | 'high' | 'very-high';
  strategyName: string;
  status: 'pending' | 'won' | 'lost' | 'partial';
  settledAt?: string;
  actualReturn?: number;
  // Multi-sport coupon?
  isMultiSport?: boolean;
  sportsIncluded?: SportId[];
}

// ===== FILTER CONFIG =====
export interface CouponFilterConfig {
  minOdds: number; // Default 1.60
  maxOdds?: number; // Optional upper bound
  minProbability: number; // Default 70 (in %)
  minEdge: number; // Default 3 (in %)
  allowDraws: boolean;
  allowedSports: SportId[];
  maxBetsPerCoupon: number;
  minBetsPerCoupon: number;
}

// ===== NORMALIZED ODDS =====
export interface NormalizedOdds {
  gameId: number;
  bookmakers: {
    id: number;
    name: string;
    bets: {
      id: number;
      name: string; // api bet name
      kind?: MarketKind;
      iddaaName?: string;
      values: { value: string; odd: number }[];
    }[];
  }[];
}

// ===== SPORT PLUGIN INTERFACE =====
/**
 * Her spor bu interface'i export eder.
 * Foundation garantee: Aynı matematiksel temel, sport-specific parametre.
 */
export interface SportPlugin {
  config: SportConfig;

  // Data fetching - normalized to unified shape
  getGamesByDate(date: string): Promise<NormalizedGame[]>;
  getGameById(id: number): Promise<NormalizedGame | null>;
  getLiveGames(): Promise<NormalizedGame[]>;
  getOddsForGame(gameId: number): Promise<NormalizedOdds | null>;
  getH2H(homeTeamId: number, awayTeamId: number, season?: number): Promise<NormalizedGame[]>;
  getStandings?(leagueId: number, season: number): Promise<any[]>;
  getTeamStatistics?(teamId: number, leagueId: number, season: number): Promise<any>;

  // Prediction
  predict(params: {
    game: NormalizedGame;
    homeStats?: any;
    awayStats?: any;
    h2h?: NormalizedGame[];
    homeStanding?: any;
    awayStanding?: any;
  }): Prediction;

  // Market evaluator: Given prediction + bet, return true probability (0-1)
  evaluateMarket(params: {
    prediction: Prediction;
    betName: string; // api name
    selection: string;
    game: NormalizedGame;
  }): number; // returns 0 if market unsupported

  // Result evaluator: For settled games, is this bet won/lost/void?
  evaluateBetResult(params: {
    betName: string;
    selection: string;
    game: NormalizedGame;
  }): 'won' | 'lost' | 'void' | 'pending';
}
