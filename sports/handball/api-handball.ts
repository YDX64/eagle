
import { BaseSportApiClient } from '@/lib/sports/base/api-client';
import { CacheService } from '@/lib/cache';

/**
 * Major handball leagues with their API-Handball IDs
 */
export const MAJOR_HANDBALL_LEAGUES = {
  EHF_CHAMPIONS_LEAGUE: 37,
  BUNDESLIGA_GERMANY: 35,
  LIGA_ASOBAL_SPAIN: 190,
  STARLIGUE_FRANCE: 46,
  SUPER_LIG_TURKEY: 307,
  DANISH_LEAGUE: 47,
  NORWEGIAN_LEAGUE: 48,
  HUNGARIAN_LEAGUE: 88,
} as const;

/**
 * Handball API service using API-Handball (api-sports.io)
 * Base URL: https://v1.handball.api-sports.io
 *
 * Wraps BaseSportApiClient with handball-specific methods
 * for fetching games, standings, head-to-head, and team statistics.
 */
export class ApiHandballService extends BaseSportApiClient {
  constructor() {
    super('handball');
  }

  /**
   * Fetch all handball games for a given date.
   * @param date - ISO date string (YYYY-MM-DD)
   */
  async getGamesByDate(date: string): Promise<any[]> {
    return this.cachedRequest('/games', { date }, CacheService.TTL.FIXTURES_TODAY);
  }

  /**
   * Fetch a single game by its ID.
   * @param id - Game ID from API-Handball
   */
  async getGameById(id: number): Promise<any | null> {
    const games = await this.cachedRequest('/games', { id }, CacheService.TTL.FIXTURES_TODAY);
    return games[0] || null;
  }

  /**
   * Fetch league standings for a specific league and season.
   * @param league - League ID
   * @param season - Season identifier (e.g. "2024-2025" or "2024")
   */
  async getStandings(league: number, season: string | number): Promise<any[]> {
    return this.cachedRequest('/standings', { league, season }, CacheService.TTL.LEAGUE_STANDINGS);
  }

  /**
   * Fetch head-to-head history between two teams.
   * @param team1 - First team ID
   * @param team2 - Second team ID
   */
  async getH2H(team1: number, team2: number): Promise<any[]> {
    return this.cachedRequest(
      '/games/h2h',
      { h2h: `${team1}-${team2}` },
      CacheService.TTL.HEAD_TO_HEAD
    );
  }

  /**
   * Fetch team statistics for a given league and season.
   * @param league - League ID
   * @param season - Season identifier
   * @param team - Team ID
   */
  async getTeamStatistics(league: number, season: string | number, team: number): Promise<any[]> {
    return this.cachedRequest(
      '/statistics',
      { league, season, team },
      CacheService.TTL.MATCH_STATISTICS
    );
  }

  /**
   * Fetch recent games for a specific team (last N finished games).
   * Retrieves the team's schedule within a league/season scope, then filters to finished games.
   * @param teamId - Team ID
   * @param league - League ID
   * @param season - Season identifier
   * @param count - Number of recent games to return (default 10)
   */
  async getRecentGames(
    teamId: number,
    league: number,
    season: string | number,
    count: number = 10
  ): Promise<any[]> {
    const allGames = await this.cachedRequest(
      '/games',
      { league, season, team: teamId },
      CacheService.TTL.FIXTURES_PAST
    );

    const finishedGames = allGames
      .filter((g: any) => {
        const status = g.status?.short || '';
        return ['FT', 'AOT', 'AP', 'AET'].includes(status);
      })
      .sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));

    return finishedGames.slice(0, count);
  }

  /**
   * Fetch live handball games currently in progress.
   */
  async getLiveGames(): Promise<any[]> {
    return this.cachedRequest('/games', { live: 'all' }, 60);
  }

  /**
   * Fetch odds for a specific game or league.
   * @param params - Query parameters (game, league, season, bookmaker)
   */
  async getOdds(params: {
    game?: number;
    league?: number;
    season?: string | number;
    bookmaker?: number;
  } = {}): Promise<any[]> {
    return this.cachedRequest('/odds', params as any, 1800);
  }

  /**
   * Determine the current season string for handball leagues.
   * Most European handball seasons run from September to June.
   */
  getCurrentSeason(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    if (month >= 9) {
      return `${year}-${year + 1}`;
    }
    return `${year - 1}-${year}`;
  }
}

/**
 * Singleton instance for use across the application
 */
export const handballApi = new ApiHandballService();
