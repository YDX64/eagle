
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

const API_KEY = process.env.AWASTATS_API_KEY || process.env.API_FOOTBALL_KEY;
const BASE_URL = process.env.AWASTATS_BASE_URL || 'https://v3.football.api-sports.io';

const headers = {
  'x-apisports-key': API_KEY!,
  'Content-Type': 'application/json',
};

export class ApiFootballService {
  private static async makeRequest<T>(endpoint: string, params: Record<string, string | number> = {}): Promise<ApiFootballResponse<T>> {
    const url = new URL(`${BASE_URL}${endpoint}`);
    
    // Add parameters to URL
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value.toString());
      }
    });

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers,
        cache: 'no-store', // Prevent caching for real-time data
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      return data;
    } catch (error) {
      throw error;
    }
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
