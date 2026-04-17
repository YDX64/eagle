/**
 * Volleyball Sport Plugin
 * v1.volleyball.api-sports.io
 *
 * MATHEMATICAL FOUNDATION — Set-Based Markov Chain Model
 * ======================================================
 * Voleybol 5 sette 3 kazanan modeli (best-of-5). Poisson/Normal GEÇERSİZ;
 * her set bağımsız Bernoulli denemesi (p olasılıkla ev kazanır).
 *
 * Tek parametreli model:
 *   p = P(ev tek bir seti kazanır)
 *   q = 1 - p
 *
 * Maç kazanma olasılıkları (best-of-5 binomial):
 *   P(ev 3-0)  = p^3
 *   P(ev 3-1)  = C(3,2) * p^3 * q        = 3 * p^3 * q
 *   P(ev 3-2)  = C(4,2) * p^3 * q^2      = 6 * p^3 * q^2
 *   P(ev 0-3)  = q^3
 *   P(ev 1-3)  = 3 * q^3 * p
 *   P(ev 2-3)  = 6 * q^3 * p^2
 *
 *   P(ev kazanır) = p^3 * (1 + 3q + 6q^2)
 *   P(dep kazanır) = q^3 * (1 + 3p + 6p^2)
 *   Sum = 1 (hiç beraberlik yok)
 *
 * Toplam oynanan set dağılımı:
 *   P(3 set) = p^3 + q^3
 *   P(4 set) = 3pq(p^2 + q^2)
 *   P(5 set) = 6 p^2 q^2
 *
 * Beklenen kazanılan setler:
 *   E[ev setleri]  = 3*P(ev kaz) + 2*P(2-3 home) + 1*P(1-3 home) + 0*P(0-3)
 *   E[dep setleri] = 3*P(dep kaz) + 2*P(3-2 home) + 1*P(3-1 home) + 0*P(3-0)
 *
 * p'nin hesabı: Takım gücü ve ev avantajından logit dönüşüm, clamp [0.25, 0.80].
 */

import type {
  SportPlugin,
  NormalizedGame,
  Prediction,
  NormalizedOdds,
} from '../_core/types';
import {
  SportApiClient,
  calculateFormScore,
  analyzeH2H,
} from '../_core';
import { volleyballConfig } from './config';

const client = new SportApiClient(volleyballConfig.apiBase, volleyballConfig.apiKey);

// Status codes per api-sports volleyball
const LIVE_STATUSES = new Set(['S1', 'S2', 'S3', 'S4', 'S5', 'LIVE']);
const FINISHED_STATUSES = new Set(['FT', 'AW', 'AOT']);
const UPCOMING_STATUSES = new Set(['NS', 'TBD']);

// Bounds for single-set probability to prevent degenerate predictions
const P_MIN = 0.25;
const P_MAX = 0.80;
const P_DEFAULT_HOME = 0.55; // Default home single-set win rate

// ============================================================
// VOLLEYBALL MARKOV-SET MATHEMATICS
// ============================================================

/**
 * Compute all volleyball outcomes from single-set home-win probability p.
 *
 * Returns the full probability distribution for:
 *  - Match winner (home/away)
 *  - Each of 6 possible correct set scores
 *  - Total sets played (3, 4, or 5)
 *  - Expected sets won per side
 */
export interface VolleyballOutcomes {
  /** Single-set home-win probability (bounded to [P_MIN, P_MAX]) */
  p: number;

  /** Match win probabilities */
  homeWin: number;
  awayWin: number;

  /** Correct set score probabilities */
  scoreProbabilities: {
    '3-0': number;
    '3-1': number;
    '3-2': number;
    '0-3': number;
    '1-3': number;
    '2-3': number;
  };

  /** Total sets played probabilities */
  totalSets: {
    three: number;
    four: number;
    five: number;
  };

