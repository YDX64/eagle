import { NextRequest, NextResponse } from 'next/server';
import { getPendingValueBets } from '@/lib/tracking/analytics';
import type { SportCode } from '@/lib/tracking/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  try {
    const data = await getPendingValueBets({
      sports: p.get('sports')?.split(',').filter(Boolean) as SportCode[] | undefined,
      min_probability: p.get('min_probability') ? Number(p.get('min_probability')) : undefined,
      min_expected_value: p.get('min_expected_value') ? Number(p.get('min_expected_value')) : undefined,
      only_high_confidence: p.get('only_high_confidence') === 'true',
      limit: p.get('limit') ? Number(p.get('limit')) : 100,
    });
    return NextResponse.json({ success: true, data, count: data.length });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
