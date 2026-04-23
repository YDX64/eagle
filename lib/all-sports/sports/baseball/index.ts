/**
 * Baseball Sport Plugin
 * v1.baseball.api-sports.io
 *
 * Karakteristik:
 * - ~8.5 toplam run per game (düşük-orta skorlu → Poisson uygun)
 * - 9 inning + olası extra innings
 * - BERABERLİK YOKTUR (extra innings her zaman bir kazananı belirler)
 *   -> Prediction'da drawProb = 0 zorlanır, Poisson'dan gelen
 *      "regulation tie" olasılığı kazananlara takım gücüne göre dağıtılır
 * - Ev avantajı küçük (~%4) — park ve starting pitcher etkisi baskın
 * - Piyasalar: Home/Away (2-way), Run Line (genelde ±1.5), Over/Under
 *   (~8.5 line), Odd/Even, First 5 Innings, Team Total Runs
 *
 * Gerçek paralı bahis: Tüm hesaplar deterministik, Poisson matematiği
 * üzerinden, API verisi mevcutsa team statistics ile override edilir.
 */

import type {
  SportPlugin,
  NormalizedGame,
  Prediction,
  NormalizedOdds,
} from '../_core/types';
import {
  SportApiClient,
  deriveOutcomes,
  calculateFormScore,
  analyzeH2H,
  poissonProb,
} from '../_core';
import { baseballConfig } from './config';

const client = new SportApiClient(baseballConfig.apiBase, baseballConfig.apiKey);

// Baseball game status shortcodes observed in v1.baseball.api-sports.io
const LIVE_STATUSES = new Set([
  'IN1', 'IN2', 'IN3', 'IN4', 'IN5', 'IN6', 'IN7', 'IN8', 'IN9',
  'INT', 'BT', 'LIVE', 'POSTP', // INT = between innings, BT = break time
]);
const FINISHED_STATUSES = new Set(['FT', 'AOT']);
const UPCOMING_STATUSES = new Set(['NS', 'TBD']);

// ===== NORMALIZER =====
function normalizeGame(raw: any): NormalizedGame {
  const status = raw.status || {};
  const short: string = status.short || '';

  // Innings-level period breakdown (1..9 plus extra)
  const homeInnings = raw.scores?.home?.innings || {};
  const awayInnings = raw.scores?.away?.innings || {};
  const periods: Record<string, string | null> = {};
  for (let i = 1; i <= 9; i++) {
    const h = homeInnings?.[String(i)];
    const a = awayInnings?.[String(i)];
    if (h != null || a != null) {
      periods[`inning${i}`] = `${h ?? 0}-${a ?? 0}`;
    } else {
      periods[`inning${i}`] = null;
    }
  }
  const eh = homeInnings?.extra;
  const ea = awayInnings?.extra;
  periods.extra = eh != null || ea != null ? `${eh ?? 0}-${ea ?? 0}` : null;

  return {
    id: raw.id,
    sport: 'baseball',
    date: raw.date,
    timestamp: raw.timestamp,
    status: {
      short,
      long: status.long || '',
      live: LIVE_STATUSES.has(short),
      finished: FINISHED_STATUSES.has(short),
      upcoming: UPCOMING_STATUSES.has(short),
    },
    league: {
      id: raw.league?.id,
      name: raw.league?.name,
      logo: raw.league?.logo,
      country: raw.country?.name,
      season: raw.league?.season,
    },
    teams: {
      home: {
        id: raw.teams?.home?.id,
        name: raw.teams?.home?.name,
        logo: raw.teams?.home?.logo,
      },
      away: {
        id: raw.teams?.away?.id,
        name: raw.teams?.away?.name,
        logo: raw.teams?.away?.logo,
      },
    },
    scores: {
      home: raw.scores?.home?.total ?? null,
      away: raw.scores?.away?.total ?? null,
    },
    periods,
  };
}

function normalizeOdds(odd: any): NormalizedOdds {
  return {
    gameId: odd.game?.id ?? odd.fixture?.id ?? odd.id,
    bookmakers: (odd.bookmakers || []).map((bm: any) => ({
      id: bm.id,
      name: bm.name,
      bets: (bm.bets || []).map((bet: any) => ({
        id: bet.id,
        name: bet.name,
        values: (bet.values || []).map((v: any) => ({
          value: String(v.value),
          odd: parseFloat(v.odd),
        })),
      })),
    })),
  };
}

