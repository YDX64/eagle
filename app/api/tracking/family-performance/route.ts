import { NextRequest, NextResponse } from 'next/server';
import { getFamilyPerformance } from '@/lib/tracking/analytics';
import type { SportCode } from '@/lib/tracking/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  try {
    const data = await getFamilyPerformance({
      sports: p.get('sports')?.split(',').filter(Boolean) as SportCode[] | undefined,
      date_from: p.get('date_from') ?? undefined,
      date_to: p.get('date_to') ?? undefined,
    });
    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
