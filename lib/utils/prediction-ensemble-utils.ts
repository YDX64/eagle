import type { Standing } from '@/lib/api-football';
import type { AdvancedMatchPrediction } from '@/lib/advanced-prediction-engine';
import type { MatchPrediction, TeamForm } from '@/lib/prediction-engine';
import type {
  EnsembleInput,
  SourceAvailability,
} from '@/lib/types/ensemble-types';
import type {
  HeadToHeadSummary,
  PredictionMetadata,
  SourceSnapshots,
} from '@/lib/types';

interface BuildEnsembleInputParams {
  apiFootballPrediction: EnsembleInput['apiFootball'];
  basicPrediction: EnsembleInput['basicPrediction'];
  advancedPrediction: EnsembleInput['advancedPrediction'];
  availabilityOverride?: Partial<SourceAvailability>;
}

export function buildEnsembleInput({
  apiFootballPrediction,
  basicPrediction,
  advancedPrediction,
  availabilityOverride,
}: BuildEnsembleInputParams): EnsembleInput {
  return {
    apiFootball: apiFootballPrediction ?? null,
    basicPrediction: basicPrediction ?? null,
    advancedPrediction: advancedPrediction ?? null,
    availability: {
      apiFootball: Boolean(apiFootballPrediction),
      basicEngine: Boolean(basicPrediction),
      advancedEngine: Boolean(advancedPrediction),
      ...availabilityOverride,
    },
  };
}

interface BuildSourceSnapshotsParams {
  apiPredictions: SourceSnapshots['apiPredictions'];
  basicPrediction: MatchPrediction | null;
  advancedPrediction: AdvancedMatchPrediction | null;
}

export function buildSourceSnapshots({
  apiPredictions,
  basicPrediction,
  advancedPrediction,
}: BuildSourceSnapshotsParams): SourceSnapshots {
  return {
    apiPredictions,
    basicPrediction,
    advancedPrediction,
  };
}

interface BuildPredictionMetadataParams {
  homeForm?: TeamForm | null;
  awayForm?: TeamForm | null;
  h2hRecord?: HeadToHeadSummary | null;
  homeStanding?: Standing | null;
  awayStanding?: Standing | null;
  extras?: Record<string, unknown>;
}

export function buildPredictionMetadata({
  homeForm,
  awayForm,
  h2hRecord,
  homeStanding,
  awayStanding,
  extras,
}: BuildPredictionMetadataParams): PredictionMetadata {
  return {
    homeForm: homeForm ?? null,
    awayForm: awayForm ?? null,
    h2hRecord: h2hRecord ?? null,
    homeStanding: homeStanding ?? null,
    awayStanding: awayStanding ?? null,
    ...extras,
  };
}
