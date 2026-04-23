/**
 * Rugby Sport Plugin
 * v1.rugby.api-sports.io
 *
 * Karakteristik:
 * - ~47 toplam sayı (ev ~25, deplasman ~22)
 * - Yüksek varyans (stdDev ~11/takım) -> Normal dağılım uygundur
 * - Beraberlik izinli (~%5 oranında, drawBuffer=3 çünkü rugby puanlama kaba)
 *   Rugby'de en küçük sayı birimi 2-3 (conversion / penalty), dolayısıyla
 *   beraberlik aralığı futbol/hokeyden daha geniş tutulmalıdır.
 * - İki yarı (2 x 40 dakika)
 * - Ev avantajı yüksek (~%8) — uzun seyahatler ve iklim farkları etkili
 * - Handikap (Asian + Standard), Over/Under ve Match Winner en popüler pazarlar
 * - API v1 format: flat game object (hockey/handball/basketball'a benzer)
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
import { rugbyConfig } from './config';

const client = new SportApiClient(rugbyConfig.apiBase, rugbyConfig.apiKey);

// ===== API v1 STATUS CLASSIFICATION =====
// NS=Not Started, 1H=First Half, HT=Half-time, 2H=Second Half,
// ET=Extra Time, BT=Break Time, FT=Full-time,
// AET=After Extra Time, POST=Postponed, CANC=Cancelled, ABD=Abandoned
const LIVE_STATUS = ['1H', '2H', 'HT', 'ET', 'BT', 'LIVE'];
const FINISHED_STATUS = ['FT', 'AET', 'AOT'];

// Draw buffer matches config reasoning: rugby minimum scoring increments are 2-3
const RUGBY_DRAW_BUFFER = 3;

// ===== NORMALIZER =====
// API v1 rugby returns a flat game object (similar to hockey/handball/basketball):
// { id, date, time, timestamp, timezone, week, status:{short,long,timer},
//   country:{...}, league:{id,name,type,season,logo},
//   teams:{home:{id,name,logo}, away:{id,name,logo}},
//   scores:{home:number|null, away:number|null},
//   periods:{first:{home,away}|null, second:{home,away}|null} }
function normalizeGame(raw: any): NormalizedGame {
  const statusShort: string = String(raw.status?.short ?? 'NS').toUpperCase();
  const statusLong: string = raw.status?.long ?? 'Not Started';

  const timestamp: number =
    typeof raw.timestamp === 'number'
      ? raw.timestamp
      : raw.date
        ? Math.floor(new Date(raw.date).getTime() / 1000)
        : 0;

  const homeScore = extractTotalScore(raw.scores?.home);
  const awayScore = extractTotalScore(raw.scores?.away);

  // Period breakdown — rugby has two halves: "first" and "second"
  // Some endpoints also expose extra_time.
  const periods: Record<string, string | null> = {};
  if (raw.periods && typeof raw.periods === 'object') {
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

  const leagueCountry =
    typeof raw.country === 'object' && raw.country?.name
      ? raw.country.name
      : typeof raw.league?.country === 'string'
        ? raw.league.country
        : raw.league?.country?.name;

  return {
    id: Number(raw.id ?? 0),
    sport: 'rugby',
    date: raw.date ?? '',
    timestamp,
    status: {
      short: statusShort,
      long: statusLong,
      live: LIVE_STATUS.includes(statusShort),
      finished:
        FINISHED_STATUS.includes(statusShort) ||
        statusLong.toLowerCase().includes('finished'),
      upcoming: statusShort === 'NS' || statusShort === 'TBD' || statusShort === '',
    },
    league: {
      id: Number(raw.league?.id ?? 0),
      name: raw.league?.name ?? 'Unknown',
      logo: raw.league?.logo,
      country: leagueCountry,
      season: raw.league?.season ?? new Date().getFullYear(),
    },
    teams: {
      home: {
        id: Number(raw.teams?.home?.id ?? 0),
        name: raw.teams?.home?.name ?? 'Home',
        logo: raw.teams?.home?.logo,
      },
      away: {
        id: Number(raw.teams?.away?.id ?? 0),
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
  if (typeof scoreObj === 'string') {
    const n = parseFloat(scoreObj);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof scoreObj === 'object') {
    if (typeof scoreObj.total === 'number') return scoreObj.total;
    if (typeof scoreObj.score === 'number') return scoreObj.score;
    // Fallback: sum numeric fields (first/second half etc.)
    const vals = Object.values(scoreObj).filter(
      (v): v is number => typeof v === 'number' && Number.isFinite(v)
    );
    if (vals.length > 0) return vals.reduce((a, b) => a + b, 0);
  }
  return null;
}

function normalizeOdds(raw: any): NormalizedOdds {
  const gameId = Number(raw.game?.id ?? raw.id ?? 0);
  return {
    gameId,
    bookmakers: (raw.bookmakers || []).map((bm: any) => ({
      id: Number(bm.id ?? 0),
      name: String(bm.name ?? ''),
      bets: (bm.bets || []).map((bet: any) => ({
        id: Number(bet.id ?? 0),
        name: String(bet.name ?? ''),
        values: (bet.values || []).map((v: any) => ({
          value: String(v.value),
          odd: parseFloat(v.odd),
        })),
      })),
    })),
  };
}

// ===== MOST LIKELY SCORES (Normal-based discrete grid) =====
/**
 * Normal dağılımlar sürekli; rugby için tam sayı skor ızgarası ile
 * en olası skor kombinasyonlarını yaklaştırıyoruz.
 * Joint PDF ≈ P(home=h) * P(away=a) (bağımsızlık varsayımı).
 * Her sayı değeri için "±0.5 aralık" olasılığı continuity correction ile hesaplanır.
 *
 * Not: Rugby skorları teorik olarak 0,3,5,6,7,8,10... gibi belirli değerler alır
 * ancak tüm tam sayılar mümkün olduğu için (ör. try+missed conversion=5,
 * penalty=3, çoklu puanlar toplandığında herhangi bir değer) standart integer grid
 * iyi bir yaklaşımdır.
 */
