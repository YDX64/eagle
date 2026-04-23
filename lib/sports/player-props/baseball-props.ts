/**
 * Baseball player-prop generator.
 *
 * Starting pitchers (SP) → STRIKEOUTS.
 * Starting batters → HITS, TOTAL_BASES, HOME_RUNS.
 *
 * MLB + NPB + KBO + every major league defined in `MAJOR_BASEBALL_LEAGUES`.
 * Data comes from the api-sports baseball `/players` endpoint. API responses
 * for baseball tend to expose:
 *   - pitching.strikeouts / games / innings / ERA / WHIP / K9 / BAA
 *   - batting.hits / at_bats / doubles / triples / homeruns / runs / RBI / games
 *
 * For pitcher K projections we use a K/9 × expected innings model. For batter
 * markets we use per-game rates scaled by the expected plate appearances.
 */

import { baseballApi, MAJOR_BASEBALL_LEAGUES } from '@/lib/sports/baseball/api-baseball';
import { buildLinesForPlayer } from './line-builder';
import { chooseDistribution } from './stat-distributions';
import {
  CONFIDENCE_THRESHOLDS,
  type PlayerPropFactors,
  type PlayerPropLine,
  type PlayerPropPredictionResult,
} from './types';

const STRIKEOUT_LINES = [3.5, 4.5, 5.5, 6.5, 7.5] as const;
const HIT_LINES = [0.5, 1.5] as const;
const TB_LINES = [1.5, 2.5, 3.5] as const;
const HR_LINES = [0.5] as const;

const MIN_MEAN = {
  STRIKEOUTS: 2.5,
  HITS: 0.4,
  TB: 0.6,
  HR: 0.12,
} as const;

// Default coefficients of variation derived from empirical MLB data.
const DEFAULT_CV = {
  STRIKEOUTS: 0.35,
  HITS: 0.75,
  TB: 0.85,
  HR: 1.6,
} as const;

interface PitcherBaseline {
  player_id: number;
  player_name: string;
  team_id: number;
  team_name: string;
  position: string | null;
  games_started: number;
  innings_per_start: number; // expected IP in this start
  k_per_9: number;
  era: number | null;
  baa: number | null; // batting average against
}

interface BatterBaseline {
  player_id: number;
  player_name: string;
  team_id: number;
  team_name: string;
  position: string | null;
  games_played: number;
  plate_appearances_per_game: number;
  hits_per_game: number;
  total_bases_per_game: number;
  home_runs_per_game: number;
  batting_average: number | null;
  slugging: number | null;
}

