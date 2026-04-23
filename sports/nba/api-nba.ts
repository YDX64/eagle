/**
 * API-NBA Client (v2.nba.api-sports.io)
 *
 * Dedicated NBA API separate from the generic basketball API. Provides:
 *   - /games (with quarter-by-quarter linescore)
 *   - /games/statistics (team-level per-game stats)
 *   - /teams/statistics (season aggregates)
 *   - /players (roster)
 *   - /players/statistics (per-game player stats: points, rebounds, assists, etc)
 *   - /standings
 *
 * NBA regular season: October → April
 * Season parameter: year the season started (e.g. 2025 for 2025-2026 season)
 */

const BASE_URL = 'https://v2.nba.api-sports.io';
const API_KEY = process.env.API_FOOTBALL_KEY || ''; // Same key works for all api-sports

interface ApiNbaResponse<T> {
  get: string;
  parameters: any;
  errors: any[];
  results: number;
  paging: { current: number; total: number };
  response: T[];
}

export interface NbaGame {
  id: number;
  league: string;
  season: number;
  date: { start: string; end: string | null; duration: string | null };
  stage: number;
  status: { clock: string | null; halftime: boolean; short: number; long: string };
  periods: { current: number; total: number; endOfPeriod: boolean };
  arena: { name: string; city: string; state: string; country: string | null };
  teams: {
    visitors: NbaTeamRef;
    home: NbaTeamRef;
  };
  scores: {
    visitors: NbaTeamScores;
    home: NbaTeamScores;
  };
  officials: string[];
  timesTied: number | null;
  leadChanges: number | null;
  nugget: string | null;
}

export interface NbaTeamRef {
  id: number;
  name: string;
  nickname: string;
  code: string;
  logo: string;
}

export interface NbaTeamScores {
  win: number;
  loss: number;
  series: { win: number; loss: number };
  linescore: string[]; // per-quarter point totals as strings: ['31','30','0','']
  points: number;
}

export interface NbaTeamSeasonStats {
  games: number;
  fastBreakPoints: number;
  pointsInPaint: number;
  biggestLead: number;
  secondChancePoints: number;
  pointsOffTurnovers: number;
  longestRun: number;
  points: number;
  fgm: number;
  fga: number;
  fgp: string;
  ftm: number;
  fta: number;
  ftp: string;
  tpm: number;
  tpa: number;
  tpp: string;
  offReb: number;
  defReb: number;
  totReb: number;
  assists: number;
  pFouls: number;
  steals: number;
  turnovers: number;
  blocks: number;
  plusMinus: number;
}

export interface NbaPlayer {
  id: number;
  firstname: string;
  lastname: string;
  birth: { date: string; country: string };
  nba: { start: number; pro: number };
  height: { feets: string; inches: string; meters: string };
  weight: { pounds: string; kilograms: string };
  college: string | null;
  affiliation: string | null;
  leagues: {
    standard?: { jersey: number; active: boolean; pos: string };
  };
}

export interface NbaStanding {
  league: string;
  season: number;
  team: NbaTeamRef;
  conference: {
    name: 'East' | 'West';
    rank: number;
    win: number;
    loss: number;
  };
  division: {
    name: string;
    rank: number;
    win: number;
    loss: number;
    gamesBehind: string | null;
  };
  win: {
    home: number;
    away: number;
    total: number;
    percentage: string;
    lastTen: number;
  };
  loss: {
    home: number;
    away: number;
    total: number;
    percentage: string;
    lastTen: number;
  };
  gamesBehind: string | null;
  streak: number;
  winStreak: boolean;
  tieBreakerPoints: string | null;
}

export interface NbaPlayerGameStats {
  player: { id: number; firstname: string; lastname: string };
  team: NbaTeamRef;
  game: { id: number };
  points: number;
  pos: string;
  min: string;     // e.g. "35"
  fgm: number;
  fga: number;
  fgp: string;
  ftm: number;
  fta: number;
  ftp: string;
  tpm: number;     // 3-pointers made
  tpa: number;     // 3-pointers attempted
  tpp: string;
  offReb: number;
  defReb: number;
  totReb: number;
  assists: number;
  pFouls: number;
  steals: number;
  turnovers: number;
  blocks: number;
  plusMinus: string;
  comment: string | null;
}

// Simple in-memory cache (10 min TTL for static data, 60s for live games)
const cache = new Map<string, { data: any; expiresAt: number }>();
const LIVE_TTL_MS = 60 * 1000;
const STATIC_TTL_MS = 10 * 60 * 1000;
const LONG_TTL_MS = 60 * 60 * 1000; // 1h for team/player profiles

