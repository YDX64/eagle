/**
 * Handball Sport Plugin
 * v1.handball.api-sports.io
 *
 * Karakteristik:
 * - Yüksek skorlu (~55 gol/maç, ev ~28, deplasman ~27)
 * - Normal distribution kullanır (yüksek lambda Poisson yerine daha iyi)
 * - İki yarı (2 x 30 dakika)
 * - Draw izinli (~%8 beraberlik oranı, drawBuffer=1.5)
 * - API v1.handball format: flat game object (hockey/basketball'a benzer)
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
  calculateFormScore,
  analyzeH2H,
  normalCdf,
  normalSurvival,
} from '../_core';
import { handballConfig } from './config';

const client = new SportApiClient(handballConfig.apiBase, handballConfig.apiKey);

// ===== API v1 STATUS CLASSIFICATION =====
// NS=Not Started, Q1/Q2=In play halves, HT=Half-time, FT=Full-time,
// AOT=After Over Time, AP=After Penalties, POST=Postponed, CANC=Cancelled, ABD=Abandoned
const LIVE_STATUS = ['Q1', 'Q2', 'HT', 'OT', 'BT', 'LIVE'];
const FINISHED_STATUS = ['FT', 'AOT', 'AP', 'AET'];

// ===== NORMALIZER =====
// API v1 returns a flat game object (unlike football's nested fixture)
function normalizeGame(raw: any): NormalizedGame {
  const statusShort: string = raw.status?.short ?? 'NS';
  const statusLong: string = raw.status?.long ?? 'Not Started';
  const timestamp: number =
    typeof raw.timestamp === 'number'
      ? raw.timestamp
      : raw.date
        ? Math.floor(new Date(raw.date).getTime() / 1000)
        : 0;

  // Scores in handball v1 API are typically { home: { total, ... }, away: { total, ... } }
  // or flat { home: number, away: number } depending on endpoint. Handle both.
  const homeScore = extractTotalScore(raw.scores?.home);
  const awayScore = extractTotalScore(raw.scores?.away);

  // Period breakdown (halves). Handball has 2 halves but API may expose as periods.
  // Normalize to string form "home-away" per period.
  const periods: Record<string, string | null> = {};
  if (raw.periods) {
    Object.entries(raw.periods).forEach(([key, val]) => {
      if (val && typeof val === 'object') {
        const v = val as { home?: number | null; away?: number | null };
        if (v.home != null && v.away != null) {
          periods[key] = `${v.home}-${v.away}`;
        } else {
          periods[key] = null;
        }
      } else if (typeof val === 'string') {
        periods[key] = val;
      } else {
        periods[key] = null;
      }
    });
  }

  return {
    id: raw.id,
    sport: 'handball',
    date: raw.date,
    timestamp,
    status: {
      short: statusShort,
      long: statusLong,
      live: LIVE_STATUS.includes(statusShort),
      finished: FINISHED_STATUS.includes(statusShort),
      upcoming: statusShort === 'NS' || statusShort === 'TBD',
    },
    league: {
      id: raw.league?.id ?? 0,
      name: raw.league?.name ?? 'Unknown',
      logo: raw.league?.logo,
      country: raw.country?.name ?? raw.league?.country,
      season: raw.league?.season ?? new Date().getFullYear(),
    },
    teams: {
      home: {
        id: raw.teams?.home?.id ?? 0,
        name: raw.teams?.home?.name ?? 'Home',
        logo: raw.teams?.home?.logo,
      },
      away: {
        id: raw.teams?.away?.id ?? 0,
        name: raw.teams?.away?.name ?? 'Away',
        logo: raw.teams?.away?.logo,
      },
    },
    scores: {
      home: homeScore,
      away: awayScore,
    },
    periods,
  };
}

function extractTotalScore(scoreObj: any): number | null {
  if (scoreObj == null) return null;
  if (typeof scoreObj === 'number') return scoreObj;
  if (typeof scoreObj === 'object') {
    if (typeof scoreObj.total === 'number') return scoreObj.total;
    if (typeof scoreObj.score === 'number') return scoreObj.score;
    // Sum period scores as fallback
    const vals = Object.values(scoreObj).filter((v): v is number => typeof v === 'number');
    if (vals.length > 0) return vals.reduce((a, b) => a + b, 0);
  }
  return null;
}

function normalizeOdds(odd: any): NormalizedOdds {
  return {
    gameId: odd.game?.id ?? odd.id,
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

  // Baseline expectations
  let homeAttack = handballConfig.avgScoreHome;
  let homeDefense = handballConfig.avgScoreAway;
  let awayAttack = handballConfig.avgScoreAway;
  let awayDefense = handballConfig.avgScoreHome;

  // Extract from team statistics if available (api-sports format)
  // Handball statistics typically: { goals: { for: { average: { home, away, total } }, against: { ... } } }
  if (homeStats?.goals) {
    const forHome = parseFloat(homeStats.goals?.for?.average?.home);
    const againstHome = parseFloat(homeStats.goals?.against?.average?.home);
    if (!isNaN(forHome) && forHome > 0) homeAttack = forHome;
    if (!isNaN(againstHome) && againstHome > 0) homeDefense = againstHome;
  }
  if (awayStats?.goals) {
    const forAway = parseFloat(awayStats.goals?.for?.average?.away);
    const againstAway = parseFloat(awayStats.goals?.against?.average?.away);
    if (!isNaN(forAway) && forAway > 0) awayAttack = forAway;
    if (!isNaN(againstAway) && againstAway > 0) awayDefense = againstAway;
  }

  // Form
  const homeForm = calculateFormScore(homeStanding?.form);
  const awayForm = calculateFormScore(awayStanding?.form);

  // Head-to-head adjustment: handball skor aralığı geniş olduğu için
  // etki sınırlı tutuluyor; H2H gol ortalamasından türetilen küçük kayma.
  let h2hAdjustHome = 0;
  let h2hAdjustAway = 0;
  if (h2h.length >= 3) {
    const h2hAnalysis = analyzeH2H(h2h, game.teams.home.id);
    // Rate farkı üzerinden küçük skor kayması (max ~2 gol)
    const rateDiff = h2hAnalysis.homeWinRate - h2hAnalysis.awayWinRate;
    h2hAdjustHome = rateDiff * 2;
    h2hAdjustAway = -rateDiff * 1.5;
  }

  // Form ratio with mild influence (handball çok gol = tek faktör domine etmez)
  const formFactor = homeForm > 0 && awayForm > 0 ? homeForm / awayForm : 1;
  const adv = handballConfig.homeAdvantage;

  // Combined expected scores
  // Ev sahibi: attack + rakip defense ortalaması * ev avantajı * form^0.2
  let expectedHome =
    ((homeAttack + awayDefense) / 2) * adv * Math.pow(formFactor, 0.2) + h2hAdjustHome;
  let expectedAway =
    ((awayAttack + homeDefense) / 2) / Math.pow(formFactor, 0.15) + h2hAdjustAway;

  // Safety floors - handball'de 15'ten az gol beklenmez
  expectedHome = Math.max(15, expectedHome);
  expectedAway = Math.max(15, expectedAway);

  const stdDev = handballConfig.scoreStdDev ?? 5;

  const ouLines = [45.5, 48.5, 50.5, 52.5, 55.5, 57.5, 60.5];
  const handicapLines = [-8.5, -6.5, -4.5, -2.5, -1.5, 1.5, 2.5, 4.5, 6.5, 8.5];

  const outcomes = deriveNormalOutcomes(expectedHome, expectedAway, stdDev, stdDev, {
    ouLines,
    handicapLines,
    drawBuffer: 1.5, // Handball draws ~8% of time
  });

  // Confidence: data availability bazlı
  let confidence = 40;
  if (homeStats) confidence += 15;
  if (awayStats) confidence += 15;
  if (h2h.length >= 3) confidence += 15;
  if (homeStanding) confidence += 7.5;
  if (awayStanding) confidence += 7.5;
  confidence = Math.min(95, confidence);

  // Most likely scores - Normal distribution'dan türetilmiş en olası skor
  // kombinasyonları (integer grid search etrafında mean'lerin)
  const mostLikelyScores = deriveMostLikelyScores(expectedHome, expectedAway, stdDev, stdDev);

  const overUnder: Record<string, { over: number; under: number }> = {};
  Object.entries(outcomes.overUnder).forEach(([k, v]) => {
    overUnder[String(k)] = v;
  });

  const handicaps: Record<string, { home: number; away: number; push?: number }> = {};
  Object.entries(outcomes.handicaps).forEach(([k, v]) => {
    handicaps[String(k)] = v;
  });

  return {
    homeWinProb: outcomes.homeWin * 100,
    drawProb: outcomes.draw * 100,
    awayWinProb: outcomes.awayWin * 100,
    expectedHomeScore: expectedHome,
    expectedAwayScore: expectedAway,
    expectedTotalScore: expectedHome + expectedAway,
    overUnder,
    mostLikelyScores,
    handicaps,
    confidence,
    homeForm,
    awayForm,
  };
}

/**
 * Generate most-likely exact scores from Normal distribution.
 * For handball (~55 total goals), we sample integer grid around means
 * and return top probability combinations.
 */
