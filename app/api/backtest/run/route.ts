import { NextRequest, NextResponse } from 'next/server';
import { BacktestEngine } from '@/lib/backtest-engine';
import { prisma } from '@/lib/db';

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  console.log('[BACKTEST API] Request received');

  try {
    let body;
    try {
      const text = await request.text();
      console.log('[BACKTEST API] Raw body:', text);
      body = text ? JSON.parse(text) : {};
    } catch (parseError) {
      console.error('[BACKTEST API] JSON parse error:', parseError);
      return NextResponse.json(
        { success: false, error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const {
      leagueId,
      teamId,
      dateFrom,
      dateTo,
      predictionType,
      algorithmVersion,
      progressive,
    } = body;

    console.log('[BACKTEST API] Parsed params:', { leagueId, teamId, dateFrom, dateTo, progressive });

    // Validate required fields
    if (!dateFrom || !dateTo) {
      return NextResponse.json(
        { success: false, error: 'Date range is required' },
        { status: 400 }
      );
    }

    // Parse dates
    const fromDate = new Date(dateFrom);
    const toDate = new Date(dateTo);

    // Check if we have any predictions in the database
    const predictionCount = await prisma.prediction.count({
      where: {
        createdAt: {
          gte: fromDate,
          lte: toDate,
        },
      },
    });

    console.log(`[BACKTEST API] Found ${predictionCount} predictions in date range`);

    if (predictionCount === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No predictions found in the specified date range. Please generate predictions for matches first.'
        },
        { status: 404 }
      );
    }

    console.log('[BACKTEST API] Starting backtest...', progressive ? 'PROGRESSIVE MODE' : 'STANDARD MODE');

    let result;
    if (progressive) {
      // Use progressive backtest
      result = await BacktestEngine.runProgressiveBacktest(fromDate, toDate);
    } else {
      // Use standard backtest
      result = await BacktestEngine.runBacktest({
        leagueId: leagueId ? parseInt(leagueId) : undefined,
        teamId: teamId ? parseInt(teamId) : undefined,
        dateFrom: fromDate,
        dateTo: toDate,
        predictionType,
        algorithmVersion,
      });
    }

    console.log('[BACKTEST API] Backtest completed successfully');

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[BACKTEST API] Error:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to run backtest',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}