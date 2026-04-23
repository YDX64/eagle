/**
 * POST /api/basketball-v2/recompute
 *
 * Re-runs all derived computations from existing warehouse game data:
 *   - Team season aggregates (Four Factors, pace, ratings)
 *   - Quarter shares
 *   - Player season averages + correlations
 *   - Team ratings (ELO + Bayesian)
 *
 * Useful when:
 *   - Algorithm changes and we want to re-derive without re-fetching API
 *   - After a manual data fix
 *   - To recover from a partial backfill failure
 */

import { NextResponse } from 'next/server';
import { recomputeAllAggregates } from '@/lib/sports/basketball-v2/ingestion/team-aggregate-calculator';
import { recomputeAllQuarterShares } from '@/lib/sports/basketball-v2/ingestion/quarter-share-calculator';
import { recomputeAllRatings } from '@/lib/sports/basketball-v2/ingestion/ratings-builder';
import { aggregateAllPlayers } from '@/lib/sports/basketball-v2/ingestion/player-aggregator';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

export async function POST() {
  const start = Date.now();
  try {
    const aggCount = await recomputeAllAggregates();
    const qsCount = await recomputeAllQuarterShares();
    const playerCount = await aggregateAllPlayers();
    const ratingCount = await recomputeAllRatings();

    return NextResponse.json({
      success: true,
      engine: 'basketball-v2',
      aggregatesComputed: aggCount,
      quarterSharesComputed: qsCount,
      playersAggregated: playerCount,
      ratingsComputed: ratingCount,
      elapsedMs: Date.now() - start,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return POST();
}
