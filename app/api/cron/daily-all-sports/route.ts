import { NextRequest, NextResponse } from 'next/server';
import { runDailyPipeline } from '@/lib/tracking/daily-runner';
import type { SportCode } from '@/lib/tracking/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured = open (dev mode)
  const header = req.headers.get('authorization') ?? '';
  const provided = header.replace(/^Bearer\s+/i, '').trim();
  return provided === secret;
}

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}

async function run(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const p = req.nextUrl.searchParams;
  const sports = p.get('sports')?.split(',').filter(Boolean) as SportCode[] | undefined;
  const max = p.get('max') ? Number(p.get('max')) : 100;
  const snapshot = p.get('snapshot') !== 'false';
  try {
    const result = await runDailyPipeline({
      sports,
      max_per_sport: max,
      snapshot_odds: snapshot,
      run_type: 'daily',
    });
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
