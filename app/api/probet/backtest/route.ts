/**
 * ProBet Backtest API
 *
 * GET /api/probet/backtest?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD&season=2024&maxMatches=100
 *
 * Runs the ProBet pipeline on historical FT matches in the date range,
 * comparing predictions to actual outcomes. Computes hit rate, Brier score,
 * log loss, ROI per confidence bucket, and per-outcome accuracy.
 */

import { NextRequest, NextResponse } from 'next/server';
import { CacheService } from '@/lib/cache';
import { runBacktest } from '@/lib/probet/backtest-engine';
import { inferSeason } from '@/lib/api-football';

export const dynamic = 'force-dynamic';
export const maxDuration = 800; // ~13 minutes — large backtests can take a while

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const today = new Date();
    const defaultTo = today.toISOString().split('T')[0];
    const defaultFromDate = new Date(today);
    defaultFromDate.setDate(defaultFromDate.getDate() - 30);
    const defaultFrom = defaultFromDate.toISOString().split('T')[0];

    const fromDate = searchParams.get('fromDate') || defaultFrom;
    const toDate = searchParams.get('toDate') || defaultTo;
    const inferredSeason = inferSeason(new Date(toDate));
    const season = parseInt(searchParams.get('season') || String(inferredSeason), 10);
    // Cap raised to 2000 to support 1000+ match backtests
    const maxMatches = Math.min(parseInt(searchParams.get('maxMatches') || '100', 10), 2000);
    const retrainEvery = parseInt(searchParams.get('retrainEvery') || '30', 10);
    const fastMode = searchParams.get('fastMode') === 'true';
    const includePreviousSeason = searchParams.get('includePreviousSeason') === 'true';
    const fetchStatistics = searchParams.get('fetchStatistics') === 'true';
    const fetchEvents = searchParams.get('fetchEvents') === 'true';

    // Optional: comma-separated league ids
    const leaguesParam = searchParams.get('leagues');
    let leagueIds: number[] | undefined;
    if (leaguesParam) {
      leagueIds = leaguesParam
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n));
    }

    const cacheKey = CacheService.generateApiKey('probet_backtest_v3', {
      fromDate,
      toDate,
      season,
      maxMatches,
      retrainEvery,
      fastMode,
      includePreviousSeason,
      fetchStatistics,
      fetchEvents,
      leagueIds: leagueIds?.join(',') || 'default',
    });

    const result = await CacheService.cacheApiResponse(
      cacheKey,
      async () =>
        runBacktest({
          season,
          fromDate,
          toDate,
          leagueIds,
          maxMatches,
          retrainEvery,
          fastMode,
          includePreviousSeason,
          fetchStatistics,
          fetchEvents,
        }),
      // 6-hour cache for backtest results — they're deterministic and expensive
      6 * 60 * 60
    );

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ProBet Backtest API] Error:', error);
    return NextResponse.json(
      { success: false, error: `Backtest hatası: ${message}` },
      { status: 500 }
    );
  }
}