function deriveMostLikelyScores(
  meanHome: number,
  meanAway: number,
  stdHome: number,
  stdAway: number
): { home: number; away: number; probability: number }[] {
  const results: { home: number; away: number; probability: number }[] = [];
  const hRange = Math.ceil(stdHome * 2.5);
  const aRange = Math.ceil(stdAway * 2.5);
  const hStart = Math.max(0, Math.round(meanHome - hRange));
  const hEnd = Math.round(meanHome + hRange);
  const aStart = Math.max(0, Math.round(meanAway - aRange));
  const aEnd = Math.round(meanAway + aRange);

  for (let h = hStart; h <= hEnd; h++) {
    for (let a = aStart; a <= aEnd; a++) {
      // P(score = k) ≈ CDF(k+0.5) - CDF(k-0.5) continuity correction
      const pHome = normalCdf(h + 0.5, meanHome, stdHome) - normalCdf(h - 0.5, meanHome, stdHome);
      const pAway = normalCdf(a + 0.5, meanAway, stdAway) - normalCdf(a - 0.5, meanAway, stdAway);
      const probability = pHome * pAway;
      if (probability > 0.0001) {
        results.push({ home: h, away: a, probability });
      }
    }
  }

  return results.sort((a, b) => b.probability - a.probability).slice(0, 15);
}

