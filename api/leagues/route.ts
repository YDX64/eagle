
import { NextRequest, NextResponse } from 'next/server';
import { ApiFootballService, MAJOR_LEAGUES, CURRENT_SEASON } from '@/lib/api-football';
import { CacheService } from '@/lib/cache';

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const season = parseInt(searchParams.get('season') || CURRENT_SEASON.toString());
    
    const cacheKey = CacheService.generateApiKey('leagues', { season });
    
    const leagues = await CacheService.cacheApiResponse(
      cacheKey,
      async () => {
        const allLeagues = await ApiFootballService.getLeagues(season);
        
        // Filter for major leagues
        const majorLeagueIds = Object.values(MAJOR_LEAGUES);
        const majorLeagues = allLeagues.filter(league => 
          majorLeagueIds.includes(league.id as any)
        );
        
        return majorLeagues;
      },
      CacheService.TTL.LEAGUE_STANDINGS
    );

    return NextResponse.json({
      success: true,
      data: leagues,
      season,
      majorLeagues: MAJOR_LEAGUES
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch leagues',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
