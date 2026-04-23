/**
 * Baseball player-prop generator (DB-backed).
 *
 * Data flow:
 *   1. `baseballApi.getGameById(game_id)` → api-sports baseball fixture with
 *      league + home/away team ids + names.
 *   2. Resolve each team to its canonical MLB team via `sport_team_aliases`.
 *   3. Pull rosters from `bs_player_season_averages` (populated by
 *      `lib/importers/mlb-importer.ts`) split into pitchers vs batters.
 *   4. Emit STRIKEOUTS lines for qualified pitchers (games_started >= 10) and
 *      HITS / TOTAL_BASES / HOME_RUNS lines for batters.
 *   5. `buildLinesForPlayer` handles per-line confidence and distribution
 *      maths in `stat-distributions.ts`.
 *
 * If the tracking DB has no data yet for the resolved team, we emit an
 * empty `players[]` with a helpful note that directs the caller to
 * `/api/cron/import-mlb-players`.
 */

import { trackingPrisma } from '@/lib/db';
import { baseballApi, MAJOR_BASEBALL_LEAGUES } from '@/lib/sports/baseball/api-baseball';
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

const DEFAULT_CV = {
  STRIKEOUTS: 0.35,
  HITS: 0.75,
  TB: 0.85,
  HR: 1.6,
} as const;

/** Minimum games started for a pitcher to be emitted. */
const MIN_PITCHER_STARTS = 10;

// ---------------------------------------------------------------------------
// Baselines
// ---------------------------------------------------------------------------

interface PitcherBaseline {
  player_id: number;
  player_name: string;
  team_id: number;
  team_name: string;
  position: string | null;
  games_played: number;
  games_started: number;
  innings_per_start: number;
  k_per_9: number;
  era: number | null;
  baa: number | null;
  k_std: number | null;
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
  hits_std: number | null;
  tb_std: number | null;
  hr_std: number | null;
}

interface TeamContext {
  team_id: number;
  runs_per_game: number | null;
  runs_allowed_per_game: number | null;
  team_batting_avg: number | null;
  games_played: number;
}

// ---------------------------------------------------------------------------
// MLB canonical teams for fuzzy matching
// ---------------------------------------------------------------------------

