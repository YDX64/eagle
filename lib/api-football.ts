
export const dynamic = "force-dynamic";

interface ApiFootballResponse<T> {
  get: string;
  parameters: Record<string, string | number>;
  errors: string[];
  results: number;
  paging: {
    current: number;
    total: number;
  };
  response: T[];
}

export interface League {
  id: number;
  name: string;
  type: string;
  logo: string;
  country: {
    name: string;
    code: string;
    flag: string;
  };
  seasons: {
    year: number;
    start: string;
    end: string;
    current: boolean;
  }[];
}

export interface Team {
  id: number;
  name: string;
  code: string;
  country: string;
  founded: number;
  national: boolean;
  logo: string;
  venue: {
    id: number;
    name: string;
    address: string;
    city: string;
    capacity: number;
    surface: string;
    image: string;
  };
}

export interface Fixture {
  fixture: {
    id: number;
    referee: string;
    timezone: string;
    date: string;
    timestamp: number;
    periods: {
      first: number;
      second: number;
    };
    venue: {
      id: number;
      name: string;
      city: string;
    };
    status: {
      long: string;
      short: string;
      elapsed: number;
    };
  };
  league: {
    id: number;
    name: string;
    country: string;
    logo: string;
    flag: string;
    season: number;
    round: string;
  };
  teams: {
    home: Team;
    away: Team;
  };
  goals: {
    home: number;
    away: number;
  };
  score: {
    halftime: { home: number; away: number };
    fulltime: { home: number; away: number };
    extratime: { home: number; away: number };
    penalty: { home: number; away: number };
  };
}

export interface Standing {
  rank: number;
  team: Team;
  points: number;
  goalsDiff: number;
  group: string;
  form: string;
  status: string;
  description: string;
  all: {
    played: number;
    win: number;
    draw: number;
    lose: number;
    goals: { for: number; against: number };
  };
  home: {
    played: number;
    win: number;
    draw: number;
    lose: number;
    goals: { for: number; against: number };
  };
  away: {
    played: number;
    win: number;
    draw: number;
    lose: number;
    goals: { for: number; against: number };
  };
  update: string;
}

export interface MatchStatistics {
  team: Team;
  statistics: {
    type: string;
    value: string | number;
  }[];
}

import { CacheService } from './cache';

const API_KEY = process.env.AWASTATS_API_KEY || process.env.API_FOOTBALL_KEY;
const BASE_URL = process.env.AWASTATS_BASE_URL || 'https://v3.football.api-sports.io';

// Upstream free tier = 10 requests/minute. We leave one slot as margin.
const MIN_DELAY_MS = Math.ceil(60_000 / 9);
const MAX_RETRIES = 3;

// Per-endpoint cache TTL in seconds. Lower for live data, higher for static.
const TTL_BY_ENDPOINT: Record<string, number> = {
  '/status': 60,
  '/leagues': 86_400,
  '/teams': 86_400,
  '/teams/statistics': 3_600,
  '/standings': 3_600,
  '/fixtures': 300,               // today fixtures + live need fresh-ish
  '/fixtures/headtohead': 21_600,
  '/fixtures/statistics': 86_400,
  '/predictions': 1_800,
};

function resolveTtl(endpoint: string, params: Record<string, string | number>): number {
  // Live fixtures should be nearly real-time.
  if (endpoint === '/fixtures' && params.live) return 30;
  return TTL_BY_ENDPOINT[endpoint] ?? 600;
}

const baseHeaders: Record<string, string> = {
  'Content-Type': 'application/json',
};
if (API_KEY) baseHeaders['x-apisports-key'] = API_KEY;

// --- Token-bucket style throttle -----------------------------------------
let lastRequestAt = 0;
let pendingGate: Promise<void> = Promise.resolve();

