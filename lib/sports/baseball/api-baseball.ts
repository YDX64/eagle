
import { BaseSportApiClient } from '@/lib/sports/base/api-client';
import { CacheService } from '@/lib/cache';
import { BaseballGame } from '@/lib/sports/base/types';

/**
 * Major baseball league IDs from API-Sports Baseball API
 * (https://v1.baseball.api-sports.io).
 *
 * These IDs are verified best-effort against the public `/leagues` endpoint.
 * MLB = 1 is the canonical identifier used throughout the API-Sports docs.
 * NPB (Japan), KBO (Korea), and the Cuban National Series are the next-most
 * relevant leagues for serious baseball betting / analytics coverage.
 *
 * Any consumer that needs an authoritative map should call
 * `ApiBaseballService.getLeagues()` once on boot and cross-reference.
 */
export const MAJOR_BASEBALL_LEAGUES = {
  MLB: 1,
  NPB_JAPAN: 2,
  KBO_KOREA: 5,
  CUBAN_NATIONAL_SERIES: 12,
  CPBL_TAIWAN: 6,
  LMB_MEXICO: 13,
  LVBP_VENEZUELA: 15,
  DOMINICAN_WINTER: 16,
  WORLD_BASEBALL_CLASSIC: 19,
  MLB_POSTSEASON: 21,
} as const;

/**
 * Baseball-specific API client wrapping BaseSportApiClient.
 * Base URL: https://v1.baseball.api-sports.io
 *
 * All methods go through the cached request layer inherited from
 * BaseSportApiClient so we respect the Mega plan's rate limit. The key
 * `API_FOOTBALL_KEY` (used across every sport) is attached via the
 * `x-apisports-key` header by the base client.
 */
export class ApiBaseballService extends BaseSportApiClient {
  constructor() {
    // Pass 'baseball' through — SportType was extended in base/types.ts so
    // this is a first-class sport and BASE_URLS has the matching entry.
    super('baseball');
  }

  /**
   * Get all baseball games for a specific date.
   * @param date - ISO date string (YYYY-MM-DD)
   */
  async getGamesByDate(date: string): Promise<BaseballGame[]> {
    return this.cachedRequest<BaseballGame>('/games', { date }, CacheService.TTL.FIXTURES_TODAY);
  }

  /**
   * Get a single baseball game by its API ID.
   * @param id - Game ID from API-Sports
   */
  async getGameById(id: number): Promise<BaseballGame | null> {
    const games = await this.cachedRequest<BaseballGame>('/games', { id }, CacheService.TTL.FIXTURES_TODAY);
    return games[0] || null;
  }

  /**
   * Get all games for a specific league and season.
   * Used to build team form, schedule-based features, and historical samples.
   * @param league - League ID
   * @param season - Season year (e.g. 2025)
   */
  async getGamesByLeague(league: number, season: string | number): Promise<BaseballGame[]> {
    return this.cachedRequest<BaseballGame>(
      '/games',
      { league, season },
      CacheService.TTL.FIXTURES_PAST,
    );
  }

  /**
   * Get league standings for a given league and season.
   * Needed for relative-strength baselines (record, win %, run differential).
   */
  async getStandings(league: number, season: string | number): Promise<any[]> {
    return this.cachedRequest('/standings', { league, season }, CacheService.TTL.LEAGUE_STANDINGS);
  }

  /**
   * Head-to-head history between two clubs. API-Baseball supports
   * /games/h2h?h2h=teamA-teamB exactly like the other sport APIs.
   */
  async getH2H(team1Id: number, team2Id: number): Promise<BaseballGame[]> {
    return this.cachedRequest<BaseballGame>(
      '/games/h2h',
      { h2h: `${team1Id}-${team2Id}` },
      CacheService.TTL.HEAD_TO_HEAD,
    );
  }

  /**
   * Team statistics for a (league, season, team).
   * API returns goals for/against style totals that we interpret as runs in
   * the baseball context. Cached for 1 hour (stats update nightly).
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
      3600,
    );
  }

  /**
   * Odds for a specific game (or league/season scope). Baseball markets
   * typically include Moneyline, Runline ±1.5 and Over/Under totals
   * that the engine consumes downstream.
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
   * Live baseball games (currently in progress).
   */
  async getLiveGames(): Promise<BaseballGame[]> {
    return this.cachedRequest<BaseballGame>('/games', { live: 'all' }, 60);
  }

  /**
   * List all available baseball leagues.
   */
  async getLeagues(params: {
    id?: number;
    name?: string;
    country?: string;
    season?: string | number;
    type?: string;
    current?: string;
  } = {}): Promise<any[]> {
    return this.cachedRequest(
      '/leagues',
      params as Record<string, string | number>,
      CacheService.TTL.LEAGUE_STANDINGS,
    );
  }

  /**
   * Determine the current baseball season. Most MLB-style leagues run from
   * late March / early April through October (with postseason into November).
   * API-Sports uses the calendar year as the season identifier for baseball.
   *
   * We return the current calendar year as a number. This matches the way
   * api-sports returns `season: 2025` on game payloads.
   */
  getCurrentSeason(): number {
    return new Date().getFullYear();
  }

  /**
   * Return the canonical league key (e.g. "MLB", "NPB_JAPAN") for a
   * given league ID, or null when the league is not one of the majors.
   */
  detectMajorLeague(leagueId: number): string | null {
    for (const [key, id] of Object.entries(MAJOR_BASEBALL_LEAGUES)) {
      if (id === leagueId) return key;
    }
    return null;
  }
}

/** Singleton instance for use across the application */
export const baseballApi = new ApiBaseballService();
