/**
 * Hockey player-prop generator.
 *
 * Covers NHL + KHL + SHL + all majors defined in `MAJOR_HOCKEY_LEAGUES`.
 * Unlike basketball, we don't have a DB of player-season averages yet, so
 * we rely on the api-sports `/players` endpoint and derive projections from
 * its per-season aggregates.
 *
 * For each skater we compute expected goals / shots / assists / points /
 * blocked shots given:
 *   1. Season averages from api-sports (games played, goals, assists, shots,
 *      blocks, ice time).
 *   2. Team strength context from the hockey engine's team-stats endpoint
 *      (goals for / against — approximate matchup adjustment).
 *   3. Home/away tilt.
 *
 * Goalies are excluded — their markets (saves, saves %) are a separate
 * universe we will plug in after the skater pipeline is live.
 */

import { hockeyApi, MAJOR_HOCKEY_LEAGUES } from '@/lib/sports/hockey/api-hockey';
import { buildLinesForPlayer } from './line-builder';
import { chooseDistribution } from './stat-distributions';
import {
  CONFIDENCE_THRESHOLDS,
  type PlayerPropFactors,
  type PlayerPropLine,
  type PlayerPropPredictionResult,
} from './types';

// Book lines from the spec
const GOALS_LINES = [0.5, 1.5] as const;
const SHOTS_LINES = [1.5, 2.5, 3.5, 4.5, 5.5] as const;
const ASSIST_LINES = [0.5, 1.5] as const;
const POINTS_LINES = [0.5, 1.5, 2.5] as const;
const BLOCKED_LINES = [0.5, 1.5, 2.5] as const;

const MIN_MEAN = {
  GOALS: 0.12,
  SHOTS: 0.8,
  ASSISTS: 0.15,
  POINTS: 0.3,
  BLOCKED: 0.4,
} as const;

// Coefficient of variation defaults — per-skater game-level dispersion.
const DEFAULT_CV = {
  GOALS: 1.4, // rare, highly over-dispersed (negative-binomial on ~0.3 mean)
  SHOTS: 0.55,
  ASSISTS: 1.3,
  POINTS: 0.9,
  BLOCKED: 0.7,
} as const;

interface HockeyPlayerBaseline {
  player_id: number;
  player_name: string;
  team_id: number;
  team_name: string;
  position: string | null;
  games_played: number;
  ice_time_per_game: number | null; // minutes
  goals_per_game: number;
  assists_per_game: number;
  points_per_game: number;
  shots_per_game: number;
  blocked_shots_per_game: number;
}

interface TeamContext {
  team_id: number;
  goals_for_per_game: number | null;
  goals_against_per_game: number | null;
  games_played: number;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function generateHockeyProps(
  game_id: number,
): Promise<PlayerPropPredictionResult> {
  const game = await hockeyApi.getGameById(game_id);
  if (!game) throw new Error(`Hokey maci bulunamadi: ${game_id}`);

  const home = (game as any).teams?.home;
  const away = (game as any).teams?.away;
  const league = (game as any).league;
  if (!home?.id || !away?.id || !league?.id) {
    throw new Error(`Takim/lig bilgisi eksik: ${game_id}`);
  }

  const season = (league.season ?? hockeyApi.getCurrentSeason()) as string | number;
  const leagueId = league.id as number;

  // --- Team context -------------------------------------------------------
  const [homeCtx, awayCtx, leagueAvg] = await Promise.all([
    loadTeamContext(leagueId, season, home.id),
    loadTeamContext(leagueId, season, away.id),
    loadLeagueAverageGoals(leagueId, season),
  ]);

  // --- Rosters ------------------------------------------------------------
  const [homeRoster, awayRoster] = await Promise.all([
    loadHockeyPlayers(leagueId, season, home.id, home.name as string),
    loadHockeyPlayers(leagueId, season, away.id, away.name as string),
  ]);

  const lines: PlayerPropLine[] = [];
  for (const p of homeRoster) {
    lines.push(...emit({ player: p, isHome: true, teamCtx: homeCtx, oppCtx: awayCtx, leagueAvg }));
  }
  for (const p of awayRoster) {
    lines.push(...emit({ player: p, isHome: false, teamCtx: awayCtx, oppCtx: homeCtx, leagueAvg }));
  }

  const highConfidence = lines.filter(l => l.confidence >= CONFIDENCE_THRESHOLDS.gold);
  const notes: string[] = [];
  if (homeRoster.length === 0 && awayRoster.length === 0) {
    notes.push(
      'api-sports hokey API\'sinde oyuncu-seviye endpoint bulunmuyor. Hokey oyuncu projeksiyonları için ya DB\'de oyuncu tablosu (hockey_player_season_averages) ya da harici bir oyuncu veri kaynağı gerekli.',
    );
  } else {
    if (homeRoster.length === 0)
      notes.push(`Ev sahibi takım için oyuncu verisi bulunamadı (team ${home.id}).`);
    if (awayRoster.length === 0)
      notes.push(`Deplasman takımı için oyuncu verisi bulunamadı (team ${away.id}).`);
  }

  return {
    sport: 'hockey',
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
      home_roster_size: homeRoster.length,
      away_roster_size: awayRoster.length,
      lines_emitted: lines.length,
      platinum_count: lines.filter(l => l.confidence_tier === 'platinum').length,
      gold_count: lines.filter(l => l.confidence_tier === 'gold').length,
      silver_count: lines.filter(l => l.confidence_tier === 'silver').length,
    },
  };
}