async function acquireSlot(): Promise<void> {
  const release = pendingGate;
  let resolveNext!: () => void;
  pendingGate = new Promise<void>(res => { resolveNext = res; });
  await release;
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + MIN_DELAY_MS - now);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestAt = Date.now();
  resolveNext();
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export class ApiFootballService {
  private static async makeRequest<T>(
    endpoint: string,
    params: Record<string, string | number> = {}
  ): Promise<ApiFootballResponse<T>> {
    if (!API_KEY) {
      throw new Error('AWASTATS_API_KEY is not configured');
    }

    const cacheKey = CacheService.generateApiKey(endpoint, params);
    const ttl = resolveTtl(endpoint, params);

    const cached = await CacheService.get<ApiFootballResponse<T>>(cacheKey);
    if (cached) return cached;

    const url = new URL(`${BASE_URL}${endpoint}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value.toString());
      }
    });

    let lastError: unknown = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await acquireSlot();
      try {
        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: baseHeaders,
          cache: 'no-store',
        });

        // 429 / 5xx → exponential backoff
        if (response.status === 429 || response.status >= 500) {
          const retryAfter = Number(response.headers.get('retry-after')) || 0;
          const backoff = retryAfter > 0 ? retryAfter * 1000 : Math.min(8000, 500 * Math.pow(2, attempt));
          if (attempt < MAX_RETRIES) {
            await sleep(backoff);
            continue;
          }
          throw new Error(`AwaStats veri servisi şu an yanıt vermedi (kod ${response.status})`);
        }

        if (!response.ok) {
          throw new Error(`AwaStats veri servisi şu an yanıt vermedi (kod ${response.status})`);
        }

        const data = (await response.json()) as ApiFootballResponse<T>;
        // Only cache successful, non-empty responses to avoid poisoning.
        if (Array.isArray(data?.response) && data.response.length > 0) {
          await CacheService.set(cacheKey, data, ttl);
        } else {
          // Still cache empty lists briefly to avoid hot-loops.
          await CacheService.set(cacheKey, data, Math.min(ttl, 60));
        }
        return data;
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          await sleep(Math.min(8000, 500 * Math.pow(2, attempt)));
          continue;
        }
        throw err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('AwaStats request failed');
  }

  // Get leagues
  static async getLeagues(season?: number): Promise<League[]> {
    const params: Record<string, string | number> = {};
    if (season) {
      params.season = season;
    }
    const response = await this.makeRequest<League>('/leagues', params);
    return response.response || [];
  }

  // Get teams by league
  static async getTeams(league: number, season: number): Promise<Team[]> {
    const response = await this.makeRequest<Team>('/teams', { league, season });
    return response.response || [];
  }

  // Get fixtures by date
  static async getFixturesByDate(date: string): Promise<Fixture[]> {
    const response = await this.makeRequest<Fixture>('/fixtures', { date });
    return response.response || [];
  }

  // Get fixtures by league and season
  static async getFixturesByLeague(league: number, season: number, status?: string): Promise<Fixture[]> {
    const params: Record<string, string | number> = { league, season };
    if (status) params.status = status;
    
    const response = await this.makeRequest<Fixture>('/fixtures', params);
    return response.response || [];
  }

  // Get specific fixture
  static async getFixture(id: number): Promise<Fixture | null> {
    const response = await this.makeRequest<Fixture>('/fixtures', { id });
    return response.response?.[0] || null;
  }

  // Get league standings
  static async getStandings(league: number, season: number): Promise<Standing[]> {
    const response = await this.makeRequest<{ league: any; standings: Standing[][] }>('/standings', { league, season });
    return response.response?.[0]?.standings?.[0] || [];
  }

  // Get head to head records
  static async getHeadToHead(h2h: string): Promise<Fixture[]> {
    const response = await this.makeRequest<Fixture>('/fixtures/headtohead', { h2h });
    return response.response || [];
  }

  // Get match statistics
  static async getMatchStatistics(fixture: number): Promise<MatchStatistics[]> {
    const response = await this.makeRequest<MatchStatistics>('/fixtures/statistics', { fixture });
    return response.response || [];
  }

  // Get team statistics
  static async getTeamStatistics(league: number, season: number, team: number): Promise<any> {
    const response = await this.makeRequest<any>('/teams/statistics', { league, season, team });
    return response.response || null;
  }

  // Get live fixtures
  static async getLiveFixtures(): Promise<Fixture[]> {
    const response = await this.makeRequest<Fixture>('/fixtures', { live: 'all' });
    return response.response || [];
  }

  /**
   * Get predictions from AwaStats for a specific fixture
   */
  static async getPredictions(fixtureId: number): Promise<any> {
    try {
      const response = await this.makeRequest<any>('/predictions', { fixture: fixtureId.toString() });
      return response.response?.[0] || null;
    } catch (error) {
      return null;
    }
  }

}

// Major league IDs for easy reference
export const MAJOR_LEAGUES = {
  PREMIER_LEAGUE: 39,
  LA_LIGA: 140,
  BUNDESLIGA: 78,
  SERIE_A: 135,
  LIGUE_1: 61,
  CHAMPIONS_LEAGUE: 2,
  EUROPA_LEAGUE: 3,
  SUPER_LIG: 203, // Turkish Super League
  EREDIVISIE: 88,
  PRIMEIRA_LIGA: 94,
} as const;

export const CURRENT_SEASON = 2024;
