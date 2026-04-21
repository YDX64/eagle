import { NextRequest, NextResponse } from 'next/server';
import { runGoalAnalyzer } from '@/lib/algorithms/goal-analyzer';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const date = searchParams.get('date') || new Date().toISOString().slice(0, 10);
    const includeTomorrow = searchParams.get('includeTomorrow') !== 'false';
    const topN = Math.max(5, Math.min(50, Number(searchParams.get('topN') ?? '25')));
    const deepCount = Math.max(10, Math.min(120, Number(searchParams.get('deep') ?? '60')));
    const bet365Only = searchParams.get('bet365Only') !== 'false'; // default true

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ success: false, error: 'Invalid date format (YYYY-MM-DD)' }, { status: 400 });
    }

    const result = await runGoalAnalyzer({
      date,
      includeTomorrow,
      topN,
      deepAnalysisCount: deepCount,
      bet365Only,
      baseUrl: request.nextUrl.origin,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (err: any) {
    console.error('[goal-analyzer]', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Goal analyzer failed' },
      { status: 500 },
    );
  }
}
