/**
 * Basketball Sport Plugin
 * v1.basketball.api-sports.io
 *
 * Karakteristik:
 * - Yüksek skorlu (~160 toplam)
 * - Normal (Gaussian) dağılım (Poisson uygun değil)
 * - Beraberlik yok — OT ile karara bağlanır
 * - Dört çeyrek + OT
 * - Küçük ev avantajı (~%5)
 *
 * NOT: Basketball API, hockey'e benzer düz (flat) game yapısı döner.
 *      game.scores.home.total, game.scores.away.total,
 *      game.periods.quarter_1..quarter_4, game.periods.over_time
 */

import type {
  SportPlugin,
  NormalizedGame,
  Prediction,
  NormalizedOdds,
} from '../_core/types';
import {
  SportApiClient,
  deriveNormalOutcomes,
  normalSurvival,
  normalCdf,
  calculateFormScore,
  analyzeH2H,
} from '../_core';
import { analyzeBasketballDeep, type BasketballDeepAnalysis } from './basketballPlayers';
import { basketballConfig } from './config';

const client = new SportApiClient(basketballConfig.apiBase, basketballConfig.apiKey);

// Default Normal distribution parameters
const DEFAULT_MEAN_HOME = basketballConfig.avgScoreHome; // 80
const DEFAULT_MEAN_AWAY = basketballConfig.avgScoreAway; // 78
const DEFAULT_STD_DEV = basketballConfig.scoreStdDev ?? 12; // per team
const DRAW_BUFFER = 0.5; // very small — basketball effectively has no draw

const OU_LINES = [140.5, 150.5, 155.5, 160.5, 165.5, 170.5, 175.5];
const HANDICAP_LINES = [
  -15.5, -10.5, -7.5, -5.5, -3.5, -1.5, 1.5, 3.5, 5.5, 7.5, 10.5, 15.5,
];

// Statuses for live/finished/upcoming detection
const LIVE_STATUSES = ['Q1', 'Q2', 'Q3', 'Q4', 'OT', 'BT'];
const FINISHED_STATUSES = ['FT', 'AOT'];
const UPCOMING_STATUSES = ['NS'];

