/**
 * Hockey player-prop generator (DB-backed).
 *
 * Data flow:
 *   1. `hockeyApi.getGameById(game_id)` → the api-sports hockey fixture with
 *      league, home/away team ids + names.
 *   2. Resolve each team to its canonical NHL team via `sport_team_aliases`.
 *      The aliases are fuzzy-matched the first time a team appears; from then
 *      on the lookup is a single indexed select.
 *   3. Pull each skater's season averages from `ho_player_season_averages`
 *      (populated by `lib/importers/nhl-importer.ts`).
 *   4. Project expected goals / shots / assists / points / blocked shots with
 *      simple matchup + pace + home/away adjustments.
 *   5. Hand the projection to `buildLinesForPlayer` which turns each book line
 *      into a `PlayerPropLine` via `stat-distributions.ts`.
 *
 * Goalies (position === 'G') are excluded — their markets live in a separate
 * pipeline.
 *
 * If the tracking DB has no data yet, we emit an empty `players[]` and a
 * helpful note that directs the caller to `/api/cron/import-nhl-players`.
 */

import { trackingPrisma } from '@/lib/db';
import { hockeyApi, MAJOR_HOCKEY_LEAGUES } from '@/lib/sports/hockey/api-hockey';
import { resolveTeamAlias, type CanonicalTeam } from '@/lib/importers/shared';
import { buildLinesForPlayer } from './line-builder';
import { chooseDistribution } from './stat-distributions';
import {
  CONFIDENCE_THRESHOLDS,
  type PlayerPropFactors,
  type PlayerPropLine,
  type PlayerPropPredictionResult,
} from './types';

// ---------------------------------------------------------------------------
// Book lines (per the spec)
// ---------------------------------------------------------------------------
const POINTS_LINES = [0.5, 1.5, 2.5] as const;
const SHOTS_LINES = [1.5, 2.5, 3.5, 4.5, 5.5] as const;
const GOALS_LINES = [0.5, 1.5] as const;
const ASSIST_LINES = [0.5, 1.5] as const;
const BLOCKED_LINES = [0.5, 1.5, 2.5] as const;

// Minimum projected means below which emitting lines is wasteful.
const MIN_MEAN = {
  GOALS: 0.12,
  SHOTS: 0.8,
  ASSISTS: 0.15,
  POINTS: 0.3,
  BLOCKED: 0.4,
} as const;

