/**
 * Basketball player-prop generator.
 *
 * Covers NBA + Euroleague + FIBA-style leagues. Data is layered:
 *   1. DB: `bb_player_season_averages` (ppg / rpg / apg / spg / bpg / tpmpg
 *      plus their per-game std devs and usage). This table is filled by the
 *      NBA/BBLL importer and is the authoritative source when present.
 *   2. DB: `bb_team_season_aggregates` gives league pace and opponent
 *      defensive rating — used for matchup adjustments.
 *   3. API fallback: `basketballApi` hits the api-sports `/players` endpoint
 *      per team per league+season. We gently rate-limit by letting the
 *      underlying cached-request layer dedup calls.
 *
 * Every projection is chained through pace × matchup × home-court modifiers
 * before hitting stat-distributions.
 */

import { prisma } from '@/lib/db';
import { basketballApi, MAJOR_BASKETBALL_LEAGUES } from '@/lib/sports/basketball/api-basketball';
import type { Prisma } from '@prisma/client';
import { buildLinesForPlayer } from './line-builder';
import { chooseDistribution } from './stat-distributions';
import {
  CONFIDENCE_THRESHOLDS,
  type PlayerPropFactors,
  type PlayerPropLine,
  type PlayerPropPredictionResult,
} from './types';

// --- Book lines (per the spec) ----------------------------------------------
const POINTS_LINES = [14.5, 17.5, 19.5, 22.5, 24.5, 27.5, 29.5] as const;
const REBOUND_LINES = [4.5, 6.5, 7.5, 9.5, 10.5] as const;
const ASSIST_LINES = [3.5, 4.5, 5.5, 7.5, 9.5, 10.5] as const;
const THREES_LINES = [1.5, 2.5, 3.5, 4.5] as const;
const STEALS_LINES = [0.5, 1.5, 2.5] as const;
const BLOCKS_LINES = [0.5, 1.5, 2.5] as const;
const PRA_LINES = [24.5, 29.5, 34.5, 39.5, 44.5] as const;

// Minimum projected means below which emitting lines is wasteful — we simply
// won't hit any line with informative probability.
const MIN_MEAN = {
  POINTS: 8.0,
  REBOUNDS: 3.0,
  ASSISTS: 2.0,
  THREES: 0.8,
  STEALS: 0.5,
  BLOCKS: 0.5,
  PRA: 14.0,
} as const;

// Per-stat dispersion multipliers applied when the DB doesn't have a stddev.
// Derived from empirical NBA season-level player dispersion:
//   points CV ≈ 0.35, rebounds CV ≈ 0.32, assists CV ≈ 0.38, threes CV ≈ 0.55.
const DEFAULT_CV: Record<string, number> = {
  POINTS: 0.35,
  REBOUNDS: 0.32,
  ASSISTS: 0.38,
  THREES: 0.55,
  STEALS: 0.55,
  BLOCKS: 0.60,
  PRA: 0.30,
};

interface PlayerBaseline {
  player_id: number;
  player_name: string;
  team_id: number;
  team_name: string;
  position: string | null;
  games_played: number;
  minutes: number | null;
  ppg: number;
  rpg: number;
  apg: number;
  spg: number;
  bpg: number;
  tpmpg: number; // three-pointers made per game
  ppg_std: number | null;
  rpg_std: number | null;
  apg_std: number | null;
  tpmpg_std: number | null;
  usage_rate: number | null;
  source: 'db' | 'api';
}

interface TeamContext {
  team_id: number;
  pace: number | null;
  off_rating: number | null;
  def_rating: number | null;
  points_per_game: number | null;
  games_played: number;
}

