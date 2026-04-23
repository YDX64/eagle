import { NextRequest, NextResponse } from 'next/server';
import { getOverallKpis } from '@/lib/tracking/analytics';
import type { SportCode } from '@/lib/tracking/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const sports = params.get('sports')?.split(',').filter(Boolean) as SportCode[] | undefined;
  const date_from = params.get('date_from') ?? undefined;
  const date_to = params.get('date_to') ?? undefined;
  try {
    const data = await getOverallKpis({ sports, date_from, date_to });
    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
