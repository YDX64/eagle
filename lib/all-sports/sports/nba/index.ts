/**
 * NBA Sport Plugin
 * v2.nba.api-sports.io (NBA-specific v2 API)
 *
 * Karakteristik:
 * - Yüksek skorlu (~115-112 ortalama, toplam ~227)
 * - Beraberlik yok (uzatma ile sonuç kesin)
 * - Normal dağılım bazlı tahmin (Poisson değil)
 * - Standart sapma takım başına ~13 sayı
 * - 4 çeyrek (12 dk her biri) + uzatma (5 dk)
 *
 * NBA API v2 Format Farkları:
 * - game.teams.visitors (home değil, away ekip)
 * - game.scores.visitors.points / game.scores.home.points
 * - status.short: "Scheduled" | "InPlay" | "Finished" veya "0"/"1"/"2"
 * - game.date.start (ISO)
 */

import type {
  SportPlugin,
  NormalizedGame,
  Prediction,
  NormalizedOdds,
} from '../_core/types';
import { SportApiClient, deriveNormalOutcomes, normalCdf, normalSurvival, calculateFormScore, analyzeH2H } from '../_core';
import { nbaConfig } from './config';

const client = new SportApiClient(nbaConfig.apiBase, nbaConfig.apiKey);

// Over/Under ve handikap hatları (NBA için tipik iddaa çizgileri)
const NBA_OU_LINES = [210.5, 215.5, 220.5, 225.5, 227.5, 230.5, 235.5, 240.5];
const NBA_HANDICAP_LINES = [-15.5, -10.5, -7.5, -5.5, -3.5, -1.5, 1.5, 3.5, 5.5, 7.5, 10.5, 15.5];

// ===== NORMALIZER =====
/**
 * NBA API v2 game objesini ortak NormalizedGame'e çevirir.
 * NBA'de "visitors" = away team. Dikkat: status.short farklı formatta gelebilir.
 */
function normalizeGame(g: any): NormalizedGame {
  const dateStr: string = g.date?.start || g.date || '';
  const timestamp = dateStr ? Math.floor(new Date(dateStr).getTime() / 1000) : Math.floor(Date.now() / 1000);

  const statusShort: string = String(g.status?.short ?? '');
  const statusLong: string = String(g.status?.long ?? '');
  const isLive = statusShort === 'InPlay' || statusShort === '1';
  const isFinished = statusShort === 'Finished' || statusShort === '2';
  const isUpcoming = statusShort === 'Scheduled' || statusShort === '0';

  const homeTeam = g.teams?.home ?? {};
  const awayTeam = g.teams?.visitors ?? g.teams?.away ?? {};

  const homePoints = g.scores?.home?.points ?? g.scores?.home ?? null;
  const awayPoints = g.scores?.visitors?.points ?? g.scores?.away?.points ?? g.scores?.away ?? null;

  return {
    id: g.id,
    sport: 'nba',
    date: dateStr,
    timestamp,
    status: {
      short: statusShort,
      long: statusLong,
      live: isLive,
      finished: isFinished,
      upcoming: isUpcoming,
    },
    league: {
      id: g.league?.id ?? 12,
      name: g.league?.name ?? 'NBA',
      season: g.season ?? g.league?.season ?? new Date().getFullYear(),
    },
    teams: {
      home: {
        id: homeTeam.id,
        name: homeTeam.name ?? homeTeam.nickname ?? '',
        logo: homeTeam.logo,
      },
      away: {
        id: awayTeam.id,
        name: awayTeam.name ?? awayTeam.nickname ?? '',
        logo: awayTeam.logo,
      },
    },
    scores: {
      home: typeof homePoints === 'number' ? homePoints : (homePoints != null ? Number(homePoints) : null),
      away: typeof awayPoints === 'number' ? awayPoints : (awayPoints != null ? Number(awayPoints) : null),
    },
    periods: {
      q1: g.scores?.home?.linescore?.[0] != null && g.scores?.visitors?.linescore?.[0] != null
        ? `${g.scores.home.linescore[0]}-${g.scores.visitors.linescore[0]}`
        : null,
      q2: g.scores?.home?.linescore?.[1] != null && g.scores?.visitors?.linescore?.[1] != null
        ? `${g.scores.home.linescore[1]}-${g.scores.visitors.linescore[1]}`
        : null,
      q3: g.scores?.home?.linescore?.[2] != null && g.scores?.visitors?.linescore?.[2] != null
        ? `${g.scores.home.linescore[2]}-${g.scores.visitors.linescore[2]}`
        : null,
      q4: g.scores?.home?.linescore?.[3] != null && g.scores?.visitors?.linescore?.[3] != null
        ? `${g.scores.home.linescore[3]}-${g.scores.visitors.linescore[3]}`
        : null,
    },
  };
}

