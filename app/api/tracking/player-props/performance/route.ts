import { NextRequest, NextResponse } from 'next/server';
import { getPlayerPropPerformance } from '@/lib/tracking/analytics';
import type { SportCode } from '@/lib/tracking/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  try {
    const data = await getPlayerPropPerformance({
      sports: p.get('sports')?.split(',').filter(Boolean) as SportCode[] | undefined,
      date_from: p.get('date_from') ?? undefined,
      date_to: p.get('date_to') ?? undefined,
      only_high_confidence: p.get('only_high_confidence') === 'true',
    });
    const minSample = Number(p.get('min_sample') ?? 3);
    const filtered = data.filter(r => r.total >= minSample);
    return NextResponse.json({ success: true, data: filtered, count: filtered.length });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
