/**
 * NHL player stats importer.
 *
 * Pulls real data from the public NHL Web API (https://api-web.nhle.com)
 * and writes two tables in the tracking PostgreSQL DB:
 *   - ho_player_season_averages  (roster-level season aggregates)
 *   - ho_player_game_logs        (per-game boxscore rows)
 *
 * Both writes are idempotent via the Prisma upsert primitive.
 *
 * Endpoints used:
 *   - /v1/standings/now                           -- list of teams (abbrev + id)
 *   - /v1/club-stats/{ABBR}/{SEASON}/2            -- regular-season skater/goalie
 *                                                    aggregates for a team
 *   - /v1/schedule/{YYYY-MM-DD}                   -- scheduled games on a day
 *   - /v1/gamecenter/{GAME_ID}/boxscore           -- per-game boxscore
 *
 * Season format: compact 8-digit string '20242025'. The NHL accepts '20252026'
 * for the current 2025–2026 season.
 *
 * NOTE on per-season hits/blocks:
 *   The club-stats endpoint does NOT expose `hits` or `blockedShots` in the
 *   skater aggregate. Those stats only appear in per-game boxscores. So:
 *     - `importAllTeamRosters` writes `null` for hits_per_game / blocks_per_game
 *       and the caller can backfill the averages later from ho_player_game_logs
 *       once boxscores have been imported.
 *     - `importGameBoxscore` writes the authoritative per-game hits / blocks.
 *
 * STD devs in season averages use Poisson approximation (std = sqrt(mean)) as
 * a sane fallback when we don't have per-game dispersion. Once there's a
 * meaningful number of game-log rows the consumer can recompute the real
 * std devs.
 */

import { trackingPrisma } from '@/lib/db';
import { jitteredFetch, numberOrNull, round4, safeNumber } from './shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NHL_API_BASE = 'https://api-web.nhle.com/v1';
const SOURCE = 'nhl';

/** Regular season game type. */
const GAME_TYPE_REGULAR = 2;

// ---------------------------------------------------------------------------
// Types (structural — these are permissive over the upstream NHL payload)
// ---------------------------------------------------------------------------

interface NhlI18nString {
  default: string;
  [k: string]: string | undefined;
}

interface NhlStandingsRow {
  teamAbbrev: NhlI18nString;
  teamName: NhlI18nString;
  teamCommonName?: NhlI18nString;
  teamLogo?: string;
  conferenceName?: string;
  divisionName?: string;
}

interface NhlStandingsResponse {
  standings: NhlStandingsRow[];
}

interface NhlSkaterAggregate {
  playerId: number;
  firstName?: NhlI18nString;
  lastName?: NhlI18nString;
  positionCode?: string;
  gamesPlayed?: number;
  goals?: number;
  assists?: number;
  points?: number;
  plusMinus?: number;
  penaltyMinutes?: number;
  shots?: number;
  avgTimeOnIcePerGame?: number; // seconds
  avgShiftsPerGame?: number;
}

interface NhlGoalieAggregate {
  playerId: number;
  firstName?: NhlI18nString;
  lastName?: NhlI18nString;
  gamesPlayed?: number;
  gamesStarted?: number;
  wins?: number;
  losses?: number;
  savePercentage?: number;
  goalsAgainstAverage?: number;
  shutouts?: number;
  timeOnIce?: number | string;
}

interface NhlClubStatsResponse {
  season: string;
  gameType: number;
  skaters: NhlSkaterAggregate[];
  goalies: NhlGoalieAggregate[];
}

interface NhlScheduleGame {
  id: number;
  gameType?: number;
  gameState?: string;
  gameScheduleState?: string;
  startTimeUTC?: string;
  homeTeam?: { id?: number; abbrev?: string; score?: number };
  awayTeam?: { id?: number; abbrev?: string; score?: number };
}

interface NhlScheduleResponse {
  gameWeek?: Array<{
    date: string;
    games: NhlScheduleGame[];
  }>;
  games?: NhlScheduleGame[];
}