function computeMostLikelyScores(
  meanHome: number,
  meanAway: number,
  stdHome: number,
  stdAway: number,
  maxScore: number = 80,
  topN: number = 15
): { home: number; away: number; probability: number }[] {
  const results: { home: number; away: number; probability: number }[] = [];
  const hRange = Math.ceil(stdHome * 2.5);
  const aRange = Math.ceil(stdAway * 2.5);
  const hStart = Math.max(0, Math.round(meanHome - hRange));
  const hEnd = Math.min(maxScore, Math.round(meanHome + hRange));
  const aStart = Math.max(0, Math.round(meanAway - aRange));
  const aEnd = Math.min(maxScore, Math.round(meanAway + aRange));

  for (let h = hStart; h <= hEnd; h++) {
    const pH =
      normalCdf(h + 0.5, meanHome, stdHome) - normalCdf(h - 0.5, meanHome, stdHome);
    if (pH < 1e-5) continue;
    for (let a = aStart; a <= aEnd; a++) {
      const pA =
        normalCdf(a + 0.5, meanAway, stdAway) - normalCdf(a - 0.5, meanAway, stdAway);
      if (pA < 1e-5) continue;
      const probability = pH * pA;
      if (probability > 1e-5) {
        results.push({ home: h, away: a, probability });
      }
    }
  }

  return results.sort((a, b) => b.probability - a.probability).slice(0, topN);
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
  const {
    game,
    homeStats,
    awayStats,
    h2h = [],
    homeStanding,
    awayStanding,
  } = params;

  const cfg = rugbyConfig;
  const baseStd = cfg.scoreStdDev ?? 11;

  // Baseline expectations from config (fallback when stats missing)
  let homeAttack = cfg.avgScoreHome;
  let homeDefense = cfg.avgScoreAway; // rakibe yedirdiği sayı
  let awayAttack = cfg.avgScoreAway;
  let awayDefense = cfg.avgScoreHome;

  // Parse api-sports team statistics. Rugby istatistikleri farklı API sürümlerinde
  // farklı yerleşime sahip olabilir. Toleranslı ayıklama:
  //   - points.for.average.{home,away,total}
  //   - points.against.average.{home,away,total}
  //   - points.for.total.{home,away,total} + games.played.* ile bölünebilir
  //   - goals.for.average.* (bazı endpoint'ler "points" yerine "goals" kullanır)
  const parseAverage = (
    s: any,
    side: 'for' | 'against',
    venue: 'home' | 'away' | 'total'
  ): number | null => {
    if (!s) return null;
    const candidates = [
      s?.points?.[side]?.average?.[venue],
      s?.points?.[side]?.average?.all,
      s?.points?.[side]?.average,
      s?.goals?.[side]?.average?.[venue],
      s?.goals?.[side]?.average?.all,
      s?.goals?.[side]?.average,
      s?.[side]?.average?.[venue],
      s?.[side]?.average,
    ];
    for (const c of candidates) {
      if (c == null) continue;
      const n = typeof c === 'string' ? parseFloat(c) : Number(c);
      if (Number.isFinite(n) && n > 0) return n;
    }
    // Derive from totals / games if only raw totals provided
    const total = s?.points?.[side]?.total?.[venue] ?? s?.points?.[side]?.total?.all;
    const games =
      s?.games?.played?.[venue] ?? s?.games?.played?.all ?? s?.games?.played;
    if (total != null && games != null) {
      const t = Number(total);
      const g = Number(games);
      if (Number.isFinite(t) && Number.isFinite(g) && g > 0) return t / g;
    }
    return null;
  };

  const hFor = parseAverage(homeStats, 'for', 'home');
  const hAgainst = parseAverage(homeStats, 'against', 'home');
  const aFor = parseAverage(awayStats, 'for', 'away');
  const aAgainst = parseAverage(awayStats, 'against', 'away');

  if (hFor != null) homeAttack = hFor;
  if (hAgainst != null) homeDefense = hAgainst;
  if (aFor != null) awayAttack = aFor;
  if (aAgainst != null) awayDefense = aAgainst;

  // Form (0-100)
  const homeForm = calculateFormScore(homeStanding?.form);
  const awayForm = calculateFormScore(awayStanding?.form);

  // H2H adjustment — rugby örneklemi görece küçük, etki ±3 sayıyla sınırlı
  let h2hAdjustHome = 0;
  let h2hAdjustAway = 0;
  if (h2h.length >= 2) {
    const h2hA = analyzeH2H(h2h, game.teams.home.id);
    const rateDiff = h2hA.homeWinRate - h2hA.awayWinRate;
    h2hAdjustHome = rateDiff * 3.0; // ~±3 sayı
    h2hAdjustAway = -rateDiff * 2.0; // ~±2 sayı zıt yönde
  }

  const formFactor = homeForm > 0 && awayForm > 0 ? homeForm / awayForm : 1;
  const adv = cfg.homeAdvantage;

  // Expected scores:
  //   home = (homeAttack + awayDefense)/2 * advantage * formFactor^0.18 + h2h
  //   away = (awayAttack + homeDefense)/2 / formFactor^0.12           + h2h
  // Safety floor = 6 (rugby'de 6'dan az skor oldukça nadirdir)
  const expectedHome = Math.max(
    6,
    ((homeAttack + awayDefense) / 2) * adv * Math.pow(formFactor, 0.18) + h2hAdjustHome
  );
  const expectedAway = Math.max(
    6,
    ((awayAttack + homeDefense) / 2) / Math.pow(formFactor, 0.12) + h2hAdjustAway
  );

  // Varyans ayarı: form farkı büyükse belirsizliği biraz azalt, küçükse artır
  const formDelta = Math.abs(homeForm - awayForm);
  const stdScale = Math.max(0.85, Math.min(1.15, 1 - (formDelta - 15) * 0.005));
  const stdHome = baseStd * stdScale;
  const stdAway = baseStd * stdScale;

  // Standart Over/Under ve Handikap hatları (config belirtiminden)
  const ouLines = [35.5, 40.5, 45.5, 50.5, 55.5, 60.5];
  const handicapLines = [
    -14.5, -10.5, -7.5, -5.5, -3.5, -1.5,
    1.5, 3.5, 5.5, 7.5, 10.5, 14.5,
  ];

  const outcomes = deriveNormalOutcomes(expectedHome, expectedAway, stdHome, stdAway, {
    ouLines,
    handicapLines,
    drawBuffer: RUGBY_DRAW_BUFFER,
  });

  // En olası skor kombinasyonları (Normal integer grid)
  const mostLikelyScores = computeMostLikelyScores(
    expectedHome,
    expectedAway,
    stdHome,
    stdAway,
    80,
    15
  );

  // Confidence: veri miktarı & uyum ile artar
  let confidence = 40;
  if (homeStats) confidence += 15;
  if (awayStats) confidence += 15;
  if (h2h.length >= 2) confidence += 10;
  if (homeStanding) confidence += 7.5;
  if (awayStanding) confidence += 7.5;
  confidence = Math.min(92, confidence);

  const overUnderOut: Record<string, { over: number; under: number }> = {};
  Object.entries(outcomes.overUnder).forEach(([k, v]) => {
    overUnderOut[String(k)] = v;
  });

  const handicapsOut: Record<string, { home: number; away: number; push?: number }> = {};
  Object.entries(outcomes.handicaps).forEach(([k, v]) => {
    handicapsOut[String(k)] = v;
  });

  return {
    homeWinProb: outcomes.homeWin * 100,
    drawProb: outcomes.draw * 100,
    awayWinProb: outcomes.awayWin * 100,
    expectedHomeScore: expectedHome,
    expectedAwayScore: expectedAway,
    expectedTotalScore: expectedHome + expectedAway,
    overUnder: overUnderOut,
    mostLikelyScores,
    handicaps: handicapsOut,
    confidence,
    homeForm,
    awayForm,
  };
}

