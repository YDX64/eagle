
import { NextRequest, NextResponse } from 'next/server';
import { ApiFootballService } from '@/lib/api-football';
import { CacheService } from '@/lib/cache';

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const matchId = parseInt(id);
    
    if (isNaN(matchId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid match ID' },
        { status: 400 }
      );
    }

    const cacheKey = CacheService.generateApiKey('match_details', { id: matchId });
    
    const matchDetails = await CacheService.cacheApiResponse(
      cacheKey,
      async () => {
        // Get match basic info
        const match = await ApiFootballService.getFixture(matchId);
        
        if (!match) {
          throw new Error('Match not found');
        }

        // Get additional data if match is finished
        let statistics = null;
        if (match.fixture.status.short === 'FT') {
          try {
            statistics = await ApiFootballService.getMatchStatistics(matchId);
          } catch (error) {
          }
        }

        return {
          match,
          statistics
        };
      },
      CacheService.TTL.MATCH_STATISTICS
    );

    return NextResponse.json({
      success: true,
      data: matchDetails
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch match details',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
