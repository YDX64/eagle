/**
 * MLB player stats importer.
 *
 * Pulls real data from the public MLB StatsAPI (https://statsapi.mlb.com)
 * and writes two tables in the tracking PostgreSQL DB:
 *   - bs_player_season_averages  (roster-level season aggregates)
 *   - bs_player_game_logs        (per-game boxscore rows)
 *
 * Both writes are idempotent via the Prisma upsert primitive.
 *
 * Endpoints used:
 *   - /api/v1/teams?sportId=1&season={season}
 *   - /api/v1/teams/{id}/roster?rosterType=active
 *   - /api/v1/people/{id}?hydrate=stats(group=[hitting,pitching],type=[season],season={season})
 *   - /api/v1/schedule?sportId=1&date={YYYY-MM-DD}
 *   - /api/v1/game/{gamePk}/boxscore
 *
 * Season is a plain 4-digit string ('2024'). Role is either 'batter' or
 * 'pitcher' — two-way players (Ohtani) get a 'batter' row + a 'pitcher' row
 * when both stat groups are present.
 */

import { trackingPrisma } from '@/lib/db';
import { jitteredFetch, numberOrNull, round4, safeNumber } from './shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MLB_API_BASE = 'https://statsapi.mlb.com/api/v1';
const SOURCE = 'mlb';
const SPORT_ID = 1;

// Pitcher position codes in MLB StatsAPI: '1' (P), 'P' (Pitcher abbr), 'Y' (TWP).
// TWP is treated as both — we run both the batter and pitcher code paths.
const PITCHER_CODES = new Set(['1', 'P', 'SP', 'RP']);
const TWO_WAY_CODES = new Set(['Y', 'TWP']);

// ---------------------------------------------------------------------------
// Types (structural)
// ---------------------------------------------------------------------------

interface MlbTeam {
  id: number;
  name?: string;
  abbreviation?: string;
  teamCode?: string;
  locationName?: string;
  teamName?: string;
  active?: boolean;
  sport?: { id?: number };
}

interface MlbTeamsResponse {
  teams: MlbTeam[];
}

interface MlbRosterEntry {
  person: { id: number; fullName?: string; link?: string };
  jerseyNumber?: string;
  position?: { code?: string; name?: string; type?: string; abbreviation?: string };
  status?: { code?: string; description?: string };
}

interface MlbRosterResponse {
  roster: MlbRosterEntry[];
}

interface MlbStatsSplit {
  season?: string;
  stat: Record<string, unknown>;
  team?: { id?: number; name?: string };
  league?: { id?: number; name?: string };
  gameType?: string;
}

interface MlbStatsGroup {
  type?: { displayName?: string };
  group?: { displayName?: string };
  splits?: MlbStatsSplit[];
}

interface MlbPersonResponse {
  people: Array<{
    id: number;
    fullName?: string;
    primaryPosition?: { code?: string; abbreviation?: string };
    stats?: MlbStatsGroup[];
  }>;
}

interface MlbScheduleGame {
  gamePk: number;
  gameDate?: string;
  officialDate?: string;
  status?: { abstractGameState?: string; codedGameState?: string; detailedState?: string };
  teams?: {
    home?: { team?: { id?: number; name?: string }; score?: number };
    away?: { team?: { id?: number; name?: string }; score?: number };
  };
}

interface MlbScheduleResponse {
  dates?: Array<{ date?: string; games?: MlbScheduleGame[] }>;
}

interface MlbBoxscorePlayer {
  person: { id: number; fullName?: string };
  position?: { code?: string; abbreviation?: string };
  stats?: {
    batting?: Record<string, unknown>;
    pitching?: Record<string, unknown>;
    fielding?: Record<string, unknown>;
  };
  seasonStats?: unknown;
  gameStatus?: { isCurrentBatter?: boolean; isCurrentPitcher?: boolean; isOnBench?: boolean; isSubstitute?: boolean };
}

