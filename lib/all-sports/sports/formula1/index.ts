/**
 * Formula 1 Sport Plugin (MINIMAL SCAFFOLD)
 * v1.formula-1.api-sports.io
 *
 * F1 diğer takım sporlarından temel olarak farklıdır:
 * - 20 pilot aynı pistte yarışır, "home vs away" kavramı yoktur
 * - Skor yerine pozisyon (1., 2., 3. ...) ile sonuçlanır
 * - Pazarlar çok-yönlü: Race Winner (20 seçenek), Podium (top 3), Head-to-Head, vb.
 *
 * Bu plugin MINIMAL fonksiyonel bir scaffold'dur:
 * - getGamesByDate o tarihte planlanmış yarışları döndürür
 * - predict() generik 50/50 (gerçek F1 tahmini için pilot seviyesi veri gerekir)
 * - evaluateMarket() Head-to-Head için pozisyon tabanlı basit olasılık döner,
 *   diğer karmaşık pazarlar için 0 döner
 * - evaluateBetResult() yarış sonuçları mevcutsa settlement yapar
 *
 * "Home" ve "Away" placeholder olarak Field'a mapped edilir.
 */

import type {
  SportPlugin,
  NormalizedGame,
  Prediction,
  NormalizedOdds,
} from '../_core/types';
import { SportApiClient, normalCdf, normalSurvival, normalPdf } from '../_core';
import { formula1Config } from './config';

const client = new SportApiClient(formula1Config.apiBase, formula1Config.apiKey);

// ===== NORMALIZER =====
/**
 * F1 `races` endpoint response:
 * { id, competition: { id, name, location: { country, city, circuit } },
 *   circuit: { id, name, length, image }, season, type, location, date, status,
 *   timestamp, timezone, laps, fastest_lap, ... }
 *
 * Home ve away alanları F1'de mevcut değildir. Generic "Field" placeholder kullanılır.
 */
function normalizeGame(raw: any): NormalizedGame {
  const r = raw.race ?? raw;
  const raceId = Number(r.id ?? raw.id ?? 0);

  const statusRaw = r.status ?? '';
  const status = String(statusRaw).toLowerCase();
  const finished =
    status === 'completed' ||
    status === 'finished' ||
    status.includes('finished') ||
    status.includes('completed');
  const live =
    status === 'in progress' ||
    status === 'running' ||
    status.includes('progress') ||
    status.includes('running');
  const upcoming =
    !finished && !live && (status === 'scheduled' || status === '' || status === 'upcoming');

  const isoDate = r.date ?? '';
  const tsSeconds =
    r.timestamp != null
      ? Number(r.timestamp)
      : Math.floor(new Date(isoDate).getTime() / 1000) || 0;

  const competition = r.competition ?? {};
  const circuit = r.circuit ?? {};
  const loc = r.location ?? competition.location ?? {};

  const leagueName =
    competition.name ??
    (circuit.name ? `F1 - ${circuit.name}` : 'Formula 1');

  const country =
    typeof loc.country === 'string'
      ? loc.country
      : loc.country?.name ?? circuit.country ?? undefined;

  return {
    id: raceId,
    sport: 'formula1',
    date: isoDate,
    timestamp: tsSeconds,
    status: {
      short: finished ? 'FT' : live ? 'LIVE' : 'NS',
      long: String(statusRaw ?? ''),
      live,
      finished,
      upcoming,
    },
    league: {
      id: Number(competition.id ?? 0),
      name: leagueName,
      logo: competition.logo ?? circuit.image,
      country,
      season: r.season ?? new Date().getFullYear(),
    },
    // F1'de takım yok — placeholder
    teams: {
      home: { id: 0, name: 'Field' },
      away: { id: 0, name: 'Field' },
    },
    // F1'de "score" null — yarış sıralaması ayrı endpoint'ten gelir (rankings/races)
    scores: {
      home: null,
      away: null,
    },
    periods: {
      circuit: circuit.name ?? null,
      type: r.type ?? null,
      laps:
        r.laps != null
          ? typeof r.laps === 'object'
            ? String(r.laps.total ?? r.laps.current ?? '')
            : String(r.laps)
          : null,
    },
  };
}