function cacheKey(endpoint: string, params: Record<string, any>): string {
  return endpoint + '?' + Object.entries(params || {})
    .filter(([_, v]) => v !== undefined && v !== null)
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

async function nbaFetch<T>(
  endpoint: string,
  params: Record<string, any> = {},
  ttl: number = STATIC_TTL_MS
): Promise<T[]> {
  const key = cacheKey(endpoint, params);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data as T[];
  }

  const url = new URL(BASE_URL + endpoint);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const response = await fetch(url.toString(), {
    headers: {
      'x-apisports-key': API_KEY,
      'Content-Type': 'application/json',
    },
    // Next.js fetch cache directive
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`NBA API ${endpoint} returned ${response.status}`);
  }

  const json = (await response.json()) as ApiNbaResponse<T>;
  if (json.errors && !Array.isArray(json.errors) && Object.keys(json.errors).length > 0) {
    console.error('[api-nba] errors:', json.errors);
  }

  const data = json.response || [];
  cache.set(key, { data, expiresAt: Date.now() + ttl });
  return data;
}

export class ApiNbaService {
  /**
   * Get today's NBA games (with live quarter linescores for in-progress games).
   */
  async getGamesByDate(date: string): Promise<NbaGame[]> {
    return nbaFetch<NbaGame>('/games', { date }, LIVE_TTL_MS);
  }

  /**
   * Fetch a single game by ID.
   */
  async getGameById(id: number): Promise<NbaGame | null> {
    const games = await nbaFetch<NbaGame>('/games', { id }, LIVE_TTL_MS);
    return games[0] || null;
  }

  /**
   * Live games only.
   */
  async getLiveGames(): Promise<NbaGame[]> {
    return nbaFetch<NbaGame>('/games', { live: 'all' }, LIVE_TTL_MS);
  }

  /**
   * Get all games for a team in a season (used for recent form + H2H analysis).
   */
  async getTeamGames(teamId: number, season: number): Promise<NbaGame[]> {
    return nbaFetch<NbaGame>('/games', { team: teamId, season }, STATIC_TTL_MS);
  }

  /**
   * Team season statistics — averages across all games in the season.
   */
  async getTeamStatistics(teamId: number, season: number): Promise<NbaTeamSeasonStats | null> {
    const rows = await nbaFetch<NbaTeamSeasonStats>(
      '/teams/statistics',
      { id: teamId, season },
      LONG_TTL_MS
    );
    return rows[0] || null;
  }

  /**
   * Get the list of players on a team's roster.
   */
  async getTeamPlayers(teamId: number, season: number): Promise<NbaPlayer[]> {
    return nbaFetch<NbaPlayer>('/players', { team: teamId, season }, LONG_TTL_MS);
  }

  /**
   * Per-player statistics for a single game.
   */
  async getGamePlayerStats(gameId: number): Promise<NbaPlayerGameStats[]> {
    return nbaFetch<NbaPlayerGameStats>('/players/statistics', { game: gameId }, STATIC_TTL_MS);
  }

  /**
   * Per-player statistics for a season (averages).
   * NOTE: API-NBA returns per-game rows, so we aggregate them client-side.
   */
  async getPlayerSeasonStats(
    playerId: number,
    season: number
  ): Promise<NbaPlayerSeasonAverage | null> {
    const rows = await nbaFetch<NbaPlayerGameStats>(
      '/players/statistics',
      { id: playerId, season },
      LONG_TTL_MS
    );
    if (rows.length === 0) return null;
    return aggregatePlayerStats(playerId, rows);
  }

  /**
   * Aggregate multiple players' season stats in parallel (batch for efficiency).
   */
  async getTeamPlayerSeasonStats(
    teamId: number,
    season: number
  ): Promise<NbaPlayerSeasonAverage[]> {
    const rows = await nbaFetch<NbaPlayerGameStats>(
      '/players/statistics',
      { team: teamId, season },
      LONG_TTL_MS
    );
    // Group by player
    const grouped = new Map<number, NbaPlayerGameStats[]>();
    for (const row of rows) {
      const pid = row.player?.id;
      if (!pid) continue;
      if (!grouped.has(pid)) grouped.set(pid, []);
      grouped.get(pid)!.push(row);
    }
    return Array.from(grouped.entries())
      .map(([pid, games]) => aggregatePlayerStats(pid, games))
      .filter((p): p is NbaPlayerSeasonAverage => p !== null)
      .sort((a, b) => b.ppg - a.ppg);
  }

  /**
   * Head-to-head: last N games between two teams.
   */
  async getHeadToHead(team1: number, team2: number, season: number): Promise<NbaGame[]> {
    const g1 = await nbaFetch<NbaGame>('/games', { team: team1, season }, STATIC_TTL_MS);
    return g1.filter(
      (g) =>
        (g.teams.home.id === team1 && g.teams.visitors.id === team2) ||
        (g.teams.home.id === team2 && g.teams.visitors.id === team1)
    );
  }

