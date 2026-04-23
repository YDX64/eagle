/**
 * GET /api/probet/match-status?fixtureId=...&sport=football
 *
 * Returns the resolution status of a tracked prediction — used by the UI to
 * show win/loss markers on finished matches.
 *
 * For batch lookups, pass fixtureIds=1,2,3 (comma-separated).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPredictionStatus } from '@/lib/probet/prediction-store';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const sport = url.searchParams.get('sport') || 'football';
  const single = url.searchParams.get('fixtureId');
  const batch = url.searchParams.get('fixtureIds');

  try {
    if (single) {
      const id = parseInt(single, 10);
      if (!Number.isFinite(id)) {
        return NextResponse.json({ success: false, error: 'invalid fixtureId' }, { status: 400 });
      }
      const status = await getPredictionStatus(sport, id);
      return NextResponse.json({ success: true, data: { [id]: status } });
    }

    if (batch) {
      const ids = batch
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n));
      const out: Record<number, any> = {};
      for (const id of ids) {
        out[id] = await getPredictionStatus(sport, id);
      }
      return NextResponse.json({ success: true, data: out });
    }

    return NextResponse.json(
      { success: false, error: 'must provide fixtureId or fixtureIds' },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