  /** Expected sets won by each side */
  expectedHomeSets: number;
  expectedAwaySets: number;
  expectedTotalSets: number;

  /** Set-based handicaps (home margin perspective) */
  handicaps: Record<string, { home: number; away: number; push: number }>;
}

export function computeVolleyballOutcomes(pInput: number): VolleyballOutcomes {
  // Clamp p to avoid degenerate distributions
  const p = Math.max(P_MIN, Math.min(P_MAX, pInput));
  const q = 1 - p;

  const p3 = p * p * p;
  const q3 = q * q * q;
  const p2 = p * p;
  const q2 = q * q;

  // Correct set scores
  const p30 = p3;                // home 3-0
  const p31 = 3 * p3 * q;        // home 3-1
  const p32 = 6 * p3 * q2;       // home 3-2
  const p03 = q3;                // away 3-0 (home 0-3)
  const p13 = 3 * q3 * p;        // away 3-1 (home 1-3)
  const p23 = 6 * q3 * p2;       // away 3-2 (home 2-3)

  const homeWin = p30 + p31 + p32;
  const awayWin = p03 + p13 + p23;

  // Total sets played
  const pThreeSets = p3 + q3;
  const pFourSets = 3 * p3 * q + 3 * q3 * p; // = 3pq(p^2+q^2)
  const pFiveSets = 6 * p3 * q2 + 6 * q3 * p2; // = 6 p^2 q^2 (since p^3 q^2 + q^3 p^2 = p^2 q^2(p+q) = p^2 q^2)

  // Expected sets won
  // Home wins 3 sets if wins match; else wins 0/1/2 depending on outcome
  const expectedHomeSets =
    3 * homeWin + 2 * p23 + 1 * p13 + 0 * p03;
  const expectedAwaySets =
    3 * awayWin + 2 * p32 + 1 * p31 + 0 * p30;

  // ============ SET HANDICAPS ============
  // Handicap line L applied to home; home wins if (homeSets - awaySets + L) > 0
  // Possible margin values: +3, +2, +1, -1, -2, -3
  // Margin=0 impossible (no draws in volleyball)
  //
  // Lines: -2.5, -1.5, -0.5, +0.5, +1.5, +2.5
  // (All half-point, so no pushes — set 'push' to 0 for all)
  const handicaps: Record<string, { home: number; away: number; push: number }> = {};

  // For each line, compute P(home covers) = sum of score probs where margin + L > 0
  // Margin > -L
  const scoresByMargin: Array<[number, number]> = [
    [+3, p30],
    [+2, p31],
    [+1, p32],
    [-1, p23],
    [-2, p13],
    [-3, p03],
  ];

  const handicapLines = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5];
  for (const line of handicapLines) {
    let homeProb = 0;
    let awayProb = 0;
    for (const [margin, prob] of scoresByMargin) {
      const diff = margin + line;
      if (diff > 0) homeProb += prob;
      else if (diff < 0) awayProb += prob;
      // diff === 0 impossible at half-point lines
    }
    handicaps[String(line)] = { home: homeProb, away: awayProb, push: 0 };
  }

  return {
    p,
    homeWin,
    awayWin,
    scoreProbabilities: {
      '3-0': p30,
      '3-1': p31,
      '3-2': p32,
      '0-3': p03,
      '1-3': p13,
      '2-3': p23,
    },
    totalSets: {
      three: pThreeSets,
      four: pFourSets,
      five: pFiveSets,
    },
    expectedHomeSets,
    expectedAwaySets,
    expectedTotalSets: expectedHomeSets + expectedAwaySets,
    handicaps,
  };
}