/** IDs match MLB StatsAPI's internal team ids. */
const MLB_CANONICAL_TEAMS: CanonicalTeam[] = [
  { team_id: 108, name: 'Los Angeles Angels', abbr: 'LAA', aliases: ['Angels'] },
  { team_id: 109, name: 'Arizona Diamondbacks', abbr: 'ARI', aliases: ['Diamondbacks', 'D-backs'] },
  { team_id: 110, name: 'Baltimore Orioles', abbr: 'BAL', aliases: ['Orioles'] },
  { team_id: 111, name: 'Boston Red Sox', abbr: 'BOS', aliases: ['Red Sox'] },
  { team_id: 112, name: 'Chicago Cubs', abbr: 'CHC', aliases: ['Cubs'] },
  { team_id: 113, name: 'Cincinnati Reds', abbr: 'CIN', aliases: ['Reds'] },
  { team_id: 114, name: 'Cleveland Guardians', abbr: 'CLE', aliases: ['Guardians', 'Indians'] },
  { team_id: 115, name: 'Colorado Rockies', abbr: 'COL', aliases: ['Rockies'] },
  { team_id: 116, name: 'Detroit Tigers', abbr: 'DET', aliases: ['Tigers'] },
  { team_id: 117, name: 'Houston Astros', abbr: 'HOU', aliases: ['Astros'] },
  { team_id: 118, name: 'Kansas City Royals', abbr: 'KC', aliases: ['Royals'] },
  { team_id: 119, name: 'Los Angeles Dodgers', abbr: 'LAD', aliases: ['Dodgers'] },
  { team_id: 120, name: 'Washington Nationals', abbr: 'WSH', aliases: ['Nationals', 'Nats'] },
  { team_id: 121, name: 'New York Mets', abbr: 'NYM', aliases: ['Mets'] },
  { team_id: 133, name: 'Athletics', abbr: 'ATH', aliases: ['Oakland Athletics', "Oakland A's"] },
  { team_id: 134, name: 'Pittsburgh Pirates', abbr: 'PIT', aliases: ['Pirates'] },
  { team_id: 135, name: 'San Diego Padres', abbr: 'SD', aliases: ['Padres'] },
  { team_id: 136, name: 'Seattle Mariners', abbr: 'SEA', aliases: ['Mariners'] },
  { team_id: 137, name: 'San Francisco Giants', abbr: 'SF', aliases: ['Giants'] },
  { team_id: 138, name: 'St. Louis Cardinals', abbr: 'STL', aliases: ['Cardinals', 'St Louis Cardinals'] },
  { team_id: 139, name: 'Tampa Bay Rays', abbr: 'TB', aliases: ['Rays'] },
  { team_id: 140, name: 'Texas Rangers', abbr: 'TEX', aliases: ['Rangers'] },
  { team_id: 141, name: 'Toronto Blue Jays', abbr: 'TOR', aliases: ['Blue Jays'] },
  { team_id: 142, name: 'Minnesota Twins', abbr: 'MIN', aliases: ['Twins'] },
  { team_id: 143, name: 'Philadelphia Phillies', abbr: 'PHI', aliases: ['Phillies'] },
  { team_id: 144, name: 'Atlanta Braves', abbr: 'ATL', aliases: ['Braves'] },
  { team_id: 145, name: 'Chicago White Sox', abbr: 'CWS', aliases: ['White Sox'] },
  { team_id: 146, name: 'Miami Marlins', abbr: 'MIA', aliases: ['Marlins'] },
  { team_id: 147, name: 'New York Yankees', abbr: 'NYY', aliases: ['Yankees'] },
  { team_id: 158, name: 'Milwaukee Brewers', abbr: 'MIL', aliases: ['Brewers'] },
];

