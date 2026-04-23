import { NextRequest, NextResponse } from 'next/server';
import { getMarketPerformance } from '@/lib/tracking/analytics';
import type { MarketFamily, SportCode } from '@/lib/tracking/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  try {
    const rows = await getMarketPerformance({
      sports: p.get('sports')?.split(',').filter(Boolean) as SportCode[] | undefined,
      markets: p.get('markets')?.split(',').filter(Boolean),
      families: p.get('families')?.split(',').filter(Boolean) as MarketFamily[] | undefined,
      date_from: p.get('date_from') ?? undefined,
      date_to: p.get('date_to') ?? undefined,
      min_probability: p.get('min_probability') ? Number(p.get('min_probability')) : undefined,
      min_expected_value: p.get('min_expected_value') ? Number(p.get('min_expected_value')) : undefined,
      only_high_confidence: p.get('only_high_confidence') === 'true',
    });
    const minSample = Number(p.get('min_sample') ?? 0);
    const limit = Number(p.get('limit') ?? 500);
    const filtered = rows.filter(r => r.total >= minSample).slice(0, limit);
    return NextResponse.json({ success: true, data: filtered, count: filtered.length });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
