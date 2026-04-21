
import { BaseSportApiClient } from '@/lib/sports/base/api-client';
import { CacheService } from '@/lib/cache';
import { HockeyGame } from '@/lib/sports/base/types';

/**
 * Major hockey league IDs from API-Sports Hockey API
 */
export const MAJOR_HOCKEY_LEAGUES = {
  NHL: 57,
  KHL: 50,
  SHL: 77,
  LIIGA: 69,
  DEL: 48,
  NLA: 37,
  CZECH_EXTRALIGA: 36,
  CHAMPIONS_HOCKEY: 35,
};

/**
 * Hockey-specific API client wrapping BaseSportApiClient.
 * Base URL: https://v1.hockey.api-sports.io
 *
 * All methods use real API-Sports data with aggressive caching
 * to respect rate limits. No mock data.
 */
export class ApiHockeyService extends BaseSportApiClient {
  constructor() {
    super('hockey');
  }

  /**
   * Get all hockey games for a specific date.
   * @param date - ISO date string (YYYY-MM-DD)
   */
  async getGamesByDate(date: string): Promise<HockeyGame[]> {
    return this.cachedRequest<HockeyGame>('/games', { date }, CacheService.TTL.FIXTURES_TODAY);
  }

  /**
   * Get a single hockey game by its API ID.
   * @param id - Game ID from API-Sports
   */
  async getGameById(id: number): Promise<HockeyGame | null> {
    const games = await this.cachedRequest<HockeyGame>('/games', { id }, CacheService.TTL.FIXTURES_TODAY);
    return games[0] || null;
  }

  /**
   * Get league standings for a given league and season.
   * @param league - League ID
   * @param season - Season year (e.g., 2024 or "2024")
   */
  async getStandings(league: number, season: string | number): Promise<any[]> {
    return this.cachedRequest('/standings', { league, season }, CacheService.TTL.LEAGUE_STANDINGS);
  }

  /**
   * Get head-to-head history between two teams.
   * Returns past games where these teams faced each other.
   * @param team1Id - First team ID
   * @param team2Id - Second team ID
   */
  async getH2H(team1Id: number, team2Id: number): Promise<HockeyGame[]> {
    return this.cachedRequest<HockeyGame>(
      '/games/h2h',
      { h2h: `${team1Id}-${team2Id}` },
      CacheService.TTL.HEAD_TO_HEAD
    );
  }

  /**
   * Get team statistics for a specific league and season.
   * Includes goals for/against, power play, penalty kill, etc.
   * @param params.league - League ID
   * @param params.season - Season year
   * @param params.team - Team ID
   * @param params.date - Optional cutoff date for stats
   */
  async getTeamStatistics(params: {
    league: number;
    season: string | number;
    team: number;
    date?: string;
  }): Promise<any[]> {
    return this.cachedRequest(
      '/teams/statistics',
      params as Record<string, string | number>,
      3600
    );
  }

  /**
   * Get all games for a specific league and season.
   * Useful for building form and historical analysis.
   * @param league - League ID
   * @param season - Season year
   */
  async getGamesByLeague(league: number, season: string | number): Promise<HockeyGame[]> {
    return this.cachedRequest<HockeyGame>(
      '/games',
      { league, season },
      CacheService.TTL.FIXTURES_PAST
    );
  }

  /**
   * Get live hockey games (all leagues).
   */
  async getLiveGames(): Promise<HockeyGame[]> {
    return this.cachedRequest<HockeyGame>('/games', { live: 'all' }, 60);
  }

  /**
   * Get odds for a specific game or league.
   */
  async getOdds(params: {
    game?: number;
    league?: number;
    season?: string | number;
    bookmaker?: number;
  } = {}): Promise<any[]> {
    return this.cachedRequest('/odds', params as Record<string, string | number>, 1800);
  }

  /**
   * Determine the current or most recent season for a league.
   * Falls back to current calendar year logic for hockey seasons.
   */
  getCurrentSeason(): number {
    const now = new Date();
    const month = now.getMonth() + 1;
    // Hockey seasons span two calendar years (e.g., 2024-2025 season starts ~Sep).
    // API-Sports uses the start year as the season identifier.
    return month >= 9 ? now.getFullYear() : now.getFullYear() - 1;
  }

  /**
   * Detect which major league a game belongs to.
   * Returns the league key or null if not a major league.
   */
  detectMajorLeague(leagueId: number): string | null {
    for (const [key, id] of Object.entries(MAJOR_HOCKEY_LEAGUES)) {
      if (id === leagueId) return key;
    }
    return null;
  }
}

/** Singleton instance for use across the application */
export const hockeyApi = new ApiHockeyService();
