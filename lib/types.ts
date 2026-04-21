import type { Fixture, Standing } from '@/lib/api-football';
import type { AdvancedMatchPrediction } from '@/lib/advanced-prediction-engine';
import type { MatchPrediction, TeamForm } from '@/lib/prediction-engine';
import type {
  BankoSelection,
  ConfidenceSummary,
  EnsemblePrediction,
  SourceDiagnostics,
} from '@/lib/types/ensemble-types';

export type Expense = {
  id: string;
  amount: number;
  category: string;
  description: string;
  date: Date;
};

export type ExpenseFormData = Omit<Expense, 'id' | 'date'> & {
  date: string;
};

export const EXPENSE_CATEGORIES = [
  'Food',
  'Transportation',
  'Housing',
  'Utilities',
  'Entertainment',
  'Healthcare',
  'Shopping',
  'Education',
  'Other',
] as const;

export type DateRange = {
  from: Date | undefined;
  to: Date | undefined;
};

export interface HeadToHeadSummary {
  total_matches: number;
  team1_wins: number;
  team2_wins: number;
  draws: number;
}

export interface PredictionMetadata {
  homeForm?: TeamForm | null;
  awayForm?: TeamForm | null;
  h2hRecord?: HeadToHeadSummary | null;
  homeStanding?: Standing | null;
  awayStanding?: Standing | null;
  [key: string]: unknown;
}

export interface SourceSnapshots {
  apiPredictions: Record<string, unknown> | null;
  basicPrediction: MatchPrediction | null;
  advancedPrediction: AdvancedMatchPrediction | null;
}

export interface PredictionApiData {
  match: Fixture;
  ensemblePrediction: EnsemblePrediction;
  sourceDiagnostics: SourceDiagnostics;
  bankoSelections: BankoSelection[];
  confidenceSummary: ConfidenceSummary;
  sourceSnapshots?: SourceSnapshots;
  metadata: PredictionMetadata;
  apiPredictions?: Record<string, unknown> | null;
  advancedPrediction?: AdvancedMatchPrediction | null;
  basicPrediction?: MatchPrediction | null;
}

export interface PredictionApiSuccessResponse {
  success: true;
  data: PredictionApiData;
}

export interface PredictionApiErrorResponse {
  success: false;
  error: string;
  message?: string;
}

export type PredictionApiResponse =
  | PredictionApiSuccessResponse
  | PredictionApiErrorResponse;