interface TeamContext {
  team_id: number;
  runs_per_game: number | null;
  runs_allowed_per_game: number | null;
  team_batting_avg: number | null;
  games_played: number;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export async function generateBaseballProps(
  game_id: number,
): Promise<PlayerPropPredictionResult> {
  const game = await baseballApi.getGameById(game_id);
  if (!game) throw new Error(`Beyzbol maci bulunamadi: ${game_id}`);

  const home = (game as any).teams?.home;
  const away = (game as any).teams?.away;
  const league = (game as any).league;
  if (!home?.id || !away?.id || !league?.id) {
    throw new Error(`Takim/lig bilgisi eksik: ${game_id}`);
  }

  const season = (league.season ?? baseballApi.getCurrentSeason()) as string | number;
  const leagueId = league.id as number;

  const [homeCtx, awayCtx, leagueRpg] = await Promise.all([
    loadTeamContext(leagueId, season, home.id),
    loadTeamContext(leagueId, season, away.id),
    loadLeagueRunsPerGame(leagueId, season),
  ]);

  const [homePlayers, awayPlayers] = await Promise.all([
    loadRoster(leagueId, season, home.id, home.name as string),
    loadRoster(leagueId, season, away.id, away.name as string),
  ]);

  const lines: PlayerPropLine[] = [];

  // Pitchers
  for (const p of homePlayers.pitchers) {
    lines.push(...emitPitcher(p, true, homeCtx, awayCtx, leagueRpg));
  }
  for (const p of awayPlayers.pitchers) {
    lines.push(...emitPitcher(p, false, awayCtx, homeCtx, leagueRpg));
  }

  // Batters
  for (const b of homePlayers.batters) {
    lines.push(...emitBatter(b, true, homeCtx, awayCtx, leagueRpg));
  }
  for (const b of awayPlayers.batters) {
    lines.push(...emitBatter(b, false, awayCtx, homeCtx, leagueRpg));
  }

  const highConfidence = lines.filter(l => l.confidence >= CONFIDENCE_THRESHOLDS.gold);
  const notes: string[] = [];
  const homeRosterSize = homePlayers.pitchers.length + homePlayers.batters.length;
  const awayRosterSize = awayPlayers.pitchers.length + awayPlayers.batters.length;
  const totalRoster = homeRosterSize + awayRosterSize;
  if (totalRoster === 0) {
    notes.push(
      'api-sports beyzbol API\'sinde oyuncu-seviye endpoint bulunmuyor. Beyzbol oyuncu projeksiyonları için ya DB\'de oyuncu tablosu (baseball_player_season_averages) ya da harici oyuncu veri kaynağı gerekli.',
    );
  }

  return {
    sport: 'baseball',
    game_id,
    league_id: leagueId,
    league_name: (league.name as string | undefined) ?? detectLeagueLabel(leagueId),
    season,
    home_team: home.name as string,
    home_team_id: home.id as number,
    away_team: away.name as string,
    away_team_id: away.id as number,
    game_date: (game as any).date as string,
    players: lines,
    high_confidence: highConfidence,
    generated_at: new Date().toISOString(),
    notes: notes.length > 0 ? notes : undefined,
    summary: {
      home_roster_size: homeRosterSize,
      away_roster_size: awayRosterSize,
      lines_emitted: lines.length,
      platinum_count: lines.filter(l => l.confidence_tier === 'platinum').length,
      gold_count: lines.filter(l => l.confidence_tier === 'gold').length,
      silver_count: lines.filter(l => l.confidence_tier === 'silver').length,
    },
  };
}

function detectLeagueLabel(leagueId: number): string | null {
  for (const [k, v] of Object.entries(MAJOR_BASEBALL_LEAGUES)) {
    if (v === leagueId) return k;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

async function loadTeamContext(
  leagueId: number,
  season: string | number,
  teamId: number,
): Promise<TeamContext> {
  try {
    const stats = await baseballApi.getTeamStatistics({ league: leagueId, season, team: teamId });
    const row = Array.isArray(stats) ? stats[0] : stats;
    const games = Number(row?.games ?? row?.games_played ?? 0);
    const rf = Number(row?.runs?.for?.total?.all ?? row?.runs_for ?? row?.goals?.for?.total?.all ?? 0);
    const ra = Number(row?.runs?.against?.total?.all ?? row?.runs_against ?? row?.goals?.against?.total?.all ?? 0);
    const avg = ((): number | null => {
    const raw = row?.batting_average ?? row?.avg ?? 0;
    const num = Number(raw);
    return num > 0 ? num : null;
  })();
    return {
      team_id: teamId,
      runs_per_game: games > 0 ? rf / games : null,
      runs_allowed_per_game: games > 0 ? ra / games : null,
      team_batting_avg: avg,
      games_played: games,
    };
  } catch {
    return {
      team_id: teamId,
      runs_per_game: null,
      runs_allowed_per_game: null,
      team_batting_avg: null,
      games_played: 0,
    };
  }
}

async function loadLeagueRunsPerGame(
  leagueId: number,
  season: string | number,
): Promise<number> {
  try {
    const games = await baseballApi.getGamesByLeague(leagueId, season);
    const finished = games
      .filter((g: any) => g?.scores?.home?.total !== null && g?.scores?.away?.total !== null)
      .slice(-200);
    if (finished.length < 10) return 9.0;
    const totals = finished.map(
      (g: any) => (g.scores?.home?.total ?? 0) + (g.scores?.away?.total ?? 0),
    );
    return totals.reduce((a: number, b: number) => a + b, 0) / totals.length;
  } catch {
    return 9.0;
  }
}

interface Roster {
  pitchers: PitcherBaseline[];
  batters: BatterBaseline[];
}

async function loadRoster(
  leagueId: number,
  season: string | number,
  teamId: number,
  teamName: string,
): Promise<Roster> {
  try {
    const rows = (await (baseballApi as any).cachedRequest?.(
      '/players',
      { league: leagueId, season, team: teamId },
      3600,
    )) as any[] | undefined;
    if (!rows || rows.length === 0) return { pitchers: [], batters: [] };

    const pitchers: PitcherBaseline[] = [];
    const batters: BatterBaseline[] = [];

    for (const row of rows) {
      const info = row.player ?? row;
      const stats = Array.isArray(row.statistics) ? row.statistics[0] : row.statistics;
      if (!info?.id || !stats) continue;

      const position = (info?.position as string | undefined)?.toUpperCase?.() ?? null;
      const pos = position ?? '';
      const startsFromStats = Number(stats?.pitching?.starts ?? stats?.starts ?? 0);
      const isSP =
        /^SP$|STARTING PITCHER|PITCHER\s*-\s*S/.test(pos) ||
        (/^P$/.test(pos) && startsFromStats > 3);

      const pitcher = toPitcher(info, stats, teamId, teamName);
      if (isSP && pitcher) {
        pitchers.push(pitcher);
        continue;
      }

      const batter = toBatter(info, stats, teamId, teamName);
      if (batter) batters.push(batter);
    }

    // Only the top 9-12 batters by PA typically start.
    batters.sort((a, b) => b.plate_appearances_per_game - a.plate_appearances_per_game);

    return {
      pitchers: pitchers.slice(0, 6), // top candidates for starting rotation
      batters: batters.slice(0, 12),
    };
  } catch {
    return { pitchers: [], batters: [] };
  }
}

function toPitcher(info: any, stats: any, teamId: number, teamName: string): PitcherBaseline | null {
  const p = stats?.pitching ?? stats;
  const games_started = Number(p?.starts ?? p?.games?.started ?? p?.games_started ?? 0);
  const innings = Number(p?.innings_pitched ?? p?.innings?.total ?? p?.ip ?? 0);
  if (games_started < 3 || innings < 10) return null;
  const strikeouts = Number(p?.strikeouts ?? p?.k ?? 0);
  const eraRaw = Number(p?.era ?? 0);
  const era = eraRaw > 0 ? eraRaw : null;
  const baaRaw = Number(p?.batting_average_against ?? p?.baa ?? 0);
  const baa = baaRaw > 0 ? baaRaw : null;
  // K/9 = K * 9 / IP
  const k_per_9 = innings > 0 ? (strikeouts * 9) / innings : 0;
  // Average IP per start, capped at 7 (typical modern MLB ceiling).
  const innings_per_start = Math.min(7, innings / Math.max(1, games_started));
  if (k_per_9 <= 0 || innings_per_start <= 0) return null;
  return {
    player_id: Number(info?.id ?? 0),
    player_name: resolvePlayerName(info),
    team_id: teamId,
    team_name: teamName,
    position: 'SP',
    games_started,
    innings_per_start,
    k_per_9,
    era,
    baa,
  };
}

function toBatter(info: any, stats: any, teamId: number, teamName: string): BatterBaseline | null {
  const b = stats?.batting ?? stats;
  const games = Number(b?.games ?? b?.appearences ?? b?.games_played ?? 0);
  if (games < 5) return null;
  const pa = Number(b?.plate_appearances ?? b?.pa ?? 0);
  const ab = Number(b?.at_bats ?? b?.atBats ?? b?.ab ?? 0);
  const hits = Number(b?.hits ?? 0);
  const doubles = Number(b?.doubles ?? b?.['2b'] ?? 0);
  const triples = Number(b?.triples ?? b?.['3b'] ?? 0);
  const homeruns = Number(b?.homeruns ?? b?.home_runs ?? b?.hr ?? 0);
  const singles = Math.max(0, hits - doubles - triples - homeruns);
  const total_bases = singles + doubles * 2 + triples * 3 + homeruns * 4;
  const paPerGame = games > 0 ? (pa > 0 ? pa / games : ab / games + 0.5) : 0;
  const hitsPerGame = games > 0 ? hits / games : 0;
  if (hitsPerGame <= 0) return null;
  return {
    player_id: Number(info?.id ?? 0),
    player_name: resolvePlayerName(info),
    team_id: teamId,
    team_name: teamName,
    position: (info?.position as string | null) ?? null,
    games_played: games,
    plate_appearances_per_game: paPerGame,
    hits_per_game: hitsPerGame,
    total_bases_per_game: games > 0 ? total_bases / games : 0,
    home_runs_per_game: games > 0 ? homeruns / games : 0,
    batting_average: ab > 0 ? hits / ab : null,
    slugging: ab > 0 ? total_bases / ab : null,
  };
}

/**
 * Build a human-readable player name from api-sports' nested payload. The
 * endpoint sometimes exposes `.name`, sometimes only `firstname` + `lastname`.
 */
function resolvePlayerName(info: any): string {
  if (typeof info?.name === 'string' && info.name.trim()) return info.name.trim();
  const first = typeof info?.firstname === 'string' ? info.firstname.trim() : '';
  const last = typeof info?.lastname === 'string' ? info.lastname.trim() : '';
  const joined = `${first} ${last}`.trim();
  if (joined) return joined;
  return `Player ${info?.id ?? '?'}`;
}

// ---------------------------------------------------------------------------
// Emit pitchers (STRIKEOUTS)
// ---------------------------------------------------------------------------

function emitPitcher(
  p: PitcherBaseline,
  isHome: boolean,
  _teamCtx: TeamContext,
  oppCtx: TeamContext,
  leagueRpg: number,
): PlayerPropLine[] {
  // Matchup: strong-hitting opponents reduce strikeouts, weak ones increase.
  // Use team batting average as proxy (lower BA → more Ks).
  const leagueAvg = 0.245; // typical MLB baseline; NPB/KBO similar.
  const matchupFactor = oppCtx.team_batting_avg
    ? Math.max(0.88, Math.min(1.12, leagueAvg / Math.max(0.190, oppCtx.team_batting_avg)))
    : 1.0;
  // Pace factor: higher-scoring games → pitcher pulled sooner → fewer Ks.
  const leagueAvgRpg = leagueRpg / 2;
  const oppRpg = oppCtx.runs_per_game ?? leagueAvgRpg;
  const paceFactor = Math.max(0.9, Math.min(1.08, leagueAvgRpg / Math.max(2.5, oppRpg)));
  // Home pitchers are marginally better (+2% on average).
  const homeAdj = isHome ? 0.02 : -0.01;

  // Expected Ks = K/9 × expected IP × adjustments.
  const mean = (p.k_per_9 / 9) * p.innings_per_start * matchupFactor * paceFactor * (1 + homeAdj);
  if (mean < MIN_MEAN.STRIKEOUTS) return [];
  const std = Math.max(mean * DEFAULT_CV.STRIKEOUTS, 1.2);
  const dist = chooseDistribution(mean, std, 'poisson');

  const reasoning = ({ line, side, mean: m }: { line: number; side: 'OVER' | 'UNDER'; prob: number; mean: number }) => {
    const pieces: string[] = [];
    pieces.push(`${p.player_name} ${line} ${side === 'OVER' ? 'üstü' : 'altı'} strikeout`);
    pieces.push(`K/9 ${p.k_per_9.toFixed(1)}`);
    pieces.push(`beklenen IP ${p.innings_per_start.toFixed(1)}`);
    pieces.push(`projeksiyon ${m.toFixed(1)}`);
    if (matchupFactor > 1.02) pieces.push('rakip vuruş zayıf');
    else if (matchupFactor < 0.98) pieces.push('rakip vuruş güçlü');
    pieces.push(isHome ? 'ev sahibi avantajı' : 'deplasman');
    return pieces.join(' — ');
  };

  const factors: PlayerPropFactors = {
    projected_mean: round3(mean),
    projected_std_dev: round3(std),
    distribution: dist,
    baseline_mean: round3((p.k_per_9 / 9) * p.innings_per_start),
    matchup_factor: round3(matchupFactor),
    pace_factor: round3(paceFactor),
    home_adjustment: round3(homeAdj),
    sample_size: p.games_started,
    expected_usage: p.innings_per_start,
  };

  return buildLinesForPlayer({
    sport_prefix: 'BS',
    player_id: p.player_id,
    player_name: p.player_name,
    team_id: p.team_id,
    team_name: p.team_name,
    position: p.position,
    market: 'STRIKEOUTS',
    distribution: dist,
    projected_mean: mean,
    projected_std_dev: std,
    book_lines: STRIKEOUT_LINES,
    factors,
    reasoning_builder: reasoning,
  });
}

// ---------------------------------------------------------------------------
// Emit batters (HITS, TOTAL_BASES, HOME_RUNS)
// ---------------------------------------------------------------------------

function emitBatter(
  b: BatterBaseline,
  isHome: boolean,
  _teamCtx: TeamContext,
  oppCtx: TeamContext,
  leagueRpg: number,
): PlayerPropLine[] {
  const out: PlayerPropLine[] = [];

  // Matchup factor: opposing pitching (approximate via runs_allowed_per_game)
  const leagueSideAvg = leagueRpg / 2;
  const oppRa = oppCtx.runs_allowed_per_game ?? leagueSideAvg;
  const matchupFactor = Math.max(0.9, Math.min(1.1, oppRa / Math.max(3.0, leagueSideAvg)));
  // Pace: implied run environment.
  const paceFactor = 1.0;
  // Home hitters: modest +2% on average.
  const homeAdj = isHome ? 0.02 : -0.01;

  const reasoning = (stat: string) =>
    ({ line, side, mean }: { line: number; side: 'OVER' | 'UNDER'; prob: number; mean: number }) => {
      const pieces: string[] = [];
      pieces.push(`${b.player_name} ${line} ${side === 'OVER' ? 'üstü' : 'altı'} ${stat}`);
      pieces.push(`projeksiyon ${mean.toFixed(2)}`);
      if (matchupFactor > 1.03) pieces.push('rakip atma zayıf');
      else if (matchupFactor < 0.97) pieces.push('rakip atma güçlü');
      if (b.batting_average) pieces.push(`BA ${b.batting_average.toFixed(3)}`);
      pieces.push(isHome ? 'ev sahibi avantajı' : 'deplasman');
      return pieces.join(' — ');
    };

  // ---- HITS ---------------------------------------------------------------
  const hitsMean = b.hits_per_game * matchupFactor * paceFactor * (1 + homeAdj);
  if (hitsMean >= MIN_MEAN.HITS) {
    const std = Math.max(Math.sqrt(hitsMean * (1 + DEFAULT_CV.HITS)), 0.6);
    const dist = chooseDistribution(hitsMean, std, 'poisson');
    out.push(
      ...buildLinesForPlayer({
        sport_prefix: 'BS',
        player_id: b.player_id,
        player_name: b.player_name,
        team_id: b.team_id,
        team_name: b.team_name,
        position: b.position,
        market: 'HITS',
        distribution: dist,
        projected_mean: hitsMean,
        projected_std_dev: std,
        book_lines: HIT_LINES,
        factors: batterFactors(b, hitsMean, std, matchupFactor, paceFactor, homeAdj, dist),
        reasoning_builder: reasoning('vuruş'),
      }),
    );
  }

  // ---- TOTAL BASES --------------------------------------------------------
  const tbMean = b.total_bases_per_game * matchupFactor * paceFactor * (1 + homeAdj);
  if (tbMean >= MIN_MEAN.TB) {
    const std = Math.max(tbMean * DEFAULT_CV.TB, 0.9);
    const dist = chooseDistribution(tbMean, std, 'negative_binomial');
    out.push(
      ...buildLinesForPlayer({
        sport_prefix: 'BS',
        player_id: b.player_id,
        player_name: b.player_name,
        team_id: b.team_id,
        team_name: b.team_name,
        position: b.position,
        market: 'TOTAL_BASES',
        distribution: dist,
        projected_mean: tbMean,
        projected_std_dev: std,
        book_lines: TB_LINES,
        factors: batterFactors(b, tbMean, std, matchupFactor, paceFactor, homeAdj, dist),
        reasoning_builder: reasoning('total base'),
      }),
    );
  }

  // ---- HOME RUNS ----------------------------------------------------------
  const hrMean = b.home_runs_per_game * matchupFactor * paceFactor * (1 + homeAdj);
  if (hrMean >= MIN_MEAN.HR) {
    const std = Math.max(Math.sqrt(hrMean * (1 + DEFAULT_CV.HR)), 0.4);
    const dist = chooseDistribution(hrMean, std, 'poisson');
    out.push(
      ...buildLinesForPlayer({
        sport_prefix: 'BS',
        player_id: b.player_id,
        player_name: b.player_name,
        team_id: b.team_id,
        team_name: b.team_name,
        position: b.position,
        market: 'HOME_RUNS',
        distribution: dist,
        projected_mean: hrMean,
        projected_std_dev: std,
        book_lines: HR_LINES,
        factors: batterFactors(b, hrMean, std, matchupFactor, paceFactor, homeAdj, dist),
        reasoning_builder: reasoning('home run'),
      }),
    );
  }

  return out;
}

function batterFactors(
  b: BatterBaseline,
  mean: number,
  std: number,
  matchup: number,
  pace: number,
  home: number,
  dist: ReturnType<typeof chooseDistribution>,
): PlayerPropFactors {
  const baseline = mean / (matchup * pace * (1 + home));
  return {
    projected_mean: round3(mean),
    projected_std_dev: round3(std),
    distribution: dist,
    baseline_mean: round3(baseline),
    matchup_factor: round3(matchup),
    pace_factor: round3(pace),
    home_adjustment: round3(home),
    sample_size: b.games_played,
    expected_usage: b.plate_appearances_per_game,
  };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
