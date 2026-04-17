/**
 * Hockey API Service Layer
 * Arctic Futurism - AWA Stats Analytics Platform
 * Tüm endpoint'ler: status, timezone, seasons, countries, leagues, teams,
 * teams/statistics, games, games/h2h, games/events, standings, standings/stages,
 * standings/groups, odds, odds/bets, odds/bookmakers
 */

const API_BASE = 'https://v1.hockey.api-sports.io';
const API_KEY = 'b9ccb3be380b9f990745280ac95b4763';

interface ApiResponse<T> {
  get: string;
  parameters: Record<string, string>;
  errors: any;
  results: number;
  response: T;
}

async function fetchApi<T>(endpoint: string, params?: Record<string, string | number>): Promise<ApiResponse<T>> {
  const url = new URL(`${API_BASE}/${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.append(key, String(value));
      }
    });
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'x-apisports-key': API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }

  return response.json();
}

// Cache layer
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 dakika

async function cachedFetch<T>(endpoint: string, params?: Record<string, string | number>, ttl = CACHE_TTL): Promise<ApiResponse<T>> {
  const key = `${endpoint}:${JSON.stringify(params || {})}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data;
  }
  const data = await fetchApi<T>(endpoint, params);
  cache.set(key, { data, timestamp: Date.now() });
  return data;
}

// ===== ENDPOINT FUNCTIONS =====

export async function getStatus() {
  return fetchApi<any>('status');
}

export async function getTimezones() {
  return cachedFetch<string[]>('timezone', undefined, 24 * 60 * 60 * 1000);
}

export async function getSeasons() {
  return cachedFetch<number[]>('seasons', undefined, 24 * 60 * 60 * 1000);
}

export async function getCountries() {
  return cachedFetch<Country[]>('countries', undefined, 24 * 60 * 60 * 1000);
}

export async function getLeagues(params?: { id?: number; name?: string; country?: string; country_id?: number; season?: number; type?: string; current?: string; search?: string }) {
  return cachedFetch<League[]>('leagues', params as any);
}

export async function getTeams(params?: { id?: number; name?: string; league?: number; season?: number; country?: string; country_id?: number; search?: string }) {
  return cachedFetch<Team[]>('teams', params as any);
}

export async function getTeamStatistics(params: { season: number; team: number; league: number }) {
  return cachedFetch<TeamStatistics>('teams/statistics', params as any);
}

export async function getGames(params?: { id?: number; date?: string; league?: number; season?: number; team?: number; timezone?: string; live?: string; h2h?: string }) {
  return cachedFetch<Game[]>('games', params as any, 60 * 1000); // 1 dakika cache
}

export async function getGameById(id: number) {
  return cachedFetch<Game[]>('games', { id } as any, 30 * 1000);
}

export async function getH2H(params: { h2h: string; season?: number }) {
  return cachedFetch<Game[]>('games/h2h', params as any);
}

export async function getGameEvents(gameId: number) {
  return cachedFetch<GameEvent[]>('games/events', { game: gameId } as any, 30 * 1000);
}

export async function getStandings(params: { league: number; season: number; team?: number; group?: string; stage?: string }) {
  return cachedFetch<StandingGroup[]>('standings', params as any);
}

export async function getStandingsStages(params: { league: number; season: number }) {
  return cachedFetch<string[]>('standings/stages', params as any);
}

export async function getStandingsGroups(params: { league: number; season: number }) {
  return cachedFetch<string[]>('standings/groups', params as any);
}

export async function getOdds(params: { game?: number; bookmaker?: number; bet?: number }) {
  return cachedFetch<OddsResponse[]>('odds', params as any, 2 * 60 * 1000);
}

export async function getOddsBets(params?: { id?: number; search?: string }) {
  return cachedFetch<BetType[]>('odds/bets', params as any, 24 * 60 * 60 * 1000);
}

export async function getOddsBookmakers(params?: { id?: number; search?: string }) {
  return cachedFetch<Bookmaker[]>('odds/bookmakers', params as any, 24 * 60 * 60 * 1000);
}

export async function getLiveGames() {
  return fetchApi<Game[]>('games', { live: 'all' });
}

