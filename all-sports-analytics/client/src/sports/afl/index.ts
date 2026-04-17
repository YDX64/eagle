/**
 * Australian Football League (AFL) Sport Plugin
 * v1.afl.api-sports.io
 *
 * Karakteristik:
 * - ~170 toplam sayı (ev ~90, deplasman ~82)
 * - Yüksek varyans (stdDev ~18/takım) -> Normal dağılım doğru seçim
 * - Beraberlik nadir ama mümkün (drawBuffer=0.5)
 * - 4 çeyrek, ev avantajı ~%7
 * - Handikap (Line), Over/Under, Asian Handicap en popüler pazarlar
 *
 * Bu plugin American Football adapter'ının Normal distribution
 * template'ini kullanır, AFL'e özgü parametrelerle kalibre edilmiştir.
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
  deriveNormalOutcomes,
  normalPdf,
  normalCdf,
  normalSurvival,
} from '../_core';
import { aflConfig } from './config';

const client = new SportApiClient(aflConfig.apiBase, aflConfig.apiKey);

// ===== NORMALIZER =====
// AFL api-sports.io response yapısı American Football ile paraleldir:
// { game: {id, date:{date,timestamp}, status:{short,long}, week, league:{...},
//           teams:{home,away}, scores:{home:{quarter_1..4, total}, away:{...}}} }
function normalizeGame(raw: any): NormalizedGame {
  // API varyasyonuna toleranslı ayıklama
  const g = raw.game ?? raw;
  const gameId = g.id ?? raw.id;

  const statusRaw = g.status ?? raw.status ?? {};
  const short = String(statusRaw.short ?? '').toUpperCase();
  const long = String(statusRaw.long ?? '');

  const liveCodes = ['Q1', 'Q2', 'Q3', 'Q4', 'QT', 'OT', 'HT', 'IP', 'LIVE', 'BT'];
  const finishedCodes = ['FT', 'AOT', 'AET', 'PST', 'FINISHED'];

  const dateInfo = g.date ?? raw.date ?? {};
  const isoDate = typeof dateInfo === 'string' ? dateInfo : (dateInfo.date ?? '');
  const tsSeconds =
    typeof dateInfo === 'object' && dateInfo.timestamp
      ? Number(dateInfo.timestamp)
      : Math.floor(new Date(isoDate).getTime() / 1000);

  const league = g.league ?? raw.league ?? {};
  const teams = g.teams ?? raw.teams ?? {};
  const scores = g.scores ?? raw.scores ?? {};

  const homeTotal = extractFinalScore(scores.home);
  const awayTotal = extractFinalScore(scores.away);

  return {
    id: Number(gameId),
    sport: 'afl',
    date: isoDate,
    timestamp: tsSeconds,
    status: {
      short,
      long,
      live: liveCodes.includes(short),
      finished: finishedCodes.includes(short) || long.toLowerCase().includes('finished'),
      upcoming: short === 'NS' || short === 'TBD' || short === '',
    },
    league: {
      id: Number(league.id ?? 0),
      name: league.name ?? '',
      logo: league.logo,
      country: typeof league.country === 'string' ? league.country : league.country?.name,
      season: league.season ?? new Date().getFullYear(),
    },
    teams: {
      home: {
        id: Number(teams.home?.id ?? 0),
        name: teams.home?.name ?? '',
        logo: teams.home?.logo,
      },
      away: {
        id: Number(teams.away?.id ?? 0),
        name: teams.away?.name ?? '',
        logo: teams.away?.logo,
      },
    },
    scores: {
      home: homeTotal,
      away: awayTotal,
    },
    periods: {
      quarter_1: formatQuarter(scores, 'quarter_1'),
      quarter_2: formatQuarter(scores, 'quarter_2'),
      quarter_3: formatQuarter(scores, 'quarter_3'),
      quarter_4: formatQuarter(scores, 'quarter_4'),
      overtime: formatQuarter(scores, 'overtime'),
    },
  };
}

function extractFinalScore(side: any): number | null {
  if (side == null) return null;
  if (typeof side === 'number') return side;
  if (typeof side === 'object') {
    // AFL skorları `score` / `total` / `goals` + `behinds` gibi çeşitli şekillerde gelebilir.
    // Önce "total" / "score" alanını dener.
    if (side.total != null) return Number(side.total);
    if (side.score != null) return Number(side.score);
    // AFL tipik score format: 6 goals + 10 behinds = 6*6 + 10 = 46 points
    if (side.goals != null && side.behinds != null) {
      return Number(side.goals) * 6 + Number(side.behinds);
    }
    // Çeyrek bazında topla
    const parts = ['quarter_1', 'quarter_2', 'quarter_3', 'quarter_4', 'overtime']
      .map((k) => (side[k] != null ? Number(side[k]) : null))
      .filter((v): v is number => v != null && !Number.isNaN(v));
    if (parts.length === 0) return null;
    return parts.reduce((a, b) => a + b, 0);
  }
  return null;
}

function formatQuarter(scores: any, key: string): string | null {
  const h = scores?.home?.[key];
  const a = scores?.away?.[key];
  if (h == null && a == null) return null;
  return `${h ?? 0}-${a ?? 0}`;
}

function normalizeOdds(raw: any): NormalizedOdds {
  const g = raw.game ?? raw;
  const gameId = Number(g.id ?? raw.id ?? 0);
  const bookmakers = raw.bookmakers ?? [];

  return {
    gameId,
    bookmakers: bookmakers.map((bm: any) => ({
      id: Number(bm.id ?? 0),
      name: String(bm.name ?? ''),
      bets: (bm.bets ?? []).map((bet: any) => ({
        id: Number(bet.id ?? 0),
        name: String(bet.name ?? ''),
        values: (bet.values ?? []).map((v: any) => ({
          value: String(v.value),
          odd: parseFloat(v.odd),
        })),
      })),
    })),
  };
}

// ===== MOST LIKELY SCORES (Normal-based discrete grid) =====
/**
 * AFL tipik skor aralığı 50-150 puan/takım (total ~170).
 * Joint PDF ≈ pdf(home) * pdf(away) bağımsızlık varsayımı.
 * 5'er puan ızgarasında çalışır (AFL'de tek sayılı skorlar "behind" ile oluşur,
 * 5 puan aralıkları algoritmik olarak daha verimli ve anlamlı).
 */
