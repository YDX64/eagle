import { NextRequest, NextResponse } from 'next/server';
import { ComprehensiveBacktest } from '@/lib/comprehensive-backtest';

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { dateFrom, dateTo } = body;

    if (!dateFrom || !dateTo) {
      return NextResponse.json(
        { success: false, error: 'Date range is required' },
        { status: 400 }
      );
    }

    const fromDate = new Date(dateFrom);
    const toDate = new Date(dateTo);

    // Run comprehensive backtest
    const results = await ComprehensiveBacktest.runComprehensiveBacktest(fromDate, toDate);

    return NextResponse.json({
      success: true,
      data: results
    });

  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to run comprehensive backtest',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}