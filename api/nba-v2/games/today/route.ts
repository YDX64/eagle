/**
 * GET /api/nba-v2/games/today?date=YYYY-MM-DD
 *
 * NBA-specific games endpoint. Uses the dedicated NBA API v2 (not the
 * generic basketball-api) to get richer game data with quarter linescores,
 * officials, lead changes, etc.
 *
 * Response shape matches the generic basketball/games/today endpoint so
 * the shared GamesDashboard component renders correctly.
 */

import { NextRequest, NextResponse } from 'next/server';
import { nbaApi } from '@/lib/sports/nba/api-nba';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const date = url.searchParams.get('date') || new Date().toISOString().split('T')[0];
  const search = url.searchParams.get('search')?.toLowerCase() || '';

  try {
    const rawGames = await nbaApi.getGamesByDate(date);

    // Transform to shared dashboard format (matches basketball games endpoint)
    let games = rawGames.map((g) => ({
      id: g.id,
      date: g.date.start,
      time: new Date(g.date.start).toLocaleTimeString('tr-TR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Istanbul',
      }),
      timestamp: Math.floor(new Date(g.date.start).getTime() / 1000),
      venue: g.arena?.name || null,
      stage: g.stage,
      status: {
        long: g.status?.long || 'Unknown',
        short: mapNbaStatus(g.status?.short),
        timer: g.status?.clock || null,
      },
      league: {
        id: 12, // NBA league ID
        name: 'NBA',
        type: 'League',
        season: g.season,
        logo: 'https://media.api-sports.io/basketball/leagues/12.png',
      },
      country: {
        id: 5,
        name: 'USA',
        code: 'US',
        flag: 'https://media.api-sports.io/flags/us.svg',
      },
      teams: {
        home: {
          id: g.teams.home.id,
          name: g.teams.home.name,
          logo: g.teams.home.logo,
          code: g.teams.home.code,
        },
        away: {
          id: g.teams.visitors.id,
          name: g.teams.visitors.name,
          logo: g.teams.visitors.logo,
          code: g.teams.visitors.code,
        },
      },
      scores: {
        home: {
          quarter_1: parseIntOrNull(g.scores.home.linescore?.[0]),
          quarter_2: parseIntOrNull(g.scores.home.linescore?.[1]),
          quarter_3: parseIntOrNull(g.scores.home.linescore?.[2]),
          quarter_4: parseIntOrNull(g.scores.home.linescore?.[3]),
          over_time: parseIntOrNull(g.scores.home.linescore?.[4]),
          total: g.scores.home.points || null,
        },
        away: {
          quarter_1: parseIntOrNull(g.scores.visitors.linescore?.[0]),
          quarter_2: parseIntOrNull(g.scores.visitors.linescore?.[1]),
          quarter_3: parseIntOrNull(g.scores.visitors.linescore?.[2]),
          quarter_4: parseIntOrNull(g.scores.visitors.linescore?.[3]),
          over_time: parseIntOrNull(g.scores.visitors.linescore?.[4]),
          total: g.scores.visitors.points || null,
        },
      },
      // NBA-specific extras
      officials: g.officials,
      timesTied: g.timesTied,
      leadChanges: g.leadChanges,
      nugget: g.nugget,
    }));

    // Client-side search
    if (search) {
      games = games.filter(
        (g) =>
          g.teams.home.name.toLowerCase().includes(search) ||
          g.teams.away.name.toLowerCase().includes(search)
      );
    }

    const liveStatuses = ['Q1', 'Q2', 'Q3', 'Q4', 'OT', 'HT', 'BT', 'LIVE'];
    const stats = {
      totalGames: games.length,
      liveGames: games.filter((g) => liveStatuses.some((s) => g.status.short.includes(s))).length,
      upcomingGames: games.filter((g) => g.status.short === 'NS').length,
      finishedGames: games.filter((g) => ['FT', 'AOT', 'AET'].includes(g.status.short)).length,
    };

    return NextResponse.json({
      success: true,
      sport: 'nba',
      data: {
        games,
        stats,
        pagination: {
          currentPage: 1,
          totalPages: 1,
          totalItems: games.length,
          hasNextPage: false,
          hasPrevPage: false,
          itemsPerPage: games.length,
        },
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

function parseIntOrNull(s: string | undefined | null): number | null {
  if (s === undefined || s === null || s === '') return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function mapNbaStatus(short: number | string | undefined): string {
  if (short === undefined || short === null) return 'NS';
  const n = typeof short === 'number' ? short : parseInt(String(short), 10);
  // NBA API uses: 1=NS, 2=Live, 3=Finished
  if (n === 1) return 'NS';
  if (n === 2) return 'LIVE';
  if (n === 3) return 'FT';
  return String(short);
}