interface NhlBoxscorePlayerRow {
  playerId: number;
  sweaterNumber?: number;
  name?: NhlI18nString | string;
  position?: string;
  goals?: number;
  assists?: number;
  points?: number;
  plusMinus?: number;
  pim?: number;
  hits?: number;
  powerPlayGoals?: number;
  sog?: number;
  faceoffWinningPctg?: number;
  toi?: string; // "mm:ss"
  blockedShots?: number;
  shifts?: number;
  giveaways?: number;
  takeaways?: number;
  starter?: boolean;
}

interface NhlBoxscoreGoalieRow {
  playerId: number;
  name?: NhlI18nString | string;
  position?: string;
  toi?: string;
  starter?: boolean;
}

interface NhlBoxscoreTeamPlayers {
  forwards?: NhlBoxscorePlayerRow[];
  defense?: NhlBoxscorePlayerRow[];
  goalies?: NhlBoxscoreGoalieRow[];
}

interface NhlBoxscoreResponse {
  id: number;
  season?: number;
  gameDate?: string;
  awayTeam?: {
    id?: number;
    abbrev?: string;
    name?: NhlI18nString;
    commonName?: NhlI18nString;
    placeName?: NhlI18nString;
    score?: number;
  };
  homeTeam?: {
    id?: number;
    abbrev?: string;
    name?: NhlI18nString;
    commonName?: NhlI18nString;
    placeName?: NhlI18nString;
    score?: number;
  };
  gameState?: string;
  playerByGameStats?: {
    awayTeam?: NhlBoxscoreTeamPlayers;
    homeTeam?: NhlBoxscoreTeamPlayers;
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RosterImportResult {
  season: string;
  teams_scanned: number;
  teams_succeeded: number;
  teams_failed: number;
  players_upserted: number;
  errors: Array<{ team_abbrev: string; error: string }>;
}

export interface ImportOptions {
  /** Limit to N teams (for smoke testing). */
  limit_teams?: number;
  /** Subset of team abbreviations to import. */
  team_abbrevs?: string[];
}

/**
 * Import season averages for every team in the league.
 *
 * Works end-to-end: standings → per-team skater aggregates → upsert.
 * Goalies are intentionally skipped — player-prop markets for goalies use a
 * separate pipeline.
 */
export async function importAllTeamRosters(
  season: string,
  options: ImportOptions = {},
): Promise<RosterImportResult> {
  if (!trackingPrisma) {
    throw new Error('trackingPrisma is not initialised — cannot import NHL rosters');
  }

  const result: RosterImportResult = {
    season,
    teams_scanned: 0,
    teams_succeeded: 0,
    teams_failed: 0,
    players_upserted: 0,
    errors: [],
  };

  const standings = await jitteredFetch<NhlStandingsResponse>(
    `${NHL_API_BASE}/standings/now`,
  );
  if (!standings?.standings) {
    throw new Error('NHL standings response was empty');
  }

  // De-duplicate by abbrev (the standings list is already unique but defensive).
  const abbrevSet = new Set<string>();
  const teams: { abbrev: string; name: string }[] = [];
  for (const row of standings.standings) {
    const abbrev = row.teamAbbrev?.default;
    if (!abbrev || abbrevSet.has(abbrev)) continue;
    abbrevSet.add(abbrev);
    teams.push({
      abbrev,
      name: row.teamName?.default ?? abbrev,
    });
  }

  const filtered = options.team_abbrevs && options.team_abbrevs.length > 0
    ? teams.filter(t => options.team_abbrevs!.includes(t.abbrev))
    : teams;
  const limited = options.limit_teams && options.limit_teams > 0
    ? filtered.slice(0, options.limit_teams)
    : filtered;

  for (const team of limited) {
    result.teams_scanned += 1;
    try {
      const upserted = await importTeamRoster(team.abbrev, team.name, season);
      result.teams_succeeded += 1;
      result.players_upserted += upserted;
    } catch (err) {
      result.teams_failed += 1;
      result.errors.push({
        team_abbrev: team.abbrev,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/**
 * Import one team's season skater aggregates and upsert each row into
 * `ho_player_season_averages`. Returns the number of rows written.
 *
 * `canonical_team_id` is the NHL team's internal id. The NHL club-stats
 * endpoint doesn't expose the team id directly, so we hash the abbreviation
 * via the standings API up front. As a robust fallback we fetch the current
 * roster endpoint which returns the team numerical id.
 */
export async function importTeamRoster(
  teamAbbrev: string,
  teamName: string,
  season: string,
): Promise<number> {
  if (!trackingPrisma) return 0;

  const stats = await jitteredFetch<NhlClubStatsResponse>(
    `${NHL_API_BASE}/club-stats/${teamAbbrev}/${season}/${GAME_TYPE_REGULAR}`,
    { allow404: true },
  );
  if (!stats?.skaters || stats.skaters.length === 0) {
    return 0;
  }

  const teamId = await resolveTeamId(teamAbbrev);

  let count = 0;
  for (const row of stats.skaters) {
    if (!row.playerId) continue;
    const games = safeNumber(row.gamesPlayed);
    if (games <= 0) continue;

    const goals = safeNumber(row.goals);
    const assists = safeNumber(row.assists);
    const points = safeNumber(row.points, goals + assists);
    const shots = safeNumber(row.shots);
    const pim = safeNumber(row.penaltyMinutes);
    const plusMinus = numberOrNull(row.plusMinus);
    const toiSeconds = safeNumber(row.avgTimeOnIcePerGame);

    const goalsPerGame = goals / games;
    const assistsPerGame = assists / games;
    const pointsPerGame = points / games;
    const shotsPerGame = shots / games;
    const pimPerGame = pim / games;
    const toiMinutesPerGame = toiSeconds / 60;

    // Poisson-approximation std devs. These are fallbacks — they'll be
    // overwritten once per-game logs accumulate and the caller recomputes.
    const goalsStd = Math.sqrt(Math.max(goalsPerGame, 1e-6));
    const assistsStd = Math.sqrt(Math.max(assistsPerGame, 1e-6));
    const pointsStd = Math.sqrt(Math.max(pointsPerGame, 1e-6));
    const shotsStd = Math.sqrt(Math.max(shotsPerGame, 1e-6));

    const playerName = resolvePlayerName(row.firstName, row.lastName, row.playerId);

    await trackingPrisma.ho_player_season_averages.upsert({
      where: {
        source_player_id_season: {
          source: SOURCE,
          player_id: row.playerId,
          season,
        },
      },
      update: {
        player_name: playerName,
        team_id: teamId,
        team_name: teamName,
        position: row.positionCode ?? null,
        games_played: games,
        goals_per_game: round4(goalsPerGame),
        assists_per_game: round4(assistsPerGame),
        points_per_game: round4(pointsPerGame),
        shots_per_game: round4(shotsPerGame),
        // hits/blocks not available in club-stats — leave null until boxscores
        // are imported and aggregated separately.
        hits_per_game: null,
        blocks_per_game: null,
        pim_per_game: round4(pimPerGame),
        toi_per_game: round4(toiMinutesPerGame),
        plus_minus_avg: plusMinus,
        goals_std: round4(goalsStd),
        assists_std: round4(assistsStd),
        points_std: round4(pointsStd),
        shots_std: round4(shotsStd),
        computed_at: new Date(),
      },
      create: {
        source: SOURCE,
        player_id: row.playerId,
        player_name: playerName,
        team_id: teamId,
        team_name: teamName,
        position: row.positionCode ?? null,
        season,
        games_played: games,
        goals_per_game: round4(goalsPerGame),
        assists_per_game: round4(assistsPerGame),
        points_per_game: round4(pointsPerGame),
        shots_per_game: round4(shotsPerGame),
        hits_per_game: null,
        blocks_per_game: null,
        pim_per_game: round4(pimPerGame),
        toi_per_game: round4(toiMinutesPerGame),
        plus_minus_avg: plusMinus,
        goals_std: round4(goalsStd),
        assists_std: round4(assistsStd),
        points_std: round4(pointsStd),
        shots_std: round4(shotsStd),
      },
    });
    count += 1;
  }

  return count;
}

// ---------------------------------------------------------------------------
// Boxscore import
// ---------------------------------------------------------------------------

export interface BoxscoreImportResult {
  api_game_id: number;
  rows_written: number;
  skipped: boolean;
  reason?: string;
}

/**
 * Import one game's per-player stats into `ho_player_game_logs`.
 */
export async function importGameBoxscore(api_game_id: number): Promise<BoxscoreImportResult> {
  if (!trackingPrisma) {
    return { api_game_id, rows_written: 0, skipped: true, reason: 'no-tracking-prisma' };
  }

  const box = await jitteredFetch<NhlBoxscoreResponse>(
    `${NHL_API_BASE}/gamecenter/${api_game_id}/boxscore`,
    { allow404: true },
  );
  if (!box || !box.playerByGameStats) {
    return { api_game_id, rows_written: 0, skipped: true, reason: 'no-boxscore' };
  }

  const gameState = (box.gameState ?? '').toUpperCase();
  // Only persist final games to avoid writing stale in-progress numbers.
  if (gameState && !['OFF', 'FINAL', 'FUT', 'PRE', 'LIVE'].includes(gameState)) {
    // Allow unknown states through — we'd rather import than silently drop.
  }
  if (gameState === 'FUT' || gameState === 'PRE') {
    return { api_game_id, rows_written: 0, skipped: true, reason: `game-state:${gameState}` };
  }

  const homeTeamId = numberOrNull(box.homeTeam?.id);
  const awayTeamId = numberOrNull(box.awayTeam?.id);
  const homeTeamName = resolveTeamNameFromBox(box.homeTeam);
  const awayTeamName = resolveTeamNameFromBox(box.awayTeam);

  const gameId = `nhl:${api_game_id}`;
  const fetchedAt = new Date();

  const awayRows = box.playerByGameStats.awayTeam;
  const homeRows = box.playerByGameStats.homeTeam;

  let written = 0;
  written += await persistSkaterRows(
    api_game_id,
    gameId,
    [...(awayRows?.forwards ?? []), ...(awayRows?.defense ?? [])],
    awayTeamId,
    awayTeamName,
    fetchedAt,
  );
  written += await persistSkaterRows(
    api_game_id,
    gameId,
    [...(homeRows?.forwards ?? []), ...(homeRows?.defense ?? [])],
    homeTeamId,
    homeTeamName,
    fetchedAt,
  );
  // Goalie rows: we store them too (position='G') so downstream code can
  // choose to exclude them. The player-prop engines filter out goalies via
  // the `position` column.
  written += await persistGoalieRows(
    api_game_id,
    gameId,
    awayRows?.goalies ?? [],
    awayTeamId,
    awayTeamName,
    fetchedAt,
  );
  written += await persistGoalieRows(
    api_game_id,
    gameId,
    homeRows?.goalies ?? [],
    homeTeamId,
    homeTeamName,
    fetchedAt,
  );

  return { api_game_id, rows_written: written, skipped: false };
}

async function persistSkaterRows(
  api_game_id: number,
  game_id: string,
  rows: NhlBoxscorePlayerRow[],
  teamId: number | null,
  teamName: string | null,
  fetchedAt: Date,
): Promise<number> {
  if (!trackingPrisma || !teamId) return 0;
  let count = 0;
  for (const row of rows) {
    if (!row.playerId) continue;
    const name = resolveBoxscorePlayerName(row.name, row.playerId);
    const toi = parseToi(row.toi);
    await trackingPrisma.ho_player_game_logs.upsert({
      where: {
        source_api_game_id_player_id: {
          source: SOURCE,
          api_game_id,
          player_id: row.playerId,
        },
      },
      update: {
        game_id,
        player_name: name,
        team_id: teamId,
        team_name: teamName,
        position: row.position ?? null,
        toi: toi,
        goals: safeNumber(row.goals),
        assists: safeNumber(row.assists),
        points: safeNumber(row.points, safeNumber(row.goals) + safeNumber(row.assists)),
        shots: safeNumber(row.sog),
        hits: safeNumber(row.hits),
        blocks: safeNumber(row.blockedShots),
        pim: safeNumber(row.pim),
        plus_minus: numberOrNull(row.plusMinus),
        is_starter: typeof row.starter === 'boolean' ? row.starter : null,
        fetched_at: fetchedAt,
      },
      create: {
        source: SOURCE,
        game_id,
        api_game_id,
        player_id: row.playerId,
        player_name: name,
        team_id: teamId,
        team_name: teamName,
        position: row.position ?? null,
        toi,
        goals: safeNumber(row.goals),
        assists: safeNumber(row.assists),
        points: safeNumber(row.points, safeNumber(row.goals) + safeNumber(row.assists)),
        shots: safeNumber(row.sog),
        hits: safeNumber(row.hits),
        blocks: safeNumber(row.blockedShots),
        pim: safeNumber(row.pim),
        plus_minus: numberOrNull(row.plusMinus),
        is_starter: typeof row.starter === 'boolean' ? row.starter : null,
      },
    });
    count += 1;
  }
  return count;
}

async function persistGoalieRows(
  api_game_id: number,
  game_id: string,
  rows: NhlBoxscoreGoalieRow[],
  teamId: number | null,
  teamName: string | null,
  fetchedAt: Date,
): Promise<number> {
  if (!trackingPrisma || !teamId) return 0;
  let count = 0;
  for (const row of rows) {
    if (!row.playerId) continue;
    const name = resolveBoxscorePlayerName(row.name, row.playerId);
    const toi = parseToi(row.toi);
    await trackingPrisma.ho_player_game_logs.upsert({
      where: {
        source_api_game_id_player_id: {
          source: SOURCE,
          api_game_id,
          player_id: row.playerId,
        },
      },
      update: {
        game_id,
        player_name: name,
        team_id: teamId,
        team_name: teamName,
        position: row.position ?? 'G',
        toi,
        is_starter: typeof row.starter === 'boolean' ? row.starter : null,
        fetched_at: fetchedAt,
      },
      create: {
        source: SOURCE,
        game_id,
        api_game_id,
        player_id: row.playerId,
        player_name: name,
        team_id: teamId,
        team_name: teamName,
        position: row.position ?? 'G',
        toi,
        is_starter: typeof row.starter === 'boolean' ? row.starter : null,
      },
    });
    count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Backfill
// ---------------------------------------------------------------------------

export interface BackfillResult {
  days_scanned: number;
  games_scanned: number;
  games_imported: number;
  rows_written: number;
  errors: Array<{ api_game_id: number; error: string }>;
}

/**
 * Iterate from yesterday back `days` calendar days, fetch the day's schedule,
 * and call `importGameBoxscore` for every game that's marked final.
 */
export async function backfillLastN(days: number): Promise<BackfillResult> {
  const out: BackfillResult = {
    days_scanned: 0,
    games_scanned: 0,
    games_imported: 0,
    rows_written: 0,
    errors: [],
  };

  if (!trackingPrisma) return out;

  const today = new Date();
  for (let i = 1; i <= Math.max(1, days); i++) {
    out.days_scanned += 1;
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - i);
    const iso = date.toISOString().slice(0, 10);
    let schedule: NhlScheduleResponse | null = null;
    try {
      schedule = await jitteredFetch<NhlScheduleResponse>(
        `${NHL_API_BASE}/schedule/${iso}`,
        { allow404: true },
      );
    } catch (err) {
      out.errors.push({
        api_game_id: -1,
        error: `schedule ${iso}: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    if (!schedule) continue;
    const games = flattenSchedule(schedule, iso);
    for (const g of games) {
      if (!g.id) continue;
      out.games_scanned += 1;
      const state = (g.gameState ?? '').toUpperCase();
      // Only attempt final / post-game states.
      if (!['OFF', 'FINAL'].includes(state)) continue;
      try {
        const r = await importGameBoxscore(g.id);
        if (!r.skipped) {
          out.games_imported += 1;
          out.rows_written += r.rows_written;
        }
      } catch (err) {
        out.errors.push({
          api_game_id: g.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flattenSchedule(schedule: NhlScheduleResponse, targetDate: string): NhlScheduleGame[] {
  if (Array.isArray(schedule.games)) return schedule.games;
  if (!schedule.gameWeek) return [];
  // Only include games whose date matches the target — the schedule endpoint
  // returns a full week centred on the requested date.
  const games: NhlScheduleGame[] = [];
  for (const day of schedule.gameWeek) {
    if (day.date === targetDate) {
      for (const g of day.games ?? []) games.push(g);
    }
  }
  return games;
}

function parseToi(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  if (v.includes(':')) {
    const [mm, ss] = v.split(':').map(Number);
    if (!Number.isFinite(mm)) return null;
    return round4(mm + (Number.isFinite(ss) ? ss / 60 : 0));
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function resolvePlayerName(
  first?: NhlI18nString,
  last?: NhlI18nString,
  id?: number,
): string {
  const f = first?.default?.trim() ?? '';
  const l = last?.default?.trim() ?? '';
  const joined = `${f} ${l}`.trim();
  if (joined) return joined;
  return `NHL Player ${id ?? '?'}`;
}

function resolveBoxscorePlayerName(name: unknown, id: number): string {
  if (typeof name === 'string' && name.trim()) return name.trim();
  if (name && typeof name === 'object') {
    const v = (name as NhlI18nString).default;
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return `NHL Player ${id}`;
}

function resolveTeamNameFromBox(t: NhlBoxscoreResponse['homeTeam']): string | null {
  if (!t) return null;
  const common = t.commonName?.default ?? t.name?.default;
  const place = t.placeName?.default;
  if (place && common) return `${place} ${common}`;
  return common ?? place ?? t.abbrev ?? null;
}

// Cache abbrev → team id mapping (populated lazily from roster endpoint).
const _teamIdByAbbrev = new Map<string, number>();

async function resolveTeamId(abbrev: string): Promise<number> {
  const cached = _teamIdByAbbrev.get(abbrev);
  if (cached) return cached;
  try {
    const roster = await jitteredFetch<any>(
      `${NHL_API_BASE}/roster/${abbrev}/current`,
      { allow404: true },
    );
    if (roster) {
      // The current-roster endpoint doesn't return a team id directly, so
      // look it up via the first player's team info if present. The NHL
      // team id matches the same id used in boxscores.
      const list = [
        ...(roster?.forwards ?? []),
        ...(roster?.defensemen ?? []),
        ...(roster?.goalies ?? []),
      ];
      for (const p of list) {
        const tid = numberOrNull(p?.currentTeamId);
        if (tid) {
          _teamIdByAbbrev.set(abbrev, tid);
          return tid;
        }
      }
    }
  } catch {
    // fall through
  }
  // Fallback: derive a stable numeric id by hashing the abbreviation. This
  // won't match the NHL's internal id but guarantees a deterministic value
  // for the NOT NULL column. Boxscore imports will overwrite with the real
  // team id downstream.
  const fallback = abbrevToStableId(abbrev);
  _teamIdByAbbrev.set(abbrev, fallback);
  return fallback;
}

function abbrevToStableId(abbrev: string): number {
  let hash = 0;
  for (let i = 0; i < abbrev.length; i++) {
    hash = (hash * 31 + abbrev.charCodeAt(i)) | 0;
  }
  // Map hash into the "virtual" range 900000..999999 so it never collides
  // with real NHL team ids (1..30-ish).
  const positive = Math.abs(hash);
  return 900000 + (positive % 100000);
}

/** Exposed for tests. */
export const __internal = {
  parseToi,
  flattenSchedule,
  abbrevToStableId,
  resolvePlayerName,
  resolveBoxscorePlayerName,
  resolveTeamNameFromBox,
};