function normalizeOdds(raw: any): NormalizedOdds {
  const g = raw.race ?? raw;
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

// ===== PREDICTION =====
/**
 * F1'de "home vs away" kavramı yok — bu yüzden generic 50/50 döneriz.
 * Race Winner gibi pazarlar için evaluateMarket pilot bazında hesaplama yapar;
 * ancak o seviyede veri mevcut değilse market 0 döner.
 */
function predict(_params: {
  game: NormalizedGame;
  homeStats?: any;
  awayStats?: any;
  h2h?: NormalizedGame[];
  homeStanding?: any;
  awayStanding?: any;
}): Prediction {
  return {
    homeWinProb: 50,
    drawProb: 0,
    awayWinProb: 50,
    expectedHomeScore: 0,
    expectedAwayScore: 0,
    expectedTotalScore: 0,
    overUnder: {},
    mostLikelyScores: [],
    handicaps: {},
    confidence: 10, // Pilot verisi olmadan confidence düşük
    homeForm: 50,
    awayForm: 50,
  };
}

// ===== MARKET EVALUATOR =====
/**
 * F1'de pazarlar pilot-odaklıdır. Pilot verisi olmadan çoğu için 0 döneriz.
 * Sadece Head-to-Head için basit bir yaklaşık olasılık (50/50 baseline) döner.
 */
function evaluateMarket(params: {
  prediction: Prediction;
  betName: string;
  selection: string;
  game: NormalizedGame;
}): number {
  const { betName, selection } = params;
  const name = betName.toLowerCase().trim();
  const sel = selection.trim().toLowerCase();

  // Head-to-Head (iki pilot arasında hangisi daha yüksek bitirir)
  // Pilot istatistiği yoksa 50/50 yaklaşık olasılık
  if (
    name === 'head-to-head' ||
    name === 'head to head' ||
    name === 'h2h' ||
    name.includes('vs') ||
    name.includes('versus')
  ) {
    // Selection "Driver A" / "Driver B" formatında olabilir
    // Veri yokken eşit olasılık
    return 0.5;
  }

  // Podium, Points, Race Winner gibi pilot-odaklı pazarlar: pilot verisi olmadan 0
  // (Gerçek implementasyonda rankings/drivers + historical performance kullanılmalı)
  if (
    name === 'race winner' ||
    name === 'podium finish' ||
    name === 'points finish' ||
    name === 'fastest lap' ||
    name === 'winning driver' ||
    name === 'pole position' ||
    name.includes('winner') ||
    name.includes('podium') ||
    name.includes('points') ||
    name.includes('fastest')
  ) {
    // Baseline: 20 pilot eşit olasılıkta
    if (name === 'race winner' || name === 'winning driver') return 1 / 20; // 5%
    if (name === 'podium finish' || name.includes('podium')) return 3 / 20; // 15%
    if (name === 'points finish' || name.includes('points')) return 10 / 20; // 50%
    if (name === 'fastest lap' || name.includes('fastest')) return 1 / 20; // 5%
    if (name === 'pole position') return 1 / 20; // 5%
  }

  // Selection "yes" / "no" tarzı basit binary pazarlar
  if (sel === 'yes' || sel === 'no') {
    return 0.5;
  }

  // Desteklenmeyen pazar
  return 0;
}

// ===== BET RESULT EVALUATOR =====
/**
 * Yarış sonuçları rankings/races endpoint'inden gelir.
 * NormalizedGame.scores alanı F1'de anlamsızdır, bu yüzden settlement için
 * ek bir pozisyon listesi gerekir. Bu MINIMAL plugin'de:
 * - Yarış bitmediyse pending
 * - Yarış bitti ama detaylı sıralama yok -> void (güvenli tercih)
 *
 * Gerçek settlement için getRaceRankings() ayrı olarak çağrılıp
 * selection (pilot adı / takım adı) sonuçlara karşı kontrol edilmelidir.
 */
function evaluateBetResult(params: {
  betName: string;
  selection: string;
  game: NormalizedGame;
}): 'won' | 'lost' | 'void' | 'pending' {
  const { game } = params;
  if (!game.status.finished) return 'pending';

  // F1'de skor alanı null'dır; settlement için detaylı pozisyon listesi gerekir
  // ki bu plugin'de o çağrı yapılmamıştır. Güvenli tercih: void.
  return 'void';
}

// ===== API DATA FETCHERS =====
async function getGamesByDate(date: string): Promise<NormalizedGame[]> {
  // F1 API'de tarih bazlı filtre için "races?date=" query'si kullanılır.
  // Bazı sezonlar için season=YYYY zorunludur; fallback olarak yıldan türet.
  const year = parseInt(date.split('-')[0], 10) || new Date().getFullYear();
  const res = await client.fetch<any[]>('races', { date, season: year });
  return (res.response || []).map(normalizeGame);
}

async function getGameById(id: number): Promise<NormalizedGame | null> {
  const res = await client.fetch<any[]>('races', { id });
  const r = res.response?.[0];
  return r ? normalizeGame(r) : null;
}

async function getLiveGames(): Promise<NormalizedGame[]> {
  // F1 live endpoint (race=current ya da next) — API'nin desteklediği param
  const res = await client.fetch<any[]>('races', { next: 1 }, 60_000);
  const races = (res.response || []).map(normalizeGame);
  return races.filter((r) => r.status.live);
}

async function getOddsForGame(gameId: number): Promise<NormalizedOdds | null> {
  // F1 odds endpoint — race parametresi
  try {
    const res = await client.fetch<any[]>('odds', { race: gameId });
    const o = res.response?.[0];
    return o ? normalizeOdds(o) : null;
  } catch {
    return null;
  }
}

async function getH2H(
  _homeTeamId: number,
  _awayTeamId: number,
  _season?: number
): Promise<NormalizedGame[]> {
  // F1'de team bazlı H2H kavramı yoktur (takımlar yarışmaz, pilotlar yarışır)
  // Boş liste döner
  return [];
}

// Dependency olarak çağrılsa da kullanılmaya hazır olmaları için saklıyoruz.
void normalCdf;
void normalSurvival;
void normalPdf;

// ===== PLUGIN EXPORT =====
export const formula1Plugin: SportPlugin = {
  config: formula1Config,
  getGamesByDate,
  getGameById,
  getLiveGames,
  getOddsForGame,
  getH2H,
  predict,
  evaluateMarket,
  evaluateBetResult,
};

export default formula1Plugin;