// ===== MARKET EVALUATOR =====
/**
 * API bet adı + seçim -> gerçek olasılık (0-1).
 * Desteklenmeyen pazar için 0 döner.
 */
function evaluateMarket(params: {
  prediction: Prediction;
  betName: string;
  selection: string;
  game: NormalizedGame;
}): number {
  const { prediction, betName, selection } = params;
  const name = betName.toLowerCase().trim();
  const sel = selection.trim();
  const selLower = sel.toLowerCase();

  // Match Winner (3-way including draw)
  if (
    name === 'match winner' ||
    name === '3-way result' ||
    name === '3way result' ||
    name === '1x2'
  ) {
    if (selLower === 'home' || sel === '1') return prediction.homeWinProb / 100;
    if (selLower === 'draw' || sel === 'x') return prediction.drawProb / 100;
    if (selLower === 'away' || sel === '2') return prediction.awayWinProb / 100;
  }

  // Home/Away (Draw No Bet) — beraberlikte iade (push)
  if (name === 'home/away' || name === 'draw no bet') {
    const total = prediction.homeWinProb + prediction.awayWinProb;
    if (total <= 0) return 0;
    if (selLower === 'home' || sel === '1') return prediction.homeWinProb / total;
    if (selLower === 'away' || sel === '2') return prediction.awayWinProb / total;
  }

  // Over/Under (toplam sayı)
  if (
    name === 'over/under' ||
    name === 'total' ||
    name === 'total points' ||
    name === 'game total'
  ) {
    const m = sel.match(/(Over|Under)\s+(\d+(?:\.\d+)?)/i);
    if (m) {
      const dir = m[1].toLowerCase();
      const line = parseFloat(m[2]);
      const ou = prediction.overUnder[String(line)];
      if (ou) return dir === 'over' ? ou.over : ou.under;
      // Ad-hoc fallback
      return computeAdHocOverUnder(prediction, line, dir as 'over' | 'under');
    }
  }

  // Standard Handicap (3-way: home / draw / away with line, push=draw when exact)
  if (
    (name === 'handicap' || name.includes('handicap')) &&
    !name.includes('asian') &&
    !name.includes('half')
  ) {
    const m = sel.match(/(Home|Away)\s*([-+]?\d+(?:\.\d+)?)/i);
    if (m) {
      const side = m[1].toLowerCase();
      const line = parseFloat(m[2]);
      const hc = prediction.handicaps?.[String(line)];
      if (hc) {
        return side === 'home' ? hc.home : hc.away;
      }
      return computeAdHocHandicap(prediction, side === 'home', line);
    }
  }

  // Asian Handicap — push'u renormalize ederek 2-way
  if (name === 'asian handicap' || name.includes('asian handicap')) {
    const m = sel.match(/(Home|Away)\s*([-+]?\d+(?:\.\d+)?)/i);
    if (m) {
      const side = m[1].toLowerCase();
      const line = parseFloat(m[2]);
      const hc = prediction.handicaps?.[String(line)];
      if (hc) {
        const totalNonPush = (hc.home ?? 0) + (hc.away ?? 0);
        if (totalNonPush <= 0) return 0;
        return side === 'home' ? hc.home / totalNonPush : hc.away / totalNonPush;
      }
      // Fallback: renormalize ad-hoc handicap probabilities
      const pHome = computeAdHocHandicap(prediction, true, line);
      const pAway = computeAdHocHandicap(prediction, false, line);
      const total = pHome + pAway;
      if (total <= 0) return 0;
      return side === 'home' ? pHome / total : pAway / total;
    }
  }

  // Odd/Even (toplam sayı tek/çift)
  if (name === 'odd/even' || name === 'total odd/even') {
    let oddProb = 0;
    let evenProb = 0;
    for (const s of prediction.mostLikelyScores) {
      if ((s.home + s.away) % 2 === 1) oddProb += s.probability;
      else evenProb += s.probability;
    }
    const total = oddProb + evenProb;
    if (total <= 0) return 0;
    if (selLower === 'odd') return oddProb / total;
    if (selLower === 'even') return evenProb / total;
  }

  return 0;
}

