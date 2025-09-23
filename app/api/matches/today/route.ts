
import { NextRequest, NextResponse } from 'next/server';
import { ApiFootballService, MAJOR_LEAGUES, Fixture } from '@/lib/api-football';
import { CacheService } from '@/lib/cache';
import { 
  sortMatchesByTimeAndStatus, 
  filterMatches, 
  paginateArray 
} from '@/lib/utils';
import { 
  withApiProtection, 
  parseQueryParams, 
  createApiResponse, 
  handleApiError 
} from '@/lib/api-utils';
import { matchesQuerySchema, createErrorResponse } from '@/lib/api-security';
import { z } from 'zod';

export const dynamic = "force-dynamic";

async function matchesTodayHandler(request: NextRequest) {
  // Parse and validate query parameters
  const queryResult = parseQueryParams(request, matchesQuerySchema.extend({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }));
  
  if (!queryResult.success) {
    const { response, status } = createErrorResponse(queryResult.error, 400);
    return NextResponse.json(response, { status });
  }
  
  const { page, limit, search, endedMatchesHours } = queryResult.data as {
    page: number;
    limit: number;
    search?: string;
    endedMatchesHours?: number;
    date?: string;
  };
  const date = request.nextUrl.searchParams.get('date') || new Date().toISOString().split('T')[0];
    
    // For ended matches, get a different date range
    let actualDate = date;
    if ((endedMatchesHours ?? 0) > 0) {
      const now = new Date();
      const targetDate = new Date(now.getTime() - ((endedMatchesHours ?? 0) * 60 * 60 * 1000));
      actualDate = targetDate.toISOString().split('T')[0];
    }
    
    const cacheKey = CacheService.generateApiKey('matches_enhanced', { 
      date: actualDate, 
      page, 
      limit, 
      search,
      endedMatchesHours
    });
    
    const result = await CacheService.cacheApiResponse(
      cacheKey,
      async () => {
        const allMatches = await ApiFootballService.getFixturesByDate(actualDate);
        
        // Filter and prioritize major leagues
        const majorLeagueIds = Object.values(MAJOR_LEAGUES);
        
        // Separate major and non-major league matches
        const majorMatches = allMatches.filter(match =>
          majorLeagueIds.includes(match.league.id as any)
        );
        const otherMatches = allMatches.filter(match =>
          !majorLeagueIds.includes(match.league.id as any)
        );

        // Combine ALL matches - no limit like competitor site mrbolivian.abacusai.app
        let finalMatches = [...majorMatches, ...otherMatches];
        
        // Apply new sorting: Live matches first, then by time/status
        finalMatches = sortMatchesByTimeAndStatus(finalMatches);
        
        // Apply search filtering
        const filteredMatches = filterMatches(finalMatches, search ?? '');
        
        // Filter ended matches if requested
        const endedFilteredMatches = (endedMatchesHours ?? 0) > 0 
          ? filteredMatches.filter(match => match.fixture.status.short === 'FT')
          : filteredMatches;
        
        // Apply pagination
        const paginationResult = paginateArray(endedFilteredMatches, page, limit);
        
        
        return {
          matches: paginationResult.data,
          pagination: {
            currentPage: paginationResult.currentPage,
            totalPages: paginationResult.totalPages,
            totalItems: paginationResult.totalItems,
            hasNextPage: paginationResult.hasNextPage,
            hasPrevPage: paginationResult.hasPrevPage,
            itemsPerPage: limit
          },
          filters: {
            date: actualDate,
            search,
            endedMatchesHours
          },
          stats: {
            totalMatches: endedFilteredMatches.length,
            liveMatches: endedFilteredMatches.filter(m => 
              ['1H', '2H', 'HT'].includes(m.fixture.status.short)
            ).length,
            upcomingMatches: endedFilteredMatches.filter(m => 
              m.fixture.status.short === 'NS'
            ).length,
            finishedMatches: endedFilteredMatches.filter(m => 
              m.fixture.status.short === 'FT'
            ).length
          }
        };
      },
      CacheService.TTL.FIXTURES_TODAY
    );

    return createApiResponse({
      matches: result.matches,
      pagination: result.pagination,
      filters: result.filters,
      stats: result.stats
    });
}

// Export the protected handler
export const GET = withApiProtection(matchesTodayHandler, {
  rateLimit: true,
  validateApiKey: true,
});
