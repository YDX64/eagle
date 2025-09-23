import { NextResponse } from 'next/server';
import { cache } from '@/lib/db/json-cache';

// This endpoint should be called by a cron job every hour
export async function GET(request: Request) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all upcoming matches for the next 48 hours
    const now = new Date();
    const futureDate = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    // Fetch matches from your database or API
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/matches/upcoming`, {
      headers: {
        'Content-Type': 'application/json',
      }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch upcoming matches');
    }

    const { matches } = await response.json();

    // Filter matches within 48 hours
    const upcomingMatches = matches.filter((match: any) => {
      const matchDate = new Date(match.fixture.date);
      return matchDate >= now && matchDate <= futureDate;
    });

    // Extract match IDs
    const matchIds = upcomingMatches.map((m: any) => m.fixture.id);

    if (matchIds.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No upcoming matches to analyze'
      });
    }

    // Batch analyze in chunks of 10
    const chunkSize = 10;
    const chunks = [];

    for (let i = 0; i < matchIds.length; i += chunkSize) {
      chunks.push(matchIds.slice(i, i + chunkSize));
    }

    let totalAnalyzed = 0;
    let totalFailed = 0;

    for (const chunk of chunks) {
      try {
        const analysisResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/predictions/batch-analyze`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            matchIds: chunk,
            forceUpdate: false // Use cache if available
          })
        });

        if (analysisResponse.ok) {
          const result = await analysisResponse.json();
          totalAnalyzed += result.analyzed || 0;
          totalFailed += result.failed || 0;
        }

        // Small delay between chunks to avoid overload
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error('Chunk analysis error:', error);
        totalFailed += chunk.length;
      }
    }

    // Log the analysis run
    cache.saveAnalysisLog({
      run_time: new Date().toISOString(),
      matches_analyzed: totalAnalyzed,
      matches_failed: totalFailed,
      total_matches: matchIds.length,
      status: 'completed'
    });

    return NextResponse.json({
      success: true,
      analyzed: totalAnalyzed,
      failed: totalFailed,
      total: matchIds.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Hourly analysis error:', error);

    // Log the error
    cache.saveAnalysisLog({
      run_time: new Date().toISOString(),
      matches_analyzed: 0,
      matches_failed: 0,
      total_matches: 0,
      status: 'failed',
      error_message: error instanceof Error ? error.message : 'Unknown error'
    });

    return NextResponse.json({
      error: 'Analysis failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}