// Coefficient-of-variation fallbacks when we don't have a real std dev.
const DEFAULT_CV = {
  GOALS: 1.4, // over-dispersed (NB on small mean)
  SHOTS: 0.55,
  ASSISTS: 1.3,
  POINTS: 0.9,
  BLOCKED: 0.7,
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HockeyBaseline {
  player_id: number;
  player_name: string;
  team_id: number;
  team_name: string;
  position: string | null;
  games_played: number;
  toi_per_game: number | null;
  goals_per_game: number;
  assists_per_game: number;
  points_per_game: number;
  shots_per_game: number;
  blocked_per_game: number;
  goals_std: number | null;
  assists_std: number | null;
  points_std: number | null;
  shots_std: number | null;
}

interface TeamContext {
  team_id: number;
  goals_for_per_game: number | null;
  goals_against_per_game: number | null;
  games_played: number;
}

// ---------------------------------------------------------------------------
// NHL canonical teams (used for alias fuzzy-matching)
// ---------------------------------------------------------------------------

/**
 * Canonical NHL teams — sourced from the public NHL Web API standings. IDs
 * match the NHL's internal team ids that are used in boxscores. Aliases cover
 * common api-sports naming variations ("FC"/"HC"/short nicknames/etc.).
 */
const NHL_CANONICAL_TEAMS: CanonicalTeam[] = [
  { team_id: 1, name: 'New Jersey Devils', abbr: 'NJD', aliases: ['New Jersey', 'Devils'] },
  { team_id: 2, name: 'New York Islanders', abbr: 'NYI', aliases: ['Islanders'] },
  { team_id: 3, name: 'New York Rangers', abbr: 'NYR', aliases: ['Rangers'] },
  { team_id: 4, name: 'Philadelphia Flyers', abbr: 'PHI', aliases: ['Flyers'] },
  { team_id: 5, name: 'Pittsburgh Penguins', abbr: 'PIT', aliases: ['Penguins'] },
  { team_id: 6, name: 'Boston Bruins', abbr: 'BOS', aliases: ['Bruins'] },
  { team_id: 7, name: 'Buffalo Sabres', abbr: 'BUF', aliases: ['Sabres'] },
  { team_id: 8, name: 'Montreal Canadiens', abbr: 'MTL', aliases: ['Montréal Canadiens', 'Canadiens'] },
  { team_id: 9, name: 'Ottawa Senators', abbr: 'OTT', aliases: ['Senators'] },
  { team_id: 10, name: 'Toronto Maple Leafs', abbr: 'TOR', aliases: ['Maple Leafs', 'Leafs'] },
  { team_id: 12, name: 'Carolina Hurricanes', abbr: 'CAR', aliases: ['Hurricanes', 'Canes'] },
  { team_id: 13, name: 'Florida Panthers', abbr: 'FLA', aliases: ['Panthers'] },
  { team_id: 14, name: 'Tampa Bay Lightning', abbr: 'TBL', aliases: ['Lightning', 'Bolts'] },
  { team_id: 15, name: 'Washington Capitals', abbr: 'WSH', aliases: ['Capitals', 'Caps'] },
  { team_id: 16, name: 'Chicago Blackhawks', abbr: 'CHI', aliases: ['Blackhawks'] },
  { team_id: 17, name: 'Detroit Red Wings', abbr: 'DET', aliases: ['Red Wings'] },
  { team_id: 18, name: 'Nashville Predators', abbr: 'NSH', aliases: ['Predators', 'Preds'] },
  { team_id: 19, name: 'St. Louis Blues', abbr: 'STL', aliases: ['St Louis Blues', 'Blues'] },
  { team_id: 20, name: 'Calgary Flames', abbr: 'CGY', aliases: ['Flames'] },
  { team_id: 21, name: 'Colorado Avalanche', abbr: 'COL', aliases: ['Avalanche', 'Avs'] },
  { team_id: 22, name: 'Edmonton Oilers', abbr: 'EDM', aliases: ['Oilers'] },
  { team_id: 23, name: 'Vancouver Canucks', abbr: 'VAN', aliases: ['Canucks'] },
  { team_id: 24, name: 'Anaheim Ducks', abbr: 'ANA', aliases: ['Ducks'] },
  { team_id: 25, name: 'Dallas Stars', abbr: 'DAL', aliases: ['Stars'] },
  { team_id: 26, name: 'Los Angeles Kings', abbr: 'LAK', aliases: ['Kings'] },
  { team_id: 28, name: 'San Jose Sharks', abbr: 'SJS', aliases: ['Sharks'] },
  { team_id: 29, name: 'Columbus Blue Jackets', abbr: 'CBJ', aliases: ['Blue Jackets', 'Jackets'] },
  { team_id: 30, name: 'Minnesota Wild', abbr: 'MIN', aliases: ['Wild'] },
  { team_id: 52, name: 'Winnipeg Jets', abbr: 'WPG', aliases: ['Jets'] },
  { team_id: 53, name: 'Arizona Coyotes', abbr: 'ARI', aliases: ['Coyotes', 'Yotes'] },
  { team_id: 54, name: 'Vegas Golden Knights', abbr: 'VGK', aliases: ['Golden Knights', 'Knights'] },
  { team_id: 55, name: 'Seattle Kraken', abbr: 'SEA', aliases: ['Kraken'] },
  { team_id: 59, name: 'Utah Mammoth', abbr: 'UTA', aliases: ['Utah Hockey Club', 'Utah HC', 'Mammoth'] },
];

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
  const isNhl = leagueId === MAJOR_HOCKEY_LEAGUES.NHL;

  const [homeCtx, awayCtx, leagueAvg] = await Promise.all([
    loadTeamContext(leagueId, season, home.id),
    loadTeamContext(leagueId, season, away.id),
    loadLeagueAverageGoals(leagueId, season),
  ]);

  const notes: string[] = [];
  const [homeRoster, awayRoster] = await Promise.all([
    loadHockeyBaselines(home.id as number, home.name as string, season, leagueId, notes),
    loadHockeyBaselines(away.id as number, away.name as string, season, leagueId, notes),
  ]);

  const lines: PlayerPropLine[] = [];
  for (const p of homeRoster) {
    lines.push(...emit({ player: p, isHome: true, teamCtx: homeCtx, oppCtx: awayCtx, leagueAvg }));
  }
  for (const p of awayRoster) {
    lines.push(...emit({ player: p, isHome: false, teamCtx: awayCtx, oppCtx: homeCtx, leagueAvg }));
  }

  const highConfidence = lines.filter(l => l.confidence >= CONFIDENCE_THRESHOLDS.gold);

  if (homeRoster.length === 0 && awayRoster.length === 0) {
    if (isNhl) {
      notes.push(
        'NHL oyuncu veritabanı boş. NHL oyuncu ortalamalarını içe aktarmak için /api/cron/import-nhl-players?mode=rosters endpoint\'ini çağırın.',
      );
    } else {
      notes.push(
        'Bu lig için oyuncu veri kaynağı henüz yok. NHL dışı hokey ligleri şu an desteklenmiyor.',
      );
    }
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
// DB + API loaders
// ---------------------------------------------------------------------------

async function loadHockeyBaselines(
  apisportsTeamId: number,
  apisportsTeamName: string,
  season: string | number,
  leagueId: number,
  notes: string[],
): Promise<HockeyBaseline[]> {
  if (!trackingPrisma) {
    return [];
  }

  // Only NHL is supported via the new DB pipeline — other leagues fall back
  // to empty rosters until their importers exist.
  const canonicalSource = leagueId === MAJOR_HOCKEY_LEAGUES.NHL ? 'nhl' : null;
  if (!canonicalSource) {
    return [];
  }

  const alias = await resolveTeamAlias(
    'hockey',
    apisportsTeamId,
    apisportsTeamName,
    canonicalSource,
    NHL_CANONICAL_TEAMS,
  ).catch(() => null);

  if (!alias) {
    notes.push(
      `api-sports takımı '${apisportsTeamName}' (id=${apisportsTeamId}) için NHL eşlemesi bulunamadı. sport_team_aliases tablosuna manuel ekleyin.`,
    );
    return [];
  }

  const season8 = toNhlSeason(season);
  const rows = await trackingPrisma.ho_player_season_averages
    .findMany({
      where: {
        source: canonicalSource,
        team_id: alias.canonical_team_id,
        season: season8,
        games_played: { gt: 3 },
        // Exclude goalies — their markets are not emitted here.
        NOT: { position: 'G' },
      },
      orderBy: { points_per_game: 'desc' },
      take: 22,
    })
    .catch(() => []);

  if (rows.length === 0) {
    // Try the previous season as a fallback (many api-sports games are
    // labelled with the start year but NHL uses '20242025' style).
    const fallbackSeason = previousNhlSeason(season8);
    if (fallbackSeason && fallbackSeason !== season8) {
      const fallbackRows = await trackingPrisma.ho_player_season_averages
        .findMany({
          where: {
            source: canonicalSource,
            team_id: alias.canonical_team_id,
            season: fallbackSeason,
            games_played: { gt: 3 },
            NOT: { position: 'G' },
          },
          orderBy: { points_per_game: 'desc' },
          take: 22,
        })
        .catch(() => []);
      if (fallbackRows.length > 0) {
        notes.push(
          `Güncel NHL sezon istatistiği yok — ${fallbackSeason} sezonu verisine düşüldü.`,
        );
        return fallbackRows.map((r: any) => toBaseline(r, apisportsTeamName));
      }
    }
  }

  return rows.map((r: any) => toBaseline(r, apisportsTeamName));
}

function toBaseline(r: any, teamName: string): HockeyBaseline {
  return {
    player_id: r.player_id as number,
    player_name: (r.player_name as string | null) ?? `NHL Player ${r.player_id}`,
    team_id: r.team_id as number,
    team_name: (r.team_name as string | null) ?? teamName,
    position: (r.position as string | null) ?? null,
    games_played: r.games_played as number,
    toi_per_game: (r.toi_per_game as number | null) ?? null,
    goals_per_game: Number(r.goals_per_game ?? 0),
    assists_per_game: Number(r.assists_per_game ?? 0),
    points_per_game: Number(r.points_per_game ?? 0),
    shots_per_game: Number(r.shots_per_game ?? 0),
    blocked_per_game: Number(r.blocks_per_game ?? 0),
    goals_std: r.goals_std ?? null,
    assists_std: r.assists_std ?? null,
    points_std: r.points_std ?? null,
    shots_std: r.shots_std ?? null,
  };
}

/**
 * Compact api-sports season value into the NHL 8-digit format:
 *   2024 / "2024" / "2024-2025" / "20242025" → '20242025'.
 */
function toNhlSeason(season: string | number): string {
  const raw = String(season);
  const compact = raw.replace(/[^0-9]/g, '');
  if (compact.length === 8) return compact;
  if (compact.length === 4) {
    const start = Number(compact);
    if (Number.isFinite(start)) return `${start}${start + 1}`;
  }
  if (compact.length === 6) {
    // Something like '202425' — pad the left four digits, add full end year.
    const start = Number(compact.slice(0, 4));
    if (Number.isFinite(start)) return `${start}${start + 1}`;
  }
  return compact;
}

function previousNhlSeason(season8: string): string | null {
  if (season8.length !== 8) return null;
  const start = Number(season8.slice(0, 4));
  const end = Number(season8.slice(4));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return `${start - 1}${end - 1}`;
}

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
    const row = Array.isArray(stats) ? stats[0] : (stats as any);
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
    return {
      team_id: teamId,
      goals_for_per_game: null,
      goals_against_per_game: null,
      games_played: 0,
    };
  }
}

