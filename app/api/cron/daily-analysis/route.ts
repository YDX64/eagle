import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { syncPredictionsForDate } from '@/lib/services/prediction-sync';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max

// This endpoint should be called daily at 00:15
export async function GET(request: Request) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    console.log(`Starting daily analysis for ${today} and ${tomorrow}`);

    // Analyze today's and tomorrow's matches
    const dates = [today, tomorrow];
    const results = [];

    for (const date of dates) {
      const entry: any = { date };

      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/bulk-analysis?date=${date}&forceRefresh=true`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          }
        });
        const data = await response.json();
        entry.bulk = {
          success: data.success,
          count: data.count || 0,
          message: data.message,
        };
      } catch (error) {
        console.error(`Error analyzing ${date}:`, error);
        entry.bulk = {
          success: false,
          count: 0,
          message: error instanceof Error ? error.message : 'Unknown error',
        };
      }

      try {
        entry.goalSync = {
          success: true,
          summary: await syncPredictionsForDate({
            date,
            skipIfFreshMinutes: 120,
          }),
        };
      } catch (syncError) {
        console.error(`Goal sync failed for ${date}:`, syncError);
        entry.goalSync = {
          success: false,
          error: syncError instanceof Error ? syncError.message : 'Unknown error',
        };
      }

      entry.success = Boolean(entry.bulk?.success) && Boolean(entry.goalSync?.success);
      results.push(entry);

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Log the run via analysisRun (cronLog model not in schema)
    try {
      await prisma.analysisRun.create({
        data: {
          status: results.every((r: any) => r.success) ? 'completed' : 'failed',
          matches_analyzed: results.length,
          high_conf_found: results.filter((r: any) => r.success).length,
          end_time: new Date(),
        }
      });
    } catch {
      // Silent - logging is non-critical
    }

    return NextResponse.json({
      success: true,
      message: 'Daily analysis completed',
      results,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Daily analysis cron error:', error);

    // Log the error via analysisRun
    await prisma.analysisRun.create({
      data: {
        status: 'failed',
        matches_analyzed: 0,
        high_conf_found: 0,
        end_time: new Date(),
      }
    }).catch(() => {
      // Silent - logging is non-critical
    });

    return NextResponse.json({
      error: 'Daily analysis failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// Manual trigger endpoint
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { date } = body;

    if (!date) {
      return NextResponse.json({ error: 'Date is required' }, { status: 400 });
    }

    console.log(`Manual trigger for daily analysis: ${date}`);

    // Trigger bulk analysis
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/bulk-analysis?date=${date}&forceRefresh=true`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    });

    const data = await response.json();
    const goalSummary = await syncPredictionsForDate({
      date,
      skipIfFreshMinutes: 60,
    });

    return NextResponse.json({
      success: data.success && Boolean(goalSummary),
      message: `Manual analysis for ${date} completed`,
      count: data.count || 0,
      goalSummary,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Manual daily analysis error:', error);
    return NextResponse.json({
      error: 'Manual analysis failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}