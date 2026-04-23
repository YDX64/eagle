/**
 * POST /api/basketball-v2/daily-cron
 *
 * Daily incremental update endpoint. Run by cron at 03:00 (Europe/Istanbul).
 *
 * Body (optional):
 *   { "date": "2026-04-08" }   // defaults to yesterday
 */

import { NextRequest, NextResponse } from 'next/server';
import { runDailyCron } from '@/lib/sports/basketball-v2/ingestion/daily-cron';
import { recomputeAllAggregates } from '@/lib/sports/basketball-v2/ingestion/team-aggregate-calculator';
import { recomputeAllQuarterShares } from '@/lib/sports/basketball-v2/ingestion/quarter-share-calculator';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  let date: string | undefined;
  try {
    const body = await request.json().catch(() => ({}));
    date = body.date;
  } catch {
    /* ignore */
  }

  try {
    const cronResult = await runDailyCron(date);

    // After daily fetch, refresh aggregates + quarter shares
    const aggCount = await recomputeAllAggregates();
    const qsCount = await recomputeAllQuarterShares();

    return NextResponse.json({
      success: true,
      engine: 'basketball-v2',
      cron: cronResult,
      aggregatesRecomputed: aggCount,
      quarterSharesRecomputed: qsCount,
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

export async function GET(request: NextRequest) {
  return POST(request);
}