async function loadLeagueAverageGoals(
  leagueId: number,
  season: string | number,
): Promise<number> {
  try {
    const games = await hockeyApi.getGamesByLeague(leagueId, season);
    const finished = games
      .filter((g: any) => g?.scores?.home?.total !== null && g?.scores?.away?.total !== null)
      .slice(-120);
    if (finished.length < 10) return 5.6;
    const totals = finished.map(
      (g: any) => (g.scores?.home?.total ?? 0) + (g.scores?.away?.total ?? 0),
    );
    return totals.reduce((a: number, b: number) => a + b, 0) / totals.length;
  } catch {
    return 5.6;
  }
}

// ---------------------------------------------------------------------------
// Emit logic
// ---------------------------------------------------------------------------

interface EmitCtx {
  player: HockeyBaseline;
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

  // ---- POINTS (goals + assists) -----------------------------------------
  const pointsMean = adjustMean(player.points_per_game, matchupFactor, paceFactor, homeAdj);
  if (pointsMean >= MIN_MEAN.POINTS) {
    const std = player.points_std ?? Math.max(pointsMean * DEFAULT_CV.POINTS, 0.5);
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

  // ---- SHOTS ------------------------------------------------------------
  const shotsMean = adjustMean(player.shots_per_game, matchupFactor, paceFactor, homeAdj * 0.5);
  if (shotsMean >= MIN_MEAN.SHOTS) {
    const std = player.shots_std ?? shotsMean * DEFAULT_CV.SHOTS;
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

  // ---- GOALS ------------------------------------------------------------
  const goalsMean = adjustMean(player.goals_per_game, matchupFactor, paceFactor, homeAdj);
  if (goalsMean >= MIN_MEAN.GOALS) {
    const std =
      player.goals_std ?? Math.sqrt(Math.max(goalsMean, 1e-6) * (1 + DEFAULT_CV.GOALS));
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

  // ---- ASSISTS ----------------------------------------------------------
  const assistsMean = adjustMean(player.assists_per_game, matchupFactor, paceFactor, homeAdj * 0.6);
  if (assistsMean >= MIN_MEAN.ASSISTS) {
    const std =
      player.assists_std ?? Math.sqrt(Math.max(assistsMean, 1e-6) * (1 + DEFAULT_CV.ASSISTS));
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

  // ---- BLOCKED SHOTS ----------------------------------------------------
  const blockedMean = adjustMean(player.blocked_per_game, 1.0, paceFactor, 0);
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
  if (!Number.isFinite(base) || base <= 0) return 0;
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
  player: HockeyBaseline,
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
    sample_size: player.games_played,
    expected_usage: player.toi_per_game,
  };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
