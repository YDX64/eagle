import { Prisma, PrismaClient } from '@prisma/client';

import type { PredictionMetadata, SourceSnapshots } from '@/lib/types';
import type { EnsemblePrediction } from '@/lib/types/ensemble-types';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Prisma schema uses SQLite. If no DATABASE_URL is provided (e.g. in scripts
// that forget to load .env), fall back to the project-local dev.db file so
// we never create a nested `prisma/prisma/dev.db` like earlier revisions.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'file:./prisma/dev.db';
}

export const prisma = globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

interface SaveEnsemblePredictionParams {
  matchId: number;
  ensemblePrediction: EnsemblePrediction;
  metadata?: PredictionMetadata;
  sourceSnapshots?: SourceSnapshots;
}

const clamp = (value: number | null | undefined, min = 0, max = 1): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
};

const ratioOrNull = (numerator?: number | null, denominator?: number | null): number | null => {
  if (!numerator || !denominator || denominator === 0) {
    return null;
  }
  return numerator / denominator;
};

export async function saveEnsemblePrediction({
  matchId,
  ensemblePrediction,
  metadata,
  sourceSnapshots,
}: SaveEnsemblePredictionParams): Promise<void> {
  try {
    const predictedValue = ensemblePrediction.matchResult.prediction;
    const overallConfidence = clamp(ensemblePrediction.confidence.overall.value, 0, 1);

    const factorsPayload = {
      confidence: ensemblePrediction.confidence,
      bankoSelections: ensemblePrediction.bankoSelections,
      diagnostics: ensemblePrediction.diagnostics,
      sourceSnapshots,
    };

    const homeFormScore = metadata?.homeForm?.form_score ?? null;
    const awayFormScore = metadata?.awayForm?.form_score ?? null;
    const headToHeadScore = metadata?.h2hRecord
      ? ratioOrNull(metadata.h2hRecord.team1_wins, metadata.h2hRecord.total_matches)
      : null;
    const homeAdvantageScore = metadata?.h2hRecord
      ? clamp(
          (metadata.h2hRecord.team1_wins - metadata.h2hRecord.team2_wins) /
            (metadata.h2hRecord.total_matches || 1) /
            2 +
            0.5,
          0,
          1
        )
      : null;
    const goalsAnalysisScore = typeof ensemblePrediction.goals.expectedTotalGoals === 'number'
      ? ensemblePrediction.goals.expectedTotalGoals
      : null;

    const existingPrediction = await prisma.prediction.findFirst({
      where: {
        match_id: matchId,
        prediction_type: 'ensemble',
        algorithm_version: '3.0',
      },
    });

    const factorsUsed = factorsPayload as unknown as Prisma.InputJsonValue;
    const basePayload = {
      prediction_type: 'ensemble',
      predicted_value: predictedValue,
      confidence_score: overallConfidence,
      home_form_score: homeFormScore,
      away_form_score: awayFormScore,
      head_to_head_score: headToHeadScore,
      home_advantage_score: homeAdvantageScore,
      goals_analysis_score: goalsAnalysisScore,
      factors_used: factorsUsed,
      algorithm_version: '3.0',
      is_high_confidence: overallConfidence >= 0.7,
    };

    if (existingPrediction) {
      await prisma.prediction.update({
        where: { id: existingPrediction.id },
        data: basePayload as Prisma.PredictionUncheckedUpdateInput,
      });
    } else {
      await prisma.prediction.create({
        data: {
          match_id: matchId,
          ...basePayload,
        } as Prisma.PredictionUncheckedCreateInput,
      });
    }
  } catch (error) {
    console.error('[PREDICTION] Failed to persist ensemble prediction:', error);
  }
}

// Gracefully handle connection
prisma.$connect().catch((error: unknown) => {
  console.error('Failed to connect to database:', error);
});