function detectLeagueLabel(leagueId: number): string | null {
  for (const [k, v] of Object.entries(MAJOR_HOCKEY_LEAGUES)) {
    if (v === leagueId) return k;
  }
  return null;
}

// ---------------------------------------------------------------------------
// API loaders
// ---------------------------------------------------------------------------

async function loadTeamContext(
  leagueId: number,
  season: string | number,
  teamId: number,
): Promise<TeamContext> {
  try {
    const stats = await hockeyApi.getTeamStatistics({
      league: leagueId,
      season,
      team: teamId,
    });
    const row = Array.isArray(stats) ? stats[0] : stats;
    const games = Number(row?.games ?? row?.games_played ?? 0);
    const gf = Number(row?.goals?.for?.total?.all ?? row?.goals_for ?? 0);
    const ga = Number(row?.goals?.against?.total?.all ?? row?.goals_against ?? 0);
    return {
      team_id: teamId,
      goals_for_per_game: games > 0 ? gf / games : null,
      goals_against_per_game: games > 0 ? ga / games : null,
      games_played: games,
    };
  } catch {
    return { team_id: teamId, goals_for_per_game: null, goals_against_per_game: null, games_played: 0 };
  }
}

async function loadLeagueAverageGoals(
  leagueId: number,
  season: string | number,
): Promise<number> {
  // Try to derive from recent games; if unavailable, return a sensible default.
  try {
    const games = await hockeyApi.getGamesByLeague(leagueId, season);
    const finished = games
      .filter((g: any) => g?.scores?.home?.total !== null && g?.scores?.away?.total !== null)
      .slice(-120);
    if (finished.length < 10) return 5.6; // fallback
    const totals = finished.map(
      (g: any) => (g.scores?.home?.total ?? 0) + (g.scores?.away?.total ?? 0),
    );
    return totals.reduce((a: number, b: number) => a + b, 0) / totals.length;
  } catch {
    return 5.6;
  }
}

/**
 * Fetch the roster via api-sports `/players` endpoint.
 * The hockey API exposes seasonal player stats including goals, assists,
 * shots, blocked_shots, games, time_on_ice.
 */
async function loadHockeyPlayers(
  leagueId: number,
  season: string | number,
  teamId: number,
  teamName: string,
): Promise<HockeyPlayerBaseline[]> {
  try {
    const apiPlayers = (await (hockeyApi as any).cachedRequest?.(
      '/players',
      { league: leagueId, season, team: teamId },
      3600,
    )) as any[] | undefined;
    if (!apiPlayers || apiPlayers.length === 0) return [];
    return apiPlayers
      .map(p => toBaseline(p, teamId, teamName))
      .filter((x): x is HockeyPlayerBaseline => x !== null)
      .slice(0, 22); // typical NHL dressed roster
  } catch {
    return [];
  }
}

function toBaseline(p: any, teamId: number, teamName: string): HockeyPlayerBaseline | null {
  const info = p.player ?? p;
  const stats = Array.isArray(p.statistics) ? p.statistics[0] : p.statistics;
  if (!info?.id) return null;
  const games = Number(stats?.games ?? stats?.appearences ?? 0);
  if (games < 3) return null;
  // Goalies omitted — their markets are not emitted by this engine.
  const position = (info?.position as string | undefined)?.toUpperCase?.() ?? null;
  if (position && /GOAL|GK/.test(position)) return null;

  const goals = Number(stats?.goals?.total ?? stats?.goals ?? 0);
  const assists = Number(stats?.assists?.total ?? stats?.assists ?? 0);
  const points = Number(stats?.points?.total ?? stats?.points ?? goals + assists);
  const shots = Number(stats?.shots?.total ?? stats?.shots ?? 0);
  const blocked = Number(stats?.blocked_shots?.total ?? stats?.blocks ?? 0);
  const ice = stats?.time_on_ice ?? stats?.timeOnIce ?? null;
  const iceMin = typeof ice === 'number' ? ice : parseIceTime(ice);

  return {
    player_id: Number(info.id),
    player_name: resolvePlayerName(info),
    team_id: teamId,
    team_name: teamName,
    position,
    games_played: games,
    ice_time_per_game: iceMin !== null ? iceMin / Math.max(1, games) : null,
    goals_per_game: goals / games,
    assists_per_game: assists / games,
    points_per_game: points / games,
    shots_per_game: shots / games,
    blocked_shots_per_game: blocked / games,
  };
}