  /**
   * League standings (conferences + divisions).
   * Returns W-L records, GB, streak, conference/division rank.
   */
  async getStandings(season: number, league: 'standard' = 'standard'): Promise<NbaStanding[]> {
    return nbaFetch<NbaStanding>('/standings', { league, season }, LONG_TTL_MS);
  }

  /**
   * Find a team's standings row for playoff-race context.
   */
  async getTeamStanding(teamId: number, season: number): Promise<NbaStanding | null> {
    const rows = await this.getStandings(season);
    return rows.find((r) => r.team?.id === teamId) || null;
  }

  /**
   * Determine current NBA season from today's date.
   * NBA regular season starts in October (month 10) and runs through April.
   * June-September = offseason (use previous season).
   */
  getCurrentSeason(): number {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    // If we're past September, season has started — use current year
    if (month >= 9) return year;
    return year - 1;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Player Season Average Aggregation
// ─────────────────────────────────────────────────────────────────────────────
export interface NbaPlayerSeasonAverage {
  playerId: number;
  firstname: string;
  lastname: string;
  teamId: number;
  teamName: string;
  gamesPlayed: number;
  mpg: number;   // Minutes per game
  ppg: number;   // Points per game
  rpg: number;   // Rebounds per game
  apg: number;   // Assists per game
  spg: number;   // Steals per game
  bpg: number;   // Blocks per game
  topg: number;  // Turnovers per game
  tpmpg: number; // 3PM per game
  tpapg: number; // 3PA per game
  fgPct: number; // Field goal %
  ftPct: number; // Free throw %
  tpPct: number; // 3-point %
  plusMinusAvg: number;
  // Standard deviations (for over/under prediction)
  ppgStdDev: number;
  rpgStdDev: number;
  apgStdDev: number;
  tpmpgStdDev: number;
}

function parseMinutes(minStr: string | undefined): number {
  if (!minStr) return 0;
  // Format may be "35" or "35:42" (MM:SS)
  if (minStr.includes(':')) {
    const [m, s] = minStr.split(':').map(Number);
    return m + s / 60;
  }
  return parseFloat(minStr) || 0;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function aggregatePlayerStats(
  playerId: number,
  games: NbaPlayerGameStats[]
): NbaPlayerSeasonAverage | null {
  // Filter out games where player didn't play (0 minutes)
  const played = games.filter((g) => parseMinutes(g.min) > 0);
  if (played.length === 0) return null;

  const points = played.map((g) => g.points || 0);
  const rebounds = played.map((g) => g.totReb || 0);
  const assists = played.map((g) => g.assists || 0);
  const tpm = played.map((g) => g.tpm || 0);
  const tpa = played.map((g) => g.tpa || 0);
  const steals = played.map((g) => g.steals || 0);
  const blocks = played.map((g) => g.blocks || 0);
  const turnovers = played.map((g) => g.turnovers || 0);
  const minutes = played.map((g) => parseMinutes(g.min));
  const fgm = played.reduce((s, g) => s + (g.fgm || 0), 0);
  const fga = played.reduce((s, g) => s + (g.fga || 0), 0);
  const ftm = played.reduce((s, g) => s + (g.ftm || 0), 0);
  const fta = played.reduce((s, g) => s + (g.fta || 0), 0);
  const tpmTotal = played.reduce((s, g) => s + (g.tpm || 0), 0);
  const tpaTotal = played.reduce((s, g) => s + (g.tpa || 0), 0);
  const plusMinus = played.map((g) => parseFloat(g.plusMinus || '0') || 0);

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  return {
    playerId,
    firstname: played[0].player.firstname,
    lastname: played[0].player.lastname,
    teamId: played[0].team.id,
    teamName: played[0].team.name,
    gamesPlayed: played.length,
    mpg: avg(minutes),
    ppg: avg(points),
    rpg: avg(rebounds),
    apg: avg(assists),
    spg: avg(steals),
    bpg: avg(blocks),
    topg: avg(turnovers),
    tpmpg: avg(tpm),
    tpapg: avg(tpa),
    fgPct: fga > 0 ? (fgm / fga) * 100 : 0,
    ftPct: fta > 0 ? (ftm / fta) * 100 : 0,
    tpPct: tpaTotal > 0 ? (tpmTotal / tpaTotal) * 100 : 0,
    plusMinusAvg: avg(plusMinus),
    ppgStdDev: stdev(points),
    rpgStdDev: stdev(rebounds),
    apgStdDev: stdev(assists),
    tpmpgStdDev: stdev(tpm),
  };
}

export const nbaApi = new ApiNbaService();
