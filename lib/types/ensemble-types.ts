import type { MatchPrediction } from '@/lib/prediction-engine';
import type { AdvancedMatchPrediction } from '@/lib/advanced-prediction-engine';

/**
 * Market identifiers supported by the ensemble engine.
 */
export type MarketType =
  | 'matchResult'
  | 'overUnderGoals'
  | 'bothTeamsToScore'
  | 'firstHalfResult'
  | 'firstHalfGoals'
  | 'cards'
  | 'corners'
  | 'exactScore';

export interface ProbabilitySet {
  [key: string]: number;
}

export interface ConfidenceBreakdown {
  factor: string;
  contribution: number;
  note?: string;
}

export interface ConfidenceScore {
  value: number;
  label: 'low' | 'medium' | 'high';
  breakdown?: ConfidenceBreakdown[];
}

export interface MatchResultPrediction {
  market: 'matchResult';
  probabilities: {
    home: number;
    draw: number;
    away: number;
  };
  prediction: 'home' | 'draw' | 'away';
  confidence: ConfidenceScore;
  expectedGoals?: {
    home: number | null;
    away: number | null;
    total: number | null;
  };
}

export interface GoalLinePrediction {
  threshold: number;
  overProbability: number;
  underProbability: number;
  recommendation: 'over' | 'under';
  confidence: ConfidenceScore;
}

export interface GoalsPrediction {
  market: 'overUnderGoals';
  lines: GoalLinePrediction[];
  expectedTotalGoals: number | null;
}

export interface BothTeamsScorePrediction {
  market: 'bothTeamsToScore';
  yesProbability: number;
  noProbability: number;
  prediction: 'yes' | 'no';
  confidence: ConfidenceScore;
}

export interface FirstHalfResultPrediction {
  market: 'firstHalfResult';
  probabilities: {
    home: number;
    draw: number;
    away: number;
  };
  prediction: 'home' | 'draw' | 'away';
  confidence: ConfidenceScore;
}

export interface FirstHalfGoalsPrediction {
  market: 'firstHalfGoals';
  over05: number | null;
  over15: number | null;
  homeScore: number | null;
  awayScore: number | null;
  bothTeamsScore: number | null;
  confidence: ConfidenceScore;
}

export interface CardsPrediction {
  over35: number | null;
  over45: number | null;
  under35: number | null;
  under45: number | null;
  confidence: ConfidenceScore;
}

export interface CornersPrediction {
  over85: number | null;
  over95: number | null;
  under85: number | null;
  under95: number | null;
  confidence: ConfidenceScore;
}

export interface ExactScorePrediction {
  score: string;
  probability: number;
  confidence: ConfidenceScore;
}

export interface SpecialMarketsPrediction {
  market: 'cards' | 'corners' | 'exactScore';
  cards?: CardsPrediction;
  corners?: CornersPrediction;
  exactScores?: ExactScorePrediction[];
}

export interface AgreementAnalysis {
  market: MarketType;
  variance: number;
  consensus: number;
  disagreeingSources?: string[];
}

export interface SourceContribution {
  source: keyof SourceAvailability;
  weight: number;
  confidence?: number | null;
  contribution?: number | null;
}

export interface MarketDiagnostic {
  market: MarketType;
  sourcesUsed: SourceContribution[];
  normalizedProbabilities?: ProbabilitySet;
  agreement?: AgreementAnalysis;
  notes?: string[];
}

export interface SourceDiagnostics {
  availability: SourceAvailability;
  reliabilityWeights: Partial<Record<keyof SourceAvailability, number>>;
  markets: MarketDiagnostic[];
  overallConsensus: number;
}

export interface BankoSelection {
  market: MarketType;
  label: string;
  confidence: number;
  rationale: string[];
}

export interface ConfidenceSummary {
  overall: ConfidenceScore;
  marketBreakdown: Record<MarketType, ConfidenceScore>;
}

export interface EnsemblePrediction {
  matchResult: MatchResultPrediction;
  goals: GoalsPrediction;
  bothTeamsScore: BothTeamsScorePrediction;
  firstHalf: {
    result: FirstHalfResultPrediction;
    goals: FirstHalfGoalsPrediction;
  };
  specialMarkets: {
    cards?: CardsPrediction;
    corners?: CornersPrediction;
    exactScores?: ExactScorePrediction[];
  };
  confidence: ConfidenceSummary;
  bankoSelections: BankoSelection[];
  diagnostics: SourceDiagnostics;
}