// ===== STAT PARSERS =====
// Baseball team stats: points.for.average.{home,away,all} - strings like "4.5"
function parseStatNumber(v: any): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function extractScoringRates(stats: any, isHomeContext: boolean): {
  runsFor: number | null;
  runsAgainst: number | null;
} {
  if (!stats?.points) return { runsFor: null, runsAgainst: null };
  const sideKey = isHomeContext ? 'home' : 'away';
  const forAvg =
    parseStatNumber(stats.points?.for?.average?.[sideKey]) ??
    parseStatNumber(stats.points?.for?.average?.all);
  const againstAvg =
    parseStatNumber(stats.points?.against?.average?.[sideKey]) ??
    parseStatNumber(stats.points?.against?.average?.all);
  return { runsFor: forAvg, runsAgainst: againstAvg };
}

// Form string can be "WWLWL"; standings.form is what analyzeH2H / calculateFormScore expect.
function extractForm(standing: any): string | null {
  if (!standing) return null;
  if (typeof standing.form === 'string') return standing.form;
  return null;
}

// ===== PREDICTION =====
function predict(params: {
  game: NormalizedGame;
  homeStats?: any;
  awayStats?: any;
  h2h?: NormalizedGame[];
  homeStanding?: any;
  awayStanding?: any;
}): Prediction {
  const { game, homeStats, awayStats, h2h = [], homeStanding, awayStanding } = params;

  // Baseline lambdas
  let homeAttack = baseballConfig.avgScoreHome;
  let homeDefense = baseballConfig.avgScoreAway;
  let awayAttack = baseballConfig.avgScoreAway;
  let awayDefense = baseballConfig.avgScoreHome;

  // Override with real team statistics when available
  const homeRates = extractScoringRates(homeStats, true);
  if (homeRates.runsFor != null && homeRates.runsFor > 0) homeAttack = homeRates.runsFor;
  if (homeRates.runsAgainst != null && homeRates.runsAgainst > 0) homeDefense = homeRates.runsAgainst;

  const awayRates = extractScoringRates(awayStats, false);
  if (awayRates.runsFor != null && awayRates.runsFor > 0) awayAttack = awayRates.runsFor;
  if (awayRates.runsAgainst != null && awayRates.runsAgainst > 0) awayDefense = awayRates.runsAgainst;

  // Form scores (W/L/D string from standings)
  const homeForm = calculateFormScore(extractForm(homeStanding));
  const awayForm = calculateFormScore(extractForm(awayStanding));

  // H2H adjustment - modest weight: baseball variance is high, small sample
  let h2hAdjust = 0;
  if (h2h.length >= 3) {
    const h2hAnalysis = analyzeH2H(h2h, game.teams.home.id);
    h2hAdjust = (h2hAnalysis.homeWinRate - h2hAnalysis.awayWinRate) * 0.2;
  }

  // Form factor: square root dampened (baseball is less form-driven than soccer)
  const formFactor = homeForm > 0 && awayForm > 0 ? homeForm / awayForm : 1;
  const adv = baseballConfig.homeAdvantage;

  // Expected runs: blend team-attack vs opponent-defense, apply home boost, small form adj
  const expectedHome = Math.max(
    0.5,
    ((homeAttack + awayDefense) / 2) * adv * Math.pow(formFactor, 0.15) + h2hAdjust,
  );
  const expectedAway = Math.max(
    0.5,
    ((awayAttack + homeDefense) / 2) / Math.pow(formFactor, 0.1) - h2hAdjust * 0.5,
  );

  // Derive Poisson outcomes - baseball-specific lines
  const outcomes = deriveOutcomes(expectedHome, expectedAway, {
    maxGoals: 15, // Extra innings can push runs high; keep 15 cap
    ouLines: [6.5, 7.5, 8.5, 9.5, 10.5, 11.5],
    handicapLines: [-1.5, -0.5, 0.5, 1.5],
  });

  // NO DRAW: Baseball has no ties (extra innings decide).
  // Poisson will produce a non-zero "draw" (tied after regulation) probability.
  // Redistribute it to home/away proportionally to their relative scoring strength.
  let homeWinProb = outcomes.homeWin;
  let awayWinProb = outcomes.awayWin;
  const tieProb = outcomes.draw;
  if (tieProb > 0) {
    const totalStrength = expectedHome + expectedAway;
    const homeShare = totalStrength > 0 ? expectedHome / totalStrength : 0.5;
    const awayShare = 1 - homeShare;
    homeWinProb += tieProb * homeShare;
    awayWinProb += tieProb * awayShare;
  }
  // Normalize defensively
  const sum = homeWinProb + awayWinProb;
  if (sum > 0) {
    homeWinProb /= sum;
    awayWinProb /= sum;
  }

  // Confidence score
  let confidence = 40;
  if (homeStats) confidence += 15;
  if (awayStats) confidence += 15;
  if (h2h.length >= 3) confidence += 10;
  if (homeStanding) confidence += 5;
  if (awayStanding) confidence += 5;
  confidence = Math.min(92, confidence); // Cap lower than football — baseball has high variance

  const overUnder: Record<string, { over: number; under: number }> = {};
  Object.entries(outcomes.overUnder).forEach(([k, v]) => {
    overUnder[String(k)] = v;
  });

  const handicaps: Record<string, { home: number; away: number; push?: number }> = {};
  Object.entries(outcomes.handicaps).forEach(([k, v]) => {
    handicaps[String(k)] = v;
  });

  return {
    homeWinProb: homeWinProb * 100,
    drawProb: 0, // Enforced: no draws in baseball
    awayWinProb: awayWinProb * 100,
    expectedHomeScore: expectedHome,
    expectedAwayScore: expectedAway,
    expectedTotalScore: expectedHome + expectedAway,
    overUnder,
    mostLikelyScores: outcomes.exactScores.slice(0, 12),
    handicaps,
    confidence,
    homeForm,
    awayForm,
  };
}