function computeAdHocOverUnder(
  prediction: Prediction,
  line: number,
  dir: 'over' | 'under'
): number {
  const std = rugbyConfig.scoreStdDev ?? 11;
  const stdTotal = Math.sqrt(2) * std;
  const pOver = normalSurvival(line, prediction.expectedTotalScore, stdTotal);
  return dir === 'over' ? pOver : 1 - pOver;
}

function computeAdHocHandicap(
  prediction: Prediction,
  isHome: boolean,
  line: number
): number {
  const std = rugbyConfig.scoreStdDev ?? 11;
  const stdMargin = Math.sqrt(2) * std;
  const meanMargin = prediction.expectedHomeScore - prediction.expectedAwayScore;
  if (isHome) {
    // Home wins handicap if margin + line > drawBuffer
    return normalSurvival(-line + RUGBY_DRAW_BUFFER, meanMargin, stdMargin);
  }
  // Away wins handicap if margin + line < -drawBuffer
  return normalCdf(-line - RUGBY_DRAW_BUFFER, meanMargin, stdMargin);
}

// ===== BET RESULT EVALUATOR =====
function evaluateBetResult(params: {
  betName: string;
  selection: string;
  game: NormalizedGame;
}): 'won' | 'lost' | 'void' | 'pending' {
  const { betName, selection, game } = params;
  if (!game.status.finished) return 'pending';
  if (game.scores.home == null || game.scores.away == null) return 'pending';

  const h = game.scores.home;
  const a = game.scores.away;
  const total = h + a;
  const name = betName.toLowerCase().trim();
  const sel = selection.trim();
  const selLower = sel.toLowerCase();

  // Match Winner (3-way including draw)
  if (
    name === 'match winner' ||
    name === '3-way result' ||
    name === '3way result' ||
    name === '1x2'
  ) {
    if (selLower === 'home' || sel === '1') return h > a ? 'won' : 'lost';
    if (selLower === 'draw' || sel === 'x') return h === a ? 'won' : 'lost';
    if (selLower === 'away' || sel === '2') return a > h ? 'won' : 'lost';
  }

  // Home/Away (Draw No Bet) — beraberlikte iade
  if (name === 'home/away' || name === 'draw no bet') {
    if (h === a) return 'void';
    if (selLower === 'home' || sel === '1') return h > a ? 'won' : 'lost';
    if (selLower === 'away' || sel === '2') return a > h ? 'won' : 'lost';
  }

  // Over/Under
  if (
    name === 'over/under' ||
    name === 'total' ||
    name === 'total points' ||
    name === 'game total'
  ) {
    const m = sel.match(/(Over|Under)\s+(\d+(?:\.\d+)?)/i);
    if (m) {
      const dir = m[1].toLowerCase();
      const line = parseFloat(m[2]);
      if (total === line) return 'void';
      if (dir === 'over') return total > line ? 'won' : 'lost';
      return total < line ? 'won' : 'lost';
    }
  }

  // Handicap / Asian Handicap (same settlement rule — both use added-line margin)
  if (name.includes('handicap')) {
    const m = sel.match(/(Home|Away)\s*([-+]?\d+(?:\.\d+)?)/i);
    if (m) {
      const side = m[1].toLowerCase();
      const line = parseFloat(m[2]);
      const adjusted = side === 'home' ? h + line - a : a + line - h;
      if (adjusted > 0) return 'won';
      if (adjusted < 0) return 'lost';
      return 'void';
    }
  }

  // Odd/Even
  if (name === 'odd/even' || name === 'total odd/even') {
    if (selLower === 'odd') return total % 2 === 1 ? 'won' : 'lost';
    if (selLower === 'even') return total % 2 === 0 ? 'won' : 'lost';
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
  const res = await client.fetch<any[]>('games', { live: 'all' }, 60_000);
  return (res.response || []).map(normalizeGame);
}

async function getOddsForGame(gameId: number): Promise<NormalizedOdds | null> {
  const res = await client.fetch<any[]>('odds', { game: gameId });
  const o = res.response?.[0];
  return o ? normalizeOdds(o) : null;
}

async function getH2H(
  homeTeamId: number,
  awayTeamId: number,
  season?: number
): Promise<NormalizedGame[]> {
  const params: Record<string, string | number> = { h2h: `${homeTeamId}-${awayTeamId}` };
  if (season) params.season = season;
  const res = await client.fetch<any[]>('games/h2h', params);
  return (res.response || []).map(normalizeGame);
}

async function getStandings(leagueId: number, season: number): Promise<any[]> {
  const res = await client.fetch<any[]>('standings', { league: leagueId, season });
  const raw: any = res.response;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    // API v1 rugby standings bazen grup dizisi (ör. conference) döndürür
    if (raw.length > 0 && Array.isArray(raw[0])) {
      return (raw as any[][]).flat();
    }
    return raw;
  }
  return [];
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

// ===== PLUGIN EXPORT =====
export const rugbyPlugin: SportPlugin = {
  config: rugbyConfig,
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

export default rugbyPlugin;
