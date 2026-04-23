import { NextRequest, NextResponse } from 'next/server';
import { runDailyPipeline } from '@/lib/tracking/daily-runner';
import type { SportCode } from '@/lib/tracking/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // empty body allowed
  }
  try {
    const result = await runDailyPipeline({
      date: body?.date,
      sports: body?.sports as SportCode[] | undefined,
      max_per_sport: body?.max_per_sport,
      snapshot_odds: body?.snapshot_odds ?? true,
      run_type: body?.run_type ?? 'manual',
    });
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