// ===== HELPERS FOR MARKET EVALUATION =====
function poissonTailOver(lambda: number, line: number, cap: number = 20): number {
  // P(X > line) for X ~ Poisson(lambda). line can be non-integer (e.g. 2.5).
  let pUnderOrEqual = 0;
  const threshold = Math.floor(line);
  for (let k = 0; k <= threshold; k++) pUnderOrEqual += poissonProb(lambda, k);
  // Include tail correction just in case of numeric drift
  return Math.max(0, Math.min(1, 1 - pUnderOrEqual));
}

function parseOverUnderSelection(sel: string): { dir: 'over' | 'under'; line: number } | null {
  const m = sel.match(/(Over|Under)\s*([\d.]+)/i);
  if (!m) return null;
  return { dir: m[1].toLowerCase() as 'over' | 'under', line: parseFloat(m[2]) };
}

function redistributeDrawFromPoisson(
  expectedHome: number,
  expectedAway: number,
): { home: number; away: number } {
  // Re-run a small Poisson to get regulation-tie probability, then redistribute.
  const o = deriveOutcomes(expectedHome, expectedAway, {
    maxGoals: 15,
    ouLines: [],
    handicapLines: [],
  });
  const tieProb = o.draw;
  const totalStrength = expectedHome + expectedAway;
  const homeShare = totalStrength > 0 ? expectedHome / totalStrength : 0.5;
  const awayShare = 1 - homeShare;
  const home = o.homeWin + tieProb * homeShare;
  const away = o.awayWin + tieProb * awayShare;
  const s = home + away;
  return s > 0 ? { home: home / s, away: away / s } : { home: 0.5, away: 0.5 };
}

