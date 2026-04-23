import { NextRequest, NextResponse } from 'next/server';
import { backfillPickOdds } from '@/lib/tracking/odds-backfill';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

/**
 * Cron endpoint — fills pick.market_odds from odds_snapshots_v2.
 *
 * Bearer CRON_SECRET auth. Query params:
 *   ?limit=5000   — max picks to process per run
 *   ?sport=football|basketball|nba|... — only backfill one sport
 */
async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.get('authorization') ?? '';
    const provided = header.replace(/^Bearer\s+/i, '').trim();
    if (provided !== secret) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
  }
  const params = req.nextUrl.searchParams;
  const limit = Math.min(Number(params.get('limit') ?? 5000), 20000);
  const sport = params.get('sport') ?? undefined;
  try {
    const result = await backfillPickOdds({ limit, onlySport: sport });
    return NextResponse.json({ success: true, data: result });
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