// ============================================================
// NORMALIZER
// ============================================================
function parseScore(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Volleyball api-sports structure:
 *   game.id, game.date, game.timestamp
 *   game.status: { short, long }
 *   game.league: { id, name, logo, type, season }
 *   game.country: { id, name, code, flag }
 *   game.teams: { home: {id,name,logo}, away: {id,name,logo} }
 *   game.scores: { home: number, away: number }   // total sets won
 *   game.periods: { first, second, third, fourth, fifth } // per-set "H-A" strings
 *     (some volleyball APIs return numeric winner-score pairs; we treat as strings)
 */
function normalizeGame(game: any): NormalizedGame {
  const status = game.status || {};
  const short: string = status.short ?? 'NS';
  const long: string = status.long ?? short;

  const homeScore = parseScore(game.scores?.home);
  const awayScore = parseScore(game.scores?.away);

  const periodsRaw = game.periods || {};
  const periods: Record<string, string | null> = {
    first: periodsRaw.first ?? null,
    second: periodsRaw.second ?? null,
    third: periodsRaw.third ?? null,
    fourth: periodsRaw.fourth ?? null,
    fifth: periodsRaw.fifth ?? null,
  };

  return {
    id: game.id,
    sport: 'volleyball',
    date: game.date,
    timestamp:
      game.timestamp ??
      (game.date ? Math.floor(new Date(game.date).getTime() / 1000) : 0),
    status: {
      short,
      long,
      live: LIVE_STATUSES.has(short),
      finished: FINISHED_STATUSES.has(short),
      upcoming: UPCOMING_STATUSES.has(short),
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
  const gameId = odd.game?.id ?? odd.id ?? odd.fixture?.id;
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

// ============================================================
// TEAM STRENGTH → SET-WIN PROBABILITY p
// ============================================================

/**
 * Extract a "strength score" in [0, 1] from volleyball teams/statistics.
 * Uses win rate primarily; falls back to games.played ratio.
 */
function extractTeamStrength(stats: any): number | null {
  if (!stats) return null;

  // Try win rate
  const wins = parseFloat(stats.games?.wins?.all?.total ?? stats.games?.wins?.total);
  const played = parseFloat(stats.games?.played?.all?.total ?? stats.games?.played?.total);
  if (Number.isFinite(wins) && Number.isFinite(played) && played > 0) {
    return wins / played;
  }

  // Fallback: percentage string like "68%"
  const pct = stats.games?.wins?.all?.percentage ?? stats.games?.wins?.percentage;
  if (typeof pct === 'string') {
    const n = parseFloat(pct.replace('%', ''));
    if (Number.isFinite(n)) return n / 100;
  }

  return null;
}

/**
 * Extract sets-won-to-played ratio if available. Many volleyball stat
 * endpoints expose sets.won / sets.lost which is a stronger signal than wins.
 */
function extractSetRate(stats: any): number | null {
  if (!stats) return null;
  const won = parseFloat(stats.sets?.won?.total ?? stats.sets?.for?.total);
  const lost = parseFloat(stats.sets?.lost?.total ?? stats.sets?.against?.total);
  if (Number.isFinite(won) && Number.isFinite(lost) && won + lost > 0) {
    return won / (won + lost);
  }
  return null;
}

/**
 * Compute single-set home-win probability p from:
 *   - Team strength signals (stats/standings/form)
 *   - H2H dominance
 *   - Home advantage baseline
 *
 * Logic:
 *   1. Start from home advantage baseline (0.55).
 *   2. Apply team-strength delta (home_strength - away_strength), scaled by 0.30.
 *   3. Apply form-based delta, scaled by 0.10.
 *   4. Apply H2H dominance, scaled by 0.10.
 *   5. Clamp to [P_MIN, P_MAX].
 */
function computeSetWinProbability(params: {
  homeStrength: number | null;
  awayStrength: number | null;
  homeSetRate: number | null;
  awaySetRate: number | null;
  homeForm: number; // 0..100
  awayForm: number; // 0..100
  h2hDominance: number; // -1..+1 (home favorable)
  homeAdvantage: number;
}): number {
  let p = P_DEFAULT_HOME;

  // Team strength delta — prefer set-rate signal if available (more direct)
  const homeStrength = params.homeSetRate ?? params.homeStrength;
  const awayStrength = params.awaySetRate ?? params.awayStrength;
  if (homeStrength !== null && awayStrength !== null) {
    const strengthDelta = homeStrength - awayStrength; // -1..+1
    p += strengthDelta * 0.30;
  }

  // Form-based adjustment (secondary signal)
  const formDelta = (params.homeForm - params.awayForm) / 100; // -1..+1
  p += formDelta * 0.10;

  // H2H dominance (small weight — volleyball form changes fast)
  p += params.h2hDominance * 0.10;

  // Subtle home-advantage emphasis when we have no other info
  if (homeStrength === null || awayStrength === null) {
    // Bump p slightly if the home advantage multiplier suggests strong home court
    const advBoost = (params.homeAdvantage - 1.0) * 0.30; // e.g. 1.10 → +0.03
    p += advBoost;
  }

  return Math.max(P_MIN, Math.min(P_MAX, p));
}

// ============================================================
// PREDICTION
// ============================================================
function predict(params: {
  game: NormalizedGame;
  homeStats?: any;
  awayStats?: any;
  h2h?: NormalizedGame[];
  homeStanding?: any;
  awayStanding?: any;
}): Prediction {
  const { game, homeStats, awayStats, h2h = [], homeStanding, awayStanding } = params;

  // Extract team signals
  const homeStrength = extractTeamStrength(homeStats);
  const awayStrength = extractTeamStrength(awayStats);
  const homeSetRate = extractSetRate(homeStats);
  const awaySetRate = extractSetRate(awayStats);

  const homeFormString =
    (typeof homeStats?.form === 'string' && homeStats.form) ||
    homeStanding?.form ||
    null;
  const awayFormString =
    (typeof awayStats?.form === 'string' && awayStats.form) ||
    awayStanding?.form ||
    null;

  const homeForm = calculateFormScore(homeFormString);
  const awayForm = calculateFormScore(awayFormString);

  // H2H dominance
  let h2hDominance = 0;
  if (h2h.length >= 3) {
    const h2hAnalysis = analyzeH2H(h2h, game.teams.home.id);
    h2hDominance = h2hAnalysis.homeWinRate - h2hAnalysis.awayWinRate;
  }

  // Compute single-set probability
  const p = computeSetWinProbability({
    homeStrength,
    awayStrength,
    homeSetRate,
    awaySetRate,
    homeForm,
    awayForm,
    h2hDominance,
    homeAdvantage: volleyballConfig.homeAdvantage,
  });

  // Compute full outcome distribution
  const outcomes = computeVolleyballOutcomes(p);

  // ===== Most-likely correct set scores (6 total) =====
  const mostLikelyScores: { home: number; away: number; probability: number }[] = [
    { home: 3, away: 0, probability: outcomes.scoreProbabilities['3-0'] },
    { home: 3, away: 1, probability: outcomes.scoreProbabilities['3-1'] },
    { home: 3, away: 2, probability: outcomes.scoreProbabilities['3-2'] },
    { home: 0, away: 3, probability: outcomes.scoreProbabilities['0-3'] },
    { home: 1, away: 3, probability: outcomes.scoreProbabilities['1-3'] },
    { home: 2, away: 3, probability: outcomes.scoreProbabilities['2-3'] },
  ].sort((a, b) => b.probability - a.probability);

  // ===== Over/Under 3.5 sets =====
  // Over 3.5 = match went to 4 or 5 sets (i.e., NOT 3-0 either way)
  // Under 3.5 = match ended 3-0 either way
  const overUnder: Record<string, { over: number; under: number }> = {
    '3.5': {
      over: outcomes.totalSets.four + outcomes.totalSets.five,
      under: outcomes.totalSets.three,
    },
    // Additional secondary lines for informational completeness
    '4.5': {
      over: outcomes.totalSets.five,
      under: outcomes.totalSets.three + outcomes.totalSets.four,
    },
  };

  // ===== Handicap probabilities =====
  const handicaps: Record<string, { home: number; away: number; push?: number }> = {};
  Object.entries(outcomes.handicaps).forEach(([line, v]) => {
    handicaps[line] = { home: v.home, away: v.away, push: v.push };
  });

  // ===== Confidence scoring =====
  let confidence = 40;
  if (homeStrength !== null) confidence += 12;
  if (awayStrength !== null) confidence += 12;
  if (homeSetRate !== null) confidence += 5;
  if (awaySetRate !== null) confidence += 5;
  if (h2h.length >= 3) confidence += 10;
  if (homeFormString) confidence += 5;
  if (awayFormString) confidence += 5;
  if (homeStanding) confidence += 3;
  if (awayStanding) confidence += 3;
  confidence = Math.min(95, confidence);

  return {
    homeWinProb: outcomes.homeWin * 100,
    drawProb: 0, // Volleyball has no draws
    awayWinProb: outcomes.awayWin * 100,
    expectedHomeScore: outcomes.expectedHomeSets,
    expectedAwayScore: outcomes.expectedAwaySets,
    expectedTotalScore: outcomes.expectedTotalSets,
    overUnder,
    // NO BTTS in volleyball — both teams always win points; concept doesn't apply.
    // We intentionally omit btts (marked optional on Prediction interface).
    mostLikelyScores,
    handicaps,
    confidence,
    homeForm,
    awayForm,
  };
}

// ============================================================
// MARKET EVALUATOR
// ============================================================

/**
 * Parse a correct-set-score selection into [homeSets, awaySets].
 * Accepts formats: "3-0", "3:0", "3 - 0", "Home 3-0", etc.
 */
function parseCorrectSetScore(sel: string): { home: number; away: number } | null {
  const m = sel.match(/(\d)\s*[-:]\s*(\d)/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const a = parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  // Validate it's a legal best-of-5 final score
  const legal =
    (h === 3 && a >= 0 && a <= 2) || (a === 3 && h >= 0 && h <= 2);
  if (!legal) return null;
  return { home: h, away: a };
}

/**
 * Look up correct-set-score probability from prediction's mostLikelyScores.
 */
function lookupScoreProb(
  prediction: Prediction,
  home: number,
  away: number
): number {
  const found = prediction.mostLikelyScores.find(
    s => s.home === home && s.away === away
  );
  return found?.probability ?? 0;
}

function evaluateMarket(params: {
  prediction: Prediction;
  betName: string;
  selection: string;
  game: NormalizedGame;
}): number {
  const { prediction, betName, selection } = params;
  const name = (betName || '').trim().toLowerCase();
  const sel = (selection || '').trim();

  // ===== Home/Away (Match Winner) =====
  if (
    name === 'home/away' ||
    name === 'match winner' ||
    name === 'winner' ||
    name === '2way' ||
    name === 'moneyline'
  ) {
    // Renormalize (draw is 0 already but kept safe)
    const total = prediction.homeWinProb + prediction.awayWinProb;
    if (total === 0) return 0;
    if (/^(1|home)$/i.test(sel)) return prediction.homeWinProb / total;
    if (/^(2|away)$/i.test(sel)) return prediction.awayWinProb / total;
  }

  // ===== Asian Handicap (set-based) =====
  if (
    name === 'asian handicap' ||
    name === 'set handicap' ||
    name.includes('handicap')
  ) {
    // Parse "Home -1.5", "Away +2.5", "Home -1.5/-2.5" (split), etc.
    const splitMatch = sel.match(
      /(Home|Away)\s*([-+]?[\d.]+)\s*[\/,]\s*([-+]?[\d.]+)/i
    );
    if (splitMatch) {
      const side = splitMatch[1].toLowerCase();
      const l1 = parseFloat(splitMatch[2]);
      const l2 = parseFloat(splitMatch[3]);
      // Average the two lines' coverage probabilities
      const p1 = getHandicapProb(prediction, side as 'home' | 'away', l1);
      const p2 = getHandicapProb(prediction, side as 'home' | 'away', l2);
      return (p1 + p2) / 2;
    }

    const singleMatch = sel.match(/(Home|Away)\s*([-+]?[\d.]+)/i);
    if (singleMatch) {
      const side = singleMatch[1].toLowerCase() as 'home' | 'away';
      const line = parseFloat(singleMatch[2]);
      if (!Number.isFinite(line)) return 0;
      return getHandicapProb(prediction, side, line);
    }
  }

  // ===== Total Sets (Over/Under) =====
  if (
    name === 'total sets' ||
    name === 'over/under' ||
    name === 'over/under sets' ||
    name === 'sets over/under' ||
    name === 'total games' // some APIs use "games" for sets
  ) {
    const m = sel.match(/(Over|Under)\s+([\d.]+)/i);
    if (m) {
      const dir = m[1].toLowerCase();
      const line = parseFloat(m[2]);
      if (!Number.isFinite(line)) return 0;

      // Exact line from precomputed table?
      const ou = prediction.overUnder[String(line)];
      if (ou) return dir === 'over' ? ou.over : ou.under;

      // Compute on-the-fly from mostLikelyScores (6 outcomes)
      // Total sets played for each outcome: 3, 4, or 5
      let pOver = 0;
      let pUnder = 0;
      for (const s of prediction.mostLikelyScores) {
        const totalSets = s.home + s.away;
        if (totalSets > line) pOver += s.probability;
        else if (totalSets < line) pUnder += s.probability;
        // totalSets === line shouldn't happen at half-lines
      }
      return dir === 'over' ? pOver : pUnder;
    }
  }

  // ===== Correct Set Score =====
  if (
    name === 'correct set score' ||
    name === 'exact score' ||
    name === 'set score' ||
    name === 'correct score'
  ) {
    const parsed = parseCorrectSetScore(sel);
    if (parsed) {
      return lookupScoreProb(prediction, parsed.home, parsed.away);
    }
  }

  // ===== First Set Winner =====
  if (
    name === 'first set winner' ||
    name === '1st set winner' ||
    name === 'set 1 winner'
  ) {
    // First-set win probability is just p (single-set) — derive from home-win
    // via the implicit p stored indirectly. Use the first-set logic from
    // the prediction: solve for p from expectedHomeSets / 3 (approx).
    // Better: recover p from match-win prob by inverse of p^3(1+3q+6q^2).
    //
    // Simplest correct approach: evaluate as just "who wins a single set",
    // which IS the underlying parameter p.
    // Reconstruct p from prediction's homeWinProb via numerical inversion.
    const p = recoverPFromPrediction(prediction);
    if (/^(1|home)$/i.test(sel)) return p;
    if (/^(2|away)$/i.test(sel)) return 1 - p;
  }

  return 0;
}

/**
 * Helper: Given handicap line (home perspective) and side, return coverage prob.
 */
function getHandicapProb(
  prediction: Prediction,
  side: 'home' | 'away',
  line: number
): number {
  // Try precomputed handicap table first
  const hc = prediction.handicaps?.[String(line)];
  if (hc) {
    const nonPush = (hc.home ?? 0) + (hc.away ?? 0);
    if (nonPush === 0) return 0;
    // Asian-style: push returned, use no-push normalization
    return side === 'home' ? hc.home / nonPush : hc.away / nonPush;
  }

  // Compute directly from mostLikelyScores (6 outcomes with margins ±1,2,3)
  // Margin = home - away
  let homeProb = 0;
  let awayProb = 0;
  for (const s of prediction.mostLikelyScores) {
    const margin = s.home - s.away;
    const diff = margin + line;
    if (diff > 0) homeProb += s.probability;
    else if (diff < 0) awayProb += s.probability;
  }
  const nonPush = homeProb + awayProb;
  if (nonPush === 0) return 0;
  return side === 'home' ? homeProb / nonPush : awayProb / nonPush;
}

/**
 * Recover single-set probability p from a Prediction by inverting
 *   homeWin = p^3 * (1 + 3q + 6q^2) where q = 1-p.
 * Uses binary search — robust and monotonic in p ∈ [P_MIN, P_MAX].
 */
function recoverPFromPrediction(prediction: Prediction): number {
  const targetHomeWin = prediction.homeWinProb / 100;
  // Clamp target so inversion is well-defined
  if (targetHomeWin <= 0) return P_MIN;
  if (targetHomeWin >= 1) return P_MAX;

  const f = (p: number): number => {
    const q = 1 - p;
    return p * p * p * (1 + 3 * q + 6 * q * q);
  };

  let lo = 0.01;
  let hi = 0.99;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const val = f(mid);
    if (val < targetHomeWin) lo = mid;
    else hi = mid;
  }
  return Math.max(P_MIN, Math.min(P_MAX, (lo + hi) / 2));
}

// ============================================================
// BET RESULT EVALUATOR
// ============================================================

/**
 * Extract per-set winner from game.periods for First Set Winner settlement.
 * Period strings are "H-A" format (e.g., "25-22"). Whoever has the higher
 * point count won that set.
 */
function getSetWinner(periodValue: string | null | undefined): 'home' | 'away' | null {
  if (!periodValue || typeof periodValue !== 'string') return null;
  const m = periodValue.match(/(\d+)\s*[-:]\s*(\d+)/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const a = parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(a) || h === a) return null;
  return h > a ? 'home' : 'away';
}

function evaluateBetResult(params: {
  betName: string;
  selection: string;
  game: NormalizedGame;
}): 'won' | 'lost' | 'void' | 'pending' {
  const { betName, selection, game } = params;

  if (!game.status.finished || game.scores.home === null || game.scores.away === null) {
    return 'pending';
  }

  const h = game.scores.home; // total sets won by home
  const a = game.scores.away; // total sets won by away
  const totalSets = h + a;
  const name = (betName || '').trim().toLowerCase();
  const sel = (selection || '').trim();

  // Sanity check: best-of-5 means winner has 3 sets, total is 3, 4, or 5
  // Awarded matches (AW status) might have non-standard scores; handle defensively.

  // ===== Home/Away (Match Winner) =====
  if (
    name === 'home/away' ||
    name === 'match winner' ||
    name === 'winner' ||
    name === '2way' ||
    name === 'moneyline'
  ) {
    if (h === a) return 'void'; // Extremely rare edge case
    if (/^(1|home)$/i.test(sel)) return h > a ? 'won' : 'lost';
    if (/^(2|away)$/i.test(sel)) return a > h ? 'won' : 'lost';
  }

  // ===== Asian Handicap (set-based) =====
  if (
    name === 'asian handicap' ||
    name === 'set handicap' ||
    name.includes('handicap')
  ) {
    // Split handicap: "Home -1.5/-2.5"
    const splitMatch = sel.match(
      /(Home|Away)\s*([-+]?[\d.]+)\s*[\/,]\s*([-+]?[\d.]+)/i
    );
    if (splitMatch) {
      const side = splitMatch[1].toLowerCase();
      const l1 = parseFloat(splitMatch[2]);
      const l2 = parseFloat(splitMatch[3]);
      const diff1 = side === 'home' ? h - a + l1 : a - h + l1;
      const diff2 = side === 'home' ? h - a + l2 : a - h + l2;
      const score1 = diff1 > 0 ? 1 : diff1 === 0 ? 0.5 : 0;
      const score2 = diff2 > 0 ? 1 : diff2 === 0 ? 0.5 : 0;
      const combined = (score1 + score2) / 2;
      if (combined === 1) return 'won';
      if (combined === 0) return 'lost';
      return 'void'; // half-win/half-loss treated as void
    }

    const singleMatch = sel.match(/(Home|Away)\s*([-+]?[\d.]+)/i);
    if (singleMatch) {
      const side = singleMatch[1].toLowerCase();
      const line = parseFloat(singleMatch[2]);
      if (!Number.isFinite(line)) return 'void';
      const diff = side === 'home' ? h - a + line : a - h + line;
      if (diff > 0) return 'won';
      if (diff < 0) return 'lost';
      return 'void'; // push
    }
  }

  // ===== Total Sets (Over/Under) =====
  if (
    name === 'total sets' ||
    name === 'over/under' ||
    name === 'over/under sets' ||
    name === 'sets over/under' ||
    name === 'total games'
  ) {
    const m = sel.match(/(Over|Under)\s+([\d.]+)/i);
    if (m) {
      const dir = m[1].toLowerCase();
      const line = parseFloat(m[2]);
      if (!Number.isFinite(line)) return 'void';
      if (totalSets === line) return 'void'; // integer-line push
      if (dir === 'over') return totalSets > line ? 'won' : 'lost';
      if (dir === 'under') return totalSets < line ? 'won' : 'lost';
    }
  }

  // ===== Correct Set Score =====
  if (
    name === 'correct set score' ||
    name === 'exact score' ||
    name === 'set score' ||
    name === 'correct score'
  ) {
    const parsed = parseCorrectSetScore(sel);
    if (parsed) {
      return parsed.home === h && parsed.away === a ? 'won' : 'lost';
    }
  }

  // ===== First Set Winner =====
  if (
    name === 'first set winner' ||
    name === '1st set winner' ||
    name === 'set 1 winner'
  ) {
    const winner = getSetWinner(game.periods?.first as string | null | undefined);
    if (winner === null) return 'void';
    if (/^(1|home)$/i.test(sel)) return winner === 'home' ? 'won' : 'lost';
    if (/^(2|away)$/i.test(sel)) return winner === 'away' ? 'won' : 'lost';
  }

  return 'void';
}

// ============================================================
// API DATA FETCHERS
// ============================================================
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
  const res = await client.fetch<any[]>('games', { live: 'all' }, 60 * 1000);
  return (res.response || []).map(normalizeGame);
}

async function getOddsForGame(gameId: number): Promise<NormalizedOdds | null> {
  const res = await client.fetch<any[]>('odds', { game: gameId });
  const o = res.response?.[0];
  return o ? normalizeOdds(o) : null;
}

async function getH2H(
  homeTeamId: number,
  awayTeamId: number
): Promise<NormalizedGame[]> {
  const res = await client.fetch<any[]>('games/h2h', {
    h2h: `${homeTeamId}-${awayTeamId}`,
  });
  return (res.response || []).map(normalizeGame);
}

async function getStandings(leagueId: number, season: number): Promise<any[]> {
  const res = await client.fetch<any[]>('standings', { league: leagueId, season });
  // Volleyball standings nest under league.standings (array of arrays/groups)
  const data = res.response || [];
  // Some endpoints return [ { league: { standings: [[team,...], ...] } } ]
  if (Array.isArray(data) && data[0]?.league?.standings) {
    return data[0].league.standings.flat();
  }
  // Fallback: flatten any nested array structure
  return Array.isArray(data) ? data.flat() : [];
}

async function getTeamStatistics(
  teamId: number,
  leagueId: number,
  season: number
): Promise<any> {
  const res = await client.fetch<any>('teams/statistics', {
    team: teamId,
    league: leagueId,
    season,
  });
  return res.response;
}

// ============================================================
// PLUGIN EXPORT
// ============================================================
export const volleyballPlugin: SportPlugin = {
  config: volleyballConfig,
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