// ===== MARKET EVALUATOR =====
function evaluateMarket(params: {
  prediction: Prediction;
  betName: string;
  selection: string;
  game: NormalizedGame;
}): number {
  const { prediction, betName, selection } = params;
  const name = (betName || '').toLowerCase().trim();
  const sel = (selection || '').trim();

  // Home/Away & Moneyline (2-way, no draw)
  if (name === 'home/away' || name === 'moneyline' || name === 'money line' || name === 'match winner' || name === '1x2') {
    if (sel === '1' || sel.toLowerCase() === 'home') return prediction.homeWinProb / 100;
    if (sel === '2' || sel.toLowerCase() === 'away') return prediction.awayWinProb / 100;
    if (sel === 'X' || sel.toLowerCase() === 'draw') return 0; // no draw in baseball
  }

  // Over/Under (full game total runs)
  if (name === 'over/under' || name === 'total runs' || name === 'total' || name === 'goals over/under') {
    const parsed = parseOverUnderSelection(sel);
    if (parsed) {
      const ou = prediction.overUnder[String(parsed.line)];
      if (ou) return parsed.dir === 'over' ? ou.over : ou.under;
      // Fallback: compute from expected totals if line not precomputed
      const lambdaTotal = prediction.expectedTotalScore;
      const over = poissonTailOver(lambdaTotal, parsed.line);
      return parsed.dir === 'over' ? over : 1 - over;
    }
  }

  // Run Line (baseball standard -1.5/+1.5) and Asian Handicap (arbitrary lines)
  if (name === 'run line' || name === 'runline' || name.includes('handicap') || name === 'spread') {
    // Accept formats like "Home -1.5", "Away +1.5", or simply "-1.5 (Home)"
    const m = sel.match(/(Home|Away)\s*([-+]?[\d.]+)/i);
    if (m) {
      const side = m[1].toLowerCase();
      const line = parseFloat(m[2]);
      const hc = prediction.handicaps?.[String(line)];
      if (hc) {
        // No push in baseball (half-lines), but guard against edge cases
        const totalNonPush = (hc.home ?? 0) + (hc.away ?? 0);
        if (totalNonPush === 0) return 0;
        return side === 'home' ? hc.home / totalNonPush : hc.away / totalNonPush;
      }
    }
  }

  // Odd/Even on total runs
  if (name === 'odd/even' || name === 'odd even' || name === 'total odd/even') {
    // Compute from Poisson exact scores already returned
    let oddP = 0;
    let evenP = 0;
    prediction.mostLikelyScores.forEach(s => {
      if ((s.home + s.away) % 2 === 1) oddP += s.probability;
      else evenP += s.probability;
    });
    const total = oddP + evenP;
    if (total > 0) {
      if (sel.toLowerCase() === 'odd') return oddP / total;
      if (sel.toLowerCase() === 'even') return evenP / total;
    }
  }

  // First 5 Innings (F5) — first 5 of 9 innings ≈ 55% of total runs.
  // Treat as a sub-game with scaled Poisson lambdas.
  if (name === 'first 5 innings' || name === 'first 5 innings winner' || name === '1st 5 innings' || name === 'f5') {
    const lambdaH = prediction.expectedHomeScore * 0.55;
    const lambdaA = prediction.expectedAwayScore * 0.55;

    // F5 Over/Under selection like "Over 4.5"
    const ou = parseOverUnderSelection(sel);
    if (ou) {
      const over = poissonTailOver(lambdaH + lambdaA, ou.line);
      return ou.dir === 'over' ? over : 1 - over;
    }

    // F5 Winner (no draw; F5 CAN tie in reality but markets usually price 3-way.
    // We model 2-way here, redistributing tie to the two sides.)
    const redist = redistributeDrawFromPoisson(lambdaH, lambdaA);
    const s = sel.toLowerCase();
    if (s === '1' || s === 'home') return redist.home;
    if (s === '2' || s === 'away') return redist.away;

    // If market explicitly offers a draw (3-way F5), use raw Poisson draw
    if (s === 'x' || s === 'draw' || s === 'tie') {
      const o = deriveOutcomes(lambdaH, lambdaA, { maxGoals: 10, ouLines: [], handicapLines: [] });
      return o.draw;
    }
  }

  // Team Total Runs — per-team Over/Under selection like "Home Over 4.5" or "Away Under 3.5"
  if (
    name === 'team total runs' ||
    name === 'team total' ||
    name === 'total - home' ||
    name === 'total - away'
  ) {
    // Side resolution: either from bet name or from selection prefix
    let side: 'home' | 'away' | null = null;
    if (name.includes('home')) side = 'home';
    else if (name.includes('away')) side = 'away';

    const withSideMatch = sel.match(/(Home|Away)\s*(Over|Under)\s*([\d.]+)/i);
    if (withSideMatch) {
      side = withSideMatch[1].toLowerCase() as 'home' | 'away';
      const dir = withSideMatch[2].toLowerCase();
      const line = parseFloat(withSideMatch[3]);
      const lambda =
        side === 'home' ? prediction.expectedHomeScore : prediction.expectedAwayScore;
      const over = poissonTailOver(lambda, line);
      return dir === 'over' ? over : 1 - over;
    }

    if (side) {
      const parsed = parseOverUnderSelection(sel);
      if (parsed) {
        const lambda =
          side === 'home' ? prediction.expectedHomeScore : prediction.expectedAwayScore;
        const over = poissonTailOver(lambda, parsed.line);
        return parsed.dir === 'over' ? over : 1 - over;
      }
    }
  }

  return 0;
}