// ===== NORMALIZER =====
function parseScore(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function normalizeGame(game: any): NormalizedGame {
  const status = game.status || {};
  const short: string = status.short ?? '';
  const long: string = status.long ?? '';

  // Basketball API scores can come in two shapes:
  //   a) { home: { total, quarter_1, ... }, away: { total, ... } }
  //   b) { home: number, away: number }
  const rawHome = game.scores?.home;
  const rawAway = game.scores?.away;
  const homeScore =
    typeof rawHome === 'object' && rawHome !== null
      ? parseScore(rawHome.total)
      : parseScore(rawHome);
  const awayScore =
    typeof rawAway === 'object' && rawAway !== null
      ? parseScore(rawAway.total)
      : parseScore(rawAway);

  const periodsRaw = game.periods || {};
  const periods: Record<string, string | null> = {
    quarter_1: periodsRaw.quarter_1 ?? null,
    quarter_2: periodsRaw.quarter_2 ?? null,
    quarter_3: periodsRaw.quarter_3 ?? null,
    quarter_4: periodsRaw.quarter_4 ?? null,
    over_time: periodsRaw.over_time ?? null,
    total: periodsRaw.total ?? null,
  };

  return {
    id: game.id,
    sport: 'basketball',
    date: game.date,
    timestamp: game.timestamp ?? (game.date ? Math.floor(new Date(game.date).getTime() / 1000) : 0),
    status: {
      short,
      long,
      live: LIVE_STATUSES.includes(short),
      finished: FINISHED_STATUSES.includes(short),
      upcoming: UPCOMING_STATUSES.includes(short),
    },
    league: {
      id: game.league?.id,
      name: game.league?.name,
      logo: game.league?.logo,
      country: game.country?.name ?? game.league?.country,
      season: game.league?.season,
    },
    teams: {
      home: {
        id: game.teams?.home?.id,
        name: game.teams?.home?.name,
        logo: game.teams?.home?.logo,
      },
      away: {
        id: game.teams?.away?.id,
        name: game.teams?.away?.name,
        logo: game.teams?.away?.logo,
      },
    },
    scores: {
      home: homeScore,
      away: awayScore,
    },
    periods,
  };
}

function normalizeOdds(odd: any): NormalizedOdds {
  const gameId = odd.game?.id ?? odd.fixture?.id ?? odd.id;
  return {
    gameId,
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

// ===== STATS EXTRACTION =====
/**
 * Basketball teams/statistics endpoint returns:
 *   games: { points: { for: { average: { home, away, all }, total: {...} },
 *                      against: { average: { home, away, all }, ... } },
 *            wins: {...}, loses: {...}, played: {...} }
 *   form: "WLWWL..." (optional)
 */
function extractMeanFor(stats: any, side: 'home' | 'away'): number | null {
  if (!stats?.games?.points?.for?.average) return null;
  const v = parseFloat(stats.games.points.for.average[side]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function extractMeanAgainst(stats: any, side: 'home' | 'away'): number | null {
  if (!stats?.games?.points?.against?.average) return null;
  const v = parseFloat(stats.games.points.against.average[side]);
  return Number.isFinite(v) && v > 0 ? v : null;
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
  const { homeStats, awayStats, h2h = [], homeStanding, awayStanding, game } = params;

  // Base means
  let homeAttack = DEFAULT_MEAN_HOME;
  let homeDefense = DEFAULT_MEAN_AWAY;
  let awayAttack = DEFAULT_MEAN_AWAY;
  let awayDefense = DEFAULT_MEAN_HOME;

  // Apply real stats if available
  const homeForPts = extractMeanFor(homeStats, 'home');
  const homeAgainstPts = extractMeanAgainst(homeStats, 'home');
  if (homeForPts) homeAttack = homeForPts;
  if (homeAgainstPts) homeDefense = homeAgainstPts;

  const awayForPts = extractMeanFor(awayStats, 'away');
  const awayAgainstPts = extractMeanAgainst(awayStats, 'away');
  if (awayForPts) awayAttack = awayForPts;
  if (awayAgainstPts) awayDefense = awayAgainstPts;

  // Form analysis — use explicit form field or standing-derived form
  const homeFormString: string | null | undefined =
    (typeof homeStats?.form === 'string' && homeStats.form) ||
    homeStanding?.form ||
    null;
  const awayFormString: string | null | undefined =
    (typeof awayStats?.form === 'string' && awayStats.form) ||
    awayStanding?.form ||
    null;
  const homeForm = calculateFormScore(homeFormString);
  const awayForm = calculateFormScore(awayFormString);

  // H2H influence — in basketball this is smaller since teams evolve a lot
  let h2hHomeAdj = 0;
  let h2hAwayAdj = 0;
  if (h2h.length >= 3) {
    const h2hAnalysis = analyzeH2H(h2h, game.teams.home.id);
    // Adjustment: up to ±2 points per team based on H2H dominance
    const dominance = h2hAnalysis.homeWinRate - h2hAnalysis.awayWinRate;
    h2hHomeAdj = dominance * 2;
    h2hAwayAdj = -dominance * 1;
    // Small total-scoring adjustment based on H2H avg total vs league baseline
    const baselineTotal = DEFAULT_MEAN_HOME + DEFAULT_MEAN_AWAY;
    if (h2hAnalysis.avgTotalScore > 0) {
      const totalDelta = (h2hAnalysis.avgTotalScore - baselineTotal) * 0.15;
      h2hHomeAdj += totalDelta / 2;
      h2hAwayAdj += totalDelta / 2;
    }
  }

  // Form factor — bounded to avoid extreme adjustments
  const formRatio =
    homeForm > 0 && awayForm > 0 ? homeForm / awayForm : 1;
  const clampedFormRatio = Math.max(0.85, Math.min(1.15, formRatio));

  const adv = basketballConfig.homeAdvantage; // 1.05

  // ===== BASKETBALL DEEP ANALYSIS: pace + rest days =====
  const homeDeep = analyzeBasketballDeep({
    teamStats: homeStats,
    avgScore: DEFAULT_MEAN_HOME,
    game,
    recentGames: h2h,
    teamId: game.teams.home.id,
  });
  const awayDeep = analyzeBasketballDeep({
    teamStats: awayStats,
    avgScore: DEFAULT_MEAN_AWAY,
    game,
    recentGames: h2h,
    teamId: game.teams.away.id,
  });

  // Expected means with pace + rest adjustments
  let meanHome = Math.max(
    40,
    ((homeAttack + awayDefense) / 2) * adv * Math.pow(clampedFormRatio, 0.2) + h2hHomeAdj
  );
  let meanAway = Math.max(
    40,
    ((awayAttack + homeDefense) / 2) / Math.pow(clampedFormRatio, 0.1) + h2hAwayAdj
  );

  meanHome += homeDeep.totalScoreAdjustment;
  meanAway += awayDeep.totalScoreAdjustment;
  meanHome = Math.max(40, meanHome);
  meanAway = Math.max(40, meanAway);

  // Standard deviations — allow slight scaling with mean (higher scoring = higher variance)
  const stdDevHome = Math.max(8, DEFAULT_STD_DEV * (meanHome / DEFAULT_MEAN_HOME) ** 0.5);
  const stdDevAway = Math.max(8, DEFAULT_STD_DEV * (meanAway / DEFAULT_MEAN_AWAY) ** 0.5);

  const outcomes = deriveNormalOutcomes(meanHome, meanAway, stdDevHome, stdDevAway, {
    ouLines: OU_LINES,
    handicapLines: HANDICAP_LINES,
    drawBuffer: DRAW_BUFFER,
  });

  // Basketball does not have draws in settled matches (OT always decides).
  // Allocate the tiny draw-buffer mass proportionally to home/away win probs.
  const rawHomeWin = outcomes.homeWin;
  const rawAwayWin = outcomes.awayWin;
  const rawSum = rawHomeWin + rawAwayWin;
  const homeWinProb = rawSum > 0 ? rawHomeWin / rawSum : 0.5;
  const awayWinProb = rawSum > 0 ? rawAwayWin / rawSum : 0.5;

  // Most likely "scores" — for a continuous-distribution sport these are indicative
  // integer combinations around the means. Useful for display and odd/even derivation.
  const mostLikelyScores = generateLikelyIntegerScores(
    meanHome,
    meanAway,
    stdDevHome,
    stdDevAway,
    12
  );

  // Over/Under, handicaps formatted to string-keyed records
  const overUnder: Record<string, { over: number; under: number }> = {};
  Object.entries(outcomes.overUnder).forEach(([k, v]) => {
    overUnder[String(k)] = v;
  });
  const handicaps: Record<string, { home: number; away: number; push?: number }> = {};
  Object.entries(outcomes.handicaps).forEach(([k, v]) => {
    handicaps[String(k)] = v;
  });

  // Confidence scoring
  let confidence = 40;
  if (homeForPts) confidence += 12;
  if (awayForPts) confidence += 12;
  if (homeAgainstPts) confidence += 5;
  if (awayAgainstPts) confidence += 5;
  if (h2h.length >= 3) confidence += 10;
  if (homeFormString) confidence += 5;
  if (awayFormString) confidence += 5;
  if (homeStanding) confidence += 3;
  if (awayStanding) confidence += 3;
  confidence = Math.min(95, confidence);

  return {
    homeWinProb: homeWinProb * 100,
    drawProb: 0, // basketball: OT decides, no draw
    awayWinProb: awayWinProb * 100,
    expectedHomeScore: meanHome,
    expectedAwayScore: meanAway,
    expectedTotalScore: meanHome + meanAway,
    overUnder,
    // btts semantics don't apply cleanly to basketball — both teams always score.
    btts: { yes: 100, no: 0 },
    mostLikelyScores,
    handicaps,
    confidence,
    homeForm,
    awayForm,
  };
}

/**
 * Generate plausible integer (home, away) score combinations around the means.
 * Used mainly for Odd/Even derivation and UI display. For Normal distribution,
 * we grid-sample ±2σ around each mean and normalize joint probabilities.
 */
function generateLikelyIntegerScores(
  meanHome: number,
  meanAway: number,
  stdHome: number,
  stdAway: number,
  top: number = 12
): { home: number; away: number; probability: number }[] {
  const results: { home: number; away: number; probability: number }[] = [];
  const radiusH = Math.max(6, Math.ceil(stdHome * 2));
  const radiusA = Math.max(6, Math.ceil(stdAway * 2));
  const minH = Math.max(40, Math.floor(meanHome - radiusH));
  const maxH = Math.ceil(meanHome + radiusH);
  const minA = Math.max(40, Math.floor(meanAway - radiusA));
  const maxA = Math.ceil(meanAway + radiusA);

  let total = 0;
  for (let h = minH; h <= maxH; h++) {
    for (let a = minA; a <= maxA; a++) {
      // Discrete approximation of Normal PDF (integrate over unit bin)
      const pH =
        normalCdf(h + 0.5, meanHome, stdHome) - normalCdf(h - 0.5, meanHome, stdHome);
      const pA =
        normalCdf(a + 0.5, meanAway, stdAway) - normalCdf(a - 0.5, meanAway, stdAway);
      if (pH > 0 && pA > 0) {
        const p = pH * pA;
        total += p;
        results.push({ home: h, away: a, probability: p });
      }
    }
  }
  // Normalize
  if (total > 0) {
    for (const r of results) r.probability /= total;
  }
  results.sort((a, b) => b.probability - a.probability);
  return results.slice(0, top);
}

// ===== MARKET EVALUATOR =====
function evaluateMarket(params: {
  prediction: Prediction;
  betName: string;
  selection: string;
  game: NormalizedGame;
}): number {
  const { prediction, betName, selection } = params;
  const name = (betName || '').trim().toLowerCase();
  const sel = (selection || '').trim();

  // Home/Away (Match Winner — no draw in basketball)
  if (name === 'home/away' || name === 'match winner' || name === 'winner' || name === '2way') {
    const total = prediction.homeWinProb + prediction.awayWinProb;
    if (total === 0) return 0;
    if (/^(1|home)$/i.test(sel)) return prediction.homeWinProb / total;
    if (/^(2|away)$/i.test(sel)) return prediction.awayWinProb / total;
  }

  // Over/Under (total points)
  if (
    name === 'over/under' ||
    name === 'over under' ||
    name === 'total points' ||
    name === 'totals' ||
    name === 'points over/under'
  ) {
    const parsed = parseOverUnder(sel);
    if (parsed) {
      const ou = prediction.overUnder[String(parsed.line)];
      if (ou) return parsed.dir === 'over' ? ou.over : ou.under;
      // Line not precomputed — compute on the fly from expected total
      return computeOuFromPrediction(parsed.line, parsed.dir, prediction);
    }
  }

  // Asian Handicap / Handicap / Quarter Handicap (we treat full-game handicap here)
  if (
    name === 'asian handicap' ||
    name === 'handicap' ||
    name.includes('handicap') && !name.includes('quarter')
  ) {
    const parsed = parseHandicap(sel);
    if (parsed) {
      const hc = prediction.handicaps?.[String(parsed.line)];
      if (hc) {
        const nonPush = (hc.home ?? 0) + (hc.away ?? 0);
        if (nonPush === 0) return 0;
        return parsed.side === 'home' ? hc.home / nonPush : hc.away / nonPush;
      }
      // Compute on the fly
      return computeHandicapFromPrediction(parsed.line, parsed.side, prediction);
    }
  }

  // Odd/Even (total points)
  if (name === 'odd/even' || name === 'odd even' || name === 'total odd/even') {
    const oddP = prediction.mostLikelyScores
      .filter(s => (s.home + s.away) % 2 === 1)
      .reduce((acc, s) => acc + s.probability, 0);
    const evenP = prediction.mostLikelyScores
      .filter(s => (s.home + s.away) % 2 === 0)
      .reduce((acc, s) => acc + s.probability, 0);
    const tot = oddP + evenP;
    if (tot > 0) {
      if (/^odd$/i.test(sel)) return oddP / tot;
      if (/^even$/i.test(sel)) return evenP / tot;
    }
    // Fallback ≈ 0.5 each if no scores
    return /^odd$/i.test(sel) || /^even$/i.test(sel) ? 0.5 : 0;
  }

  // Both Teams Total Points — team total over/under
  if (name === 'both teams total points' || name === 'team total' || name.startsWith('total - ')) {
    // Selection formats:
    //   "Home Over 80.5", "Away Under 78.5", or bare "Over 80.5" if split
    const teamMatch = sel.match(/(Home|Away)\s+(Over|Under)\s+([\d.]+)/i);
    if (teamMatch) {
      const side = teamMatch[1].toLowerCase();
      const dir = teamMatch[2].toLowerCase();
      const line = parseFloat(teamMatch[3]);
      return computeTeamTotal(side as 'home' | 'away', dir as 'over' | 'under', line, prediction);
    }
    // "Total - Home" / "Total - Away" style with selection "Over 80.5"
    const sideFromName = name.includes('home') ? 'home' : name.includes('away') ? 'away' : null;
    if (sideFromName) {
      const m = sel.match(/(Over|Under)\s+([\d.]+)/i);
      if (m) {
        const dir = m[1].toLowerCase() as 'over' | 'under';
        const line = parseFloat(m[2]);
        return computeTeamTotal(sideFromName, dir, line, prediction);
      }
    }
  }

  // 1st Quarter Winner
  if (
    name === '1st quarter winner' ||
    name === 'first quarter winner' ||
    name === 'quarter 1 winner'
  ) {
    // ~25% of game expected scoring in Q1 (slightly less due to warm-up); use 0.25
    const q1Home = prediction.expectedHomeScore * 0.25;
    const q1Away = prediction.expectedAwayScore * 0.25;
    // Variance ≈ proportional (~sqrt of segment fraction)
    const q1Std = DEFAULT_STD_DEV * Math.sqrt(0.25);
    const q = deriveNormalOutcomes(q1Home, q1Away, q1Std, q1Std, {
      ouLines: [],
      handicapLines: [],
      drawBuffer: 0.5,
    });
    // Quarter CAN end in a tie — keep draw
    if (/^(1|home)$/i.test(sel)) return q.homeWin;
    if (/^(x|draw|tie)$/i.test(sel)) return q.draw;
    if (/^(2|away)$/i.test(sel)) return q.awayWin;
  }

  // Quarter Handicap — format like "Home -3.5 Q1" or "Home -2.5"
  if (name === 'quarter handicap' || name.includes('quarter handicap')) {
    const parsed = parseHandicap(sel);
    if (parsed) {
      // Default to Q1 if quarter unspecified
      const fraction = 0.25;
      const qHome = prediction.expectedHomeScore * fraction;
      const qAway = prediction.expectedAwayScore * fraction;
      const qStd = DEFAULT_STD_DEV * Math.sqrt(fraction);
      const q = deriveNormalOutcomes(qHome, qAway, qStd, qStd, {
        ouLines: [],
        handicapLines: [parsed.line],
        drawBuffer: 0.5,
      });
      const hc = q.handicaps[parsed.line];
      if (hc) {
        const nonPush = hc.home + hc.away;
        if (nonPush === 0) return 0;
        return parsed.side === 'home' ? hc.home / nonPush : hc.away / nonPush;
      }
    }
  }

  // Highest Scoring Quarter — without quarter-level means, assume roughly uniform.
  // If explicit "no" tie-break selection like "Q4" is given, assign ~0.25 each
  // with a slight Q4 boost (clutch minutes tend to have slightly more fouls -> FTs).
  if (name === 'highest scoring quarter') {
    const weights: Record<string, number> = {
      'Q1': 0.23,
      'Q2': 0.25,
      'Q3': 0.25,
      'Q4': 0.27,
      '1': 0.23,
      '2': 0.25,
      '3': 0.25,
      '4': 0.27,
    };
    const key = sel.toUpperCase();
    const w = weights[key];
    if (w) return w;
  }

  return 0;
}

// ===== HELPERS =====
function parseOverUnder(sel: string): { dir: 'over' | 'under'; line: number } | null {
  // Accept: "Over 160.5", "Under 155.5", "O 160.5", "U 160.5"
  const m = sel.match(/(Over|Under|^O|^U)\s*([\d.]+)/i);
  if (!m) return null;
  const token = m[1].toLowerCase();
  const dir: 'over' | 'under' = token.startsWith('o') ? 'over' : 'under';
  const line = parseFloat(m[2]);
  if (!Number.isFinite(line)) return null;
  return { dir, line };
}

function parseHandicap(sel: string): { side: 'home' | 'away'; line: number } | null {
  // Accept: "Home -5.5", "Away +3.5", "Home -5.5"
  const m = sel.match(/(Home|Away)\s*([+-]?[\d.]+)/i);
  if (!m) return null;
  const side = m[1].toLowerCase() as 'home' | 'away';
  const line = parseFloat(m[2]);
  if (!Number.isFinite(line)) return null;
  return { side, line };
}

function computeOuFromPrediction(
  line: number,
  dir: 'over' | 'under',
  prediction: Prediction
): number {
  const meanTotal = prediction.expectedTotalScore;
  // Recover approximate combined std from handicap/over-under structure: fall back to sqrt(2)*defaultStd
  const stdTotal = Math.sqrt(2) * DEFAULT_STD_DEV;
  const over = normalSurvival(line, meanTotal, stdTotal);
  return dir === 'over' ? over : 1 - over;
}

function computeHandicapFromPrediction(
  line: number,
  side: 'home' | 'away',
  prediction: Prediction
): number {
  const meanMargin = prediction.expectedHomeScore - prediction.expectedAwayScore;
  const stdMargin = Math.sqrt(2) * DEFAULT_STD_DEV;
  // Home covers if margin + line > 0, Away covers if margin + line < 0
  const homeWinHc = normalSurvival(-line + DRAW_BUFFER, meanMargin, stdMargin);
  const awayWinHc = normalCdf(-line - DRAW_BUFFER, meanMargin, stdMargin);
  const nonPush = homeWinHc + awayWinHc;
  if (nonPush === 0) return 0;
  return side === 'home' ? homeWinHc / nonPush : awayWinHc / nonPush;
}

function computeTeamTotal(
  side: 'home' | 'away',
  dir: 'over' | 'under',
  line: number,
  prediction: Prediction
): number {
  const mean =
    side === 'home' ? prediction.expectedHomeScore : prediction.expectedAwayScore;
  const std = DEFAULT_STD_DEV;
  const over = normalSurvival(line, mean, std);
  return dir === 'over' ? over : 1 - over;
}

// ===== BET RESULT EVALUATOR =====
function evaluateBetResult(params: {
  betName: string;
  selection: string;
  game: NormalizedGame;
}): 'won' | 'lost' | 'void' | 'pending' {
  const { betName, selection, game } = params;
  if (!game.status.finished || game.scores.home === null || game.scores.away === null) {
    return 'pending';
  }

  const h = game.scores.home;
  const a = game.scores.away;
  const total = h + a;
  const name = (betName || '').trim().toLowerCase();
  const sel = (selection || '').trim();

  // Home/Away (no draw — AOT counts to whoever won in OT)
  if (name === 'home/away' || name === 'match winner' || name === 'winner' || name === '2way') {
    if (/^(1|home)$/i.test(sel)) return h > a ? 'won' : 'lost';
    if (/^(2|away)$/i.test(sel)) return a > h ? 'won' : 'lost';
  }

  // Over/Under
  if (
    name === 'over/under' ||
    name === 'over under' ||
    name === 'total points' ||
    name === 'totals' ||
    name === 'points over/under'
  ) {
    const parsed = parseOverUnder(sel);
    if (parsed) {
      if (Math.abs(total - parsed.line) < 1e-9) return 'void';
      return parsed.dir === 'over'
        ? total > parsed.line
          ? 'won'
          : 'lost'
        : total < parsed.line
        ? 'won'
        : 'lost';
    }
  }

  // Asian Handicap / Handicap (full game)
  if (
    name === 'asian handicap' ||
    name === 'handicap' ||
    (name.includes('handicap') && !name.includes('quarter'))
  ) {
    const parsed = parseHandicap(sel);
    if (parsed) {
      const margin = parsed.side === 'home' ? h - a + parsed.line : a - h + parsed.line;
      if (margin > 0) return 'won';
      if (margin < 0) return 'lost';
      return 'void';
    }
  }

  // Odd/Even (total)
  if (name === 'odd/even' || name === 'odd even' || name === 'total odd/even') {
    if (/^odd$/i.test(sel)) return total % 2 === 1 ? 'won' : 'lost';
    if (/^even$/i.test(sel)) return total % 2 === 0 ? 'won' : 'lost';
  }

  // Both Teams Total Points / team total
  if (name === 'both teams total points' || name === 'team total' || name.startsWith('total - ')) {
    const teamMatch = sel.match(/(Home|Away)\s+(Over|Under)\s+([\d.]+)/i);
    if (teamMatch) {
      const side = teamMatch[1].toLowerCase();
      const dir = teamMatch[2].toLowerCase();
      const line = parseFloat(teamMatch[3]);
      const score = side === 'home' ? h : a;
      if (Math.abs(score - line) < 1e-9) return 'void';
      return dir === 'over'
        ? score > line
          ? 'won'
          : 'lost'
        : score < line
        ? 'won'
        : 'lost';
    }
    const sideFromName = name.includes('home') ? 'home' : name.includes('away') ? 'away' : null;
    if (sideFromName) {
      const m = sel.match(/(Over|Under)\s+([\d.]+)/i);
      if (m) {
        const dir = m[1].toLowerCase();
        const line = parseFloat(m[2]);
        const score = sideFromName === 'home' ? h : a;
        if (Math.abs(score - line) < 1e-9) return 'void';
        return dir === 'over'
          ? score > line
            ? 'won'
            : 'lost'
          : score < line
          ? 'won'
          : 'lost';
      }
    }
  }

  // 1st Quarter Winner
  if (
    name === '1st quarter winner' ||
    name === 'first quarter winner' ||
    name === 'quarter 1 winner'
  ) {
    const q1 = parsePeriodScore(game.periods?.quarter_1);
    if (!q1) return 'pending';
    if (/^(1|home)$/i.test(sel)) return q1.home > q1.away ? 'won' : 'lost';
    if (/^(x|draw|tie)$/i.test(sel)) return q1.home === q1.away ? 'won' : 'lost';
    if (/^(2|away)$/i.test(sel)) return q1.away > q1.home ? 'won' : 'lost';
  }

  // Quarter Handicap — default to Q1 when no quarter specified
  if (name === 'quarter handicap' || name.includes('quarter handicap')) {
    const parsed = parseHandicap(sel);
    if (!parsed) return 'void';
    // Pick quarter: default Q1 unless spec contains Q2/Q3/Q4
    let quarterKey = 'quarter_1';
    if (/Q2|quarter\s*2/i.test(sel)) quarterKey = 'quarter_2';
    else if (/Q3|quarter\s*3/i.test(sel)) quarterKey = 'quarter_3';
    else if (/Q4|quarter\s*4/i.test(sel)) quarterKey = 'quarter_4';
    const q = parsePeriodScore(game.periods?.[quarterKey]);
    if (!q) return 'pending';
    const margin =
      parsed.side === 'home' ? q.home - q.away + parsed.line : q.away - q.home + parsed.line;
    if (margin > 0) return 'won';
    if (margin < 0) return 'lost';
    return 'void';
  }

  // Highest Scoring Quarter
  if (name === 'highest scoring quarter') {
    const quarters = ['quarter_1', 'quarter_2', 'quarter_3', 'quarter_4'];
    const totals: number[] = [];
    for (const qk of quarters) {
      const q = parsePeriodScore(game.periods?.[qk]);
      if (!q) return 'pending';
      totals.push(q.home + q.away);
    }
    const max = Math.max(...totals);
    const winners = totals
      .map((t, i) => ({ t, idx: i + 1 }))
      .filter(x => x.t === max)
      .map(x => x.idx);
    const key = sel.toUpperCase().replace(/^Q/, '');
    const picked = parseInt(key, 10);
    if (!Number.isFinite(picked)) return 'void';
    if (winners.length > 1) return 'void'; // tie — dead heat / void on most books
    return winners[0] === picked ? 'won' : 'lost';
  }

  return 'void';
}

function parsePeriodScore(
  raw: string | null | undefined
): { home: number; away: number } | null {
  if (!raw) return null;
  const m = String(raw).match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!m) return null;
  const home = parseInt(m[1], 10);
  const away = parseInt(m[2], 10);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return { home, away };
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
  const res = await client.fetch<any[]>('games', { live: 'all' }, 60_000);
  return (res.response || []).map(normalizeGame);
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
  // Basketball standings are returned as an array of groups (conferences/divisions)
  const raw = res.response || [];
  if (Array.isArray(raw) && raw.length > 0) {
    // Flatten nested groups if any
    const flat: any[] = [];
    for (const item of raw) {
      if (Array.isArray(item)) flat.push(...item);
      else if (Array.isArray(item?.standings)) flat.push(...item.standings);
      else flat.push(item);
    }
    return flat;
  }
  return [];
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
export const basketballPlugin: SportPlugin = {
  config: basketballConfig,
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
