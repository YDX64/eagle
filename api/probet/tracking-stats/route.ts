/**
 * GET /api/probet/tracking-stats
 *
 * Returns aggregated accuracy stats from the prediction tracking DB.
 * Used by the "Canlı Backtest" panel in the ProBet tab.
 */

import { NextResponse } from 'next/server';
import { getTrackingStats } from '@/lib/probet/prediction-store';

export async function GET() {
  try {
    const stats = await getTrackingStats();
    return NextResponse.json({ success: true, data: stats });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