export interface ApiFootballPredictionTeamStats {
  form?: string | null;
  att?: string | null;
  def?: string | null;
  goals?: {
    for?: {
      total?: number | string | null;
      average?: string | null;
    };
    against?: {
      total?: number | string | null;
      average?: string | null;
    };
  };
  cards_per_game?: {
    yellow?: number | string | null;
    red?: number | string | null;
  };
  corners_per_game?: number | string | null;
}

export interface ApiFootballPrediction {
  predictions?: {
    winner?: {
      id?: number;
      name?: string;
      comment?: string;
    };
    match_winner?: {
      home?: string | number;
      draw?: string | number;
      away?: string | number;
    };
    percent?: {
      home?: string | number;
      draw?: string | number;
      away?: string | number;
    };
    goals?: {
      home?: string | number;
      away?: string | number;
      total?: string | number;
    };
    under_over?: {
      over?: string | number;
      under?: string | number;
    };
    btts?: {
      yes?: string | number;
      no?: string | number;
    };
    advice?: string | null;
    correct_score?: {
      home?: Record<string, string | number>;
      away?: Record<string, string | number>;
    };
  };
  comparison?: {
    form?: { home?: string | null; away?: string | null };
    att?: { home?: string | null; away?: string | null };
    def?: { home?: string | null; away?: string | null };
    poisson_distribution?: { home?: string | null; away?: string | null };
    h2h?: { home?: string | null; away?: string | null };
  };
  teams?: {
    home?: ApiFootballPredictionTeamStats;
    away?: ApiFootballPredictionTeamStats;
  };
  league?: {
    id?: number;
    name?: string;
    season?: number;
    round?: string;
  };
  h2h?: Array<{
    fixture?: { id?: number; date?: string };
    goals?: { home?: number; away?: number };
    teams?: {
      home?: { id?: number; name?: string };
      away?: { id?: number; name?: string };
    };
  }>;
}

export interface SourceAvailability {
  apiFootball: boolean;
  basicEngine: boolean;
  advancedEngine: boolean;
}

export interface EnsembleInput {
  apiFootball?: ApiFootballPrediction | null;
  basicPrediction?: MatchPrediction | null;
  advancedPrediction?: AdvancedMatchPrediction | null;
  availability?: Partial<SourceAvailability>;
}

export interface SourceWeightConfig {
  apiFootball?: number;
  basicEngine?: number;
  advancedEngine?: number;
}

export interface MarketWeightConfig {
  weights: SourceWeightConfig;
  agreementBoost?: number;
  disagreementPenalty?: number;
}

export interface ConfidenceAdjustmentConfig {
  lowConfidenceThreshold: number;
  lowConfidenceWeightPenalty: number;
  highAgreementThreshold: number;
  highAgreementBoost: number;
  significantDisagreementThreshold: number;
  significantDisagreementUncertainty: number;
}

export interface FallbackRules {
  minimumSources: number;
  defaultRedistribution: SourceWeightConfig;
  whenApiFootballMissing?: SourceWeightConfig;
  whenAdvancedEngineMissing?: SourceWeightConfig;
  whenBasicEngineMissing?: SourceWeightConfig;
}

export interface NormalizationConfig {
  percentageKeys?: string[];
  decimalPrecision?: number;
  allowPercentageStrings?: boolean;
  normalizeToOne?: boolean;
}

export interface BankoCriteria {
  minimumConfidence: number;
  agreementWindow: number;
  requiredSources: number;
  advancedEngineMinimum: number;
  marketOverrides?: Partial<Record<MarketType, Partial<BankoCriteria>>>;
}

export interface RiskLevelConfig {
  minConfidence: number;
  maxVariance: number;
}

export interface RiskLevels {
  low: RiskLevelConfig;
  medium: RiskLevelConfig;
  high: RiskLevelConfig;
}

export interface EnsembleWeights {
  sourceReliability: SourceWeightConfig;
  markets: Partial<Record<MarketType, MarketWeightConfig>> & {
    matchResult: MarketWeightConfig;
    overUnderGoals: MarketWeightConfig;
    bothTeamsToScore: MarketWeightConfig;
    firstHalfResult: MarketWeightConfig;
    cards: MarketWeightConfig;
    corners: MarketWeightConfig;
    exactScore: MarketWeightConfig;
  };
  confidenceAdjustments: ConfidenceAdjustmentConfig;
  fallbacks: FallbackRules;
  normalization: NormalizationConfig;
  bankoCriteria: BankoCriteria;
  riskLevels: RiskLevels;
}
