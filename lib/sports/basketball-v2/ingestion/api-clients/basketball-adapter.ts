/**
 * Basketball v1 API Adapter
 *
 * Converts v1.basketball.api-sports.io shapes into CanonicalGame for the
 * warehouse. Uses existing basketballApi (lib/sports/basketball/api-basketball.ts).
 *
 * NOTE: Basketball v1 API does NOT provide per-player stats — those come
 * only from NBA v2 API. Basketball warehouse entries have null player_logs.
 */

import { basketballApi } from '@/lib/sports/basketball/api-basketball';
import type { UpsertGameInput } from '../../warehouse/games-repo';

function parseLinescore(scores: any): number[] | null {
  if (!scores) return null;
  // Basketball v1 format: { quarter_1: 28, quarter_2: 31, quarter_3: 24, quarter_4: 27, over_time: null, total: 110 }
  const q1 = scores.quarter_1 ?? null;
  const q2 = scores.quarter_2 ?? null;
  const q3 = scores.quarter_3 ?? null;
  const q4 = scores.quarter_4 ?? null;
  const ot = scores.over_time ?? null;
  const arr = [q1, q2, q3, q4].map((v) => (typeof v === 'number' ? v : 0));
  if (ot !== null && typeof ot === 'number') arr.push(ot);
  return arr.some((n) => n > 0) ? arr : null;
}

export function basketballGameToCanonical(game: any): UpsertGameInput {
  const leagueId = game.league?.id || 0;
  const leagueName = game.league?.name || null;
  const season = String(game.league?.season || new Date().getFullYear());

  return {
    source: 'basketball',
    apiGameId: game.id,
    leagueId,
    leagueName,
    season,
    gameDate: game.date || new Date().toISOString(),
    statusShort: game.status?.short || null,
    statusLong: game.status?.long || null,
    homeTeamId: game.teams?.home?.id || 0,
    homeTeamName: game.teams?.home?.name || 'Unknown',
    homeTeamCode: game.teams?.home?.code || null,
    awayTeamId: game.teams?.away?.id || 0,
    awayTeamName: game.teams?.away?.name || 'Unknown',
    awayTeamCode: game.teams?.away?.code || null,
    homeScore: game.scores?.home?.total ?? null,
    awayScore: game.scores?.away?.total ?? null,
    homeLinescore: parseLinescore(game.scores?.home),
    awayLinescore: parseLinescore(game.scores?.away),
    venueName: game.venue || null,
    venueCity: null,
    rawData: game,
  };
}

/**
 * Fetch all games for a specific league + season from the basketball v1 API.
 */
export async function fetchBasketballSeasonGames(
  leagueId: number,
  season: string
): Promise<UpsertGameInput[]> {
  // api-basketball supports /games?league=X&season=Y with all games for the season
  const rawRequest = async () => {
    const url = new URL('https://v1.basketball.api-sports.io/games');
    url.searchParams.set('league', String(leagueId));
    url.searchParams.set('season', season);
    const res = await fetch(url.toString(), {
      headers: {
        'x-apisports-key': process.env.API_FOOTBALL_KEY || '',
      },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`basketball /games returned ${res.status}`);
    const json = await res.json();
    return (json.response || []) as any[];
  };

  try {
    const games = await rawRequest();
    return games.map(basketballGameToCanonical);
  } catch (err) {
    console.warn(`[basketball-adapter] failed league=${leagueId} season=${season}:`, err);
    return [];
  }
}

/**
 * Fetch today's / date's games from basketball v1 across all leagues.
 */
export async function fetchBasketballGamesByDate(
  date: string
): Promise<UpsertGameInput[]> {
  const games = await basketballApi.getGamesByDate(date);
  return games.map(basketballGameToCanonical);
}
