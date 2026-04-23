/**
 * MMA Sport Plugin
 * v1.mma.api-sports.io
 *
 * Karakteristik:
 * - Dövüş-tabanlı: Fighter A (home analog) vs Fighter B (away analog)
 * - Takım yok; "home/away" yalnızca normalize edilmiş etiketler
 * - Skor yok (Poisson değil) — scoreMethod: 'fight'
 * - Beraberlik nadir ama mümkün (~%2)
 * - Piyasalar:
 *     • Fighter Winner / Moneyline (Fighter1 / Draw / Fighter2)
 *     • Method of Victory (KO/TKO, Submission, Decision, Draw)
 *     • Total Rounds Over/Under (1.5 / 2.5 / 3.5 / 4.5 round line)
 *     • Fight to Go Distance (Yes / No)
 *     • Round Betting (hangi round'da bittiği)
 *
 * Prediction stratejisi:
 *   1) Dövüşçü istatistikleri yoksa literatür baz oranları (KO 30%, Sub 20%,
 *      Decision 48%, Draw 2%). Kazanma olasılıkları 50/48/2 (fighter1/draw/fighter2).
 *   2) İstatistik varsa:
 *      - Win rate karşılaştırması → kazanma olasılığı
 *      - KO/Sub/Decision oranları → method of victory dağılımı
 *      - Ortalama dövüş süresi → round over/under
 *
 * Gerçek paralı bahis: Hiç mock/demo yok. API'den gelen gerçek veriler
 *   deterministik şekilde olasılığa dönüştürülür; veri yoksa muhafazakar
 *   literatür ortalamaları kullanılır (her tahmin için confidence düşer).
 */

import type {
  SportPlugin,
  NormalizedGame,
  Prediction,
  NormalizedOdds,
} from '../_core/types';
import { SportApiClient } from '../_core';
import { mmaConfig } from './config';

const client = new SportApiClient(mmaConfig.apiBase, mmaConfig.apiKey);

// ===== STATUS CATEGORIZATION =====
const LIVE_STATUSES = new Set(['LIVE', 'R1', 'R2', 'R3', 'R4', 'R5', 'BR', 'IN_PROGRESS']);
const FINISHED_STATUSES = new Set(['FT', 'KO', 'SUB', 'DEC', 'DRAW', 'AET']);
const UPCOMING_STATUSES = new Set(['NS', 'TBD']);
const VOID_STATUSES = new Set(['NC', 'CANC', 'POSTP', 'WO']);

// Literature-grade base rates for professional MMA (UFC / high-tier promotions).
// These are used when fighter-level stats are missing.
const BASE_KO_RATE = 0.30;          // Finish by KO/TKO
const BASE_SUB_RATE = 0.20;         // Finish by Submission
const BASE_DECISION_RATE = 0.48;    // Goes to judges (decision)
const BASE_DRAW_RATE = 0.02;        // Split/majority draw (very rare)

// Conditional round distribution GIVEN an early (non-decision) finish.
// Source: aggregated UFC-era fight data — most finishes occur R1 (~48%), R2 (~28%),
// R3 (~17%), R4 (~5%), R5 (~2%). Normalized so they sum to 1 inside the "not
// decision" branch; multiplied by (1 - DECISION_RATE - DRAW_RATE) at the end.
const EARLY_FINISH_ROUND_DIST: Record<number, number> = {
  1: 0.48,
  2: 0.28,
  3: 0.17,
  4: 0.05,
  5: 0.02,
};

// Default scheduled rounds when API does not expose it
// 3 rounds = regular fight, 5 rounds = main event / title fight
const DEFAULT_ROUNDS = 3;

// ===== NORMALIZER =====
/**
 * Normalize a raw MMA fight from v1.mma.api-sports.io into NormalizedGame.
 *
 * Mapping:
 *   - fight.id                   → game.id
 *   - fight.date / timestamp     → game.date / timestamp
 *   - fight.fighters.first       → teams.home (labelled fighter1)
 *   - fight.fighters.second      → teams.away (labelled fighter2)
 *   - fight.fighters.X.winner    → scores.home/away = 1 if won, 0 otherwise
 *                                  (both 0 for draw/no contest)
 *   - fight.category             → league.name (weight class, e.g. "Lightweight")
 *   - fight.slug / event         → league.id surrogate when explicit id missing
 *   - fight.status.short         → status bucket (live/finished/upcoming)
 *
 * scores.home / scores.away semantics for MMA:
 *   1 = this fighter won
 *   0 = this fighter did not win (lost OR draw OR not decided yet)
 *   null = fight not finished or result not known
 */
