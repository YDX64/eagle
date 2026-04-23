
import { ApiSportsResponse, SportType } from './types';
import { CacheService } from '@/lib/cache';

const API_KEY = process.env.API_FOOTBALL_KEY;

const BASE_URLS: Record<SportType, string> = {
  football: 'https://v3.football.api-sports.io',
  basketball: 'https://v1.basketball.api-sports.io',
  hockey: 'https://v1.hockey.api-sports.io',
  volleyball: 'https://v1.volleyball.api-sports.io',
  handball: 'https://v1.handball.api-sports.io',
};

export class BaseSportApiClient {
  protected readonly baseUrl: string;
  protected readonly sport: SportType;

  constructor(sport: SportType) {
    this.sport = sport;
    this.baseUrl = BASE_URLS[sport];
  }

  protected async makeRequest<T>(
    endpoint: string,
    params: Record<string, string | number> = {}
  ): Promise<ApiSportsResponse<T>> {
    const url = new URL(`${this.baseUrl}${endpoint}`);

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value.toString());
      }
    });

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'x-apisports-key': API_KEY!,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`${this.sport === 'football' ? 'Futbol' : this.sport === 'basketball' ? 'Basketbol' : this.sport === 'hockey' ? 'Hokey' : 'Veri'} servisi şu an yanıt vermedi (kod ${response.status})`);
    }

    return response.json();
  }

  // Cached request wrapper
  protected async cachedRequest<T>(
    endpoint: string,
    params: Record<string, string | number> = {},
    ttl: number = 300
  ): Promise<T[]> {
    const cacheKey = CacheService.generateApiKey(
      `${this.sport}_${endpoint}`,
      params
    );

    // Check cache first
    const cached = await CacheService.get<T[]>(cacheKey);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return cached;
    }

    // Fetch fresh data
    const response = await this.makeRequest<T>(endpoint, params);
    const data = response.response || [];

    // Only cache non-empty results
    if (Array.isArray(data) && data.length > 0) {
      await CacheService.set(cacheKey, data, ttl);
    }

    return data;
  }

  // Common endpoints (same across all non-football sports)

  async getLeagues(params: {
    id?: number;
    name?: string;
    country?: string;
    season?: string | number;
    type?: string;
    current?: string;
  } = {}): Promise<any[]> {
    return this.cachedRequest('/leagues', params as any, CacheService.TTL.LEAGUE_STANDINGS);
  }

  async getGamesByDate(date: string): Promise<any[]> {
    return this.cachedRequest('/games', { date }, CacheService.TTL.FIXTURES_TODAY);
  }

  async getGameById(id: number): Promise<any | null> {
    const games = await this.cachedRequest('/games', { id }, CacheService.TTL.FIXTURES_TODAY);
    return games[0] || null;
  }

  async getGamesByLeague(league: number, season: string | number): Promise<any[]> {
    return this.cachedRequest('/games', { league, season }, CacheService.TTL.FIXTURES_PAST);
  }

  async getStandings(league: number, season: string | number): Promise<any[]> {
    return this.cachedRequest('/standings', { league, season }, CacheService.TTL.LEAGUE_STANDINGS);
  }

  async getTeams(params: {
    id?: number;
    league?: number;
    season?: string | number;
    name?: string;
    search?: string;
  } = {}): Promise<any[]> {
    return this.cachedRequest('/teams', params as any, CacheService.TTL.TEAM_INFO);
  }

  async getH2H(team1Id: number, team2Id: number): Promise<any[]> {
    return this.cachedRequest('/games/h2h', { h2h: `${team1Id}-${team2Id}` }, CacheService.TTL.HEAD_TO_HEAD);
  }

  async getStatistics(params: {
    league: number;
    season: string | number;
    team: number;
    date?: string;
  }): Promise<any[]> {
    return this.cachedRequest('/statistics', params as any, 3600);
  }

  async getOdds(params: {
    game?: number;
    league?: number;
    season?: string | number;
    bookmaker?: number;
  } = {}): Promise<any[]> {
    return this.cachedRequest('/odds', params as any, 1800);
  }

  async getLiveGames(): Promise<any[]> {
    return this.cachedRequest('/games', { live: 'all' }, 60);
  }
}