// ===== BET RESULT EVALUATOR =====
function evaluateBetResult(params: {
  betName: string;
  selection: string;
  game: NormalizedGame;
}): 'won' | 'lost' | 'void' | 'pending' {
  const { betName, selection, game } = params;
  if (!game.status.finished || game.scores.home == null || game.scores.away == null) return 'pending';

  const h = game.scores.home;
  const a = game.scores.away;
  const total = h + a;
  const name = (betName || '').toLowerCase().trim();
  const sel = (selection || '').trim();

  // Home/Away & Moneyline
  if (name === 'home/away' || name === 'moneyline' || name === 'money line' || name === 'match winner' || name === '1x2') {
    // Baseball has no draws; if somehow h === a (cancelled/suspended?), it's a void.
    if (h === a) return 'void';
    if (sel === '1' || sel.toLowerCase() === 'home') return h > a ? 'won' : 'lost';
    if (sel === '2' || sel.toLowerCase() === 'away') return a > h ? 'won' : 'lost';
    if (sel === 'X' || sel.toLowerCase() === 'draw') return 'lost';
  }

  // Over/Under full game
  if (name === 'over/under' || name === 'total runs' || name === 'total' || name === 'goals over/under') {
    const parsed = parseOverUnderSelection(sel);
    if (parsed) {
      if (total === parsed.line) return 'void';
      return parsed.dir === 'over'
        ? total > parsed.line ? 'won' : 'lost'
        : total < parsed.line ? 'won' : 'lost';
    }
  }

  // Run Line / Handicap
  if (name === 'run line' || name === 'runline' || name.includes('handicap') || name === 'spread') {
    const m = sel.match(/(Home|Away)\s*([-+]?[\d.]+)/i);
    if (m) {
      const side = m[1].toLowerCase();
      const line = parseFloat(m[2]);
      const diff = side === 'home' ? h - a + line : a - h + line;
      if (diff > 0) return 'won';
      if (diff < 0) return 'lost';
      return 'void';
    }
  }

  // Odd/Even
  if (name === 'odd/even' || name === 'odd even' || name === 'total odd/even') {
    if (sel.toLowerCase() === 'odd') return total % 2 === 1 ? 'won' : 'lost';
    if (sel.toLowerCase() === 'even') return total % 2 === 0 ? 'won' : 'lost';
  }

  // First 5 Innings — use periods data (innings 1..5)
  if (name === 'first 5 innings' || name === 'first 5 innings winner' || name === '1st 5 innings' || name === 'f5') {
    let f5Home = 0;
    let f5Away = 0;
    let innings = 0;
    for (let i = 1; i <= 5; i++) {
      const period = game.periods?.[`inning${i}`];
      if (!period) continue;
      const parts = String(period).split('-');
      if (parts.length !== 2) continue;
      const ph = parseInt(parts[0]);
      const pa = parseInt(parts[1]);
      if (Number.isFinite(ph) && Number.isFinite(pa)) {
        f5Home += ph;
        f5Away += pa;
        innings++;
      }
    }
    if (innings < 5) return 'pending'; // Not enough innings recorded

    // F5 Over/Under
    const ou = parseOverUnderSelection(sel);
    if (ou) {
      const tot = f5Home + f5Away;
      if (tot === ou.line) return 'void';
      return ou.dir === 'over'
        ? tot > ou.line ? 'won' : 'lost'
        : tot < ou.line ? 'won' : 'lost';
    }

    // F5 Winner (3-way possible if market has Draw)
    const s = sel.toLowerCase();
    if (s === '1' || s === 'home') return f5Home > f5Away ? 'won' : 'lost';
    if (s === '2' || s === 'away') return f5Away > f5Home ? 'won' : 'lost';
    if (s === 'x' || s === 'draw' || s === 'tie') return f5Home === f5Away ? 'won' : 'lost';
  }

  // Team Total Runs
  if (
    name === 'team total runs' ||
    name === 'team total' ||
    name === 'total - home' ||
    name === 'total - away'
  ) {
    let side: 'home' | 'away' | null = null;
    if (name.includes('home')) side = 'home';
    else if (name.includes('away')) side = 'away';

    const withSideMatch = sel.match(/(Home|Away)\s*(Over|Under)\s*([\d.]+)/i);
    let dir: string | null = null;
    let line: number | null = null;

    if (withSideMatch) {
      side = withSideMatch[1].toLowerCase() as 'home' | 'away';
      dir = withSideMatch[2].toLowerCase();
      line = parseFloat(withSideMatch[3]);
    } else if (side) {
      const parsed = parseOverUnderSelection(sel);
      if (parsed) {
        dir = parsed.dir;
        line = parsed.line;
      }
    }

    if (side && dir && line != null) {
      const runs = side === 'home' ? h : a;
      if (runs === line) return 'void';
      return dir === 'over'
        ? runs > line ? 'won' : 'lost'
        : runs < line ? 'won' : 'lost';
    }
  }

  return 'void';
}