// ===== MARKET EVALUATOR =====
function evaluateMarket(params: {
  prediction: Prediction;
  betName: string;
  selection: string;
  game: NormalizedGame;
}): number {
  const { prediction, betName, selection } = params;
  const name = betName.toLowerCase().trim();
  const sel = selection.trim();

  // 3-Way Result / Match Winner
  if (
    name === '3-way result' ||
    name === '3way result' ||
    name === 'match winner' ||
    name === '1x2'
  ) {
    if (sel === '1' || sel === 'Home' || sel === 'home') return prediction.homeWinProb / 100;
    if (sel === 'X' || sel === 'Draw' || sel === 'draw') return prediction.drawProb / 100;
    if (sel === '2' || sel === 'Away' || sel === 'away') return prediction.awayWinProb / 100;
  }

  // Home/Away (Draw No Bet)
  if (name === 'home/away') {
    const total = prediction.homeWinProb + prediction.awayWinProb;
    if (total === 0) return 0;
    if (sel === 'Home' || sel === '1') return prediction.homeWinProb / total;
    if (sel === 'Away' || sel === '2') return prediction.awayWinProb / total;
  }

  // Double Chance
  if (name === 'double chance' || name.includes('double chance')) {
    if (sel === 'Home/Draw' || sel === '1X' || sel === '1x')
      return (prediction.homeWinProb + prediction.drawProb) / 100;
    if (sel === 'Draw/Away' || sel === 'X2' || sel === 'x2')
      return (prediction.drawProb + prediction.awayWinProb) / 100;
    if (sel === 'Home/Away' || sel === '12')
      return (prediction.homeWinProb + prediction.awayWinProb) / 100;
  }

  // Over/Under (full match)
  if (name === 'over/under') {
    const m = sel.match(/(Over|Under)\s+([\d.]+)/i);
    if (m) {
      const dir = m[1].toLowerCase();
      const line = parseFloat(m[2]);
      const ou = prediction.overUnder[String(line)];
      if (ou) return dir === 'over' ? ou.over : ou.under;
      // Fallback: compute on-the-fly for non-preset lines using Normal
      return computeOverUnder(prediction, line, dir as 'over' | 'under');
    }
  }

  // Handicap (non-Asian)
  if (name.includes('handicap') && !name.includes('asian')) {
    const m = sel.match(/(Home|Away)\s*([-+]?[\d.]+)/);
    if (m) {
      const side = m[1];
      const line = parseFloat(m[2]);
      const hc = prediction.handicaps?.[String(line)];
      if (hc) {
        return side === 'Home' ? hc.home : hc.away;
      }
      // Fallback compute
      return computeHandicap(prediction, side === 'Home', line);
    }
  }

  // Asian Handicap
  if (name === 'asian handicap' || name.includes('asian handicap')) {
    const m = sel.match(/(Home|Away)\s*([-+]?[\d.]+)/);
    if (m) {
      const side = m[1];
      const line = parseFloat(m[2]);
      const hc = prediction.handicaps?.[String(line)];
      if (hc) {
        const totalNonPush = (hc.home ?? 0) + (hc.away ?? 0);
        if (totalNonPush === 0) return 0;
        return side === 'Home' ? hc.home / totalNonPush : hc.away / totalNonPush;
      }
      // Fallback compute (ignore push by renormalization)
      const p = computeHandicap(prediction, side === 'Home', line);
      const pOther = computeHandicap(prediction, side !== 'Home', line);
      const total = p + pOther;
      return total > 0 ? p / total : 0;
    }
  }

  // 1st Half Winner - half expectation ≈ total / 2 (2x30min equal halves)
  if (name === '1st half winner' || name === 'first half winner' || name === '1st half result') {
    const halfHome = prediction.expectedHomeScore * 0.5;
    const halfAway = prediction.expectedAwayScore * 0.5;
    const stdDev = handballConfig.scoreStdDev ?? 5;
    // Half variance ≈ full variance / 2 (independent halves sum)
    const halfStd = stdDev / Math.sqrt(2);
    const halfOutcome = deriveNormalOutcomes(halfHome, halfAway, halfStd, halfStd, {
      drawBuffer: 1.0, // Tighter buffer: half draws more common
    });
    if (sel === '1' || sel === 'Home') return halfOutcome.homeWin;
    if (sel === 'X' || sel === 'Draw') return halfOutcome.draw;
    if (sel === '2' || sel === 'Away') return halfOutcome.awayWin;
  }

  // 1st Half Over/Under
  if (name === '1st half over/under' || name === 'first half over/under') {
    const m = sel.match(/(Over|Under)\s+([\d.]+)/i);
    if (m) {
      const dir = m[1].toLowerCase();
      const line = parseFloat(m[2]);
      const halfMean = (prediction.expectedHomeScore + prediction.expectedAwayScore) * 0.5;
      const stdDev = handballConfig.scoreStdDev ?? 5;
      const halfStdTotal = Math.sqrt((stdDev * stdDev) / 2 + (stdDev * stdDev) / 2);
      const over = normalSurvival(line, halfMean, halfStdTotal);
      return dir === 'over' ? over : 1 - over;
    }
  }

  // Odd/Even - use most likely scores enumeration
  if (name === 'odd/even') {
    const oddProb = prediction.mostLikelyScores
      .filter(s => (s.home + s.away) % 2 === 1)
      .reduce((a, b) => a + b.probability, 0);
    const evenProb = prediction.mostLikelyScores
      .filter(s => (s.home + s.away) % 2 === 0)
      .reduce((a, b) => a + b.probability, 0);
    const total = oddProb + evenProb;
    if (total > 0) {
      if (sel === 'Odd') return oddProb / total;
      if (sel === 'Even') return evenProb / total;
    }
  }

  return 0;
}