function computeMostLikelyScores(
  meanHome: number,
  meanAway: number,
  stdHome: number,
  stdAway: number,
  maxScore: number = 180,
  step: number = 5,
  topN: number = 12
): { home: number; away: number; probability: number }[] {
  const scores: { home: number; away: number; probability: number }[] = [];
  for (let h = 0; h <= maxScore; h += step) {
    const pH = normalCdf(h + step / 2, meanHome, stdHome) - normalCdf(h - step / 2, meanHome, stdHome);
    if (pH < 1e-5) continue;
    for (let a = 0; a <= maxScore; a += step) {
      const pA = normalCdf(a + step / 2, meanAway, stdAway) - normalCdf(a - step / 2, meanAway, stdAway);
      if (pA < 1e-5) continue;
      scores.push({ home: h, away: a, probability: pH * pA });
    }
  }
  scores.sort((a, b) => b.probability - a.probability);
  return scores.slice(0, topN);
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

  const cfg = aflConfig;
  const baseStd = cfg.scoreStdDev ?? 18;

  // Takım istatistikleri yoksa config varsayılanları
  let homeAttack = cfg.avgScoreHome;
  let homeDefense = cfg.avgScoreAway;
  let awayAttack = cfg.avgScoreAway;
  let awayDefense = cfg.avgScoreHome;
  let stdHome = baseStd;
  let stdAway = baseStd;

  // API istatistiklerinden atak/savunma ortalamalarını türet.
  // AFL teams/statistics endpoint'i points_for / points_against döndürür.
  const parseStat = (s: any, key: 'for' | 'against'): number | null => {
    if (!s) return null;
    const raw =
      s?.points?.[key]?.average ??
      s?.points?.[key]?.per_game ??
      s?.[key]?.average ??
      s?.scoring?.[key]?.average ??
      null;
    if (raw == null) return null;
    const n = typeof raw === 'string' ? parseFloat(raw) : Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  const homeFor = parseStat(homeStats, 'for');
  const homeAgainst = parseStat(homeStats, 'against');
  const awayFor = parseStat(awayStats, 'for');
  const awayAgainst = parseStat(awayStats, 'against');

  if (homeFor != null) homeAttack = homeFor;
  if (homeAgainst != null) homeDefense = homeAgainst;
  if (awayFor != null) awayAttack = awayFor;
  if (awayAgainst != null) awayDefense = awayAgainst;

  // Form skoru (0-100)
  const homeForm = calculateFormScore(homeStanding?.form);
  const awayForm = calculateFormScore(awayStanding?.form);

  // H2H ayarı (AFL'de ~%6-7 sayı etkisi makul)
  let h2hAdjust = 0;
  if (h2h.length >= 2) {
    const h2hA = analyzeH2H(h2h, game.teams.home.id);
    h2hAdjust = (h2hA.homeWinRate - h2hA.awayWinRate) * 5.0; // +- ~5 sayı etki
  }

  const formFactor = homeForm > 0 && awayForm > 0 ? homeForm / awayForm : 1;
  const adv = cfg.homeAdvantage;

  // Beklenen skor: (kendi saldırısı + rakibin savunması) / 2, ev avantajı ve form düzeltmesi
  const expectedHome = Math.max(
    30,
    ((homeAttack + awayDefense) / 2) * adv * Math.pow(formFactor, 0.15) + h2hAdjust
  );
  const expectedAway = Math.max(
    30,
    ((awayAttack + homeDefense) / 2) / Math.pow(formFactor, 0.08) - h2hAdjust * 0.5
  );

  // Standart sapma: form farkı büyükse belirsizliği biraz azalt, küçükse artır
  const formDelta = Math.abs(homeForm - awayForm);
  const stdScale = Math.max(0.85, Math.min(1.15, 1 - (formDelta - 15) * 0.005));
  stdHome = baseStd * stdScale;
  stdAway = baseStd * stdScale;

  // Standart Over/Under ve Handikap hatları (AFL'e özgü)
  const ouLines = [150.5, 160.5, 170.5, 180.5, 190.5];
  const handicapLines = [
    -30.5, -20.5, -10.5, -5.5,
    5.5, 10.5, 20.5, 30.5,
  ];

  const outcomes = deriveNormalOutcomes(expectedHome, expectedAway, stdHome, stdAway, {
    ouLines,
    handicapLines,
    drawBuffer: 0.5, // AFL'de beraberlik çok nadir
  });

  // Exact score yaklaşığı (Normal grid, 5-puan adımları)
  const mostLikelyScores = computeMostLikelyScores(
    expectedHome,
    expectedAway,
    stdHome,
    stdAway,
    180,
    5,
    12
  );

  // Güven (confidence): veri ne kadar çok, o kadar yüksek
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

  // Match Winner (3-way: home/draw/away; AFL'de draw nadir)
  if (name === 'match winner' || name === 'full time result' || name === '1x2') {
    if (selLower === 'home' || sel === '1') return prediction.homeWinProb / 100;
    if (selLower === 'away' || sel === '2') return prediction.awayWinProb / 100;
    if (selLower === 'draw' || sel === 'x') return prediction.drawProb / 100;
  }

  // Home/Away — draw varsa push/void kabul edilir (iki sonuçlu)
  if (name === 'home/away' || name === 'to win' || name === 'winner') {
    const total = prediction.homeWinProb + prediction.awayWinProb;
    if (total <= 0) return 0;
    if (selLower === 'home' || sel === '1') return prediction.homeWinProb / total;
    if (selLower === 'away' || sel === '2') return prediction.awayWinProb / total;
  }

  // Moneyline (ML)
  if (name === 'moneyline' || name === 'money line' || name === 'ml') {
    const total = prediction.homeWinProb + prediction.awayWinProb;
    if (total <= 0) return 0;
    if (selLower === 'home' || sel === '1') return prediction.homeWinProb / total;
    if (selLower === 'away' || sel === '2') return prediction.awayWinProb / total;
  }

  // Handicap / Asian Handicap / Line
  if (
    name === 'handicap' ||
    name === 'asian handicap' ||
    name === 'line' ||
    name === 'point spread' ||
    name === 'spread' ||
    name.includes('handicap') ||
    name.includes('spread')
  ) {
    const match = sel.match(/(Home|Away)\s*([-+]?\d+(?:\.\d+)?)/i);
    if (match) {
      const side = match[1].toLowerCase();
      const line = parseFloat(match[2]);
      const hc = prediction.handicaps?.[String(line)];
      if (hc) {
        const totalNonPush = (hc.home ?? 0) + (hc.away ?? 0);
        if (totalNonPush === 0) return 0;
        return side === 'home' ? hc.home / totalNonPush : hc.away / totalNonPush;
      }
    }
  }

  // Over/Under (toplam sayı)
  if (
    name === 'over/under' ||
    name === 'total' ||
    name === 'total points' ||
    name === 'game total' ||
    name === 'total score'
  ) {
    const match = sel.match(/(Over|Under)\s+(\d+(?:\.\d+)?)/i);
    if (match) {
      const dir = match[1].toLowerCase();
      const line = parseFloat(match[2]);
      const ou = prediction.overUnder[String(line)];
      if (ou) return dir === 'over' ? ou.over : ou.under;
      // Line sunulmadıysa anında Normal ile hesapla
      return computeAdHocOverUnder(prediction, line, dir as 'over' | 'under');
    }
  }

  // Team Total (ev / deplasman için ayrı O/U)
  if (
    name === 'team total' ||
    name === 'total - home' ||
    name === 'total - away' ||
    name === 'home total' ||
    name === 'away total'
  ) {
    const match = sel.match(/(Home|Away)?\s*(Over|Under)\s+(\d+(?:\.\d+)?)/i);
    if (match) {
      const explicitSide = match[1]?.toLowerCase();
      const isHome =
        explicitSide === 'home' ||
        name.includes('home') ||
        (!explicitSide && name === 'total - home');
      const dir = match[2].toLowerCase();
      const line = parseFloat(match[3]);

      const mean = isHome ? prediction.expectedHomeScore : prediction.expectedAwayScore;
      const std = estimateTeamStd();
      const pOver = normalSurvival(line, mean, std);
      return dir === 'over' ? pOver : 1 - pOver;
    }
  }

  // Odd/Even (toplam skor tek/çift)
  if (name === 'odd/even' || name === 'total odd/even') {
    let oddProb = 0;
    let evenProb = 0;
    for (const s of prediction.mostLikelyScores) {
      if ((s.home + s.away) % 2 === 1) oddProb += s.probability;
      else evenProb += s.probability;
    }
    const total = oddProb + evenProb;
    if (total <= 0) return 0.5; // AFL skorları 5-puan ızgarasında olduğu için net tek/çift ayrımı yok
    if (selLower === 'odd') return oddProb / total;
    if (selLower === 'even') return evenProb / total;
  }

  // 1st Quarter Winner (AFL'de her çeyrek önemli)
  if (
    name === '1st quarter winner' ||
    name === 'first quarter winner' ||
    name === 'quarter 1 winner'
  ) {
    // AFL'de ~%25 toplam skor 1. çeyrekte atılır
    const qShare = 0.25;
    const qHome = prediction.expectedHomeScore * qShare;
    const qAway = prediction.expectedAwayScore * qShare;
    const baseStd = aflConfig.scoreStdDev ?? 18;
    const qStd = baseStd * Math.sqrt(qShare);
    const meanMargin = qHome - qAway;
    const stdMargin = Math.sqrt(2) * qStd;

    if (selLower === 'home' || sel === '1') return normalSurvival(0.5, meanMargin, stdMargin);
    if (selLower === 'away' || sel === '2') return normalCdf(-0.5, meanMargin, stdMargin);
    if (selLower === 'draw' || selLower === 'tie' || sel === 'x') {
      return normalCdf(0.5, meanMargin, stdMargin) - normalCdf(-0.5, meanMargin, stdMargin);
    }
  }

  return 0;
}

function computeAdHocOverUnder(
  prediction: Prediction,
  line: number,
  dir: 'over' | 'under'
): number {
  const std = aflConfig.scoreStdDev ?? 18;
  const stdTotal = Math.sqrt(2) * std;
  const pOver = normalSurvival(line, prediction.expectedTotalScore, stdTotal);
  return dir === 'over' ? pOver : 1 - pOver;
}

function estimateTeamStd(): number {
  return aflConfig.scoreStdDev ?? 18;
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

  // Match Winner (beraberlik tam sonuç)
  if (name === 'match winner' || name === 'full time result' || name === '1x2') {
    if (selLower === 'home' || sel === '1') return h > a ? 'won' : 'lost';
    if (selLower === 'away' || sel === '2') return a > h ? 'won' : 'lost';
    if (selLower === 'draw' || sel === 'x') return h === a ? 'won' : 'lost';
  }

  // Home/Away — beraberlikte push (void)
  if (name === 'home/away' || name === 'to win' || name === 'winner') {
    if (h === a) return 'void';
    if (selLower === 'home' || sel === '1') return h > a ? 'won' : 'lost';
    if (selLower === 'away' || sel === '2') return a > h ? 'won' : 'lost';
  }

  // Moneyline
  if (name === 'moneyline' || name === 'money line' || name === 'ml') {
    if (h === a) return 'void';
    if (selLower === 'home' || sel === '1') return h > a ? 'won' : 'lost';
    if (selLower === 'away' || sel === '2') return a > h ? 'won' : 'lost';
  }

  // Handicap / Asian Handicap / Spread
  if (
    name === 'handicap' ||
    name === 'asian handicap' ||
    name === 'line' ||
    name === 'point spread' ||
    name === 'spread' ||
    name.includes('handicap') ||
    name.includes('spread')
  ) {
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

  // Over/Under
  if (
    name === 'over/under' ||
    name === 'total' ||
    name === 'total points' ||
    name === 'game total' ||
    name === 'total score'
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

  // Team Total
  if (
    name === 'team total' ||
    name === 'total - home' ||
    name === 'total - away' ||
    name === 'home total' ||
    name === 'away total'
  ) {
    const m = sel.match(/(Home|Away)?\s*(Over|Under)\s+(\d+(?:\.\d+)?)/i);
    if (m) {
      const explicit = m[1]?.toLowerCase();
      const isHome =
        explicit === 'home' ||
        name.includes('home') ||
        (!explicit && name === 'total - home');
      const dir = m[2].toLowerCase();
      const line = parseFloat(m[3]);
      const teamScore = isHome ? h : a;
      if (teamScore === line) return 'void';
      if (dir === 'over') return teamScore > line ? 'won' : 'lost';
      return teamScore < line ? 'won' : 'lost';
    }
  }

  // 1st Quarter Winner
  if (
    name === '1st quarter winner' ||
    name === 'first quarter winner' ||
    name === 'quarter 1 winner'
  ) {
    const q1 = game.periods?.quarter_1;
    if (!q1) return 'pending';
    const parts = q1.split('-').map((s) => parseInt(s.trim(), 10));
    if (parts.length !== 2 || parts.some(Number.isNaN)) return 'pending';
    const [qh, qa] = parts;
    if (selLower === 'home' || sel === '1') {
      if (qh === qa) return 'void';
      return qh > qa ? 'won' : 'lost';
    }
    if (selLower === 'away' || sel === '2') {
      if (qh === qa) return 'void';
      return qa > qh ? 'won' : 'lost';
    }
    if (selLower === 'draw' || selLower === 'tie' || sel === 'x') {
      return qh === qa ? 'won' : 'lost';
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
  const resp: any = res.response;
  if (!resp) return [];
  if (Array.isArray(resp)) {
    if (resp.length > 0 && Array.isArray(resp[0])) {
      return (resp as any[][]).flat();
    }
    return resp;
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

// Normal PDF'i dependency olarak çağrılsa da kullanım gerektiğinde erişilebilir olması için saklıyoruz.
void normalPdf;

// ===== PLUGIN EXPORT =====
export const aflPlugin: SportPlugin = {
  config: aflConfig,
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

export default aflPlugin;
