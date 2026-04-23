import { NextRequest, NextResponse } from 'next/server';
import { reassessCrossSportTotals } from '@/lib/tracking/reassess';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

/**
 * Re-evaluate historical settled picks using the fixed cross-sport label
 * parser. Flips any hit that was wrongly set by the earlier football-only
 * taxonomy lookup (classic case: basketball OVER_25 → "225 Üst" label →
 * previously hit=true against a 2.5 threshold, actually miss against 225).
 */
async function run(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const dryRun = params.get('dryRun') === 'true';

  // Optional bearer auth — skipped when CRON_SECRET not configured.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.get('authorization') ?? '';
    if (header.replace(/^Bearer\s+/i, '').trim() !== secret) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
  }
  try {
    const result = await reassessCrossSportTotals({ dryRun });
    return NextResponse.json({ success: true, data: result, dryRun });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}