function computeOverUnder(prediction: Prediction, line: number, dir: 'over' | 'under'): number {
  const stdDev = handballConfig.scoreStdDev ?? 5;
  const meanTotal = prediction.expectedTotalScore;
  const stdTotal = Math.sqrt(2 * stdDev * stdDev);
  const over = normalSurvival(line, meanTotal, stdTotal);
  return dir === 'over' ? over : 1 - over;
}

function computeHandicap(prediction: Prediction, isHome: boolean, line: number): number {
  const stdDev = handballConfig.scoreStdDev ?? 5;
  const stdMargin = Math.sqrt(2 * stdDev * stdDev);
  const meanMargin = prediction.expectedHomeScore - prediction.expectedAwayScore;
  const drawBuffer = 1.5;
  if (isHome) {
    // Home wins with handicap line when margin + line > drawBuffer
    return normalSurvival(-line + drawBuffer, meanMargin, stdMargin);
  } else {
    return normalCdf(-line - drawBuffer, meanMargin, stdMargin);
  }
}

// ===== BET RESULT EVALUATOR =====
function evaluateBetResult(params: {
  betName: string;
  selection: string;
  game: NormalizedGame;
}): 'won' | 'lost' | 'void' | 'pending' {
  const { betName, selection, game } = params;
  if (!game.status.finished || game.scores.home === null || game.scores.away === null)
    return 'pending';

  const h = game.scores.home;
  const a = game.scores.away;
  const total = h + a;
  const name = betName.toLowerCase().trim();
  const sel = selection.trim();

  // 3-Way / Match Winner
  if (
    name === '3-way result' ||
    name === '3way result' ||
    name === 'match winner' ||
    name === '1x2'
  ) {
    if (sel === '1' || sel === 'Home') return h > a ? 'won' : 'lost';
    if (sel === 'X' || sel === 'Draw') return h === a ? 'won' : 'lost';
    if (sel === '2' || sel === 'Away') return a > h ? 'won' : 'lost';
  }

  // Home/Away (Draw No Bet) - draw = void/push
  if (name === 'home/away') {
    if (h === a) return 'void';
    if (sel === 'Home' || sel === '1') return h > a ? 'won' : 'lost';
    if (sel === 'Away' || sel === '2') return a > h ? 'won' : 'lost';
  }

  // Double Chance
  if (name === 'double chance' || name.includes('double chance')) {
    if (sel === 'Home/Draw' || sel === '1X') return h >= a ? 'won' : 'lost';
    if (sel === 'Draw/Away' || sel === 'X2') return a >= h ? 'won' : 'lost';
    if (sel === 'Home/Away' || sel === '12') return h !== a ? 'won' : 'lost';
  }

  // Over/Under (full match)
  if (name === 'over/under') {
    const m = sel.match(/(Over|Under)\s+([\d.]+)/i);
    if (m) {
      const dir = m[1].toLowerCase();
      const line = parseFloat(m[2]);
      // .5 lines never push. Integer lines push on exact.
      if (total === line) return 'void';
      return dir === 'over' ? (total > line ? 'won' : 'lost') : total < line ? 'won' : 'lost';
    }
  }

  // Handicap
  if (name.includes('handicap')) {
    const m = sel.match(/(Home|Away)\s*([-+]?[\d.]+)/);
    if (m) {
      const side = m[1];
      const line = parseFloat(m[2]);
      const adjustedDiff = side === 'Home' ? h - a + line : a - h + line;
      if (adjustedDiff > 0) return 'won';
      if (adjustedDiff < 0) return 'lost';
      return 'void';
    }
  }

  // 1st Half markets - need period data
  if (name === '1st half winner' || name === 'first half winner' || name === '1st half result') {
    const half = extractFirstHalfScore(game);
    if (half === null) return 'pending';
    if (sel === '1' || sel === 'Home') return half.home > half.away ? 'won' : 'lost';
    if (sel === 'X' || sel === 'Draw') return half.home === half.away ? 'won' : 'lost';
    if (sel === '2' || sel === 'Away') return half.away > half.home ? 'won' : 'lost';
  }

  if (name === '1st half over/under' || name === 'first half over/under') {
    const half = extractFirstHalfScore(game);
    if (half === null) return 'pending';
    const halfTotal = half.home + half.away;
    const m = sel.match(/(Over|Under)\s+([\d.]+)/i);
    if (m) {
      const dir = m[1].toLowerCase();
      const line = parseFloat(m[2]);
      if (halfTotal === line) return 'void';
      return dir === 'over'
        ? halfTotal > line
          ? 'won'
          : 'lost'
        : halfTotal < line
          ? 'won'
          : 'lost';
    }
  }

  // Odd/Even
  if (name === 'odd/even') {
    if (sel === 'Odd') return total % 2 === 1 ? 'won' : 'lost';
    if (sel === 'Even') return total % 2 === 0 ? 'won' : 'lost';
  }

  return 'void';
}

function extractFirstHalfScore(game: NormalizedGame): { home: number; away: number } | null {
  if (!game.periods) return null;
  // API v1 common keys: "first_half", "firstHalf", "Q1", "quarter_1", "1"
  const keys = ['first_half', 'firstHalf', 'first', 'Q1', 'quarter_1', '1', 'H1'];
  for (const k of keys) {
    const v = game.periods[k];
    if (typeof v === 'string') {
      const parts = v.split(/[-:]/).map(s => parseInt(s.trim(), 10));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return { home: parts[0], away: parts[1] };
      }
    }
  }
  return null;
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
  const res = await client.fetch<any[]>('games', { live: 'all' }, 60000);
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
  // Handball v1 standings response is typically array-of-array structure
  const raw = res.response;
  if (!Array.isArray(raw)) return [];
  // Flatten if nested
  return raw.flat(Infinity) as any[];
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
export const handballPlugin: SportPlugin = {
  config: handballConfig,
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
