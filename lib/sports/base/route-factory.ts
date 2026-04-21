
import { NextRequest, NextResponse } from 'next/server';
import { CacheService } from '@/lib/cache';
import { SportType } from './types';

/**
 * Creates a standard "today's games" handler for any sport
 */
export function createGamesTodayHandler(
  sportApiClient: { getGamesByDate: (date: string) => Promise<any[]>; getLiveGames: () => Promise<any[]> },
  sport: SportType,
  majorLeagueIds: number[]
) {
  return async function handler(request: NextRequest) {
    try {
      const searchParams = request.nextUrl.searchParams;
      const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
      const page = parseInt(searchParams.get('page') || '1');
      const limit = parseInt(searchParams.get('limit') || '50');
      const search = searchParams.get('search') || '';

      // getGamesByDate already caches internally, so we only cache the final paginated result
      const allGames = await sportApiClient.getGamesByDate(date);

      const result = await (async () => {

          // Separate major and other league games
          const majorGames = allGames.filter((g: any) =>
            majorLeagueIds.includes(g.league?.id)
          );
          const otherGames = allGames.filter((g: any) =>
            !majorLeagueIds.includes(g.league?.id)
          );

          let finalGames = [...majorGames, ...otherGames];

          // Sort: live first, then upcoming, then finished
          finalGames.sort((a: any, b: any) => {
            const statusOrder = (s: string) => {
              if (['Q1', 'Q2', 'Q3', 'Q4', 'OT', 'BT', 'HT', '1H', '2H', 'P1', 'P2', 'P3', 'S1', 'S2', 'S3', 'S4', 'S5', 'LIVE', 'IN'].some(st => s.includes(st))) return 0;
              if (['NS', 'TBD', 'CANC'].some(st => s.includes(st))) return 1;
              return 2; // FT, AOT, AP, etc.
            };
            const aOrder = statusOrder(a.status?.short || '');
            const bOrder = statusOrder(b.status?.short || '');
            if (aOrder !== bOrder) return aOrder - bOrder;
            return (a.timestamp || 0) - (b.timestamp || 0);
          });

          // Apply search filter
          if (search) {
            const s = search.toLowerCase();
            finalGames = finalGames.filter((g: any) =>
              g.teams?.home?.name?.toLowerCase().includes(s) ||
              g.teams?.away?.name?.toLowerCase().includes(s) ||
              g.league?.name?.toLowerCase().includes(s) ||
              g.country?.name?.toLowerCase().includes(s)
            );
          }

          // Pagination
          const totalItems = finalGames.length;
          const totalPages = Math.ceil(totalItems / limit);
          const startIndex = (page - 1) * limit;
          const paginatedGames = finalGames.slice(startIndex, startIndex + limit);

          return {
            games: paginatedGames,
            pagination: {
              currentPage: page,
              totalPages,
              totalItems,
              hasNextPage: page < totalPages,
              hasPrevPage: page > 1,
              itemsPerPage: limit,
            },
            filters: { date, search },
            stats: {
              totalGames: totalItems,
              liveGames: finalGames.filter((g: any) => {
                const s = g.status?.short || '';
                return ['Q1', 'Q2', 'Q3', 'Q4', 'OT', 'BT', 'HT', '1H', '2H', 'P1', 'P2', 'P3', 'S1', 'S2', 'S3', 'S4', 'S5', 'LIVE', 'IN'].some(st => s.includes(st));
              }).length,
              upcomingGames: finalGames.filter((g: any) => g.status?.short === 'NS').length,
              finishedGames: finalGames.filter((g: any) => ['FT', 'AET', 'AOT', 'AP'].includes(g.status?.short || '')).length,
            },
          };
        })();

      return NextResponse.json({ success: true, sport, data: result });
    } catch (error) {
      return NextResponse.json(
        { success: false, sport, error: 'Failed to fetch games', message: error instanceof Error ? error.message : 'Unknown error' },
        { status: 500 }
      );
    }
  };
}

/**
 * Creates a standard prediction handler for any sport
 */
export function createPredictionHandler(
  sportApiClient: any,
  predictionEngine: { generatePrediction: (gameId: number, client: any) => Promise<any> },
  sport: SportType
) {
  return async function handler(
    request: NextRequest,
    { params }: { params: Promise<{ gameId: string }> }
  ) {
    const { gameId: gameIdStr } = await params;
    try {
      const gameId = parseInt(gameIdStr);
      if (isNaN(gameId)) {
        return NextResponse.json({ success: false, error: 'Invalid game ID' }, { status: 400 });
      }

      const cacheKey = CacheService.generateApiKey(`${sport}_prediction`, { gameId });

      const result = await CacheService.cacheApiResponse(
        cacheKey,
        async () => predictionEngine.generatePrediction(gameId, sportApiClient),
        CacheService.TTL.PREDICTIONS
      );

      return NextResponse.json({ success: true, sport, data: result });
    } catch (error) {
      return NextResponse.json(
        { success: false, sport, error: 'Failed to generate prediction', message: error instanceof Error ? error.message : 'Unknown error' },
        { status: 500 }
      );
    }
  };
}
