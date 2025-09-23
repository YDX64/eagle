import { NextRequest, NextResponse } from 'next/server';
import { BacktestEngine } from '@/lib/backtest-engine';

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

    const options = {
      ...(dateFrom && { dateFrom: new Date(dateFrom) }),
      ...(dateTo && { dateTo: new Date(dateTo) }),
    };

    const statistics = await BacktestEngine.getStatistics('prediction', options);

    return NextResponse.json({
      success: true,
      data: statistics,
    });
  } catch (error) {
    console.error('Prediction statistics API error:', error);

    // Return empty data when database is unavailable
    if (error instanceof Error && error.message.includes('connection pool')) {
      return NextResponse.json({
        success: true,
        data: [],
        message: 'Database unavailable - no data to display',
      });
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch prediction statistics',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}