/**
 * GET /api/nba/games/today
 *
 * Returns today's NBA games with live quarter linescores for in-progress
 * matches. Uses v2.nba.api-sports.io — distinct from the generic basketball
 * endpoint which covers all basketball leagues.
 *
 * Query params:
 *   date   — YYYY-MM-DD (default: today UTC)
 *   page   — pagination
 *   limit  — results per page (default: 50)
 */

import { NextRequest, NextResponse } from 'next/server';
import { nbaApi } from '@/lib/sports/nba/api-nba';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const date = url.searchParams.get('date') || new Date().toISOString().split('T')[0];
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '50', 10));

  try {
    const games = await nbaApi.getGamesByDate(date);

    // Sort: live first, then upcoming, then finished
    games.sort((a, b) => {
      const order = (s: any) => {
        const short = s?.short ?? 0;
        // short: 1=NS, 2=In Play, 3=FT (finished)
        if (short === 2) return 0;
        if (short === 1) return 1;
        return 2;
      };
      const ao = order(a.status);
      const bo = order(b.status);
      if (ao !== bo) return ao - bo;
      return new Date(a.date.start).getTime() - new Date(b.date.start).getTime();
    });

    const totalItems = games.length;
    const totalPages = Math.ceil(totalItems / limit);
    const startIdx = (page - 1) * limit;
    const paginated = games.slice(startIdx, startIdx + limit);

    const liveGames = games.filter((g) => (g.status?.short ?? 0) === 2);
    const finishedGames = games.filter((g) => (g.status?.short ?? 0) === 3);

    return NextResponse.json({
      success: true,
      sport: 'nba',
      data: {
        games: paginated,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems,
          itemsPerPage: limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        filters: { date },
        stats: {
          totalGames: totalItems,
          liveGames: liveGames.length,
          finishedGames: finishedGames.length,
          upcomingGames: totalItems - liveGames.length - finishedGames.length,
        },
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        sport: 'nba',
        error: 'Failed to fetch NBA games',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
