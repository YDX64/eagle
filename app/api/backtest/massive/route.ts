import { NextRequest, NextResponse } from 'next/server';
import { LargeScaleBacktest } from '@/lib/large-scale-backtest';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min timeout

/**
 * Massive Backtest API
 *
 * 20+ lig × çoklu sezon = binlerce/on binlerce maç
 *
 * GET /api/backtest/massive
 * GET /api/backtest/massive?seasons=2024,2023,2022,2021,2020
 * GET /api/backtest/massive?mode=full  (tüm ligler, 5 sezon)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') || 'standard';
    const seasonsParam = searchParams.get('seasons');

    let seasons: number[];
    if (seasonsParam) {
      seasons = seasonsParam.split(',').map(s => parseInt(s.trim())).filter(s => !isNaN(s));
    } else if (mode === 'full') {
      seasons = [2024, 2023, 2022, 2021, 2020];
    } else {
      seasons = [2024, 2023, 2022];
    }

    const result = await LargeScaleBacktest.runMassiveBacktest({
      seasons,
      minRound: 5,
    });

    // Remove individual match data to reduce payload
    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('[MASSIVE BACKTEST] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Massive backtest failed',
    }, { status: 500 });
  }
}
