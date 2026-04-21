
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

export interface MatchEvent {
  time: { elapsed: number; extra: number | null };
  team: { id: number; name: string; logo: string };
  player: { id: number; name: string };
  assist: { id: number | null; name: string | null };
  type: string; // "Goal", "Card", "subst", "Var"
  detail: string; // "Yellow Card", "Red Card", "Normal Goal", "Penalty", etc.
  comments: string | null;
}

export interface OddsValue {
  value: string;
  odd: string;
}

export interface OddsBet {
  id: number;
  name: string;
  values: OddsValue[];
}

export interface OddsBookmaker {
  id: number;
  name: string;
  bets: OddsBet[];
}

export interface FixtureOdds {
  league: { id: number; name: string; country: string; logo: string; flag: string; season: number };
  fixture: { id: number; timezone: string; date: string; timestamp: number };
  update: string;
  bookmakers: OddsBookmaker[];
}

export interface PlayerInjury {
  player: { id: number; name: string; photo: string; type: string; reason: string };
  team: { id: number; name: string; logo: string };
  fixture: { id: number; timezone: string; date: string; timestamp: number };
  league: { id: number; season: number; name: string; country: string; logo: string; flag: string };
}

export interface FixtureLineup {
  team: { id: number; name: string; logo: string; colors: any };
  coach: { id: number; name: string; photo: string };
  formation: string;
  startXI: Array<{ player: { id: number; name: string; number: number; pos: string; grid: string } }>;
  substitutes: Array<{ player: { id: number; name: string; number: number; pos: string; grid: string | null } }>;
}

export interface FixturePlayerStats {
  team: { id: number; name: string; logo: string; update: string };
  players: Array<{
    player: { id: number; name: string; photo: string };
    statistics: Array<{
      games: { minutes: number; number: number; position: string; rating: string; captain: boolean; substitute: boolean };
      shots: { total: number | null; on: number | null };
      goals: { total: number | null; conceded: number | null; assists: number | null; saves: number | null };
      passes: { total: number | null; key: number | null; accuracy: string | null };
      tackles: { total: number | null; blocks: number | null; interceptions: number | null };
      duels: { total: number | null; won: number | null };
      dribbles: { attempts: number | null; success: number | null; past: number | null };
      fouls: { drawn: number | null; committed: number | null };
      cards: { yellow: number; red: number };
      penalty: { won: number | null; commited: number | null; scored: number | null; missed: number | null; saved: number | null };
    }>;
  }>;
}

const API_KEY = process.env.API_FOOTBALL_KEY;
const BASE_URL = 'https://v3.football.api-sports.io';

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
    const response = await this.makeRequest<{ league: { id: number; name: string; standings: Standing[][] } }>('/standings', { league, season });
    return response.response?.[0]?.league?.standings?.[0] || [];
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
   * Get predictions from API-Football for a specific fixture
   */
  static async getPredictions(fixtureId: number): Promise<any> {
    try {
      const response = await this.makeRequest<any>('/predictions', { fixture: fixtureId.toString() });
      return response.response?.[0] || null;
    } catch (error) {
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // NEW ENDPOINTS: Events, Odds, Injuries, Lineups, Players
  // ═══════════════════════════════════════════════════════════

  /**
   * Get match events (goals, cards, substitutions, VAR)
   */
  static async getFixtureEvents(fixtureId: number): Promise<MatchEvent[]> {
    try {
      const response = await this.makeRequest<MatchEvent>('/fixtures/events', { fixture: fixtureId });
      return response.response || [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Get pre-match odds from bookmakers for a fixture
   */
  static async getOdds(fixtureId: number): Promise<FixtureOdds[]> {
    try {
      const response = await this.makeRequest<FixtureOdds>('/odds', { fixture: fixtureId });
      return response.response || [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Get pre-match odds for a specific bet type (e.g. bet=1 for Match Winner)
   * Common bet IDs: 1=Match Winner, 5=Over/Under, 12=Double Chance, 8=Both Teams Score
   */
  static async getOddsByBet(fixtureId: number, betId: number): Promise<FixtureOdds[]> {
    try {
      const response = await this.makeRequest<FixtureOdds>('/odds', { fixture: fixtureId, bet: betId });
      return response.response || [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Get live/in-play odds for a fixture
   */
  static async getLiveOdds(fixtureId: number): Promise<FixtureOdds[]> {
    try {
      const response = await this.makeRequest<FixtureOdds>('/odds/live', { fixture: fixtureId });
      return response.response || [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Get player injuries for a fixture
   */
  static async getInjuries(fixtureId: number): Promise<PlayerInjury[]> {
    try {
      const response = await this.makeRequest<PlayerInjury>('/injuries', { fixture: fixtureId });
      return response.response || [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Get injuries by team and season
   */
  static async getTeamInjuries(teamId: number, season: number): Promise<PlayerInjury[]> {
    try {
      const response = await this.makeRequest<PlayerInjury>('/injuries', { team: teamId, season });
      return response.response || [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Get lineups for a fixture
   */
  static async getFixtureLineups(fixtureId: number): Promise<FixtureLineup[]> {
    try {
      const response = await this.makeRequest<FixtureLineup>('/fixtures/lineups', { fixture: fixtureId });
      return response.response || [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Get player statistics for a fixture
   */
  static async getFixturePlayers(fixtureId: number): Promise<FixturePlayerStats[]> {
    try {
      const response = await this.makeRequest<FixturePlayerStats>('/fixtures/players', { fixture: fixtureId });
      return response.response || [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Get bookmaker odds mapping (all available bet types)
   */
  static async getOddsMapping(): Promise<any[]> {
    try {
      const response = await this.makeRequest<any>('/odds/mapping');
      return response.response || [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Get all events for a team's recent fixtures (for cards/corners analysis)
   * Returns events from last N completed matches
   */
  static async getTeamRecentEvents(teamId: number, leagueId: number, season: number, count: number = 10): Promise<{ fixtureId: number; events: MatchEvent[] }[]> {
    try {
      const fixtures = await this.getFixturesByLeague(leagueId, season, 'FT');
      const teamFixtures = fixtures
        .filter(f => f.teams.home.id === teamId || f.teams.away.id === teamId)
        .sort((a, b) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime())
        .slice(0, count);

      const eventsPromises = teamFixtures.map(async (f) => ({
        fixtureId: f.fixture.id,
        events: await this.getFixtureEvents(f.fixture.id)
      }));

      return await Promise.all(eventsPromises);
    } catch (error) {
      return [];
    }
  }

  /**
   * Get fixture statistics for multiple past matches of a team
   * Used for building statistical profiles (cards, corners, shots averages)
   */
  static async getTeamRecentStats(teamId: number, leagueId: number, season: number, count: number = 10): Promise<{ fixtureId: number; stats: MatchStatistics[] }[]> {
    try {
      const fixtures = await this.getFixturesByLeague(leagueId, season, 'FT');
      const teamFixtures = fixtures
        .filter(f => f.teams.home.id === teamId || f.teams.away.id === teamId)
        .sort((a, b) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime())
        .slice(0, count);

      const statsPromises = teamFixtures.map(async (f) => ({
        fixtureId: f.fixture.id,
        stats: await this.getMatchStatistics(f.fixture.id)
      }));

      return await Promise.all(statsPromises);
    } catch (error) {
      return [];
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