/**
 * NBA odds formatını ortak NormalizedOdds'a çevirir.
 * NBA odds endpoint bookmakers dizisi döndürür; football ile aynı şekilde ele alınır.
 */
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

// ===== TEAM STATS HELPERS =====
/**
 * NBA takım istatistiklerinden ortalama sayı üretir.
 * API: teams/statistics endpoint farklı alan isimleri kullanabilir; dikkatli fallback yapılır.
 */
function extractAveragePoints(stats: any, fallback: number): { scored: number; conceded: number } {
  if (!stats) return { scored: fallback, conceded: fallback };

  // NBA API v2: stats.points.for.average / points.against.average
  const scoredAvg =
    parseFloat(stats?.points?.for?.average?.all) ||
    parseFloat(stats?.points?.for?.average) ||
    parseFloat(stats?.games?.points?.for?.average?.all) ||
    parseFloat(stats?.ppg) ||
    NaN;

  const concededAvg =
    parseFloat(stats?.points?.against?.average?.all) ||
    parseFloat(stats?.points?.against?.average) ||
    parseFloat(stats?.games?.points?.against?.average?.all) ||
    parseFloat(stats?.oppg) ||
    NaN;

  return {
    scored: Number.isFinite(scoredAvg) && scoredAvg > 0 ? scoredAvg : fallback,
    conceded: Number.isFinite(concededAvg) && concededAvg > 0 ? concededAvg : fallback,
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

  const baseHome = nbaConfig.avgScoreHome; // 115
  const baseAway = nbaConfig.avgScoreAway; // 112
  const adv = nbaConfig.homeAdvantage;     // 1.04
  const stdDev = nbaConfig.scoreStdDev ?? 13;

  // Takım istatistiklerinden attack/defense ortalamaları
  const homeAvg = extractAveragePoints(homeStats, baseHome);
  const awayAvg = extractAveragePoints(awayStats, baseAway);

  // Form skoru (standing.form stringi varsa)
  const homeForm = calculateFormScore(homeStanding?.form);
  const awayForm = calculateFormScore(awayStanding?.form);
  const formFactor = homeForm > 0 && awayForm > 0 ? homeForm / awayForm : 1;

  // H2H analizine göre hafif ayarlama
  let h2hAdjust = 0;
  if (h2h && h2h.length > 0) {
    const h2hAnalysis = analyzeH2H(h2h, game.teams.home.id);
    // Win rate farkı ±3 sayıya kadar etki edebilir
    h2hAdjust = (h2hAnalysis.homeWinRate - h2hAnalysis.awayWinRate) * 3;
  }

  // Expected scores: takımların attack'i ile rakibin defense'inin ortalaması + ev avantajı + form
  // Normal dağılım için beklenen değerler: skor = mean score, std dev sabit (13)
  const meanHome = Math.max(60, ((homeAvg.scored + awayAvg.conceded) / 2) * adv * Math.pow(formFactor, 0.15) + h2hAdjust);
  const meanAway = Math.max(60, ((awayAvg.scored + homeAvg.conceded) / 2) / Math.pow(formFactor, 0.08) - h2hAdjust * 0.5);

  // Normal dağılımdan olasılıkları türet
  const outcomes = deriveNormalOutcomes(meanHome, meanAway, stdDev, stdDev, {
    ouLines: NBA_OU_LINES,
    handicapLines: NBA_HANDICAP_LINES,
    drawBuffer: 0.5, // NBA'de beraberlik yok, ama normal dağılımda ince bir push aralığı
  });

  // NBA beraberlik yok: draw'u home/away'e yeniden dağıt (uzatmada kazanan belirlenir)
  const totalWin = outcomes.homeWin + outcomes.awayWin;
  const homeWinNoDraw = totalWin > 0 ? outcomes.homeWin / totalWin : 0.5;
  const awayWinNoDraw = totalWin > 0 ? outcomes.awayWin / totalWin : 0.5;

  const overUnder: Record<string, { over: number; under: number }> = {};
  Object.entries(outcomes.overUnder).forEach(([k, v]) => {
    overUnder[String(k)] = v;
  });

  const handicaps: Record<string, { home: number; away: number; push?: number }> = {};
  Object.entries(outcomes.handicaps).forEach(([k, v]) => {
    handicaps[String(k)] = v;
  });

  // "En olası skorlar" - Normal dağılımdan tam skor üretimi Poisson kadar kesin değil
  // ama en yakın tam sayılar için yoğunluk tahmini yapabiliriz.
  const mostLikelyScores: { home: number; away: number; probability: number }[] = [];
  for (let hOffset = -2; hOffset <= 2; hOffset++) {
    for (let aOffset = -2; aOffset <= 2; aOffset++) {
      const h = Math.round(meanHome + hOffset * stdDev * 0.25);
      const a = Math.round(meanAway + aOffset * stdDev * 0.25);
      if (h < 60 || a < 60) continue;
      // NBA'de tam skor olasılığı çok küçük - bucket olarak ±1 sayı içinde düşme olasılığını hesapla
      const pH = normalCdf(h + 0.5, meanHome, stdDev) - normalCdf(h - 0.5, meanHome, stdDev);
      const pA = normalCdf(a + 0.5, meanAway, stdDev) - normalCdf(a - 0.5, meanAway, stdDev);
      mostLikelyScores.push({ home: h, away: a, probability: pH * pA });
    }
  }
  mostLikelyScores.sort((a, b) => b.probability - a.probability);

  // Confidence: veri kalitesine göre
  let confidence = 40;
  if (homeStats) confidence += 15;
  if (awayStats) confidence += 15;
  if (h2h.length >= 3) confidence += 15;
  if (homeStanding) confidence += 7.5;
  if (awayStanding) confidence += 7.5;
  confidence = Math.min(95, confidence);

  return {
    homeWinProb: homeWinNoDraw * 100,
    drawProb: 0, // NBA'de beraberlik yok
    awayWinProb: awayWinNoDraw * 100,
    expectedHomeScore: meanHome,
    expectedAwayScore: meanAway,
    expectedTotalScore: meanHome + meanAway,
    overUnder,
    // NBA'de BTTS her zaman evet (her iki takım da her zaman skor atar)
    btts: { yes: 100, no: 0 },
    mostLikelyScores: mostLikelyScores.slice(0, 10),
    handicaps,
    confidence,
    homeForm,
    awayForm,
  };
}

// ===== MARKET EVALUATOR =====
/**
 * Verilen tahmin + bahis için gerçek olasılık (0-1) döner.
 * Desteklenmeyen market için 0 döner.
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

  // Home/Away ve Moneyline (NBA'de draw yok, ikisi aynı market)
  if (name === 'home/away' || name === 'moneyline' || name === 'match winner' || name === '1x2') {
    if (sel === '1' || sel.toLowerCase() === 'home') return prediction.homeWinProb / 100;
    if (sel === '2' || sel.toLowerCase() === 'away') return prediction.awayWinProb / 100;
    // NBA'de draw oldukça nadir olsa da push olarak dönebilir
    if (sel.toLowerCase() === 'draw' || sel === 'X') return prediction.drawProb / 100;
  }

  // Over/Under
  if (name === 'over/under' || name === 'total' || name === 'total points') {
    const m = sel.match(/(Over|Under)\s+([\d.]+)/i);
    if (m) {
      const dir = m[1].toLowerCase();
      const line = parseFloat(m[2]);
      const ou = prediction.overUnder[String(line)];
      if (ou) return dir === 'over' ? ou.over : ou.under;
      // Eğer tam eşleşen hat yoksa en yakını bul
      const availableLines = Object.keys(prediction.overUnder).map(parseFloat);
      if (availableLines.length > 0) {
        const closest = availableLines.reduce((a, b) => Math.abs(b - line) < Math.abs(a - line) ? b : a);
        const closestOU = prediction.overUnder[String(closest)];
        if (closestOU) return dir === 'over' ? closestOU.over : closestOU.under;
      }
    }
  }

  // Asian Handicap / Spread / Handicap (NBA'de hepsi handikap)
  if (name === 'asian handicap' || name === 'spread' || name === 'handicap' || name.includes('handicap') || name.includes('spread')) {
    const m = sel.match(/(Home|Away)\s*([-+]?[\d.]+)/i);
    if (m) {
      const side = m[1].toLowerCase();
      const line = parseFloat(m[2]);
      const hc = prediction.handicaps?.[String(line)];
      if (hc) {
        // NBA'de push çok nadir (0.5'li hatlar için neredeyse 0)
        const totalNonPush = (hc.home ?? 0) + (hc.away ?? 0);
        if (totalNonPush === 0) return 0;
        return side === 'home' ? hc.home / totalNonPush : hc.away / totalNonPush;
      }
      // Yakın hat yoksa normalCdf ile doğrudan hesapla
      const marginMean = prediction.expectedHomeScore - prediction.expectedAwayScore;
      const marginStd = Math.sqrt(2) * (nbaConfig.scoreStdDev ?? 13);
      // Home wins handicap if margin + line > 0
      if (side === 'home') return normalSurvival(-line, marginMean, marginStd);
      if (side === 'away') return normalCdf(-line, marginMean, marginStd);
    }
  }

  // Odd/Even (toplam sayı)
  if (name === 'odd/even' || name === 'odd even' || name.includes('odd/even')) {
    // Yüksek skorlu sporlarda tek/çift yaklaşık 50/50 - normal dağılımdan hesap
    // Tam olarak hesap için tam skor bucket'larını kullanabiliriz ama yaklaşım yeterli
    let oddProb = 0;
    let evenProb = 0;
    for (const s of prediction.mostLikelyScores) {
      const total = s.home + s.away;
      if (total % 2 === 1) oddProb += s.probability;
      else evenProb += s.probability;
    }
    const total = oddProb + evenProb;
    if (total > 0) {
      if (sel.toLowerCase() === 'odd') return oddProb / total;
      if (sel.toLowerCase() === 'even') return evenProb / total;
    }
    // Fallback: ~50/50
    return 0.5;
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
  if (!game.status.finished || game.scores.home === null || game.scores.away === null) {
    return 'pending';
  }

  const h = game.scores.home;
  const a = game.scores.away;
  const total = h + a;
  const name = betName.toLowerCase().trim();
  const sel = selection.trim();

  // Home/Away ve Moneyline - NBA'de draw yok
  if (name === 'home/away' || name === 'moneyline' || name === 'match winner' || name === '1x2') {
    if (sel === '1' || sel.toLowerCase() === 'home') return h > a ? 'won' : 'lost';
    if (sel === '2' || sel.toLowerCase() === 'away') return a > h ? 'won' : 'lost';
    if (sel.toLowerCase() === 'draw' || sel === 'X') return h === a ? 'won' : 'lost';
  }

  // Over/Under
  if (name === 'over/under' || name === 'total' || name === 'total points') {
    const m = sel.match(/(Over|Under)\s+([\d.]+)/i);
    if (m) {
      const dir = m[1].toLowerCase();
      const line = parseFloat(m[2]);
      if (total === line) return 'void'; // push
      return dir === 'over' ? (total > line ? 'won' : 'lost') : (total < line ? 'won' : 'lost');
    }
  }

  // Handicap / Spread / Asian Handicap
  if (name === 'asian handicap' || name === 'spread' || name === 'handicap' || name.includes('handicap') || name.includes('spread')) {
    const m = sel.match(/(Home|Away)\s*([-+]?[\d.]+)/i);
    if (m) {
      const side = m[1].toLowerCase();
      const line = parseFloat(m[2]);
      const diff = side === 'home' ? (h - a + line) : (a - h + line);
      if (diff > 0) return 'won';
      if (diff < 0) return 'lost';
      return 'void';
    }
  }

  // Odd/Even
  if (name === 'odd/even' || name === 'odd even' || name.includes('odd/even')) {
    if (sel.toLowerCase() === 'odd') return total % 2 === 1 ? 'won' : 'lost';
    if (sel.toLowerCase() === 'even') return total % 2 === 0 ? 'won' : 'lost';
  }

  return 'void';
}

// ===== API DATA FETCHERS =====
/**
 * NBA API v2: GET /games?date=YYYY-MM-DD
 */
async function getGamesByDate(date: string): Promise<NormalizedGame[]> {
  const res = await client.fetch<any[]>('games', { date });
  return (res.response || []).map(normalizeGame);
}

/**
 * NBA API v2: GET /games?id=XXX
 */
async function getGameById(id: number): Promise<NormalizedGame | null> {
  const res = await client.fetch<any[]>('games', { id });
  const g = res.response?.[0];
  return g ? normalizeGame(g) : null;
}

/**
 * NBA API v2: GET /games?live=all
 */
async function getLiveGames(): Promise<NormalizedGame[]> {
  const res = await client.fetch<any[]>('games', { live: 'all' }, 60000);
  return (res.response || []).map(normalizeGame);
}

/**
 * NBA odds endpoint. Formatı v2'de olabilir veya ayrı olabilir.
 */
async function getOddsForGame(gameId: number): Promise<NormalizedOdds | null> {
  try {
    const res = await client.fetch<any[]>('odds', { game: gameId });
    const o = res.response?.[0];
    return o ? normalizeOdds(o) : null;
  } catch {
    // Fallback: fixture parametresi ile dene
    try {
      const res = await client.fetch<any[]>('odds', { fixture: gameId });
      const o = res.response?.[0];
      return o ? normalizeOdds(o) : null;
    } catch {
      return null;
    }
  }
}

/**
 * NBA H2H: v2'de direct head-to-head yok; iki takım arasındaki maçları takım bazında çek ve filtrele.
 */
async function getH2H(homeTeamId: number, awayTeamId: number, season?: number): Promise<NormalizedGame[]> {
  try {
    const currentSeason = season ?? new Date().getFullYear();
    const seasonsToCheck = [currentSeason, currentSeason - 1];
    const allGames: NormalizedGame[] = [];

    for (const s of seasonsToCheck) {
      const res = await client.fetch<any[]>('games', { team: homeTeamId, season: s });
      const games = (res.response || []).map(normalizeGame);
      // Sadece her iki takımı içeren maçları al
      const h2hGames = games.filter(g =>
        (g.teams.home.id === homeTeamId && g.teams.away.id === awayTeamId) ||
        (g.teams.home.id === awayTeamId && g.teams.away.id === homeTeamId)
      );
      allGames.push(...h2hGames);
    }

    // Son maçları önce getir, maksimum 10
    return allGames
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10);
  } catch (err) {
    console.warn('NBA H2H fetch failed:', err);
    return [];
  }
}

/**
 * NBA standings: v2 endpoint formatı farklı.
 */
async function getStandings(leagueId: number, season: number): Promise<any[]> {
  try {
    const res = await client.fetch<any>('standings', { league: leagueId, season });
    // NBA v2 standings response yapısı league'a göre değişebilir
    const raw = res.response;
    if (Array.isArray(raw)) return raw;
    if (raw?.standings) return Array.isArray(raw.standings) ? raw.standings : [raw.standings];
    return [];
  } catch (err) {
    console.warn('NBA standings fetch failed:', err);
    return [];
  }
}

/**
 * NBA team statistics.
 */
async function getTeamStatistics(teamId: number, leagueId: number, season: number): Promise<any> {
  try {
    const res = await client.fetch<any>('teams/statistics', { id: teamId, league: leagueId, season });
    return res.response;
  } catch (err) {
    console.warn('NBA team stats fetch failed:', err);
    return null;
  }
}

// ===== PLUGIN EXPORT =====
export const nbaPlugin: SportPlugin = {
  config: nbaConfig,
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
