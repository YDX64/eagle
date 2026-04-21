/**
 * Goal Analyzer — multi-algorithm gol-beklentisi skorlayıcı
 *
 * Dört bağımsız sub-algoritma birleşik confidence üretir:
 *  1) Poisson dağılımı (xG'den gerçek olasılık)
 *  2) Odds consensus (bookmaker implied probability)
 *  3) H2H goal average (tarihsel skor)
 *  4) Value bet detector (Poisson − Market edge)
 */

import { ApiFootballService } from '@/lib/api-football';
// ProBet engine + 40+ backtest-calibrated odds patterns (production ProBet)
// Bu import'lar Eagle local'de resolve olmayabilir; ProBet production build'de resolve olur.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — optional dependency: ProBet'in mevcut modülleri (sadece ProBet build'de var)
import type { ProBetPrediction as _PBP } from '@/lib/probet/probet-engine';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { matchAllPatterns as _matchAllPatterns, type LiveOddsSnapshot as _LOS } from '@/lib/probet/odds-patterns';

// ────────────────────────────────── math utils

function factorial(n: number): number {
  if (n < 2) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

export function poissonPMF(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

export function probOver(
  lambdaHome: number,
  lambdaAway: number,
  threshold: number,
  maxGoals = 10,
): number {
  let pUnder = 0;
  for (let i = 0; i < maxGoals; i++) {
    for (let j = 0; j < maxGoals; j++) {
      if (i + j < threshold + 0.5) {
        pUnder += poissonPMF(i, lambdaHome) * poissonPMF(j, lambdaAway);
      }
    }
  }
  return Math.max(0, Math.min(1, 1 - pUnder));
}

export function probBTTS(lambdaHome: number, lambdaAway: number): number {
  const p0h = poissonPMF(0, lambdaHome);
  const p0a = poissonPMF(0, lambdaAway);
  return Math.max(0, Math.min(1, 1 - p0h - p0a + p0h * p0a));
}

export function impliedProb(decimalOdd: number | null): number | null {
  if (!decimalOdd || decimalOdd <= 1.01) return null;
  return 1 / decimalOdd;
}

// ────────────────────────────────── odds extraction

interface OddsValue { value: string; odd: string }
interface OddsBet { name: string; values: OddsValue[] }
interface OddsBookmaker { bets: OddsBet[] }
interface OddsItem { bookmakers: OddsBookmaker[] }

export function bestOdds(
  response: OddsItem[] | null | undefined,
  betContains: string,
  valueContains: string,
): number | null {
  return bestOddsExact(response, betContains, valueContains);
}

/** Opsiyonel bet-name exclusion filtresi (örn. BTTS ararken "first half" içermesin) */
export function bestOddsExact(
  response: OddsItem[] | null | undefined,
  betContains: string,
  valueContains: string,
  betPredicate?: (normalizedName: string) => boolean,
): number | null {
  if (!response) return null;
  let best: number | null = null;
  const needle = betContains.toLowerCase();
  const valNeedle = valueContains.toLowerCase();
  for (const item of response) {
    for (const bk of (item as any).bookmakers ?? []) {
      for (const bet of (bk as any).bets ?? []) {
        const name = (typeof (bet as any)?.name === 'string' ? (bet as any).name : '').toLowerCase();
        if (!name.includes(needle)) continue;
        if (betPredicate && !betPredicate(name)) continue;
        for (const v of (bet as any).values ?? []) {
          const val = (typeof (v as any)?.value === 'string' ? (v as any).value : '').toLowerCase();
          if (val !== valNeedle && !val.includes(valNeedle)) continue;
          // strict eşleşme: "over 2.5" "over 2.55" değil
          if (valNeedle.startsWith('over ') || valNeedle.startsWith('under ')) {
            if (val !== valNeedle) continue;
          }
          const od = Number((v as any).odd);
          if (od > 1.01 && (best === null || od < best)) best = od;
        }
      }
    }
  }
  return best;
}

// ────────────────────────────────── h2h avg

export function h2hGoalAverage(h2h: Array<{ goals?: { home?: number | null; away?: number | null } }> | null): number | null {
  if (!h2h || h2h.length === 0) return null;
  const totals: number[] = [];
  for (const m of h2h) {
    const h = m.goals?.home, a = m.goals?.away;
    if (typeof h === 'number' && typeof a === 'number') totals.push(h + a);
  }
  if (totals.length === 0) return null;
  return totals.reduce((s, v) => s + v, 0) / totals.length;
}

/** H2H içinde her iki takımın da gol attığı maç oranı (0-1) */
export function h2hBttsRatio(h2h: Array<{ goals?: { home?: number | null; away?: number | null } }> | null): number | null {
  if (!h2h || h2h.length === 0) return null;
  let valid = 0, both = 0;
  for (const m of h2h) {
    const h = m.goals?.home, a = m.goals?.away;
    if (typeof h === 'number' && typeof a === 'number') {
      valid++;
      if (h > 0 && a > 0) both++;
    }
  }
  return valid > 0 ? both / valid : null;
}

// ────────────────────────────────── types

export interface GoalAnalysisInput {
  fixtureId: number;
  homeName: string;
  awayName: string;
  homeId: number;
  awayId: number;
  leagueName: string;
  country: string;
  kickoffUtc: string;
  statusShort: string;
  elapsed: number | null;
  homeGoals: number | null;
  awayGoals: number | null;
  prediction: any | null;
  odds: OddsItem[] | null;
  h2h: any[] | null;
  probet: any | null;           // ProBetPrediction (lib/probet/probet-engine)
}

export interface GoalAnalysisResult {
  fixtureId: number;
  homeName: string;
  awayName: string;
  leagueName: string;
  country: string;
  kickoffUtc: string;
  statusShort: string;
  elapsed: number | null;
  bucket: 'live_0_0' | 'upcoming';
  // xG
  xgHome: number;
  xgAway: number;
  xgTotal: number;
  // Poisson probabilities (%)
  poissonOver05: number;
  poissonOver15: number;
  poissonOver25: number;
  poissonOver35: number;
  poissonBTTS: number;
  poissonHTOver05: number;   // İY 0.5 Üst — ilk yarı gol
  poissonHTOver15: number;   // İY 1.5 Üst
  poissonExactScore: string; // "1-1", "2-1" etc (mode)
  // Odds
  oddOver25: number | null;
  oddOver15: number | null;
  oddBTTS: number | null;
  impliedOver25: number | null;
  impliedBTTS: number | null;
  // H2H
  h2hGoalAvg: number | null;
  h2hMatches: number;
  // Bet365
  hasBet365: boolean;
  bet365MarketsCount: number;
  // HT odds (bet365 market 6 — Goals Over/Under First Half)
  oddHTOver05: number | null;
  oddHTOver15: number | null;
  oddHTBTTS: number | null;
  // Market-bazlı çoklu-kaynak sağlama (6 bağımsız kaynak)
  supportO25:   { poisson: boolean; odds: boolean; h2h: boolean; advice: boolean; probet: boolean; patterns: boolean; count: number };
  supportBTTS:  { poisson: boolean; odds: boolean; h2h: boolean; probet: boolean; patterns: boolean; count: number };
  supportHT05:  { poisson: boolean; odds: boolean; probet: boolean; patterns: boolean; count: number };
  // ProBet engine sonuçları (mevcutsa)
  probetO25Prob: number | null;
  probetBTTSProb: number | null;
  probetHT05Prob: number | null;
  probetBestPick: { label: string; prob: number; odds: number | null } | null;
  // Eşleşen ProBet odds-patterns (banko + güçlü)
  matchedPatterns: Array<{ id: string; name: string; prediction: string; hitRate: number; banko: boolean }>;
  h2hBttsRate: number | null;    // son 6 maçta her iki takımın da gol attığı oran
  // Advice
  predictionAdvice: string;
  underOverHint: string | null;
  // Composite
  confidence: number;
  patterns: string[];
  recommendation: string;
}

// ────────────────────────────────── scorer

function pickModeScore(lh: number, la: number, maxG = 6): string {
  let best = '0-0', bestP = 0;
  for (let i = 0; i < maxG; i++) {
    for (let j = 0; j < maxG; j++) {
      const p = poissonPMF(i, lh) * poissonPMF(j, la);
      if (p > bestP) { bestP = p; best = `${i}-${j}`; }
    }
  }
  return best;
}

const BET365_BOOKMAKER_ID = 8;
const FIRST_HALF_FACTOR = 0.43; // Eagle advanced-prediction-engine convention

// Bet365 odds → ProBet LiveOddsSnapshot key mapping
function buildLiveOddsSnapshot(odds: OddsItem[] | null | undefined): Record<string, number> {
  const snap: Record<string, number> = {};
  if (!odds) return snap;
  for (const item of odds) {
    for (const bk of (item as any).bookmakers ?? []) {
      if ((bk as any).id !== BET365_BOOKMAKER_ID) continue;
      for (const bet of (bk as any).bets ?? []) {
        const name = (typeof (bet as any)?.name === 'string' ? (bet as any).name : '').toLowerCase();
        for (const v of (bet as any).values ?? []) {
          const val = (typeof (v as any)?.value === 'string' ? (v as any).value : '').toLowerCase();
          const od = Number((v as any).odd);
          if (!(od > 1.01)) continue;
          if (name === 'match winner') {
            if (val === 'home') snap.MS1_CLOSE = od;
            else if (val === 'draw') snap.MSX_CLOSE = od;
            else if (val === 'away') snap.MS2_CLOSE = od;
          } else if (name === 'goals over/under') {
            if (val === 'over 0.5') snap.OVER_05_CLOSE = od;
            else if (val === 'over 1.5') snap.OVER_15_CLOSE = od;
            else if (val === 'over 2.5') snap.OVER_25_CLOSE = od;
            else if (val === 'over 3.5') snap.OVER_35_CLOSE = od;
            else if (val === 'over 4.5') snap.OVER_45_CLOSE = od;
            else if (val === 'under 0.5') snap.UNDER_05_CLOSE = od;
            else if (val === 'under 1.5') snap.UNDER_15_CLOSE = od;
            else if (val === 'under 2.5') snap.UNDER_25_CLOSE = od;
            else if (val === 'under 3.5') snap.UNDER_35_CLOSE = od;
          } else if (name === 'both teams score') {
            if (val === 'yes') snap.BTTS_YES_CLOSE = od;
            else if (val === 'no') snap.BTTS_NO_CLOSE = od;
          } else if (name === 'goals over/under first half') {
            if (val === 'over 0.5') snap.HT_05_OVER_CLOSE = od;
            else if (val === 'over 1.5') snap.HT_15_OVER_CLOSE = od;
            else if (val === 'under 0.5') snap.HT_05_UNDER_CLOSE = od;
            else if (val === 'under 1.5') snap.HT_15_UNDER_CLOSE = od;
          } else if (name === 'both teams score - first half') {
            if (val === 'yes') snap.HT_BTTS_CLOSE = od;
          }
        }
      }
    }
  }
  return snap;
}

// ProBet pick lookup — marketLabel/market key ile arama
function findProBetPick(pred: any, needle: string): { probability: number; marketOdds?: number; marketLabel: string } | null {
  if (!pred?.topPicks) return null;
  const n = needle.toLowerCase();
  for (const p of pred.topPicks as any[]) {
    const lbl = ((p.marketLabel || p.market || '') as string).toLowerCase();
    if (lbl.includes(n)) return { probability: p.probability, marketOdds: p.marketOdds, marketLabel: p.marketLabel ?? p.market };
  }
  return null;
}

function safeMatchPatterns(snap: Record<string, number>): Array<any> {
  try {
    // @ts-ignore — ProBet module resolve only inside ProBet build
    return _matchAllPatterns(snap) as any[];
  } catch {
    return [];
  }
}

function bet365Stats(odds: OddsItem[] | null | undefined): { has: boolean; markets: number } {
  if (!odds) return { has: false, markets: 0 };
  for (const item of odds) {
    for (const bk of (item as any).bookmakers ?? []) {
      if ((bk as any).id === BET365_BOOKMAKER_ID) {
        return { has: true, markets: (bk.bets ?? []).length };
      }
    }
  }
  return { has: false, markets: 0 };
}

export function analyzeMatch(input: GoalAnalysisInput, bucket: 'live_0_0' | 'upcoming'): GoalAnalysisResult {
  const pp = input.prediction?.predictions ?? {};
  const gg = pp.goals ?? {};
  const bet365 = bet365Stats(input.odds);

  const parseNum = (v: any): number => {
    if (v === null || v === undefined) return 0;
    const s = String(v).replace('-', '0').replace('+', '');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  };

  const xgHome = parseNum(gg.home);
  const xgAway = parseNum(gg.away);
  const xgTotal = xgHome + xgAway;

  // 1) Poisson — full match
  const p05 = probOver(xgHome, xgAway, 0.5);
  const p15 = probOver(xgHome, xgAway, 1.5);
  const p25 = probOver(xgHome, xgAway, 2.5);
  const p35 = probOver(xgHome, xgAway, 3.5);
  const pBtts = probBTTS(xgHome, xgAway);
  const mode = pickModeScore(xgHome, xgAway);
  // 1b) Poisson — first half (0.43 factor, Eagle ALGORITHMS.md convention)
  const htHome = xgHome * FIRST_HALF_FACTOR;
  const htAway = xgAway * FIRST_HALF_FACTOR;
  const pHT05 = probOver(htHome, htAway, 0.5);
  const pHT15 = probOver(htHome, htAway, 1.5);

  // 2) Odds consensus (Bet365 market'ları)
  // FT Over/Under (bet id=5): "Goals Over/Under"
  // HT Over/Under (bet id=6): "Goals Over/Under First Half"
  // BTTS (bet id=8): "Both Teams Score"
  // HT BTTS (bet id=34): "Both Teams Score - First Half"
  const oddO25 = bestOddsExact(input.odds, 'goals over/under', 'over 2.5');
  const oddO15 = bestOddsExact(input.odds, 'goals over/under', 'over 1.5');
  const oddBTTS = bestOddsExact(input.odds, 'both teams score', 'yes', (n) => !n.includes('half'));
  const oddHTOver05 = bestOddsExact(input.odds, 'first half', 'over 0.5');
  const oddHTOver15 = bestOddsExact(input.odds, 'first half', 'over 1.5');
  const oddHTBTTS = bestOddsExact(input.odds, 'both teams score - first half', 'yes');
  const impO25 = impliedProb(oddO25);
  const impBTTS = impliedProb(oddBTTS);

  // 3) H2H
  const h2hAvg = h2hGoalAverage(input.h2h ?? []);
  const h2hBtts = h2hBttsRatio(input.h2h ?? []);
  const h2hN = input.h2h?.length ?? 0;

  const advice = (pp.advice ?? '').toString().toLowerCase();
  const uo = pp.under_over ? String(pp.under_over) : null;
  const adviceSupportsO25 = advice.includes('+2.5') || advice.includes('over 2.5');

  // 5) PROBET ENGINE (Dixon-Coles + Gradient Boost Ensemble — 783K maç kalibrasyonu)
  const probetPred = input.probet;
  const probetO25 = findProBetPick(probetPred, 'üst 2.5') || findProBetPick(probetPred, 'over 2.5');
  const probetBTTS = findProBetPick(probetPred, 'kg var') || findProBetPick(probetPred, 'btts') || findProBetPick(probetPred, 'karşılıklı');
  const probetHT05 = findProBetPick(probetPred, 'iy 0.5') || findProBetPick(probetPred, 'ht 0.5') || findProBetPick(probetPred, 'ilk yarı');

  // 6) PROBET ODDS-PATTERNS (40+ backtest-calibrated pattern'ler)
  const snap = buildLiveOddsSnapshot(input.odds);
  const matchedRaw = safeMatchPatterns(snap);
  const matchedPatterns = matchedRaw.map((pm: any) => ({
    id: pm.pattern?.id ?? '',
    name: pm.pattern?.name ?? '',
    prediction: pm.pattern?.prediction ?? '',
    hitRate: pm.hitRate ?? 0,
    banko: pm.isBanko ?? false,
  }));
  // Pattern prediction → market destekçisi
  const patternSupportsO25 = matchedPatterns.some((p) => p.prediction === 'OVER_25' && p.hitRate >= 0.60);
  const patternSupportsBTTS = matchedPatterns.some((p) => p.prediction === 'BTTS_YES' && p.hitRate >= 0.60);
  const patternSupportsHT05 = matchedPatterns.some((p) => (p.prediction === 'HT_OVER_05' || p.prediction === 'HT_05_OVER') && p.hitRate >= 0.60);

  // MARKET-BAZLI 6-KAYNAK SAĞLAMA
  const supO25 = {
    poisson: p25 >= 0.65,
    odds: impO25 !== null && impO25 >= 0.60,
    h2h: h2hAvg !== null && h2hAvg >= 2.8,
    advice: adviceSupportsO25,
    probet: probetO25 !== null && probetO25.probability >= 0.60,
    patterns: patternSupportsO25,
    count: 0,
  };
  supO25.count = [supO25.poisson, supO25.odds, supO25.h2h, supO25.advice, supO25.probet, supO25.patterns].filter(Boolean).length;

  const supBTTS = {
    poisson: pBtts >= 0.60,
    odds: oddBTTS !== null && oddBTTS <= 1.85,
    h2h: h2hBtts !== null && h2hBtts >= 0.5,
    probet: probetBTTS !== null && probetBTTS.probability >= 0.58,
    patterns: patternSupportsBTTS,
    count: 0,
  };
  supBTTS.count = [supBTTS.poisson, supBTTS.odds, supBTTS.h2h, supBTTS.probet, supBTTS.patterns].filter(Boolean).length;

  const supHT05 = {
    poisson: pHT05 >= 0.60,
    odds: (oddHTOver05 !== null && oddHTOver05 <= 1.60)
         || (oddHTOver15 !== null && oddHTOver15 <= 2.20),
    probet: probetHT05 !== null && probetHT05.probability >= 0.60,
    patterns: patternSupportsHT05,
    count: 0,
  };
  supHT05.count = [supHT05.poisson, supHT05.odds, supHT05.probet, supHT05.patterns].filter(Boolean).length;

  // Composite confidence (0-100) — 6-kaynak sağlama ağırlıklı
  const sigPoisson = p25 * 25 + pBtts * 12 + pHT05 * 8;     // max 45
  const sigSupportO25 = (supO25.count / 6) * 30;             // max 30 (6/6)
  const sigSupportBTTS = (supBTTS.count / 5) * 15;           // max 15 (5/5)
  const sigSupportHT05 = (supHT05.count / 4) * 10;           // max 10 (4/4)
  // ProBet bestPick confidence'ı da pay et (kendi weighted score'u)
  const probetBestProb = probetPred?.bestPick?.probability ?? 0;
  const sigProbetPrimary = probetBestProb * 10; // max 10
  const confidence = Math.min(100, Math.max(0, sigPoisson + sigSupportO25 + sigSupportBTTS + sigSupportHT05 + sigProbetPrimary));

  // Patterns — market başına 6-kaynak sağlama + ProBet odds-patterns dahil
  const patterns: string[] = [];
  if (supO25.count >= 5) patterns.push(`🎯🎯 O2.5 Tam Sağlama (${supO25.count}/6)`);
  else if (supO25.count === 4) patterns.push(`🎯 O2.5 Güçlü Sağlama (4/6)`);
  else if (supO25.count === 3) patterns.push(`O2.5 Sağlama (3/6)`);
  if (supBTTS.count >= 4) patterns.push(`🎯🎯 KG Tam Sağlama (${supBTTS.count}/5)`);
  else if (supBTTS.count === 3) patterns.push(`🎯 KG Güçlü Sağlama (3/5)`);
  if (supHT05.count >= 3) patterns.push(`🎯 İY 0.5 Üst Sağlama (${supHT05.count}/4)`);
  // Banko odds-patterns (ProBet 783K kalibre)
  for (const mp of matchedPatterns.filter((p) => p.banko).slice(0, 3)) {
    patterns.push(`📊 ${mp.name} (%${(mp.hitRate * 100).toFixed(0)})`);
  }

  // Recommendation — 6-kaynak sağlamasına dayalı
  let recommendation = 'Veri yetersiz';
  if (supO25.count >= 5 && supBTTS.count >= 3) recommendation = 'Üst 2.5 & KG Var (Full Onay)';
  else if (supO25.count >= 5) recommendation = 'Üst 2.5 (Full Onay)';
  else if (supO25.count >= 4 && supHT05.count >= 3) recommendation = 'İY Gol + Üst 2.5';
  else if (supO25.count >= 4 && supBTTS.count >= 3) recommendation = 'Üst 2.5 & KG Var';
  else if (supBTTS.count >= 4) recommendation = 'KG Var (Tam Sağlama)';
  else if (supO25.count >= 3) recommendation = 'Üst 2.5';
  else if (supHT05.count >= 3) recommendation = 'İY 0.5 Üst';
  else if (supBTTS.count >= 3) recommendation = 'KG Var';
  else if (probetPred?.bestPick?.probability >= 0.70) recommendation = `ProBet: ${probetPred.bestPick.marketLabel}`;
  else if (p15 >= 0.88 && (oddO15 ?? 99) <= 1.30) recommendation = 'Üst 1.5 (banko)';
  else if (p05 >= 0.95) recommendation = 'Üst 0.5 (banko)';

  return {
    fixtureId: input.fixtureId,
    homeName: input.homeName,
    awayName: input.awayName,
    leagueName: input.leagueName,
    country: input.country,
    kickoffUtc: input.kickoffUtc,
    statusShort: input.statusShort,
    elapsed: input.elapsed,
    bucket,
    xgHome,
    xgAway,
    xgTotal: +xgTotal.toFixed(2),
    poissonOver05: +(p05 * 100).toFixed(1),
    poissonOver15: +(p15 * 100).toFixed(1),
    poissonOver25: +(p25 * 100).toFixed(1),
    poissonOver35: +(p35 * 100).toFixed(1),
    poissonBTTS: +(pBtts * 100).toFixed(1),
    poissonHTOver05: +(pHT05 * 100).toFixed(1),
    poissonHTOver15: +(pHT15 * 100).toFixed(1),
    poissonExactScore: mode,
    oddOver25: oddO25,
    oddOver15: oddO15,
    oddBTTS: oddBTTS,
    impliedOver25: impO25 !== null ? +(impO25 * 100).toFixed(1) : null,
    impliedBTTS: impBTTS !== null ? +(impBTTS * 100).toFixed(1) : null,
    h2hGoalAvg: h2hAvg !== null ? +h2hAvg.toFixed(2) : null,
    h2hMatches: h2hN,
    h2hBttsRate: h2hBtts !== null ? +h2hBtts.toFixed(2) : null,
    hasBet365: bet365.has,
    bet365MarketsCount: bet365.markets,
    oddHTOver05,
    oddHTOver15,
    oddHTBTTS,
    supportO25: supO25,
    supportBTTS: supBTTS,
    supportHT05: supHT05,
    probetO25Prob: probetO25?.probability ?? null,
    probetBTTSProb: probetBTTS?.probability ?? null,
    probetHT05Prob: probetHT05?.probability ?? null,
    probetBestPick: probetPred?.bestPick
      ? { label: probetPred.bestPick.marketLabel ?? probetPred.bestPick.market ?? 'pick', prob: probetPred.bestPick.probability, odds: probetPred.bestPick.marketOdds ?? null }
      : null,
    matchedPatterns: matchedPatterns.slice(0, 8),
    predictionAdvice: (pp.advice ?? '').toString().slice(0, 80),
    underOverHint: uo,
    confidence: +confidence.toFixed(1),
    patterns,
    recommendation,
  };
}

// ────────────────────────────────── orchestrator: fetch → filter → score

export interface GoalAnalyzerOptions {
  date: string;            // YYYY-MM-DD (UTC)
  includeTomorrow?: boolean;
  topN?: number;           // her buckets için döndürülecek top sayısı
  deepAnalysisCount?: number; // odds/h2h çekilecek ilk N xG-sorted maç
  bet365Only?: boolean;    // sadece Bet365'te açılmış fikstürleri döndür (default true)
}

const DEFAULT_OPTS: Required<GoalAnalyzerOptions> = {
  date: '',
  includeTomorrow: false,
  topN: 20,
  deepAnalysisCount: 60, // rate-limit ile 60 call × 2 (odds+h2h) = 120 call @ 3 req/s ≈ 40s
  bet365Only: true,
};

async function apiGet<T = any>(path: string): Promise<T> {
  const KEY = process.env.API_FOOTBALL_KEY || '';
  const url = `https://v3.football.api-sports.io${path}`;
  const res = await fetch(url, { headers: { 'x-apisports-key': KEY }, cache: 'no-store' });
  if (!res.ok) throw new Error(`Upstream ${res.status}`);
  return res.json();
}

async function fetchFixturesForDate(date: string): Promise<any[]> {
  const j = await apiGet<any>(`/fixtures?date=${date}`);
  return j.response ?? [];
}

/** Bet365 odds map: fixture ID → full odds response. `/odds?date=X&bookmaker=8` çağrısı
 *  her fixture için tam market yapısını döndürüyor — ikinci fixture-level call gerekmiyor.
 *  Bu hem rate-limit'i rahatlatır hem her bet365-açık fixture için garanti odds sağlar. */
async function fetchBet365OddsForDate(date: string): Promise<Map<number, any[]>> {
  const map = new Map<number, any[]>();
  const consume = (resp: any) => {
    for (const item of resp?.response ?? []) {
      const fid = item?.fixture?.id;
      if (typeof fid === 'number') map.set(fid, [item]);
    }
  };
  try {
    const r1 = await apiGet<any>(`/odds?date=${date}&bookmaker=${BET365_BOOKMAKER_ID}&page=1`);
    consume(r1);
    const totalPages = r1?.paging?.total ?? 1;
    const maxPage = Math.min(totalPages, 10);
    for (let p = 2; p <= maxPage; p++) {
      try {
        const rr = await apiGet<any>(`/odds?date=${date}&bookmaker=${BET365_BOOKMAKER_ID}&page=${p}`);
        consume(rr);
      } catch { /* tek sayfa atla */ }
    }
  } catch { /* empty map means no bet365 data */ }
  return map;
}

/** Geriye uyumluluk için — eski fetchBet365FixtureIdsForDate çağrıları bu wrapper'ı kullanır. */
async function fetchBet365FixtureIdsForDate(date: string): Promise<Set<number>> {
  const ids = new Set<number>();
  try {
    // page 1
    const r1 = await apiGet<any>(`/odds?date=${date}&bookmaker=${BET365_BOOKMAKER_ID}&page=1`);
    for (const item of r1.response ?? []) {
      const fid = item?.fixture?.id;
      if (typeof fid === 'number') ids.add(fid);
    }
    const totalPages = r1?.paging?.total ?? 1;
    // diğer sayfalar (cap 10 sayfa = 1000 fixture, güvenli maksimum)
    const maxPage = Math.min(totalPages, 10);
    if (maxPage > 1) {
      const pages = Array.from({ length: maxPage - 1 }, (_, i) => i + 2);
      await Promise.all(pages.map(async (p) => {
        try {
          const r = await apiGet<any>(`/odds?date=${date}&bookmaker=${BET365_BOOKMAKER_ID}&page=${p}`);
          for (const item of r.response ?? []) {
            const fid = item?.fixture?.id;
            if (typeof fid === 'number') ids.add(fid);
          }
        } catch { /* ignore single page errors */ }
      }));
    }
  } catch { /* ignore — empty set means no bet365 data */ }
  return ids;
}

// Upstream ~300 req/min limit. Hedef 4 req/s:
// concurrency 4 + 800-1200ms jitter → ~3-4 req/s → dakikada ~200 request (güvenli).
async function parallelFetch<T>(items: any[], fn: (x: any) => Promise<T>, concurrency = 4): Promise<T[]> {
  const results: T[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const my = idx++;
      try {
        results[my] = await fn(items[my]);
      } catch {
        (results as any)[my] = null;
      }
      await new Promise((r) => setTimeout(r, 800 + Math.floor(Math.random() * 400)));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

// In-memory cache — aynı date+options için 10 dakika TTL (upstream rate-limit korur)
interface CacheEntry { expiry: number; data: any; }
const GA_CACHE = new Map<string, CacheEntry>();
const GA_CACHE_TTL_MS = 10 * 60 * 1000;
function gaCacheKey(o: Required<GoalAnalyzerOptions>): string {
  return `ga:${o.date}:${o.includeTomorrow}:${o.topN}:${o.deepAnalysisCount}:${o.bet365Only}`;
}

// ProBet bulk predictions — major leagues only (Gradient Boost training heavy)
// Tüm ligler için 60s+ sürer; major ligle sınırlandırılırsa <30s.
async function fetchProBetPredictions(date: string, baseUrl: string): Promise<Map<number, any>> {
  const map = new Map<number, any>();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000); // 45s cap
    const r = await fetch(`${baseUrl}/api/probet?date=${date}&limit=40&majorLeagues=true`, {
      cache: 'no-store',
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return map;
    const j = await r.json();
    const preds: any[] = j?.data?.predictions ?? j?.data ?? [];
    for (const p of preds) if (typeof p?.fixtureId === 'number') map.set(p.fixtureId, p);
  } catch { /* ignore abort / network */ }
  return map;
}

export async function runGoalAnalyzer(opts: GoalAnalyzerOptions & { baseUrl?: string }): Promise<{
  date: string;
  totalCandidates: number;
  analyzed: number;
  night: GoalAnalysisResult[];
  tomorrow: GoalAnalysisResult[];
  meta: { fetchedAt: string; durationMs: number; cached: boolean };
}> {
  const o = { ...DEFAULT_OPTS, ...opts };
  const start = Date.now();

  // In-memory cache check
  const ckey = gaCacheKey(o as any);
  const hit = GA_CACHE.get(ckey);
  if (hit && hit.expiry > Date.now()) {
    return { ...hit.data, meta: { ...hit.data.meta, cached: true } };
  }
  // Her zaman internal loopback — external'a gitmek (pro.awastats.com) Cloudflare/Traefik
  // üzerinden geri döner, rate-limit + SSL gereksiz maliyet.
  const baseUrl = 'http://127.0.0.1:5000';
  const tomorrow = new Date(o.date + 'T00:00:00Z');
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  // Aynı anda fixtures + bet365 odds map çek. Pre-filter call'ı tüm market'ları içerdiği için odds'u burada elde ediyoruz.
  const [fxToday, fxTomorrow, b365OddsToday, b365OddsTomorrow] = await Promise.all([
    fetchFixturesForDate(o.date),
    o.includeTomorrow ? fetchFixturesForDate(tomorrowStr) : Promise.resolve<any[]>([]),
    o.bet365Only ? fetchBet365OddsForDate(o.date) : Promise.resolve(new Map<number, any[]>()),
    o.bet365Only && o.includeTomorrow ? fetchBet365OddsForDate(tomorrowStr) : Promise.resolve(new Map<number, any[]>()),
  ]);

  const bet365OddsMap = new Map<number, any[]>([...b365OddsToday, ...b365OddsTomorrow]);
  const bet365All = new Set<number>(bet365OddsMap.keys());
  const totalRawFixtures = fxToday.length + fxTomorrow.length;

  // Filter — upcoming or live 0-0 + (bet365-only ise) fixture bet365'te olmalı
  const targets: Array<{ match: any; bucket: 'live_0_0' | 'upcoming' }> = [];
  const collect = (arr: any[]) => {
    for (const m of arr) {
      if (o.bet365Only && !bet365All.has(m.fixture.id)) continue;
      const st = m.fixture.status.short;
      const total = (m.goals.home ?? 0) + (m.goals.away ?? 0);
      if (st === 'NS' || st === 'TBD') targets.push({ match: m, bucket: 'upcoming' });
      else if (['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE'].includes(st) && total === 0) {
        targets.push({ match: m, bucket: 'live_0_0' });
      }
    }
  };
  collect(fxToday);
  collect(fxTomorrow);

  const totalCandidates = targets.length;

  // Stage 1: lightweight predictions for ALL
  const preds = await parallelFetch(targets, async (t) => {
    try {
      const r = await apiGet<any>(`/predictions?fixture=${t.match.fixture.id}`);
      return { fid: t.match.fixture.id, data: r.response?.[0] ?? null };
    } catch { return { fid: t.match.fixture.id, data: null }; }
  }, 25);

  const predMap = new Map<number, any>();
  for (const p of preds) if (p && p.data) predMap.set(p.fid, p.data);

  // xG-sorted preliminary list
  const preliminary = targets
    .map((t) => {
      const pred = predMap.get(t.match.fixture.id);
      const g = pred?.predictions?.goals;
      const xg = (parseFloat(String(g?.home ?? '0').replace('-', '0')) || 0)
        + (parseFloat(String(g?.away ?? '0').replace('-', '0')) || 0);
      return { t, pred, xg };
    })
    .sort((a, b) => b.xg - a.xg);

  const deepCount = Math.min(o.deepAnalysisCount, preliminary.length);
  const deepSlice = preliminary.slice(0, deepCount);

  // Odds ZATEN pre-filter call'ında geldi — sadece H2H çekeceğiz
  const h2hResults = await parallelFetch(deepSlice, async (p) => {
    try {
      const pair = `${p.t.match.teams.home.id}-${p.t.match.teams.away.id}`;
      const r = await apiGet<any>(`/fixtures/headtohead?h2h=${pair}&last=6`);
      return { fid: p.t.match.fixture.id, data: r.response ?? [] };
    } catch { return { fid: p.t.match.fixture.id, data: [] }; }
  }, 6);

  // oddsMap = pre-filter'dan direkt kopyala (bet365Only modunda zaten hazır)
  const oddsMap = new Map<number, any>(bet365OddsMap);
  const h2hMap = new Map<number, any>();
  for (const r of h2hResults) if (r) h2hMap.set(r.fid, r.data);

  // ProBet bulk predictions — tek seferlik çağrı (bu ve yarının tarihi için)
  const [probetToday, probetTmr] = await Promise.all([
    fetchProBetPredictions(o.date, baseUrl),
    o.includeTomorrow ? fetchProBetPredictions(tomorrowStr, baseUrl) : Promise.resolve(new Map<number, any>()),
  ]);
  const probetMap = new Map<number, any>([...probetToday, ...probetTmr]);

  // Score every preliminary entry
  const scored: GoalAnalysisResult[] = preliminary
    .map(({ t, pred }) => {
      const fid = t.match.fixture.id;
      const input: GoalAnalysisInput = {
        fixtureId: fid,
        homeName: t.match.teams.home.name,
        awayName: t.match.teams.away.name,
        homeId: t.match.teams.home.id,
        awayId: t.match.teams.away.id,
        leagueName: t.match.league.name,
        country: t.match.league.country,
        kickoffUtc: t.match.fixture.date,
        statusShort: t.match.fixture.status.short,
        elapsed: t.match.fixture.status.elapsed ?? null,
        homeGoals: t.match.goals.home ?? null,
        awayGoals: t.match.goals.away ?? null,
        prediction: pred,
        odds: oddsMap.get(fid) ?? null,
        h2h: h2hMap.get(fid) ?? null,
        probet: probetMap.get(fid) ?? null,
      };
      return analyzeMatch(input, t.bucket);
    })
    .sort((a, b) => b.confidence - a.confidence);

  // Bet365 filtering zaten pre-filter olarak targets seviyesinde yapıldı — ek filtreye gerek yok
  const excludedCount = o.bet365Only ? (totalRawFixtures - bet365All.size) : 0;

  const night = scored.filter((s) => s.kickoffUtc.startsWith(o.date)).slice(0, o.topN);
  const tmr = scored.filter((s) => s.kickoffUtc.startsWith(tomorrowStr)).slice(0, o.topN);

  const result = {
    date: o.date,
    totalCandidates,
    analyzed: scored.length,
    bet365Only: o.bet365Only,
    bet365Excluded: excludedCount,
    bet365FixturesOnDates: bet365All.size,
    totalRawFixtures,
    probetPredictionsLoaded: probetMap.size,
    night,
    tomorrow: tmr,
    meta: {
      fetchedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      cached: false,
    },
  };

  GA_CACHE.set(ckey, { expiry: Date.now() + GA_CACHE_TTL_MS, data: result });
  return result;
}