interface MlbBoxscoreTeam {
  team?: { id?: number; name?: string };
  players?: Record<string, MlbBoxscorePlayer>;
  batters?: number[];
  pitchers?: number[];
  battingOrder?: number[];
}

interface MlbBoxscoreResponse {
  teams?: { home?: MlbBoxscoreTeam; away?: MlbBoxscoreTeam };
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
  errors: Array<{ team_id: number; error: string }>;
}

export interface ImportOptions {
  /** Limit to N teams (for smoke testing). */
  limit_teams?: number;
  /** Subset of team ids to import. */
  team_ids?: number[];
}

/**
 * Import season-level batter + pitcher averages for every MLB team.
 */
export async function importAllTeamRosters(
  season: string,
  options: ImportOptions = {},
): Promise<RosterImportResult> {
  if (!trackingPrisma) {
    throw new Error('trackingPrisma is not initialised — cannot import MLB rosters');
  }

  const out: RosterImportResult = {
    season,
    teams_scanned: 0,
    teams_succeeded: 0,
    teams_failed: 0,
    players_upserted: 0,
    errors: [],
  };

  const teamsRes = await jitteredFetch<MlbTeamsResponse>(
    `${MLB_API_BASE}/teams?sportId=${SPORT_ID}&season=${encodeURIComponent(season)}`,
  );
  if (!teamsRes?.teams) {
    throw new Error('MLB teams response was empty');
  }

  const teams = teamsRes.teams.filter(t => t.active !== false && t.sport?.id === SPORT_ID);
  const filtered = options.team_ids && options.team_ids.length > 0
    ? teams.filter(t => options.team_ids!.includes(t.id))
    : teams;
  const limited = options.limit_teams && options.limit_teams > 0
    ? filtered.slice(0, options.limit_teams)
    : filtered;

  for (const team of limited) {
    out.teams_scanned += 1;
    try {
      const upserted = await importTeamRoster(team, season);
      out.teams_succeeded += 1;
      out.players_upserted += upserted;
    } catch (err) {
      out.teams_failed += 1;
      out.errors.push({
        team_id: team.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return out;
}

/**
 * Import one team's active roster + every player's season stats.
 * Writes `bs_player_season_averages` rows. Returns row count written.
 */
export async function importTeamRoster(
  team: MlbTeam,
  season: string,
): Promise<number> {
  if (!trackingPrisma) return 0;

  const rosterRes = await jitteredFetch<MlbRosterResponse>(
    `${MLB_API_BASE}/teams/${team.id}/roster?rosterType=active&season=${encodeURIComponent(season)}`,
    { allow404: true },
  );
  if (!rosterRes?.roster) return 0;

  const teamName = team.name ?? null;
  let count = 0;

  for (const entry of rosterRes.roster) {
    const personId = entry.person?.id;
    if (!personId) continue;
    const position = (entry.position?.abbreviation ?? entry.position?.code ?? '').toUpperCase();
    const positionCode = entry.position?.code ?? null;

    const isPitcher = PITCHER_CODES.has(position) || PITCHER_CODES.has(positionCode ?? '');
    const isTwoWay = TWO_WAY_CODES.has(position) || TWO_WAY_CODES.has(positionCode ?? '');
    const wantHitting = !isPitcher || isTwoWay;
    const wantPitching = isPitcher || isTwoWay;

    const groupsRequested: string[] = [];
    if (wantHitting) groupsRequested.push('hitting');
    if (wantPitching) groupsRequested.push('pitching');
    if (groupsRequested.length === 0) continue;

    const hydrateValue = `stats(group=[${groupsRequested.join(',')}],type=[season],season=${season})`;
    const url = `${MLB_API_BASE}/people/${personId}?hydrate=${encodeURIComponent(hydrateValue)}`;

    let personRes: MlbPersonResponse | null = null;
    try {
      personRes = await jitteredFetch<MlbPersonResponse>(url, { allow404: true });
    } catch {
      continue;
    }
    if (!personRes?.people?.[0]) continue;
    const person = personRes.people[0];
    const playerName = person.fullName ?? entry.person?.fullName ?? `MLB Player ${personId}`;

    const hittingSplit = findSplit(person.stats, 'hitting', season);
    const pitchingSplit = findSplit(person.stats, 'pitching', season);

    if (hittingSplit && wantHitting) {
      const upserted = await upsertBatterRow({
        player_id: personId,
        player_name: playerName,
        team_id: team.id,
        team_name: teamName,
        position: position || positionCode,
        season,
        stat: hittingSplit.stat,
      });
      if (upserted) count += 1;
    }
    if (pitchingSplit && wantPitching) {
      const upserted = await upsertPitcherRow({
        player_id: personId,
        player_name: playerName,
        team_id: team.id,
        team_name: teamName,
        position: position || positionCode,
        season,
        stat: pitchingSplit.stat,
      });
      if (upserted) count += 1;
    }
  }

  return count;
}

// ---------------------------------------------------------------------------
// Boxscore import
// ---------------------------------------------------------------------------

export interface BoxscoreImportResult {
  game_pk: number;
  rows_written: number;
  skipped: boolean;
  reason?: string;
}

export async function importGameBoxscore(game_pk: number): Promise<BoxscoreImportResult> {
  if (!trackingPrisma) {
    return { game_pk, rows_written: 0, skipped: true, reason: 'no-tracking-prisma' };
  }

  const box = await jitteredFetch<MlbBoxscoreResponse>(
    `${MLB_API_BASE}/game/${game_pk}/boxscore`,
    { allow404: true },
  );
  if (!box?.teams) {
    return { game_pk, rows_written: 0, skipped: true, reason: 'no-boxscore' };
  }

  const gameId = `mlb:${game_pk}`;
  const fetchedAt = new Date();

  let written = 0;
  if (box.teams.home) {
    written += await persistBoxscoreTeam(box.teams.home, game_pk, gameId, fetchedAt);
  }
  if (box.teams.away) {
    written += await persistBoxscoreTeam(box.teams.away, game_pk, gameId, fetchedAt);
  }

  return { game_pk, rows_written: written, skipped: false };
}

async function persistBoxscoreTeam(
  team: MlbBoxscoreTeam,
  api_game_id: number,
  game_id: string,
  fetchedAt: Date,
): Promise<number> {
  if (!trackingPrisma) return 0;
  if (!team?.players) return 0;

  const teamId = team.team?.id ?? 0;
  const teamName = team.team?.name ?? null;
  const battingOrder = new Set((team.battingOrder ?? []).map(Number));

  let count = 0;
  for (const key of Object.keys(team.players)) {
    const player = team.players[key];
    if (!player?.person?.id) continue;
    const personId = player.person.id;
    const positionCode = (player.position?.abbreviation ?? player.position?.code ?? '').toUpperCase();

    const batting = player.stats?.batting ?? null;
    const pitching = player.stats?.pitching ?? null;
    const hasBatting = batting && Object.keys(batting).length > 0 && safeNumber(batting.atBats, 0) > 0;
    const hasPitching = pitching && Object.keys(pitching).length > 0 && parseInnings(pitching.inningsPitched) > 0;

    if (!hasBatting && !hasPitching) continue;

    const role = hasBatting && hasPitching
      ? 'both'
      : hasPitching
        ? 'pitcher'
        : 'batter';

    const isPitcher = PITCHER_CODES.has(positionCode);
    const isStarter = hasPitching
      ? safeNumber(pitching?.gamesStarted) === 1
      : battingOrder.has(personId);

    const data = buildGameLogData({
      api_game_id,
      player_id: personId,
      player_name: player.person.fullName ?? `MLB Player ${personId}`,
      team_id: teamId,
      team_name: teamName,
      position: positionCode || null,
      role,
      batting,
      pitching,
      is_starter: isStarter || isPitcher,
    });

    await trackingPrisma.bs_player_game_logs.upsert({
      where: {
        source_api_game_id_player_id: {
          source: SOURCE,
          api_game_id,
          player_id: personId,
        },
      },
      update: {
        game_id,
        ...data,
        fetched_at: fetchedAt,
      },
      create: {
        source: SOURCE,
        game_id,
        ...data,
      },
    });
    count += 1;
  }
  return count;
}

function buildGameLogData(args: {
  api_game_id: number;
  player_id: number;
  player_name: string;
  team_id: number;
  team_name: string | null;
  position: string | null;
  role: string;
  batting: Record<string, unknown> | null;
  pitching: Record<string, unknown> | null;
  is_starter: boolean;
}) {
  const b = args.batting ?? {};
  const p = args.pitching ?? {};
  return {
    api_game_id: args.api_game_id,
    player_id: args.player_id,
    player_name: args.player_name,
    team_id: args.team_id,
    team_name: args.team_name,
    position: args.position,
    role: args.role,
    // batting
    at_bats: args.batting ? safeNumber(b.atBats) : null,
    hits: args.batting ? safeNumber(b.hits) : null,
    doubles: args.batting ? safeNumber(b.doubles) : null,
    triples: args.batting ? safeNumber(b.triples) : null,
    home_runs: args.batting ? safeNumber(b.homeRuns) : null,
    rbis: args.batting ? safeNumber(b.rbi) : null,
    runs: args.batting ? safeNumber(b.runs) : null,
    strikeouts: args.batting ? safeNumber(b.strikeOuts) : null,
    walks: args.batting ? safeNumber(b.baseOnBalls) : null,
    total_bases: args.batting ? safeNumber(b.totalBases) : null,
    stolen_bases: args.batting ? safeNumber(b.stolenBases) : null,
    // pitching
    innings_pitched: args.pitching ? parseInnings(p.inningsPitched) : null,
    earned_runs: args.pitching ? safeNumber(p.earnedRuns) : null,
    pitcher_ks: args.pitching ? safeNumber(p.strikeOuts) : null,
    pitcher_bb: args.pitching ? safeNumber(p.baseOnBalls) : null,
    hits_allowed: args.pitching ? safeNumber(p.hits) : null,
    hr_allowed: args.pitching ? safeNumber(p.homeRuns) : null,
    is_starter: args.is_starter,
  };
}

// ---------------------------------------------------------------------------
// Backfill
// ---------------------------------------------------------------------------

export interface BackfillResult {
  days_scanned: number;
  games_scanned: number;
  games_imported: number;
  rows_written: number;
  errors: Array<{ game_pk: number; error: string }>;
}

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
    let schedule: MlbScheduleResponse | null = null;
    try {
      schedule = await jitteredFetch<MlbScheduleResponse>(
        `${MLB_API_BASE}/schedule?sportId=${SPORT_ID}&date=${iso}`,
        { allow404: true },
      );
    } catch (err) {
      out.errors.push({
        game_pk: -1,
        error: `schedule ${iso}: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    if (!schedule?.dates) continue;
    for (const day of schedule.dates) {
      for (const g of day.games ?? []) {
        if (!g.gamePk) continue;
        out.games_scanned += 1;
        const state = g.status?.abstractGameState;
        if (state !== 'Final') continue;
        try {
          const r = await importGameBoxscore(g.gamePk);
          if (!r.skipped) {
            out.games_imported += 1;
            out.rows_written += r.rows_written;
          }
        } catch (err) {
          out.errors.push({
            game_pk: g.gamePk,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Upsert helpers for season averages
// ---------------------------------------------------------------------------

async function upsertBatterRow(args: {
  player_id: number;
  player_name: string;
  team_id: number;
  team_name: string | null;
  position: string | null;
  season: string;
  stat: Record<string, unknown>;
}): Promise<boolean> {
  if (!trackingPrisma) return false;
  const games = safeNumber(args.stat.gamesPlayed);
  if (games <= 0) return false;

  const hits = safeNumber(args.stat.hits);
  const tb = safeNumber(args.stat.totalBases);
  const hr = safeNumber(args.stat.homeRuns);
  const rbi = safeNumber(args.stat.rbi);
  const runs = safeNumber(args.stat.runs);
  const so = safeNumber(args.stat.strikeOuts);
  const bb = safeNumber(args.stat.baseOnBalls);
  const pa = safeNumber(args.stat.plateAppearances);

  const hitsPerGame = hits / games;
  const tbPerGame = tb / games;
  const hrPerGame = hr / games;
  const rbiPerGame = rbi / games;
  const runsPerGame = runs / games;
  const soPerGame = so / games;
  const bbPerGame = bb / games;
  const paPerGame = pa > 0 ? pa / games : null;

  const avg = parseSlashStat(args.stat.avg);
  const obp = parseSlashStat(args.stat.obp);
  const slg = parseSlashStat(args.stat.slg);
  const ops = parseSlashStat(args.stat.ops);

  const hitsStd = Math.sqrt(Math.max(hitsPerGame, 1e-6));
  const tbStd = Math.sqrt(Math.max(tbPerGame, 1e-6));
  const hrStd = Math.sqrt(Math.max(hrPerGame, 1e-6));

  await trackingPrisma.bs_player_season_averages.upsert({
    where: {
      source_player_id_season: {
        source: SOURCE,
        player_id: args.player_id,
        season: args.season,
      },
    },
    update: {
      player_name: args.player_name,
      team_id: args.team_id,
      team_name: args.team_name,
      position: args.position,
      role: 'batter',
      games_played: games,
      games_started: null,
      hits_per_game: round4(hitsPerGame),
      tb_per_game: round4(tbPerGame),
      hr_per_game: round4(hrPerGame),
      rbi_per_game: round4(rbiPerGame),
      runs_per_game: round4(runsPerGame),
      so_per_game: round4(soPerGame),
      bb_per_game: round4(bbPerGame),
      avg,
      obp,
      slg,
      ops,
      plate_appearances_per_game: paPerGame !== null ? round4(paPerGame) : null,
      hits_std: round4(hitsStd),
      tb_std: round4(tbStd),
      hr_std: round4(hrStd),
      k_std: null,
      innings_per_start: null,
      k_per_9: null,
      bb_per_9: null,
      hr_per_9: null,
      era: null,
      whip: null,
      baa: null,
      computed_at: new Date(),
    },
    create: {
      source: SOURCE,
      player_id: args.player_id,
      player_name: args.player_name,
      team_id: args.team_id,
      team_name: args.team_name,
      position: args.position,
      role: 'batter',
      season: args.season,
      games_played: games,
      games_started: null,
      hits_per_game: round4(hitsPerGame),
      tb_per_game: round4(tbPerGame),
      hr_per_game: round4(hrPerGame),
      rbi_per_game: round4(rbiPerGame),
      runs_per_game: round4(runsPerGame),
      so_per_game: round4(soPerGame),
      bb_per_game: round4(bbPerGame),
      avg,
      obp,
      slg,
      ops,
      plate_appearances_per_game: paPerGame !== null ? round4(paPerGame) : null,
      hits_std: round4(hitsStd),
      tb_std: round4(tbStd),
      hr_std: round4(hrStd),
    },
  });
  return true;
}

async function upsertPitcherRow(args: {
  player_id: number;
  player_name: string;
  team_id: number;
  team_name: string | null;
  position: string | null;
  season: string;
  stat: Record<string, unknown>;
}): Promise<boolean> {
  if (!trackingPrisma) return false;
  const games = safeNumber(args.stat.gamesPitched, safeNumber(args.stat.gamesPlayed));
  const starts = safeNumber(args.stat.gamesStarted);
  const inningsTotal = parseInnings(args.stat.inningsPitched);
  if (games <= 0 || inningsTotal <= 0) return false;

  const ks = safeNumber(args.stat.strikeOuts);
  const walks = safeNumber(args.stat.baseOnBalls);
  const hrAllowed = safeNumber(args.stat.homeRuns);
  const era = parseSlashStat(args.stat.era);
  const whip = parseSlashStat(args.stat.whip);
  const baa = parseSlashStat(args.stat.avg);

  const k9 = inningsTotal > 0 ? (ks * 9) / inningsTotal : 0;
  const bb9 = inningsTotal > 0 ? (walks * 9) / inningsTotal : 0;
  const hr9 = inningsTotal > 0 ? (hrAllowed * 9) / inningsTotal : 0;
  const innsPerStart = starts > 0 ? Math.min(9, inningsTotal / starts) : inningsTotal / Math.max(1, games);

  const kStd = Math.sqrt(Math.max(k9 / 9 * innsPerStart, 1e-6));

  await trackingPrisma.bs_player_season_averages.upsert({
    where: {
      source_player_id_season: {
        source: SOURCE,
        player_id: args.player_id,
        season: args.season,
      },
    },
    update: {
      player_name: args.player_name,
      team_id: args.team_id,
      team_name: args.team_name,
      position: args.position,
      role: 'pitcher',
      games_played: games,
      games_started: starts,
      hits_per_game: null,
      tb_per_game: null,
      hr_per_game: null,
      rbi_per_game: null,
      runs_per_game: null,
      so_per_game: null,
      bb_per_game: null,
      avg: null,
      obp: null,
      slg: null,
      ops: null,
      plate_appearances_per_game: null,
      innings_per_start: round4(innsPerStart),
      k_per_9: round4(k9),
      bb_per_9: round4(bb9),
      hr_per_9: round4(hr9),
      era,
      whip,
      baa,
      hits_std: null,
      tb_std: null,
      hr_std: null,
      k_std: round4(kStd),
      computed_at: new Date(),
    },
    create: {
      source: SOURCE,
      player_id: args.player_id,
      player_name: args.player_name,
      team_id: args.team_id,
      team_name: args.team_name,
      position: args.position,
      role: 'pitcher',
      season: args.season,
      games_played: games,
      games_started: starts,
      innings_per_start: round4(innsPerStart),
      k_per_9: round4(k9),
      bb_per_9: round4(bb9),
      hr_per_9: round4(hr9),
      era,
      whip,
      baa,
      k_std: round4(kStd),
    },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findSplit(
  groups: MlbStatsGroup[] | undefined,
  groupName: 'hitting' | 'pitching',
  season: string,
): MlbStatsSplit | null {
  if (!groups) return null;
  for (const g of groups) {
    const gname = g.group?.displayName;
    if (gname !== groupName) continue;
    for (const s of g.splits ?? []) {
      if ((s.season ?? '').toString() === season || !s.season) return s;
    }
  }
  return null;
}

/**
 * Parse MLB's weird "slash stat" strings like ".310", "1.036" into a number.
 * Strings like ".---" or "-.--" mean no data -> null. Returns null on parse
 * failure.
 */
function parseSlashStat(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || /^[-.]+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse MLB innings pitched strings — '104.0', '7.2' (which is 7 2/3) etc.
 * In MLB notation the decimal portion is thirds of an inning (out count),
 * so '7.2' = 7 + 2/3 = 7.667.
 */
function parseInnings(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v !== 'string') return 0;
  const s = v.trim();
  if (!s) return 0;
  if (s.includes('.')) {
    const [wholeStr, fracStr] = s.split('.');
    const whole = Number(wholeStr);
    const frac = Number(fracStr);
    if (!Number.isFinite(whole)) return 0;
    if (!Number.isFinite(frac)) return whole;
    const thirds = Math.min(2, Math.max(0, frac));
    return whole + thirds / 3;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Exposed for tests. */
export const __internal = {
  parseInnings,
  parseSlashStat,
  findSplit,
};

// Silence unused-import lint for numberOrNull (kept for parity with nhl-importer).
void numberOrNull;
