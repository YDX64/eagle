import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// PostgreSQL connection will use DATABASE_URL from environment

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn']
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// Only connect if DATABASE_URL is a valid PostgreSQL URL
const dbUrl = process.env.DATABASE_URL || '';
if (dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://')) {
  prisma.$connect().catch((error: any) => {
    console.error('Failed to connect to database:', error);
  });
}

/**
 * Best-effort helper that persists an ensemble prediction result.
 *
 * The legacy football flow calls this from `/api/predictions/[matchId]` but
 * treats failures as non-fatal (wrapped in try/catch). We persist a compact
 * JSON snapshot into the `predictions` table under a synthetic prediction_id
 * so the tracking dashboard can still surface the ensemble result alongside
 * the cross-sport predictions.
 */
export async function saveEnsemblePrediction(args: {
  matchId: number;
  ensemblePrediction: Record<string, any> & { confidence?: any };
  metadata?: Record<string, any>;
  sourceSnapshots?: Record<string, any>;
}): Promise<void> {
  try {
    const id = `football:${args.matchId}`;
    const payload = {
      engine_name: 'football-ensemble',
      engine_version: 'legacy',
      ensemble: args.ensemblePrediction,
      metadata: args.metadata ?? null,
      sources: args.sourceSnapshots ?? null,
      saved_at: new Date().toISOString(),
    } as any;
    await prisma.predictions.upsert({
      where: { id },
      update: { payload },
      create: {
        id,
        sport: 'football',
        fixture_id: args.matchId,
        status: 'pending',
        payload,
      },
    });
  } catch (err) {
    console.warn('[saveEnsemblePrediction] persist failed (non-fatal):', err instanceof Error ? err.message : err);
  }
}