// ===== TYPE DEFINITIONS =====

export interface Country {
  id: number;
  name: string;
  code: string | null;
  flag: string | null;
}

export interface League {
  id: number;
  name: string;
  type: string;
  logo: string;
  country: Country;
  seasons: { season: number; start: string; end: string; current: boolean }[];
}

export interface Team {
  id: number;
  name: string;
  logo: string;
}

export interface TeamStatistics {
  country: Country;
  league: { id: number; name: string; type: string; logo: string; season: number };
  team: Team;
  games: {
    played: { home: number; away: number; all: number };
    wins: { home: { total: number; percentage: string }; away: { total: number; percentage: string }; all: { total: number; percentage: string } };
    loses: { home: { total: number; percentage: string }; away: { total: number; percentage: string }; all: { total: number; percentage: string } };
  };
  goals: {
    for: { total: { home: number; away: number; all: number }; average: { home: string; away: string; all: string } };
    against: { total: { home: number; away: number; all: number }; average: { home: string; away: string; all: string } };
  };
}

export interface GameStatus {
  long: string;
  short: string;
}

export interface Game {
  id: number;
  date: string;
  time: string;
  timestamp: number;
  timezone: string;
  week: string | null;
  timer: string | null;
  status: GameStatus;
  country: Country;
  league: { id: number; name: string; type: string; logo: string; season: number };
  teams: {
    home: Team;
    away: Team;
  };
  scores: { home: number | null; away: number | null };
  periods: {
    first: string | null;
    second: string | null;
    third: string | null;
    overtime: string | null;
    penalties: string | null;
  };
  events: boolean;
}

export interface GameEvent {
  game_id: number;
  period: string;
  minute: string;
  team: Team;
  players: string[];
  assists: string[];
  comment: string | null;
  type: string;
}

export interface Standing {
  position: number;
  stage: string | null;
  group: { name: string };
  team: Team;
  league: { id: number; name: string; type: string; logo: string; season: number };
  country: Country;
  games: {
    played: number;
    win: { total: number; percentage: string };
    win_overtime: { total: number | null; percentage: string };
    lose: { total: number; percentage: string };
    lose_overtime: { total: number | null; percentage: string };
  };
  goals: { for: number; against: number };
  points: number;
  form: string;
  description: string | null;
}

export type StandingGroup = Standing[];

export interface OddsResponse {
  league: { id: number; name: string; type: string; season: number; logo: string };
  country: Country;
  game: Game;
  bookmakers: BookmakerOdds[];
}

export interface BookmakerOdds {
  id: number;
  name: string;
  bets: BetOdds[];
}

export interface BetOdds {
  id: number;
  name: string;
  values: { value: string; odd: string }[];
}

export interface BetType {
  id: number;
  name: string;
}

export interface Bookmaker {
  id: number;
  name: string;
}

export function clearCache() {
  cache.clear();
}

// Utility: Get today's date in YYYY-MM-DD format
export function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

// Utility: Format date for display
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

export function getGameStatusText(status: GameStatus): string {
  const statusMap: Record<string, string> = {
    'NS': 'Başlamadı',
    'P1': '1. Periyot',
    'P2': '2. Periyot',
    'P3': '3. Periyot',
    'OT': 'Uzatma',
    'PT': 'Penaltılar',
    'BT': 'Mola',
    'FT': 'Bitti',
    'AOT': 'Uzatma Sonrası',
    'AP': 'Penaltı Sonrası',
    'POST': 'Ertelendi',
    'CANC': 'İptal',
    'INTR': 'Yarıda Kaldı',
    'ABD': 'Terk Edildi',
    'LIVE': 'Canlı',
  };
  return statusMap[status.short] || status.long;
}

export function isLiveGame(status: GameStatus): boolean {
  return ['P1', 'P2', 'P3', 'OT', 'PT', 'BT'].includes(status.short);
}

export function isFinishedGame(status: GameStatus): boolean {
  return ['FT', 'AOT', 'AP'].includes(status.short);
}

export function isUpcomingGame(status: GameStatus): boolean {
  return status.short === 'NS';
}