function resolvePlayerName(info: any): string {
  if (typeof info?.name === 'string' && info.name.trim()) return info.name.trim();
  const first = typeof info?.firstname === 'string' ? info.firstname.trim() : '';
  const last = typeof info?.lastname === 'string' ? info.lastname.trim() : '';
  const joined = `${first} ${last}`.trim();
  if (joined) return joined;
  return `Player ${info?.id ?? '?'}`;
}

function parseIceTime(x: unknown): number | null {
  if (x === null || x === undefined) return null;
  if (typeof x === 'number') return isFinite(x) ? x : null;
  if (typeof x === 'string') {
    // Sometimes appears as "mm:ss" total across season
    if (x.includes(':')) {
      const [m, s] = x.split(':').map(Number);
      if (!isFinite(m)) return null;
      return m + (isFinite(s) ? s / 60 : 0);
    }
    const n = Number(x);
    return isFinite(n) ? n : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Emission logic
// ---------------------------------------------------------------------------

interface EmitCtx {
  player: HockeyPlayerBaseline;
  isHome: boolean;
  teamCtx: TeamContext;
  oppCtx: TeamContext;
  leagueAvg: number;
}

function emit(ctx: EmitCtx): PlayerPropLine[] {
  const { player, isHome, teamCtx, oppCtx, leagueAvg } = ctx;
  const out: PlayerPropLine[] = [];

  const matchupFactor = computeMatchupFactor(oppCtx.goals_against_per_game, leagueAvg);
  const paceFactor = computePaceFactor(
    teamCtx.goals_for_per_game,
    oppCtx.goals_for_per_game,
    leagueAvg,
  );
  const homeAdj = isHome ? 0.03 : -0.015;

  const reason = (stat: string) =>
    ({ line, side, mean }: { line: number; side: 'OVER' | 'UNDER'; prob: number; mean: number }) => {
      const pieces: string[] = [];
      pieces.push(`${player.player_name} ${line} ${side === 'OVER' ? 'üstü' : 'altı'}`);
      pieces.push(`projeksiyon ${mean.toFixed(2)} ${stat}`);
      if (matchupFactor > 1.03) pieces.push('rakip savunması zayıf');
      else if (matchupFactor < 0.97) pieces.push('rakip savunması güçlü');
      if (paceFactor > 1.03) pieces.push('yüksek skor beklentisi');
      else if (paceFactor < 0.97) pieces.push('düşük skor beklentisi');
      pieces.push(isHome ? 'ev sahibi avantajı' : 'deplasman');
      return pieces.join(' — ');
    };

  // ---- GOALS --------------------------------------------------------------
  const goalsMean = adjustMean(player.goals_per_game, matchupFactor, paceFactor, homeAdj);
  if (goalsMean >= MIN_MEAN.GOALS) {
    const std = Math.sqrt(goalsMean * (1 + DEFAULT_CV.GOALS));
    const dist = chooseDistribution(goalsMean, std, 'poisson');
    out.push(
      ...buildLinesForPlayer({
        sport_prefix: 'HO',
        player_id: player.player_id,
        player_name: player.player_name,
        team_id: player.team_id,
        team_name: player.team_name,
        position: player.position,
        market: 'GOALS',
        distribution: dist,
        projected_mean: goalsMean,
        projected_std_dev: std,
        book_lines: GOALS_LINES,
        factors: factors(player, goalsMean, std, matchupFactor, paceFactor, homeAdj, dist),
        reasoning_builder: reason('gol'),
      }),
    );
  }

  // ---- SHOTS --------------------------------------------------------------
  const shotsMean = adjustMean(player.shots_per_game, matchupFactor, paceFactor, homeAdj * 0.5);
  if (shotsMean >= MIN_MEAN.SHOTS) {
    const std = shotsMean * DEFAULT_CV.SHOTS;
    const dist = chooseDistribution(shotsMean, std, 'negative_binomial');
    out.push(
      ...buildLinesForPlayer({
        sport_prefix: 'HO',
        player_id: player.player_id,
        player_name: player.player_name,
        team_id: player.team_id,
        team_name: player.team_name,
        position: player.position,
        market: 'SHOTS_ON_GOAL',
        distribution: dist,
        projected_mean: shotsMean,
        projected_std_dev: std,
        book_lines: SHOTS_LINES,
        factors: factors(player, shotsMean, std, matchupFactor, paceFactor, homeAdj * 0.5, dist),
        reasoning_builder: reason('şut'),
      }),
    );
  }

  // ---- ASSISTS ------------------------------------------------------------
  const assistsMean = adjustMean(player.assists_per_game, matchupFactor, paceFactor, homeAdj * 0.6);
  if (assistsMean >= MIN_MEAN.ASSISTS) {
    const std = Math.sqrt(assistsMean * (1 + DEFAULT_CV.ASSISTS));
    const dist = chooseDistribution(assistsMean, std, 'poisson');
    out.push(
      ...buildLinesForPlayer({
        sport_prefix: 'HO',
        player_id: player.player_id,
        player_name: player.player_name,
        team_id: player.team_id,
        team_name: player.team_name,
        position: player.position,
        market: 'HOCKEY_ASSISTS',
        distribution: dist,
        projected_mean: assistsMean,
        projected_std_dev: std,
        book_lines: ASSIST_LINES,
        factors: factors(player, assistsMean, std, matchupFactor, paceFactor, homeAdj * 0.6, dist),
        reasoning_builder: reason('asist'),
      }),
    );
  }

  // ---- POINTS (goals + assists) -------------------------------------------
  const pointsMean = adjustMean(player.points_per_game, matchupFactor, paceFactor, homeAdj);
  if (pointsMean >= MIN_MEAN.POINTS) {
    const std = Math.max(pointsMean * DEFAULT_CV.POINTS, 0.5);
    const dist = chooseDistribution(pointsMean, std, 'negative_binomial');
    out.push(
      ...buildLinesForPlayer({
        sport_prefix: 'HO',
        player_id: player.player_id,
        player_name: player.player_name,
        team_id: player.team_id,
        team_name: player.team_name,
        position: player.position,
        market: 'HOCKEY_POINTS',
        distribution: dist,
        projected_mean: pointsMean,
        projected_std_dev: std,
        book_lines: POINTS_LINES,
        factors: factors(player, pointsMean, std, matchupFactor, paceFactor, homeAdj, dist),
        reasoning_builder: reason('puan'),
      }),
    );
  }

  // ---- BLOCKED SHOTS ------------------------------------------------------
  const blockedMean = adjustMean(player.blocked_shots_per_game, 1.0, paceFactor, 0);
  if (blockedMean >= MIN_MEAN.BLOCKED) {
    const std = blockedMean * DEFAULT_CV.BLOCKED;
    const dist = chooseDistribution(blockedMean, std, 'poisson');
    out.push(
      ...buildLinesForPlayer({
        sport_prefix: 'HO',
        player_id: player.player_id,
        player_name: player.player_name,
        team_id: player.team_id,
        team_name: player.team_name,
        position: player.position,
        market: 'BLOCKED_SHOTS',
        distribution: dist,
        projected_mean: blockedMean,
        projected_std_dev: std,
        book_lines: BLOCKED_LINES,
        factors: factors(player, blockedMean, std, 1.0, paceFactor, 0, dist),
        reasoning_builder: reason('blok'),
      }),
    );
  }

  return out;
}

function adjustMean(base: number, matchup: number, pace: number, home: number): number {
  if (!isFinite(base) || base <= 0) return 0;
  return base * matchup * pace * (1 + home);
}

function computeMatchupFactor(
  oppGoalsAgainstPerGame: number | null,
  leagueTotalAvg: number,
): number {
  if (!oppGoalsAgainstPerGame || !leagueTotalAvg) return 1.0;
  const leagueSideAvg = leagueTotalAvg / 2;
  const ratio = oppGoalsAgainstPerGame / leagueSideAvg;
  return Math.max(0.9, Math.min(1.1, ratio));
}

function computePaceFactor(
  teamGF: number | null,
  oppGF: number | null,
  leagueTotalAvg: number,
): number {
  if (!teamGF || !oppGF || !leagueTotalAvg) return 1.0;
  const leagueSideAvg = leagueTotalAvg / 2;
  const ratio = (teamGF + oppGF) / (leagueSideAvg * 2);
  return Math.max(0.94, Math.min(1.06, ratio));
}

function factors(
  player: HockeyPlayerBaseline,
  mean: number,
  std: number,
  matchup: number,
  pace: number,
  home: number,
  dist: ReturnType<typeof chooseDistribution>,
): PlayerPropFactors {
  // Baseline reverses the adjustments (approximate).
  const baseline = mean / (matchup * pace * (1 + home));
  return {
    projected_mean: round3(mean),
    projected_std_dev: round3(std),
    distribution: dist,
    baseline_mean: round3(baseline),
    matchup_factor: round3(matchup),
    pace_factor: round3(pace),
    home_adjustment: round3(home),
    sample_size: player.games_played,
    expected_usage: player.ice_time_per_game,
  };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