// ===== API DATA FETCHERS =====
async function getGamesByDate(date: string): Promise<NormalizedGame[]> {
  const res = await client.fetch<any[]>('games', { date });
  return (res.response || []).map(normalizeGame);
}

async function getGameById(id: number): Promise<NormalizedGame | null> {
  const res = await client.fetch<any[]>('games', { id });
  const g = res.response?.[0];
  return g ? normalizeGame(g) : null;
}

async function getLiveGames(): Promise<NormalizedGame[]> {
  // v1.baseball.api-sports.io has no /games?live=all endpoint.
  // Strategy: fetch today's games (UTC date) and filter locally by live status.
  const today = new Date().toISOString().slice(0, 10);
  const res = await client.fetch<any[]>('games', { date: today }, 60000);
  const all = (res.response || []).map(normalizeGame);
  return all.filter(g => g.status.live);
}

async function getOddsForGame(gameId: number): Promise<NormalizedOdds | null> {
  const res = await client.fetch<any[]>('odds', { game: gameId });
  const o = res.response?.[0];
  return o ? normalizeOdds(o) : null;
}

async function getH2H(homeTeamId: number, awayTeamId: number): Promise<NormalizedGame[]> {
  const res = await client.fetch<any[]>('games/h2h', { h2h: `${homeTeamId}-${awayTeamId}` });
  return (res.response || []).map(normalizeGame);
}

async function getStandings(leagueId: number, season: number): Promise<any[]> {
  const res = await client.fetch<any[]>('standings', { league: leagueId, season });
  // Baseball standings may be flat (one group) or nested by stage/group — flatten defensively
  const raw = res.response || [];
  if (raw.length === 0) return [];
  if (Array.isArray(raw[0])) return (raw as any[]).flat();
  return raw;
}

async function getTeamStatistics(teamId: number, leagueId: number, season: number): Promise<any> {
  const res = await client.fetch<any>('teams/statistics', {
    team: teamId,
    league: leagueId,
    season,
  });
  return res.response;
}

// ===== PLUGIN EXPORT =====
export const baseballPlugin: SportPlugin = {
  config: baseballConfig,
  getGamesByDate,
  getGameById,
  getLiveGames,
  getOddsForGame,
  getH2H,
  getStandings,
  getTeamStatistics,
  predict,
  evaluateMarket,
  evaluateBetResult,
};