interface LeagueContext {
  league_id: number;
  league_name: string;
  avg_pace: number | null;
  avg_def_rating: number | null;
  league_label: string | null;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Generate player-prop predictions for a basketball game.
 *
 * @param game_id api-sports basketball game id
 * @returns the full PlayerPropPredictionResult; `players` is flattened across
 *          both teams and all markets.
 */
export async function generateBasketballProps(
  game_id: number,
): Promise<PlayerPropPredictionResult> {
  const game = await basketballApi.getGameById(game_id);
  if (!game) throw new Error(`Basketbol maci bulunamadi: ${game_id}`);

  const home = game.teams?.home;
  const away = game.teams?.away;
  const league = game.league;
  if (!home?.id || !away?.id || !league?.id) {
    throw new Error(`Takim/lig bilgisi eksik: ${game_id}`);
  }

  const season = (league.season ?? basketballApi.getCurrentSeason()) as string | number;
  const leagueId = league.id as number;
  const leagueLabel = detectLeagueLabel(leagueId);

  // ---- Team-level context (pace + def rating from DB) --------------------
  const [homeCtx, awayCtx, leagueCtx] = await Promise.all([
    loadTeamContext(leagueId, season, home.id),
    loadTeamContext(leagueId, season, away.id),
    loadLeagueContext(leagueId, season, leagueLabel, league.name as string | undefined),
  ]);

  // ---- Player rosters ----------------------------------------------------
  const [homeRoster, awayRoster] = await Promise.all([
    loadPlayerBaselines(leagueId, season, home.id, home.name as string),
    loadPlayerBaselines(leagueId, season, away.id, away.name as string),
  ]);

  // ---- Emit lines --------------------------------------------------------
  const lines: PlayerPropLine[] = [];
  for (const p of homeRoster) {
    lines.push(
      ...emitLinesForPlayer({
        player: p,
        isHome: true,
        teamCtx: homeCtx,
        oppCtx: awayCtx,
        leagueCtx,
      }),
    );
  }
  for (const p of awayRoster) {
    lines.push(
      ...emitLinesForPlayer({
        player: p,
        isHome: false,
        teamCtx: awayCtx,
        oppCtx: homeCtx,
        leagueCtx,
      }),
    );
  }

  const highConfidence = lines.filter(l => l.confidence >= CONFIDENCE_THRESHOLDS.gold);
  const notes: string[] = [];
  if (homeRoster.length === 0) notes.push(`Ev sahibi takım için oyuncu verisi bulunamadı (team ${home.id}).`);
  if (awayRoster.length === 0) notes.push(`Deplasman takımı için oyuncu verisi bulunamadı (team ${away.id}).`);

  return {
    sport: 'basketball',
    game_id,
    league_id: leagueId,
    league_name: (league.name as string | undefined) ?? leagueLabel,
    season,
    home_team: home.name as string,
    home_team_id: home.id as number,
    away_team: away.name as string,
    away_team_id: away.id as number,
    game_date: game.date as string,
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

// ---------------------------------------------------------------------------
// DB loaders
// ---------------------------------------------------------------------------

async function loadTeamContext(
  leagueId: number,
  season: string | number,
  teamId: number,
): Promise<TeamContext> {
  try {
    const row = await prisma.bb_team_season_aggregates.findFirst({
      where: {
        league_id: leagueId,
        season: String(season),
        team_id: teamId,
      },
      orderBy: { computed_at: 'desc' },
    });
    if (row) {
      return {
        team_id: teamId,
        pace: row.pace,
        off_rating: row.off_rating,
        def_rating: row.def_rating,
        points_per_game:
          row.points && row.games_played ? row.points / row.games_played : null,
        games_played: row.games_played,
      };
    }
  } catch {
    // DB may not have the league/season — ignore and return empty context.
  }
  return {
    team_id: teamId,
    pace: null,
    off_rating: null,
    def_rating: null,
    points_per_game: null,
    games_played: 0,
  };
}

async function loadLeagueContext(
  leagueId: number,
  season: string | number,
  leagueLabel: string | null,
  leagueName: string | undefined,
): Promise<LeagueContext> {
  try {
    const rows = await prisma.bb_team_season_aggregates.findMany({
      where: {
        league_id: leagueId,
        season: String(season),
        pace: { not: null },
      },
      select: { pace: true, def_rating: true },
      take: 40,
    });
    if (rows.length > 0) {
      const paces = rows.map(r => r.pace).filter((x): x is number => typeof x === 'number');
      const drtg = rows.map(r => r.def_rating).filter((x): x is number => typeof x === 'number');
      const avgPace = paces.length > 0 ? paces.reduce((a, b) => a + b, 0) / paces.length : null;
      const avgDrtg = drtg.length > 0 ? drtg.reduce((a, b) => a + b, 0) / drtg.length : null;
      return {
        league_id: leagueId,
        league_name: leagueName ?? leagueLabel ?? `League ${leagueId}`,
        avg_pace: avgPace,
        avg_def_rating: avgDrtg,
        league_label: leagueLabel,
      };
    }
  } catch {
    // swallow
  }
  return {
    league_id: leagueId,
    league_name: leagueName ?? leagueLabel ?? `League ${leagueId}`,
    avg_pace: DEFAULT_LEAGUE_PACE[leagueLabel ?? ''] ?? 100,
    avg_def_rating: null,
    league_label: leagueLabel,
  };
}

const DEFAULT_LEAGUE_PACE: Record<string, number> = {
  NBA: 100.0,
  EUROLEAGUE: 72.0,
  ACB_SPAIN: 74.0,
  BSL_TURKEY: 74.0,
  LEGA_BASKET_ITALY: 74.0,
  BBL_GERMANY: 76.0,
  LNB_FRANCE: 74.0,
  GREEK_BASKET_LEAGUE: 73.0,
  VTB_UNITED_LEAGUE: 73.0,
  FIBA_CHAMPIONS_LEAGUE: 72.0,
};

function detectLeagueLabel(leagueId: number): string | null {
  for (const [key, id] of Object.entries(MAJOR_BASKETBALL_LEAGUES)) {
    if (id === leagueId) return key;
  }
  return null;
}

/**
 * Load player baselines.
 *
 * Real api-sports behaviour:
 *   - `/players?team=X&season=Y` returns a **roster** with no stats.
 *   - `/games/statistics/players?id=GAME` returns full per-game box scores.
 *
 * So the fallback path is: roster → recent-finished-games → per-game
 * aggregation. This is expensive on API calls, so we cache aggressively
 * (24h TTL on the per-game box scores, which don't change once a game
 * finishes) and rely on the DB first whenever it has data.
 *
 *   1. DB: `bb_player_season_averages` — fast, high-quality NBA data that the
 *      importer refreshes nightly.
 *   2. API: aggregate last N box scores via `/games/statistics/players`.
 *   3. DB log-table fallback: `bb_player_game_logs` — raw per-game rows the
 *      NBA importer writes; useful when season-averages haven't been computed
 *      yet for the current season.
 */
async function loadPlayerBaselines(
  leagueId: number,
  season: string | number,
  teamId: number,
  teamName: string,
): Promise<PlayerBaseline[]> {
  // --- (1) Season-averages DB path -------------------------------------
  try {
    const dbRows = await prisma.bb_player_season_averages.findMany({
      where: {
        team_id: teamId,
        season: String(season),
        games_played: { gt: 3 },
      },
      orderBy: { ppg: 'desc' },
      take: 15,
    });
    if (dbRows.length > 0) {
      return dbRows.map(r => toBaselineFromDb(r, teamName));
    }
  } catch {
    // fall through
  }

  // --- (2) Aggregate box scores DB path --------------------------------
  // If the importer has per-game logs but hasn't rolled them up to averages,
  // we aggregate on the fly. Scoped to the last 20 finished games for the team
  // so early-season samples stay reasonable.
  try {
    const logs = await prisma.bb_player_game_logs.findMany({
      where: { team_id: teamId },
      orderBy: { fetched_at: 'desc' },
      take: 300, // ~15 games × 20 players
    });
    if (logs.length > 10) {
      return aggregateFromGameLogs(logs, teamId, teamName);
    }
  } catch {
    // fall through
  }

  // --- (3) API aggregation fallback ------------------------------------
  return await aggregateFromApiBoxScores(leagueId, season, teamId, teamName);
}

/**
 * Aggregate `bb_player_game_logs` rows (per-game stat lines) into per-player
 * means + std devs across the last ~20 games.
 */
function aggregateFromGameLogs(
  logs: any[],
  teamId: number,
  teamName: string,
): PlayerBaseline[] {
  const byPlayer = new Map<number, any[]>();
  for (const row of logs) {
    const pid = row.player_id as number;
    if (!byPlayer.has(pid)) byPlayer.set(pid, []);
    byPlayer.get(pid)!.push(row);
  }
  const baselines: PlayerBaseline[] = [];
  for (const [pid, rows] of byPlayer.entries()) {
    // Keep the 20 most recent rows per player.
    const recent = rows.slice(0, 20);
    const gp = recent.length;
    if (gp < 3) continue;
    const mean = (key: string) => {
      const vals = recent.map(r => Number(r[key] ?? 0)).filter((x: number) => isFinite(x));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    };
    const std = (key: string, m: number) => {
      const vals = recent.map(r => Number(r[key] ?? 0)).filter((x: number) => isFinite(x));
      if (vals.length < 2) return 0;
      const v = vals.reduce((a, b) => a + (b - m) ** 2, 0) / (vals.length - 1);
      return Math.sqrt(v);
    };
    const ppg = mean('points');
    if (ppg <= 0) continue;
    const rpg = mean('total_reb');
    const apg = mean('assists');
    const spg = mean('steals');
    const bpg = mean('blocks');
    const tpmpg = mean('tpm');
    const minutes = mean('minutes');
    baselines.push({
      player_id: pid,
      player_name: (recent[0]?.player_name as string | null) ?? `Player ${pid}`,
      team_id: teamId,
      team_name: (recent[0]?.team_name as string | null) ?? teamName,
      position: (recent[0]?.position as string | null) ?? null,
      games_played: gp,
      minutes: minutes || null,
      ppg,
      rpg,
      apg,
      spg,
      bpg,
      tpmpg,
      ppg_std: std('points', ppg) || null,
      rpg_std: std('total_reb', rpg) || null,
      apg_std: std('assists', apg) || null,
      tpmpg_std: std('tpm', tpmpg) || null,
      usage_rate: null,
      source: 'db',
    });
  }
  baselines.sort((a, b) => b.ppg - a.ppg);
  return baselines.slice(0, 15);
}

/**
 * Fetch the team's recent finished games and then pull box scores from
 * `/games/statistics/players?id=GAME` for up to N of them, aggregating per
 * player. This is expensive but only happens when DB has nothing.
 */
async function aggregateFromApiBoxScores(
  leagueId: number,
  season: string | number,
  teamId: number,
  teamName: string,
): Promise<PlayerBaseline[]> {
  try {
    const recent = await basketballApi.getRecentGames(teamId, leagueId, season, 10);
    if (!recent || recent.length === 0) return [];
    const byPlayer = new Map<
      number,
      {
        name: string;
        team_name: string;
        lines: Array<{
          points: number;
          rebounds: number;
          assists: number;
          steals: number;
          blocks: number;
          tpm: number;
          minutes: number | null;
        }>;
      }
    >();
    // Hit game/stats endpoint for each recent game, capped for API-cost sanity.
    const games = recent.slice(0, 7);
    for (const g of games) {
      const gid = g?.id;
      if (!gid) continue;
      const boxRows = (await (basketballApi as any).cachedRequest?.(
        '/games/statistics/players',
        { id: gid },
        86400, // box score never changes once game is final
      )) as any[] | undefined;
      if (!boxRows) continue;
      for (const r of boxRows) {
        if (r?.team?.id !== teamId) continue;
        const pid = Number(r?.player?.id ?? 0);
        if (!pid) continue;
        const existing = byPlayer.get(pid) ?? {
          name: String(r?.player?.name ?? `Player ${pid}`),
          team_name: teamName,
          lines: [],
        };
        existing.lines.push({
          points: Number(r?.points ?? 0),
          rebounds: Number(r?.rebounds?.total ?? 0),
          assists: Number(r?.assists ?? 0),
          steals: Number(r?.steals ?? 0),
          blocks: Number(r?.blocks ?? 0),
          tpm: Number(r?.threepoint_goals?.total ?? 0),
          minutes:
            typeof r?.minutes === 'string' ? parseApiMinutes(r.minutes) : null,
        });
        byPlayer.set(pid, existing);
      }
    }
    const baselines: PlayerBaseline[] = [];
    for (const [pid, entry] of byPlayer.entries()) {
      const gp = entry.lines.length;
      if (gp < 3) continue;
      const avg = (fn: (x: any) => number) =>
        entry.lines.reduce((a, b) => a + fn(b), 0) / gp;
      const sd = (fn: (x: any) => number, m: number) => {
        if (gp < 2) return 0;
        const v =
          entry.lines.reduce((a, b) => a + (fn(b) - m) ** 2, 0) / (gp - 1);
        return Math.sqrt(v);
      };
      const ppg = avg(x => x.points);
      if (ppg <= 0) continue;
      const rpg = avg(x => x.rebounds);
      const apg = avg(x => x.assists);
      const spg = avg(x => x.steals);
      const bpg = avg(x => x.blocks);
      const tpmpg = avg(x => x.tpm);
      const minutesVals = entry.lines
        .map(x => x.minutes)
        .filter((x): x is number => typeof x === 'number');
      const mpg =
        minutesVals.length > 0
          ? minutesVals.reduce((a, b) => a + b, 0) / minutesVals.length
          : null;
      baselines.push({
        player_id: pid,
        player_name: entry.name,
        team_id: teamId,
        team_name: entry.team_name,
        position: null,
        games_played: gp,
        minutes: mpg,
        ppg,
        rpg,
        apg,
        spg,
        bpg,
        tpmpg,
        ppg_std: sd(x => x.points, ppg),
        rpg_std: sd(x => x.rebounds, rpg),
        apg_std: sd(x => x.assists, apg),
        tpmpg_std: sd(x => x.tpm, tpmpg),
        usage_rate: null,
        source: 'api',
      });
    }
    baselines.sort((a, b) => b.ppg - a.ppg);
    return baselines.slice(0, 15);
  } catch {
    return [];
  }
}

function toBaselineFromDb(r: any, teamName: string): PlayerBaseline {
  return {
    player_id: r.player_id as number,
    player_name: (r.player_name as string | null) ?? `Player ${r.player_id}`,
    team_id: r.team_id as number,
    team_name: (r.team_name as string | null) ?? teamName,
    position: null,
    games_played: r.games_played as number,
    minutes: r.mpg ?? null,
    ppg: r.ppg ?? 0,
    rpg: r.rpg ?? 0,
    apg: r.apg ?? 0,
    spg: r.spg ?? 0,
    bpg: r.bpg ?? 0,
    tpmpg: r.tpmpg ?? 0,
    ppg_std: r.ppg_std ?? null,
    rpg_std: r.rpg_std ?? null,
    apg_std: r.apg_std ?? null,
    tpmpg_std: r.tpmpg_std ?? null,
    usage_rate: r.usage_rate ?? null,
    source: 'db',
  };
}

function parseApiMinutes(s: string): number | null {
  // api-sports minutes come as "28:43" or plain number
  if (s.includes(':')) {
    const [m, sec] = s.split(':').map(x => Number(x));
    if (!isFinite(m)) return null;
    return m + (isFinite(sec) ? sec / 60 : 0);
  }
  const n = Number(s);
  return isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Projection + emit lines for a single player
// ---------------------------------------------------------------------------

interface EmitCtx {
  player: PlayerBaseline;
  isHome: boolean;
  teamCtx: TeamContext;
  oppCtx: TeamContext;
  leagueCtx: LeagueContext;
}

function emitLinesForPlayer(ctx: EmitCtx): PlayerPropLine[] {
  const { player, isHome, teamCtx, oppCtx, leagueCtx } = ctx;
  const out: PlayerPropLine[] = [];

  // Matchup factor: a soft defence (def_rating above league average) boosts
  // offensive output. Capped at ±8%.
  const matchupFactor = computeMatchupFactor(oppCtx.def_rating, leagueCtx.avg_def_rating);

  // Pace factor: faster-than-league pace raises counting stats. Capped at ±6%.
  const paceFactor = computePaceFactor(teamCtx.pace, oppCtx.pace, leagueCtx.avg_pace);

  // Home/away additive-ish adjustment. NBA: home boost ≈ 3.5 pts for team =>
  // ~4% per player on scoring stats. We express it as a multiplicative tilt.
  const homeAdj = isHome ? 0.04 : -0.02;

  const reason = (stat: string) =>
    ({ line, side, mean }: { line: number; side: 'OVER' | 'UNDER'; prob: number; mean: number }) => {
      const pieces: string[] = [];
      pieces.push(`${player.player_name} ${line} ${side === 'OVER' ? 'üstü' : 'altı'}`);
      pieces.push(`projeksiyon ${mean.toFixed(1)} ${stat}`);
      if (matchupFactor > 1.02) pieces.push('rakip savunması zayıf');
      else if (matchupFactor < 0.98) pieces.push('rakip savunması güçlü');
      if (paceFactor > 1.02) pieces.push('maç temposu yüksek');
      else if (paceFactor < 0.98) pieces.push('maç temposu düşük');
      pieces.push(isHome ? 'ev sahibi avantajı' : 'deplasman');
      return pieces.join(' — ');
    };

  // ---- POINTS ------------------------------------------------------------
  const pointsMean = adjustMean(player.ppg, matchupFactor, paceFactor, homeAdj);
  if (pointsMean >= MIN_MEAN.POINTS) {
    const std = player.ppg_std ?? pointsMean * DEFAULT_CV.POINTS;
    const dist = chooseDistribution(pointsMean, std, 'negative_binomial');
    out.push(
      ...buildLinesForPlayer({
        sport_prefix: 'BB',
        player_id: player.player_id,
        player_name: player.player_name,
        team_id: player.team_id,
        team_name: player.team_name,
        position: player.position,
        market: 'POINTS',
        distribution: dist,
        projected_mean: pointsMean,
        projected_std_dev: std,
        book_lines: POINTS_LINES,
        factors: buildFactors({
          baseline: player.ppg,
          mean: pointsMean,
          std,
          matchupFactor,
          paceFactor,
          homeAdj,
          sample: player.games_played,
          minutes: player.minutes,
          dist,
        }),
        reasoning_builder: reason('sayı'),
      }),
    );
  }

  // ---- REBOUNDS ----------------------------------------------------------
  const reboundsMean = adjustMean(player.rpg, matchupFactor, paceFactor, homeAdj * 0.5);
  if (reboundsMean >= MIN_MEAN.REBOUNDS) {
    const std = player.rpg_std ?? reboundsMean * DEFAULT_CV.REBOUNDS;
    const dist = chooseDistribution(reboundsMean, std, 'poisson');
    out.push(
      ...buildLinesForPlayer({
        sport_prefix: 'BB',
        player_id: player.player_id,
        player_name: player.player_name,
        team_id: player.team_id,
        team_name: player.team_name,
        position: player.position,
        market: 'REBOUNDS',
        distribution: dist,
        projected_mean: reboundsMean,
        projected_std_dev: std,
        book_lines: REBOUND_LINES,
        factors: buildFactors({
          baseline: player.rpg,
          mean: reboundsMean,
          std,
          matchupFactor,
          paceFactor,
          homeAdj: homeAdj * 0.5,
          sample: player.games_played,
          minutes: player.minutes,
          dist,
        }),
        reasoning_builder: reason('ribaund'),
      }),
    );
  }

  // ---- ASSISTS -----------------------------------------------------------
  const assistsMean = adjustMean(player.apg, matchupFactor, paceFactor, homeAdj * 0.3);
  if (assistsMean >= MIN_MEAN.ASSISTS) {
    const std = player.apg_std ?? assistsMean * DEFAULT_CV.ASSISTS;
    const dist = chooseDistribution(assistsMean, std, 'poisson');
    out.push(
      ...buildLinesForPlayer({
        sport_prefix: 'BB',
        player_id: player.player_id,
        player_name: player.player_name,
        team_id: player.team_id,
        team_name: player.team_name,
        position: player.position,
        market: 'ASSISTS',
        distribution: dist,
        projected_mean: assistsMean,
        projected_std_dev: std,
        book_lines: ASSIST_LINES,
        factors: buildFactors({
          baseline: player.apg,
          mean: assistsMean,
          std,
          matchupFactor,
          paceFactor,
          homeAdj: homeAdj * 0.3,
          sample: player.games_played,
          minutes: player.minutes,
          dist,
        }),
        reasoning_builder: reason('asist'),
      }),
    );
  }

  // ---- THREES ------------------------------------------------------------
  const threesMean = adjustMean(player.tpmpg, matchupFactor, paceFactor, homeAdj * 0.3);
  if (threesMean >= MIN_MEAN.THREES) {
    const std = player.tpmpg_std ?? Math.max(threesMean * DEFAULT_CV.THREES, 0.8);
    // Three-pointers are notoriously over-dispersed.
    const dist = chooseDistribution(threesMean, std, 'negative_binomial');
    out.push(
      ...buildLinesForPlayer({
        sport_prefix: 'BB',
        player_id: player.player_id,
        player_name: player.player_name,
        team_id: player.team_id,
        team_name: player.team_name,
        position: player.position,
        market: 'THREE_POINTERS',
        distribution: dist,
        projected_mean: threesMean,
        projected_std_dev: std,
        book_lines: THREES_LINES,
        factors: buildFactors({
          baseline: player.tpmpg,
          mean: threesMean,
          std,
          matchupFactor,
          paceFactor,
          homeAdj: homeAdj * 0.3,
          sample: player.games_played,
          minutes: player.minutes,
          dist,
        }),
        reasoning_builder: reason('üçlük'),
      }),
    );
  }

  // ---- STEALS ------------------------------------------------------------
  const stealsMean = adjustMean(player.spg, matchupFactor, paceFactor, 0);
  if (stealsMean >= MIN_MEAN.STEALS) {
    const std = Math.max(stealsMean * DEFAULT_CV.STEALS, 0.5);
    const dist = chooseDistribution(stealsMean, std, 'poisson');
    out.push(
      ...buildLinesForPlayer({
        sport_prefix: 'BB',
        player_id: player.player_id,
        player_name: player.player_name,
        team_id: player.team_id,
        team_name: player.team_name,
        position: player.position,
        market: 'STEALS',
        distribution: dist,
        projected_mean: stealsMean,
        projected_std_dev: std,
        book_lines: STEALS_LINES,
        factors: buildFactors({
          baseline: player.spg,
          mean: stealsMean,
          std,
          matchupFactor,
          paceFactor,
          homeAdj: 0,
          sample: player.games_played,
          minutes: player.minutes,
          dist,
        }),
        reasoning_builder: reason('top çalma'),
      }),
    );
  }

  // ---- BLOCKS ------------------------------------------------------------
  const blocksMean = adjustMean(player.bpg, matchupFactor, paceFactor, 0);
  if (blocksMean >= MIN_MEAN.BLOCKS) {
    const std = Math.max(blocksMean * DEFAULT_CV.BLOCKS, 0.5);
    const dist = chooseDistribution(blocksMean, std, 'poisson');
    out.push(
      ...buildLinesForPlayer({
        sport_prefix: 'BB',
        player_id: player.player_id,
        player_name: player.player_name,
        team_id: player.team_id,
        team_name: player.team_name,
        position: player.position,
        market: 'BLOCKS',
        distribution: dist,
        projected_mean: blocksMean,
        projected_std_dev: std,
        book_lines: BLOCKS_LINES,
        factors: buildFactors({
          baseline: player.bpg,
          mean: blocksMean,
          std,
          matchupFactor,
          paceFactor,
          homeAdj: 0,
          sample: player.games_played,
          minutes: player.minutes,
          dist,
        }),
        reasoning_builder: reason('blok'),
      }),
    );
  }

  // ---- PRA (points + rebounds + assists) ---------------------------------
  const praBaseline = player.ppg + player.rpg + player.apg;
  const praMean = adjustMean(praBaseline, matchupFactor, paceFactor, homeAdj * 0.8);
  if (praMean >= MIN_MEAN.PRA) {
    // For a sum of (roughly independent) NB-ish stats, variance adds. Start
    // from whichever std devs we have, fall back to CV-derived.
    const ppgStd = player.ppg_std ?? player.ppg * DEFAULT_CV.POINTS;
    const rpgStd = player.rpg_std ?? player.rpg * DEFAULT_CV.REBOUNDS;
    const apgStd = player.apg_std ?? player.apg * DEFAULT_CV.ASSISTS;
    // Light positive correlation between points and assists for ball-dominant
    // scorers — inflate variance by 15% as a conservative hedge.
    const std = Math.sqrt(ppgStd ** 2 + rpgStd ** 2 + apgStd ** 2) * 1.15;
    const dist = chooseDistribution(praMean, std, 'negative_binomial');
    out.push(
      ...buildLinesForPlayer({
        sport_prefix: 'BB',
        player_id: player.player_id,
        player_name: player.player_name,
        team_id: player.team_id,
        team_name: player.team_name,
        position: player.position,
        market: 'PRA',
        distribution: dist,
        projected_mean: praMean,
        projected_std_dev: std,
        book_lines: PRA_LINES,
        factors: buildFactors({
          baseline: praBaseline,
          mean: praMean,
          std,
          matchupFactor,
          paceFactor,
          homeAdj: homeAdj * 0.8,
          sample: player.games_played,
          minutes: player.minutes,
          dist,
        }),
        reasoning_builder: reason('PRA'),
      }),
    );
  }

  return out;
}

// ---------------------------------------------------------------------------
// Adjustment math
// ---------------------------------------------------------------------------

function adjustMean(
  baseline: number,
  matchup: number,
  pace: number,
  home: number,
): number {
  if (!isFinite(baseline) || baseline <= 0) return 0;
  return baseline * matchup * pace * (1 + home);
}

function computeMatchupFactor(
  oppDefRating: number | null,
  leagueAvgDrtg: number | null,
): number {
  if (!oppDefRating || !leagueAvgDrtg || leagueAvgDrtg <= 0) return 1.0;
  // Higher DRTG = softer defence = more points for offence.
  const ratio = oppDefRating / leagueAvgDrtg;
  // Clamp to [0.92, 1.08] — matchup adjustments should be modest.
  return Math.max(0.92, Math.min(1.08, ratio));
}

function computePaceFactor(
  teamPace: number | null,
  oppPace: number | null,
  leagueAvgPace: number | null,
): number {
  if (!leagueAvgPace || leagueAvgPace <= 0) return 1.0;
  const inv = (teamPace ?? leagueAvgPace) + (oppPace ?? leagueAvgPace);
  const expected = leagueAvgPace * 2;
  const ratio = inv / expected;
  return Math.max(0.94, Math.min(1.06, ratio));
}

function buildFactors(args: {
  baseline: number;
  mean: number;
  std: number;
  matchupFactor: number;
  paceFactor: number;
  homeAdj: number;
  sample: number;
  minutes: number | null;
  dist: ReturnType<typeof chooseDistribution>;
}): PlayerPropFactors {
  return {
    projected_mean: round3(args.mean),
    projected_std_dev: round3(args.std),
    distribution: args.dist,
    baseline_mean: round3(args.baseline),
    matchup_factor: round3(args.matchupFactor),
    pace_factor: round3(args.paceFactor),
    home_adjustment: round3(args.homeAdj),
    sample_size: args.sample,
    expected_usage: args.minutes,
  };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

// Re-export so Prisma types don't leak through.
export type { Prisma };