// ---------------------------------------------------------------------------
// Main entry
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
  const isMlb = leagueId === MAJOR_BASEBALL_LEAGUES.MLB;

  const [homeCtx, awayCtx, leagueRpg] = await Promise.all([
    loadTeamContext(leagueId, season, home.id),
    loadTeamContext(leagueId, season, away.id),
    loadLeagueRunsPerGame(leagueId, season),
  ]);

  const notes: string[] = [];
  const [homeRoster, awayRoster] = await Promise.all([
    loadRoster(home.id as number, home.name as string, season, leagueId, notes),
    loadRoster(away.id as number, away.name as string, season, leagueId, notes),
  ]);

  const lines: PlayerPropLine[] = [];
  for (const p of homeRoster.pitchers) {
    lines.push(...emitPitcher(p, true, homeCtx, awayCtx, leagueRpg));
  }
  for (const p of awayRoster.pitchers) {
    lines.push(...emitPitcher(p, false, awayCtx, homeCtx, leagueRpg));
  }
  for (const b of homeRoster.batters) {
    lines.push(...emitBatter(b, true, homeCtx, awayCtx, leagueRpg));
  }
  for (const b of awayRoster.batters) {
    lines.push(...emitBatter(b, false, awayCtx, homeCtx, leagueRpg));
  }

  const highConfidence = lines.filter(l => l.confidence >= CONFIDENCE_THRESHOLDS.gold);
  const homeRosterSize = homeRoster.pitchers.length + homeRoster.batters.length;
  const awayRosterSize = awayRoster.pitchers.length + awayRoster.batters.length;
  if (homeRosterSize + awayRosterSize === 0) {
    if (isMlb) {
      notes.push(
        'MLB oyuncu veritabanı boş. MLB oyuncu ortalamalarını içe aktarmak için /api/cron/import-mlb-players?mode=rosters endpoint\'ini çağırın.',
      );
    } else {
      notes.push(
        'Bu lig için oyuncu veri kaynağı henüz yok. MLB dışı beyzbol ligleri şu an desteklenmiyor.',
      );
    }
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

interface Roster {
  pitchers: PitcherBaseline[];
  batters: BatterBaseline[];
}

async function loadRoster(
  apisportsTeamId: number,
  apisportsTeamName: string,
  season: string | number,
  leagueId: number,
  notes: string[],
): Promise<Roster> {
  const empty: Roster = { pitchers: [], batters: [] };
  if (!trackingPrisma) return empty;

  const canonicalSource = leagueId === MAJOR_BASEBALL_LEAGUES.MLB ? 'mlb' : null;
  if (!canonicalSource) return empty;

  const alias = await resolveTeamAlias(
    'baseball',
    apisportsTeamId,
    apisportsTeamName,
    canonicalSource,
    MLB_CANONICAL_TEAMS,
  ).catch(() => null);

  if (!alias) {
    notes.push(
      `api-sports takımı '${apisportsTeamName}' (id=${apisportsTeamId}) için MLB eşlemesi bulunamadı. sport_team_aliases tablosuna manuel ekleyin.`,
    );
    return empty;
  }

  const seasonStr = toMlbSeason(season);
  const rows = await trackingPrisma.bs_player_season_averages
    .findMany({
      where: {
        source: canonicalSource,
        team_id: alias.canonical_team_id,
        season: seasonStr,
      },
      orderBy: [{ role: 'asc' }, { ops: 'desc' }],
      take: 40,
    })
    .catch(() => []);

  if (rows.length === 0) {
    notes.push(
      `Takım ${alias.canonical_name ?? alias.canonical_team_id} için ${seasonStr} sezonunda oyuncu verisi yok.`,
    );
    return empty;
  }

  const pitchers: PitcherBaseline[] = [];
  const batters: BatterBaseline[] = [];
  for (const r of rows as any[]) {
    if ((r.role === 'pitcher' || r.role === 'both') && (r.games_started ?? 0) >= MIN_PITCHER_STARTS) {
      pitchers.push({
        player_id: r.player_id,
        player_name: r.player_name ?? `MLB Player ${r.player_id}`,
        team_id: r.team_id,
        team_name: r.team_name ?? apisportsTeamName,
        position: r.position ?? null,
        games_played: r.games_played ?? 0,
        games_started: r.games_started ?? 0,
        innings_per_start: Number(r.innings_per_start ?? 0),
        k_per_9: Number(r.k_per_9 ?? 0),
        era: r.era ?? null,
        baa: r.baa ?? null,
        k_std: r.k_std ?? null,
      });
    }
    if ((r.role === 'batter' || r.role === 'both') && (r.games_played ?? 0) >= 5) {
      batters.push({
        player_id: r.player_id,
        player_name: r.player_name ?? `MLB Player ${r.player_id}`,
        team_id: r.team_id,
        team_name: r.team_name ?? apisportsTeamName,
        position: r.position ?? null,
        games_played: r.games_played ?? 0,
        plate_appearances_per_game: Number(r.plate_appearances_per_game ?? 0),
        hits_per_game: Number(r.hits_per_game ?? 0),
        total_bases_per_game: Number(r.tb_per_game ?? 0),
        home_runs_per_game: Number(r.hr_per_game ?? 0),
        batting_average: r.avg ?? null,
        slugging: r.slg ?? null,
        hits_std: r.hits_std ?? null,
        tb_std: r.tb_std ?? null,
        hr_std: r.hr_std ?? null,
      });
    }
  }

  // Cap batter count so we don't swamp the consumer with bench hitters.
  batters.sort(
    (a, b) => (b.plate_appearances_per_game || 0) - (a.plate_appearances_per_game || 0),
  );
  return { pitchers: pitchers.slice(0, 6), batters: batters.slice(0, 12) };
}

function toMlbSeason(season: string | number): string {
  const raw = String(season);
  const match = raw.match(/(\d{4})/);
  return match ? match[1] : raw;
}

async function loadTeamContext(
  leagueId: number,
  season: string | number,
  teamId: number,
): Promise<TeamContext> {
  try {
    const stats = await baseballApi.getTeamStatistics({ league: leagueId, season, team: teamId });
    const row = Array.isArray(stats) ? stats[0] : (stats as any);
    const games = Number(row?.games ?? row?.games_played ?? 0);
    const rf = Number(
      row?.runs?.for?.total?.all ?? row?.runs_for ?? row?.goals?.for?.total?.all ?? 0,
    );
    const ra = Number(
      row?.runs?.against?.total?.all ?? row?.runs_against ?? row?.goals?.against?.total?.all ?? 0,
    );
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
  const leagueAvg = 0.245;
  const matchupFactor = oppCtx.team_batting_avg
    ? Math.max(0.88, Math.min(1.12, leagueAvg / Math.max(0.190, oppCtx.team_batting_avg)))
    : 1.0;
  const leagueAvgRpg = leagueRpg / 2;
  const oppRpg = oppCtx.runs_per_game ?? leagueAvgRpg;
  const paceFactor = Math.max(0.9, Math.min(1.08, leagueAvgRpg / Math.max(2.5, oppRpg)));
  const homeAdj = isHome ? 0.02 : -0.01;

  const mean = (p.k_per_9 / 9) * p.innings_per_start * matchupFactor * paceFactor * (1 + homeAdj);
  if (mean < MIN_MEAN.STRIKEOUTS) return [];
  const std = p.k_std && p.k_std > 0 ? p.k_std : Math.max(mean * DEFAULT_CV.STRIKEOUTS, 1.2);
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

  const leagueSideAvg = leagueRpg / 2;
  const oppRa = oppCtx.runs_allowed_per_game ?? leagueSideAvg;
  const matchupFactor = Math.max(0.9, Math.min(1.1, oppRa / Math.max(3.0, leagueSideAvg)));
  const paceFactor = 1.0;
  const homeAdj = isHome ? 0.02 : -0.01;

  const reasoning = (stat: string) =>
    ({ line, side, mean }: { line: number; side: 'OVER' | 'UNDER'; prob: number; mean: number }) => {
      const pieces: string[] = [];
      pieces.push(`${b.player_name} ${line} ${side === 'OVER' ? 'üstü' : 'altı'} ${stat}`);
      pieces.push(`projeksiyon ${mean.toFixed(2)}`);
      if (matchupFactor > 1.03) pieces.push('rakip atma zayıf');
      else if (matchupFactor < 0.97) pieces.push('rakip atma güçlü');
      if (b.batting_average) pieces.push(`AVG ${b.batting_average.toFixed(3)}`);
      pieces.push(isHome ? 'ev sahibi avantajı' : 'deplasman');
      return pieces.join(' — ');
    };

  // ---- HITS -------------------------------------------------------------
  const hitsMean = b.hits_per_game * matchupFactor * paceFactor * (1 + homeAdj);
  if (hitsMean >= MIN_MEAN.HITS) {
    const std =
      b.hits_std && b.hits_std > 0
        ? b.hits_std
        : Math.max(Math.sqrt(hitsMean * (1 + DEFAULT_CV.HITS)), 0.6);
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

  // ---- TOTAL BASES ------------------------------------------------------
  const tbMean = b.total_bases_per_game * matchupFactor * paceFactor * (1 + homeAdj);
  if (tbMean >= MIN_MEAN.TB) {
    const std =
      b.tb_std && b.tb_std > 0 ? b.tb_std : Math.max(tbMean * DEFAULT_CV.TB, 0.9);
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

  // ---- HOME RUNS --------------------------------------------------------
  const hrMean = b.home_runs_per_game * matchupFactor * paceFactor * (1 + homeAdj);
  if (hrMean >= MIN_MEAN.HR) {
    const std =
      b.hr_std && b.hr_std > 0
        ? b.hr_std
        : Math.max(Math.sqrt(hrMean * (1 + DEFAULT_CV.HR)), 0.4);
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