function normalizeFight(raw: any): NormalizedGame {
  const status = raw?.status || {};
  const short: string = String(status.short || '').toUpperCase();

  const first = raw?.fighters?.first || {};
  const second = raw?.fighters?.second || {};
  const category = raw?.category || {};
  const slugOrEvent = raw?.slug || raw?.event?.name || category.name || 'MMA';

  const finished = FINISHED_STATUSES.has(short) || VOID_STATUSES.has(short);
  const firstWon = first?.winner === true;
  const secondWon = second?.winner === true;

  // Scores semantics for MMA: 1 = winner, 0 = loser/draw, null = not settled.
  let homeScore: number | null = null;
  let awayScore: number | null = null;
  if (finished) {
    if (VOID_STATUSES.has(short)) {
      homeScore = null;
      awayScore = null;
    } else {
      homeScore = firstWon ? 1 : 0;
      awayScore = secondWon ? 1 : 0;
    }
  }

  // Period breakdown — record round ended (if available) and method (KO/SUB/DEC/DRAW)
  const periods: Record<string, string | null> = {
    round: raw?.round != null ? String(raw.round) : null,
    method: raw?.method ?? (short === 'KO' ? 'KO' : short === 'SUB' ? 'SUB' : short === 'DEC' ? 'DEC' : short === 'DRAW' ? 'DRAW' : null),
    scheduledRounds: raw?.rounds != null ? String(raw.rounds) : null,
  };

  return {
    id: Number(raw?.id),
    sport: 'mma',
    date: String(raw?.date ?? ''),
    timestamp: Number(raw?.timestamp ?? (raw?.date ? Math.floor(new Date(raw.date).getTime() / 1000) : 0)),
    status: {
      short,
      long: String(status.long || ''),
      live: LIVE_STATUSES.has(short),
      finished,
      upcoming: UPCOMING_STATUSES.has(short),
    },
    league: {
      // Category = weight class; no real "league id" in MMA API, use category.id if exists
      id: Number(category.id ?? 0),
      name: String(category.name ?? slugOrEvent),
      logo: category.logo,
      country: raw?.country?.name,
      season: raw?.league?.season ?? new Date(raw?.date ?? Date.now()).getFullYear(),
    },
    teams: {
      home: {
        id: Number(first?.id ?? 0),
        name: String(first?.name ?? 'Fighter 1'),
        logo: first?.logo ?? first?.image,
      },
      away: {
        id: Number(second?.id ?? 0),
        name: String(second?.name ?? 'Fighter 2'),
        logo: second?.logo ?? second?.image,
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
  return {
    gameId: Number(odd?.fight?.id ?? odd?.game?.id ?? odd?.id),
    bookmakers: (odd?.bookmakers || []).map((bm: any) => ({
      id: Number(bm?.id),
      name: String(bm?.name || ''),
      bets: (bm?.bets || []).map((bet: any) => ({
        id: Number(bet?.id),
        name: String(bet?.name || ''),
        values: (bet?.values || []).map((v: any) => ({
          value: String(v?.value ?? ''),
          odd: parseFloat(v?.odd),
        })),
      })),
    })),
  };
}

// ===== STATISTICS EXTRACTION =====

function parseNumber(v: any): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract fighter-level rates from api-sports mma fighter stats payload.
 * Defensive against shape variations — falls back to null when missing.
 */
interface FighterRates {
  winRate: number | null;      // 0..1
  koRate: number | null;       // % of wins by KO/TKO (of all fights or of wins)
  subRate: number | null;      // % of wins by submission
  decisionRate: number | null; // % of wins by decision
  avgRoundsFought: number | null; // average rounds-to-finish (1..scheduledRounds)
  totalFights: number | null;
}

function extractFighterRates(stats: any): FighterRates {
  if (!stats) {
    return { winRate: null, koRate: null, subRate: null, decisionRate: null, avgRoundsFought: null, totalFights: null };
  }

  // api-sports fighter statistics may expose:
  //   stats.records.wins.total, .losses.total, .draws.total
  //   stats.wins.ko, stats.wins.submission, stats.wins.decision
  //   stats.losses.ko, stats.losses.submission, stats.losses.decision
  const wins = parseNumber(stats?.wins?.total ?? stats?.records?.wins?.total);
  const losses = parseNumber(stats?.losses?.total ?? stats?.records?.losses?.total);
  const draws = parseNumber(stats?.draws?.total ?? stats?.records?.draws?.total) ?? 0;
  const total = (wins ?? 0) + (losses ?? 0) + draws;

  const winsKO = parseNumber(stats?.wins?.ko ?? stats?.wins?.knockouts);
  const winsSub = parseNumber(stats?.wins?.submission ?? stats?.wins?.submissions);
  const winsDec = parseNumber(stats?.wins?.decision ?? stats?.wins?.decisions);

  const winRate = total > 0 ? ((wins ?? 0) / total) : null;

  // Finish distribution expressed as a share of TOTAL FIGHTS (so draws naturally reduce all shares).
  const koRate = total > 0 && winsKO != null ? winsKO / total : null;
  const subRate = total > 0 && winsSub != null ? winsSub / total : null;
  const decRate = total > 0 && winsDec != null ? winsDec / total : null;

  const avgRounds = parseNumber(stats?.average?.rounds ?? stats?.averages?.rounds ?? stats?.avg_rounds);

  return {
    winRate,
    koRate,
    subRate,
    decisionRate: decRate,
    avgRoundsFought: avgRounds,
    totalFights: total > 0 ? total : null,
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
  const { homeStats, awayStats, h2h = [] } = params;

  const fighter1 = extractFighterRates(homeStats);
  const fighter2 = extractFighterRates(awayStats);

  // ---- Step 1: Fighter winner probabilities ----
  // Default: evenly matched with small edge to fighter1 baseline.
  let fighter1WinProb = 0.5;
  let drawProb = BASE_DRAW_RATE;
  let fighter2WinProb = 1 - fighter1WinProb - drawProb;

  const haveStatSignal =
    (fighter1.winRate != null && (fighter1.totalFights ?? 0) >= 3) ||
    (fighter2.winRate != null && (fighter2.totalFights ?? 0) >= 3);

  if (haveStatSignal) {
    // Use win rates as strength estimates; Bradley-Terry style ratio.
    // Guard against zeros / nulls with modest priors.
    const r1 = fighter1.winRate != null ? Math.max(0.15, Math.min(0.95, fighter1.winRate)) : 0.5;
    const r2 = fighter2.winRate != null ? Math.max(0.15, Math.min(0.95, fighter2.winRate)) : 0.5;
    const denom = r1 + r2;
    const p1 = denom > 0 ? r1 / denom : 0.5;
    const p2 = 1 - p1;
    // Reserve draw mass first (baseline), split remainder between the two fighters
    drawProb = BASE_DRAW_RATE;
    const remaining = 1 - drawProb;
    fighter1WinProb = p1 * remaining;
    fighter2WinProb = p2 * remaining;
  }

  // H2H adjustment — extremely rare in MMA but can exist (rematches).
  if (h2h.length >= 1) {
    // Count direct fighter1 vs fighter2 historical wins
    let f1Wins = 0;
    let f2Wins = 0;
    h2h.forEach(g => {
      if (g.scores.home === 1 && g.scores.away === 0) f1Wins++;
      else if (g.scores.home === 0 && g.scores.away === 1) f2Wins++;
    });
    const n = f1Wins + f2Wins;
    if (n > 0) {
      // Small blend weight — h2h in MMA is noisy (styles evolve, injuries, weight cuts)
      const h2hP1 = f1Wins / n;
      const blendWeight = Math.min(0.20, 0.05 * n); // up to 20% at 4+ rematches
      const nonDraw = 1 - drawProb;
      fighter1WinProb = (fighter1WinProb * (1 - blendWeight)) + (h2hP1 * nonDraw * blendWeight);
      fighter2WinProb = (fighter2WinProb * (1 - blendWeight)) + ((1 - h2hP1) * nonDraw * blendWeight);
    }
  }

  // Normalize defensively
  const probSum = fighter1WinProb + drawProb + fighter2WinProb;
  if (probSum > 0) {
    fighter1WinProb /= probSum;
    drawProb /= probSum;
    fighter2WinProb /= probSum;
  }

  // ---- Step 2: Total rounds over/under ----
  // Base rates: P(over 1.5) = 0.75, P(over 2.5) = 0.55. Adjust by average rounds if known.
  // Higher avgRoundsFought (decision-heavy) → higher over rates.
  let pOver05 = 0.95; // fight virtually always enters round 1 (over 0.5)
  let pOver15 = 0.75;
  let pOver25 = 0.55;
  let pOver35 = 0.30;
  let pOver45 = 0.15;

  const avgR1 = fighter1.avgRoundsFought;
  const avgR2 = fighter2.avgRoundsFought;
  if (avgR1 != null || avgR2 != null) {
    const avg = ((avgR1 ?? 2.2) + (avgR2 ?? 2.2)) / 2;
    // Linear interpolation around 2.2 rounds baseline.
    // Each +0.3 rounds above baseline shifts over rates ~+5 pp, capped.
    const delta = Math.max(-1.5, Math.min(1.5, avg - 2.2));
    pOver15 = Math.max(0.40, Math.min(0.95, 0.75 + delta * 0.10));
    pOver25 = Math.max(0.20, Math.min(0.85, 0.55 + delta * 0.12));
    pOver35 = Math.max(0.05, Math.min(0.70, 0.30 + delta * 0.12));
    pOver45 = Math.max(0.02, Math.min(0.55, 0.15 + delta * 0.10));
  }

  // ---- Step 3: Confidence ----
  let confidence = 40;
  if (homeStats) confidence += 12;
  if (awayStats) confidence += 12;
  if ((fighter1.totalFights ?? 0) >= 5) confidence += 5;
  if ((fighter2.totalFights ?? 0) >= 5) confidence += 5;
  if (h2h.length >= 1) confidence += 6;
  confidence = Math.min(85, confidence); // MMA has high variance — cap below team sports

  // ---- Step 4: Form scores (0..100) ----
  // Use win rates * 100 as a "form" proxy; fall back to 50 when unknown.
  const homeForm = fighter1.winRate != null ? Math.round(fighter1.winRate * 100) : 50;
  const awayForm = fighter2.winRate != null ? Math.round(fighter2.winRate * 100) : 50;

  return {
    homeWinProb: fighter1WinProb * 100,
    drawProb: drawProb * 100,
    awayWinProb: fighter2WinProb * 100,
    // Score concept does not apply to MMA — emit zeros so consumers know to ignore.
    expectedHomeScore: 0,
    expectedAwayScore: 0,
    expectedTotalScore: 0,
    overUnder: {
      '0.5': { over: pOver05, under: 1 - pOver05 },
      '1.5': { over: pOver15, under: 1 - pOver15 },
      '2.5': { over: pOver25, under: 1 - pOver25 },
      '3.5': { over: pOver35, under: 1 - pOver35 },
      '4.5': { over: pOver45, under: 1 - pOver45 },
    },
    // No exact-score concept in MMA
    mostLikelyScores: [],
    confidence,
    homeForm,
    awayForm,
  };
}

// ===== HELPERS FOR MARKET EVALUATION =====

/**
 * Distribute the fight's non-draw probability mass over victory methods per fighter.
 * Returns absolute probabilities (sum ≈ fighter1Win + fighter2Win + draw = 1).
 *
 * Method mass per fighter is derived from:
 *   - Fighter-specific KO/Sub/Dec rates (of all fights) if available
 *   - Otherwise literature base rates (30/20/48 for KO/Sub/Decision)
 */
function methodOfVictoryDistribution(prediction: Prediction, homeStats?: any, awayStats?: any): {
  fighter1: { ko: number; sub: number; decision: number };
  fighter2: { ko: number; sub: number; decision: number };
  draw: number;
} {
  const f1 = extractFighterRates(homeStats);
  const f2 = extractFighterRates(awayStats);

  // Determine a per-fighter finish mix normalized to 1 (conditional on winning).
  // If win-finish breakdown is missing, fall back to the base mix.
  function conditionalMix(r: FighterRates): { ko: number; sub: number; decision: number } {
    const totalWins = (r.koRate ?? 0) + (r.subRate ?? 0) + (r.decisionRate ?? 0);
    if (totalWins > 0) {
      return {
        ko: (r.koRate ?? 0) / totalWins,
        sub: (r.subRate ?? 0) / totalWins,
        decision: (r.decisionRate ?? 0) / totalWins,
      };
    }
    const baseTotal = BASE_KO_RATE + BASE_SUB_RATE + BASE_DECISION_RATE;
    return {
      ko: BASE_KO_RATE / baseTotal,
      sub: BASE_SUB_RATE / baseTotal,
      decision: BASE_DECISION_RATE / baseTotal,
    };
  }

  const mix1 = conditionalMix(f1);
  const mix2 = conditionalMix(f2);

  const p1 = prediction.homeWinProb / 100;
  const p2 = prediction.awayWinProb / 100;
  const pd = prediction.drawProb / 100;

  return {
    fighter1: {
      ko: p1 * mix1.ko,
      sub: p1 * mix1.sub,
      decision: p1 * mix1.decision,
    },
    fighter2: {
      ko: p2 * mix2.ko,
      sub: p2 * mix2.sub,
      decision: p2 * mix2.decision,
    },
    draw: pd,
  };
}

/**
 * Probability distribution over the round in which the fight ends.
 * P(end in round k) for k = 1..scheduledRounds, plus P(decision / goes distance).
 *
 * Derived from:
 *   - Total rounds Over/Under curve in the prediction (pOver_{k-0.5})
 *   - Early finish distribution EARLY_FINISH_ROUND_DIST
 */
function roundEndDistribution(prediction: Prediction, scheduledRounds: number): {
  perRound: Record<number, number>; // P(fight ends in round k, for k=1..scheduledRounds)
  decision: number; // P(fight goes to decision / full distance)
  draw: number; // P(draw - separate outcome)
} {
  const ou = prediction.overUnder;
  // P(over k.5) = P(fight enters round k+1) = P(not finished by end of round k)
  const pOver = (line: string, def: number) => ou[line]?.over ?? def;

  const pOver05 = pOver('0.5', 0.99);
  const pOver15 = pOver('1.5', 0.75);
  const pOver25 = pOver('2.5', 0.55);
  const pOver35 = pOver('3.5', 0.30);
  const pOver45 = pOver('4.5', 0.15);

  const perRound: Record<number, number> = {};
  // P(ends in R1) = P(not over 0.5 → ends in R1) ≈ 1 - pOver05  (edge case: fight ended <R1 impossible
  //                                                                so we model ends-in-R1 = P(not over 1.5 AND over 0.5) = pOver05 - pOver15)
  if (scheduledRounds >= 1) perRound[1] = Math.max(0, pOver05 - pOver15);
  if (scheduledRounds >= 2) perRound[2] = Math.max(0, pOver15 - pOver25);
  if (scheduledRounds >= 3) perRound[3] = Math.max(0, pOver25 - pOver35);
  if (scheduledRounds >= 4) perRound[4] = Math.max(0, pOver35 - pOver45);
  if (scheduledRounds >= 5) perRound[5] = Math.max(0, pOver45 - 0);

  // P(goes distance / decision) = P(over scheduledRounds - 0.5) AND fight is NOT a KO/sub in final round.
  // For a K-round fight, the "over (K-0.5)" line is P(fight reaches final round); to go FULL distance
  // we want P(fight survives past final round) = pOver(K-0.5) is not right; precise marker is:
  // Fight lasts all K rounds == P(over (K-0.5)) if rounds are whole. But over 2.5 in a 3-round fight
  // means fight entered round 3; going the distance means fight is not finished IN round 3 either.
  // So decision = pOver(scheduledRounds-0.5) - P(ends-in-final-round).
  const finalRoundLine = scheduledRounds - 0.5;
  const pEnteredFinal = pOver(String(finalRoundLine), 0);
  const pEndsInFinal = perRound[scheduledRounds] ?? 0;
  const decision = Math.max(0, pEnteredFinal - pEndsInFinal);

  // Extract draw separately (drawProb is already in prediction)
  const draw = prediction.drawProb / 100;

  return { perRound, decision, draw };
}

function parseOverUnderSelection(sel: string): { dir: 'over' | 'under'; line: number } | null {
  const m = sel.match(/(Over|Under)\s*([\d.]+)/i);
  if (!m) return null;
  return { dir: m[1].toLowerCase() as 'over' | 'under', line: parseFloat(m[2]) };
}

// ===== MARKET EVALUATOR =====
function evaluateMarket(params: {
  prediction: Prediction;
  betName: string;
  selection: string;
  game: NormalizedGame;
}): number {
  const { prediction, betName, selection, game } = params;
  const name = (betName || '').toLowerCase().trim();
  const sel = (selection || '').trim();
  const selLower = sel.toLowerCase();

  const fighter1Name = (game.teams.home.name || '').toLowerCase();
  const fighter2Name = (game.teams.away.name || '').toLowerCase();

  // Helper: which fighter is this selection referring to?
  function selectionMatchesFighter(sel: string): 'fighter1' | 'fighter2' | 'draw' | null {
    const s = sel.toLowerCase().trim();
    if (s === '1' || s === 'home' || s === 'fighter1' || s === 'fighter 1' || s === 'first') return 'fighter1';
    if (s === '2' || s === 'away' || s === 'fighter2' || s === 'fighter 2' || s === 'second') return 'fighter2';
    if (s === 'x' || s === 'draw' || s === 'tie') return 'draw';
    if (fighter1Name && s.includes(fighter1Name)) return 'fighter1';
    if (fighter2Name && s.includes(fighter2Name)) return 'fighter2';
    return null;
  }

  // ---- Fighter Winner / Moneyline ----
  if (
    name === 'fighter winner' ||
    name === 'moneyline' ||
    name === 'money line' ||
    name === 'match winner' ||
    name === 'winner' ||
    name === '1x2'
  ) {
    const side = selectionMatchesFighter(sel);
    if (side === 'fighter1') return prediction.homeWinProb / 100;
    if (side === 'fighter2') return prediction.awayWinProb / 100;
    if (side === 'draw') return prediction.drawProb / 100;
  }

  // ---- Method of Victory ----
  if (name === 'method of victory' || name === 'method' || name === 'fight outcome') {
    const mov = methodOfVictoryDistribution(prediction);

    // Selection patterns:
    //   "Fighter1 KO/TKO", "Fighter 1 Submission", "Fighter1 Decision"
    //   "Fighter2 KO/TKO", "Fighter 2 Submission", "Fighter2 Decision"
    //   "Draw"
    //   Or combined "KO/TKO" (sums both fighters)

    if (selLower === 'draw') return mov.draw;

    const side = selectionMatchesFighter(selLower.replace(/ko\/tko|ko|tko|submission|sub|decision|dec|draw/gi, '').trim());
    const isKO = /\bko\b|\btko\b|knock[- ]?out/i.test(sel);
    const isSub = /submission|\bsub\b/i.test(sel);
    const isDec = /decision|\bdec\b/i.test(sel);

    if (isKO && !isSub && !isDec) {
      if (side === 'fighter1') return mov.fighter1.ko;
      if (side === 'fighter2') return mov.fighter2.ko;
      if (side == null) return mov.fighter1.ko + mov.fighter2.ko; // combined
    }
    if (isSub && !isKO && !isDec) {
      if (side === 'fighter1') return mov.fighter1.sub;
      if (side === 'fighter2') return mov.fighter2.sub;
      if (side == null) return mov.fighter1.sub + mov.fighter2.sub;
    }
    if (isDec && !isKO && !isSub) {
      if (side === 'fighter1') return mov.fighter1.decision;
      if (side === 'fighter2') return mov.fighter2.decision;
      if (side == null) return mov.fighter1.decision + mov.fighter2.decision;
    }
  }

  // ---- Total Rounds Over/Under ----
  if (
    name === 'total rounds over/under' ||
    name === 'total rounds' ||
    name === 'rounds over/under' ||
    name === 'over/under rounds' ||
    name === 'over/under'
  ) {
    const parsed = parseOverUnderSelection(sel);
    if (parsed) {
      const ou = prediction.overUnder[String(parsed.line)];
      if (ou) return parsed.dir === 'over' ? ou.over : ou.under;
    }
  }

  // ---- Fight to Go Distance ----
  if (
    name === 'fight to go distance' ||
    name === 'goes to distance' ||
    name === 'go the distance' ||
    name === 'fight goes distance'
  ) {
    // P(Yes = fight goes full distance) = 1 - P(early finish) = 1 - (KO + Sub from any side)
    // We approximate P(early finish) as the non-decision, non-draw mass.
    const mov = methodOfVictoryDistribution(prediction);
    const earlyFinish =
      mov.fighter1.ko + mov.fighter1.sub +
      mov.fighter2.ko + mov.fighter2.sub;
    const goesDistance = 1 - earlyFinish - mov.draw;

    if (selLower === 'yes') return Math.max(0, Math.min(1, goesDistance));
    if (selLower === 'no') return Math.max(0, Math.min(1, earlyFinish));
  }

  // ---- Round Betting ----
  if (
    name === 'round betting' ||
    name === 'winning round' ||
    name === 'fight ends in round' ||
    name === 'end of fight'
  ) {
    const scheduled = parseInt(game.periods?.scheduledRounds || '') || DEFAULT_ROUNDS;
    const dist = roundEndDistribution(prediction, scheduled);

    // Selection patterns:
    //   "Round 1", "Round 2", ..., "Round 5"
    //   "Fighter1 Round 1", "Fighter 2 Round 3"
    //   "Decision", "Goes to Decision", "Draw"
    if (/\bdecision\b/i.test(sel) || /goes to decision/i.test(sel)) {
      return dist.decision;
    }
    if (selLower === 'draw') {
      return dist.draw;
    }
    const m = sel.match(/round\s*(\d)/i);
    if (m) {
      const roundNum = parseInt(m[1]);
      if (roundNum >= 1 && roundNum <= scheduled) {
        const perRoundP = dist.perRound[roundNum] ?? 0;
        // If selection specifies a fighter, attribute proportionally to that fighter's win prob
        const side = selectionMatchesFighter(sel);
        if (side === 'fighter1' || side === 'fighter2') {
          const p1 = prediction.homeWinProb / 100;
          const p2 = prediction.awayWinProb / 100;
          const denom = p1 + p2;
          if (denom <= 0) return 0;
          return side === 'fighter1' ? perRoundP * (p1 / denom) : perRoundP * (p2 / denom);
        }
        return perRoundP;
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
  if (!game.status.finished) return 'pending';

  // Void if result is missing (e.g. No Contest, Cancelled)
  if (game.scores.home == null || game.scores.away == null) return 'void';

  const f1Won = game.scores.home === 1;
  const f2Won = game.scores.away === 1;
  const isDraw = !f1Won && !f2Won;

  const name = (betName || '').toLowerCase().trim();
  const sel = (selection || '').trim();
  const selLower = sel.toLowerCase();

  const fighter1Name = (game.teams.home.name || '').toLowerCase();
  const fighter2Name = (game.teams.away.name || '').toLowerCase();

  function selectionSide(sel: string): 'fighter1' | 'fighter2' | 'draw' | null {
    const s = sel.toLowerCase().trim();
    if (s === '1' || s === 'home' || s === 'fighter1' || s === 'fighter 1' || s === 'first') return 'fighter1';
    if (s === '2' || s === 'away' || s === 'fighter2' || s === 'fighter 2' || s === 'second') return 'fighter2';
    if (s === 'x' || s === 'draw' || s === 'tie') return 'draw';
    if (fighter1Name && s.includes(fighter1Name)) return 'fighter1';
    if (fighter2Name && s.includes(fighter2Name)) return 'fighter2';
    return null;
  }

  // ---- Fighter Winner / Moneyline ----
  if (
    name === 'fighter winner' ||
    name === 'moneyline' ||
    name === 'money line' ||
    name === 'match winner' ||
    name === 'winner' ||
    name === '1x2'
  ) {
    const side = selectionSide(sel);
    if (side === 'fighter1') return f1Won ? 'won' : 'lost';
    if (side === 'fighter2') return f2Won ? 'won' : 'lost';
    if (side === 'draw') return isDraw ? 'won' : 'lost';
  }

  // ---- Method of Victory ----
  // Requires the period "method" code (KO / SUB / DEC / DRAW). If missing, void.
  if (name === 'method of victory' || name === 'method' || name === 'fight outcome') {
    const method = (game.periods?.method || '').toUpperCase();
    if (!method) return 'void';

    if (selLower === 'draw') return method === 'DRAW' ? 'won' : 'lost';

    const cleaned = selLower.replace(/ko\/tko|ko|tko|submission|sub|decision|dec/gi, '').trim();
    const side = selectionSide(cleaned);
    const isKO = /\bko\b|\btko\b|knock[- ]?out/i.test(sel);
    const isSub = /submission|\bsub\b/i.test(sel);
    const isDec = /decision|\bdec\b/i.test(sel);

    const methodMatches = (expected: 'KO' | 'SUB' | 'DEC'): boolean => {
      if (expected === 'KO') return method === 'KO' || method === 'TKO';
      if (expected === 'SUB') return method === 'SUB' || method === 'SUBMISSION';
      if (expected === 'DEC') return method === 'DEC' || method === 'DECISION';
      return false;
    };

    // Selection must match both side AND method
    if (isKO) {
      if (side === 'fighter1') return f1Won && methodMatches('KO') ? 'won' : 'lost';
      if (side === 'fighter2') return f2Won && methodMatches('KO') ? 'won' : 'lost';
      if (side == null) return methodMatches('KO') ? 'won' : 'lost';
    }
    if (isSub) {
      if (side === 'fighter1') return f1Won && methodMatches('SUB') ? 'won' : 'lost';
      if (side === 'fighter2') return f2Won && methodMatches('SUB') ? 'won' : 'lost';
      if (side == null) return methodMatches('SUB') ? 'won' : 'lost';
    }
    if (isDec) {
      if (side === 'fighter1') return f1Won && methodMatches('DEC') ? 'won' : 'lost';
      if (side === 'fighter2') return f2Won && methodMatches('DEC') ? 'won' : 'lost';
      if (side == null) return methodMatches('DEC') ? 'won' : 'lost';
    }
  }

  // ---- Total Rounds Over/Under ----
  if (
    name === 'total rounds over/under' ||
    name === 'total rounds' ||
    name === 'rounds over/under' ||
    name === 'over/under rounds' ||
    name === 'over/under'
  ) {
    const round = parseInt(game.periods?.round || '') || null;
    if (round == null) return 'void'; // Can't settle without round info

    const parsed = parseOverUnderSelection(sel);
    if (parsed) {
      // Convention: if fight ends in round R, then actual "rounds completed" = R - 0.5 for mid-round finish
      // But API usually returns ending round integer. To settle a line like 2.5:
      //   Over 2.5 = fight entered round 3 (round >= 3)
      //   Under 2.5 = fight ended before/within round 2 (round <= 2)
      const method = (game.periods?.method || '').toUpperCase();
      const wentDistance = method === 'DEC' || method === 'DECISION';
      // "Rounds fought" effective for line comparison:
      //   - Decision → all scheduled rounds (round field will equal scheduled rounds)
      //   - Finish in round R → R - 0.5 (finish was mid-round)
      const effective = wentDistance ? round : round - 0.5;
      if (effective === parsed.line) return 'void';
      return parsed.dir === 'over'
        ? effective > parsed.line ? 'won' : 'lost'
        : effective < parsed.line ? 'won' : 'lost';
    }
  }

  // ---- Fight to Go Distance ----
  if (
    name === 'fight to go distance' ||
    name === 'goes to distance' ||
    name === 'go the distance' ||
    name === 'fight goes distance'
  ) {
    const method = (game.periods?.method || '').toUpperCase();
    if (!method) return 'void';
    const goesDistance = method === 'DEC' || method === 'DECISION' || method === 'DRAW';
    if (selLower === 'yes') return goesDistance ? 'won' : 'lost';
    if (selLower === 'no') return !goesDistance ? 'won' : 'lost';
  }

  // ---- Round Betting ----
  if (
    name === 'round betting' ||
    name === 'winning round' ||
    name === 'fight ends in round' ||
    name === 'end of fight'
  ) {
    const round = parseInt(game.periods?.round || '') || null;
    const method = (game.periods?.method || '').toUpperCase();

    if (/\bdecision\b/i.test(sel) || /goes to decision/i.test(sel)) {
      return (method === 'DEC' || method === 'DECISION') ? 'won' : 'lost';
    }
    if (selLower === 'draw') {
      return isDraw ? 'won' : 'lost';
    }
    if (round == null) return 'void';

    const m = sel.match(/round\s*(\d)/i);
    if (m) {
      const expectedRound = parseInt(m[1]);
      const side = selectionSide(sel);
      // Finish must have happened by KO/TKO/SUB in that exact round
      const endedByFinish = method === 'KO' || method === 'TKO' || method === 'SUB' || method === 'SUBMISSION';
      if (!endedByFinish) return 'lost'; // decision → round bet loses
      if (round !== expectedRound) return 'lost';

      if (side === 'fighter1') return f1Won ? 'won' : 'lost';
      if (side === 'fighter2') return f2Won ? 'won' : 'lost';
      if (side == null) return 'won'; // just "Round 2" without fighter specifier
    }
  }

  return 'void';
}

// ===== API DATA FETCHERS =====
async function getGamesByDate(date: string): Promise<NormalizedGame[]> {
  // v1.mma.api-sports.io uses /fights endpoint, filterable by `date` (YYYY-MM-DD).
  const res = await client.fetch<any[]>('fights', { date });
  return (res.response || []).map(normalizeFight);
}

async function getGameById(id: number): Promise<NormalizedGame | null> {
  const res = await client.fetch<any[]>('fights', { id });
  const g = res.response?.[0];
  return g ? normalizeFight(g) : null;
}

async function getLiveGames(): Promise<NormalizedGame[]> {
  // v1.mma.api-sports.io supports `?live=all` on /fights for real-time active fights.
  // If unsupported by account tier, fall back to today's date + live status filter.
  try {
    const res = await client.fetch<any[]>('fights', { live: 'all' }, 60000);
    return (res.response || []).map(normalizeFight);
  } catch {
    const today = new Date().toISOString().slice(0, 10);
    const res = await client.fetch<any[]>('fights', { date: today }, 60000);
    return (res.response || []).map(normalizeFight).filter(g => g.status.live);
  }
}

async function getOddsForGame(gameId: number): Promise<NormalizedOdds | null> {
  // Odds endpoint for MMA uses `?fight=<id>` (not `fixture`).
  const res = await client.fetch<any[]>('odds', { fight: gameId });
  const o = res.response?.[0];
  return o ? normalizeOdds(o) : null;
}

async function getH2H(homeTeamId: number, awayTeamId: number): Promise<NormalizedGame[]> {
  // api-sports MMA: `/fights?h2h=id1-id2` retrieves all direct fights between two fighters.
  // May return empty for never-faced pairs (common — rematches are rare in MMA).
  try {
    const res = await client.fetch<any[]>('fights', { h2h: `${homeTeamId}-${awayTeamId}` });
    return (res.response || []).map(normalizeFight);
  } catch {
    return [];
  }
}

async function getTeamStatistics(teamId: number, _leagueId: number, _season: number): Promise<any> {
  // For MMA, `team` == fighter. Endpoint: /fighters/statistics?id=<id>
  // Some accounts expose /fighters?id=<id> with embedded stats — try both.
  try {
    const res = await client.fetch<any>('fighters/statistics', { id: teamId });
    if (res.response) return res.response;
  } catch {
    // fall through
  }
  try {
    const res = await client.fetch<any[]>('fighters', { id: teamId });
    return res.response?.[0] ?? null;
  } catch {
    return null;
  }
}

// ===== PLUGIN EXPORT =====
export const mmaPlugin: SportPlugin = {
  config: mmaConfig,
  getGamesByDate,
  getGameById,
  getLiveGames,
  getOddsForGame,
  getH2H,
  // No traditional standings in MMA — intentionally omitted
  getTeamStatistics,
  predict,
  evaluateMarket,
  evaluateBetResult,
};
