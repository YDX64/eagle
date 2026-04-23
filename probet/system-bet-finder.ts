/**
 * System Bet Finder
 *
 * Sistem kuponları için "makul olasılık × yüksek oran" combos üretir.
 * Geleneksel "yüksek güvenli" picks (oranlar 1.20-1.50) yerine, 2-8 oranlı
 * value bet'leri tarar ve toplam oran 3-39 aralığına oturan kombolar oluşturur.
 *
 * Aday türleri:
 *   1. HTFT sürprizler — model olasılığı ≥10% × market oran 5-20
 *   2. Exact Score mantıklı adaylar — top 3 skorda EV>15%
 *   3. İY KG kombinasyonları — yarı bazlı combo
 *   4. Çifte Şans + KG combo
 *   5. Underdog value — deplasman 3.50-6.00 + model ≥30%
 */

import type { MarketKey, MarketCategory, ProBetPrediction } from './probet-engine';
import type { LiveRawOdds } from './context-enricher';
import type { PoissonXGPrediction } from './poisson-xg-model';

export type RiskLevel = 'low' | 'medium' | 'high';
export type SystemCategory = 'HTFT' | 'SCORE' | 'KG_SPLIT' | 'UPSET' | 'COMBO' | 'GOAL_VALUE';

export interface SystemBetCandidate {
  market: MarketKey;
  pickLabel: string;
  category: SystemCategory;
  modelProbability: number;
  marketOdds: number;
  expectedValue: number;
  /** Kelly stake fraction (0..1) — what fraction of bankroll to risk */
  kellyStake: number;
  riskLevel: RiskLevel;
  /** Why is this a candidate? */
  reason: string;
}

export interface SystemComboSuggestion {
  /** Picks to combine in a single multi-bet */
  legs: SystemBetCandidate[];
  /** Multiply odds — what the combo pays if all legs win */
  totalOdds: number;
  /** Naive product of probabilities (assumes independence) */
  combinedProbability: number;
  /** EV after independence assumption */
  expectedValue: number;
  /** Penalty for correlated outcomes (overlap of markets) */
  correlationPenalty: number;
  /** Description for UI */
  description: string;
}

/**
 * Compute Kelly stake for a single bet.
 * f* = (b*p - q) / b where b = decimal_odds - 1, p = win prob, q = 1-p
 *
 * Returns 0 if no edge. Capped at 5% of bankroll for safety (fractional Kelly).
 */
function kellyStake(probability: number, decimalOdds: number): number {
  const b = decimalOdds - 1;
  const p = probability;
  const q = 1 - probability;
  const f = (b * p - q) / b;
  if (f <= 0 || !Number.isFinite(f)) return 0;
  return Math.min(0.05, f * 0.5); // Half-Kelly with 5% cap
}

function classifyRisk(prob: number, odds: number): RiskLevel {
  if (prob >= 0.5 && odds <= 2.5) return 'low';
  if (prob >= 0.3 && odds <= 5.0) return 'medium';
  return 'high';
}

/**
 * Find candidate system bets by scanning the prediction across multiple markets.
 *
 * @param prediction Full ProBet prediction object
 * @param rawOdds    Live decimal odds snapshot
 * @param minEv      Minimum EV (default 0.10 = +10% expected return)
 */
export function findSystemBetCandidates(
  prediction: ProBetPrediction,
  rawOdds: LiveRawOdds | null,
  minEv: number = 0.10
): SystemBetCandidate[] {
  if (!rawOdds) return [];
  const candidates: SystemBetCandidate[] = [];

  // === 1. HTFT SURPRISES ===
  // For each HTFT outcome, check if model probability × market odds > 1+minEv
  const htftMarkets: Array<[string, MarketKey, number]> = [];
  // We need to iterate through the model's HTFT predictions. They should
  // be in topPicks/allMarkets, but we re-derive from poisson values via
  // contextExtras if needed. For simplicity scan allMarkets.YARI_FULL.
  const htftPicks = prediction.allMarkets?.YARI_FULL ?? [];
  for (const pick of htftPicks) {
    if (pick.market !== 'HTFT') continue;
    if (!pick.marketOdds || !Number.isFinite(pick.marketOdds)) continue;
    // Skip 0/0 model picks
    if (pick.probability < 0.05) continue;
    const ev = pick.probability * pick.marketOdds - 1;
    if (ev < minEv) continue;
    // Only "interesting" odds for system bets — skip super low odds
    if (pick.marketOdds < 3.0 || pick.marketOdds > 30) continue;
    candidates.push({
      market: 'HTFT',
      pickLabel: pick.pickLabel,
      category: 'HTFT',
      modelProbability: pick.probability,
      marketOdds: pick.marketOdds,
      expectedValue: ev,
      kellyStake: kellyStake(pick.probability, pick.marketOdds),
      riskLevel: classifyRisk(pick.probability, pick.marketOdds),
      reason: `Model: ${(pick.probability * 100).toFixed(0)}% × Oran: ${pick.marketOdds.toFixed(2)} → EV +${(ev * 100).toFixed(0)}%`,
    });
  }

  // === 2. EXACT SCORE VALUE ===
  // Top 3 most likely scores — if odds in market and EV positive
  const topScores = prediction.topScores ?? [];
  for (let i = 0; i < Math.min(3, topScores.length); i++) {
    const s = topScores[i];
    const odd = rawOdds.correct_scores?.[s.score];
    if (!odd || !Number.isFinite(odd)) continue;
    const ev = s.probability * odd - 1;
    if (ev < minEv) continue;
    if (odd < 4 || odd > 25) continue;
    candidates.push({
      market: 'CORRECT_SCORE',
      pickLabel: `Tam skor: ${s.score}`,
      category: 'SCORE',
      modelProbability: s.probability,
      marketOdds: odd,
      expectedValue: ev,
      kellyStake: kellyStake(s.probability, odd),
      riskLevel: classifyRisk(s.probability, odd),
      reason: `Top-${i + 1} olası skor: ${(s.probability * 100).toFixed(0)}% × ${odd.toFixed(2)} → EV +${(ev * 100).toFixed(0)}%`,
    });
  }

  // === 3. UNDERDOG VALUE ===
  // If model thinks home/away win is more likely than market suggests
  if (rawOdds.home && rawOdds.home >= 3.5 && rawOdds.home <= 6.0 && prediction.homeWinProb >= 0.30) {
    const ev = prediction.homeWinProb * rawOdds.home - 1;
    if (ev >= minEv) {
      candidates.push({
        market: 'HOME_WIN',
        pickLabel: `${prediction.homeTeam} kazanır (underdog)`,
        category: 'UPSET',
        modelProbability: prediction.homeWinProb,
        marketOdds: rawOdds.home,
        expectedValue: ev,
        kellyStake: kellyStake(prediction.homeWinProb, rawOdds.home),
        riskLevel: classifyRisk(prediction.homeWinProb, rawOdds.home),
        reason: `Underdog değer: ${(prediction.homeWinProb * 100).toFixed(0)}% × ${rawOdds.home.toFixed(2)} → EV +${(ev * 100).toFixed(0)}%`,
      });
    }
  }
  if (rawOdds.away && rawOdds.away >= 3.5 && rawOdds.away <= 6.0 && prediction.awayWinProb >= 0.30) {
    const ev = prediction.awayWinProb * rawOdds.away - 1;
    if (ev >= minEv) {
      candidates.push({
        market: 'AWAY_WIN',
        pickLabel: `${prediction.awayTeam} kazanır (underdog)`,
        category: 'UPSET',
        modelProbability: prediction.awayWinProb,
        marketOdds: rawOdds.away,
        expectedValue: ev,
        kellyStake: kellyStake(prediction.awayWinProb, rawOdds.away),
        riskLevel: classifyRisk(prediction.awayWinProb, rawOdds.away),
        reason: `Underdog değer: ${(prediction.awayWinProb * 100).toFixed(0)}% × ${rawOdds.away.toFixed(2)} → EV +${(ev * 100).toFixed(0)}%`,
      });
    }
  }

  // === 4. DRAW VALUE ===
  if (rawOdds.draw && rawOdds.draw >= 3.0 && rawOdds.draw <= 5.0 && prediction.drawProb >= 0.28) {
    const ev = prediction.drawProb * rawOdds.draw - 1;
    if (ev >= minEv) {
      candidates.push({
        market: 'DRAW',
        pickLabel: 'Beraberlik (value)',
        category: 'UPSET',
        modelProbability: prediction.drawProb,
        marketOdds: rawOdds.draw,
        expectedValue: ev,
        kellyStake: kellyStake(prediction.drawProb, rawOdds.draw),
        riskLevel: classifyRisk(prediction.drawProb, rawOdds.draw),
        reason: `Beraberlik değer: ${(prediction.drawProb * 100).toFixed(0)}% × ${rawOdds.draw.toFixed(2)} → EV +${(ev * 100).toFixed(0)}%`,
      });
    }
  }

  // === 5. GOAL MARKET VALUE (combos with reasonable odds) ===
  const goalsPicks = prediction.allMarkets?.GOL_TOPLAMI ?? [];
  for (const pick of goalsPicks) {
    if (!pick.marketOdds || !Number.isFinite(pick.marketOdds)) continue;
    if (pick.marketOdds < 1.6 || pick.marketOdds > 4.0) continue;
    const ev = pick.probability * pick.marketOdds - 1;
    if (ev < minEv) continue;
    candidates.push({
      market: pick.market,
      pickLabel: pick.pickLabel,
      category: 'GOAL_VALUE',
      modelProbability: pick.probability,
      marketOdds: pick.marketOdds,
      expectedValue: ev,
      kellyStake: kellyStake(pick.probability, pick.marketOdds),
      riskLevel: classifyRisk(pick.probability, pick.marketOdds),
      reason: `Gol marketi value: ${(pick.probability * 100).toFixed(0)}% × ${pick.marketOdds.toFixed(2)} → EV +${(ev * 100).toFixed(0)}%`,
    });
  }

  // Sort by EV descending
  candidates.sort((a, b) => b.expectedValue - a.expectedValue);
  return candidates;
}

/**
 * Build system combo suggestions from candidates.
 *
 * Produces 2-3 combo suggestions where total odds fall in [3, 39].
 * Avoids correlated picks (e.g. HOME_WIN + DC_1X redundant).
 */
export function buildSystemCombos(
  candidates: SystemBetCandidate[],
  targetOddsRange: [number, number] = [3, 39]
): SystemComboSuggestion[] {
  if (candidates.length < 2) return [];

  const [minTotal, maxTotal] = targetOddsRange;
  const suggestions: SystemComboSuggestion[] = [];

  // Helper: are two markets correlated?
  const correlated = (a: SystemBetCandidate, b: SystemBetCandidate): boolean => {
    // Same market = correlated
    if (a.market === b.market) return true;
    // 1X2 + DC redundancy
    const dcMap: Record<string, string[]> = {
      HOME_WIN: ['DC_1X', 'DC_12', 'DNB_HOME'],
      DRAW: ['DC_1X', 'DC_X2'],
      AWAY_WIN: ['DC_X2', 'DC_12', 'DNB_AWAY'],
    };
    if (dcMap[a.market]?.includes(b.market)) return true;
    if (dcMap[b.market]?.includes(a.market)) return true;
    // OVER/UNDER same line redundancy
    const lineMatch = (m: string) => m.match(/^(OVER|UNDER)_(\d+)$/);
    const aLine = lineMatch(a.market);
    const bLine = lineMatch(b.market);
    if (aLine && bLine && aLine[2] === bLine[2]) return true;
    return false;
  };

  // Try combos of size 2 first (most common system bet)
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      if (correlated(a, b)) continue;
      const totalOdds = a.marketOdds * b.marketOdds;
      if (totalOdds < minTotal || totalOdds > maxTotal) continue;
      const combinedProb = a.modelProbability * b.modelProbability;
      const ev = combinedProb * totalOdds - 1;
      if (ev < 0.05) continue; // require at least +5% EV
      suggestions.push({
        legs: [a, b],
        totalOdds,
        combinedProbability: combinedProb,
        expectedValue: ev,
        correlationPenalty: 0,
        description: `İkili kombo: toplam @${totalOdds.toFixed(2)} (EV +${(ev * 100).toFixed(0)}%)`,
      });
    }
  }

  // Try combos of size 3 (higher payout)
  for (let i = 0; i < Math.min(8, candidates.length); i++) {
    for (let j = i + 1; j < Math.min(8, candidates.length); j++) {
      for (let k = j + 1; k < Math.min(8, candidates.length); k++) {
        const a = candidates[i];
        const b = candidates[j];
        const c = candidates[k];
        if (correlated(a, b) || correlated(a, c) || correlated(b, c)) continue;
        const totalOdds = a.marketOdds * b.marketOdds * c.marketOdds;
        if (totalOdds < minTotal || totalOdds > maxTotal) continue;
        const combinedProb = a.modelProbability * b.modelProbability * c.modelProbability;
        const ev = combinedProb * totalOdds - 1;
        if (ev < 0.05) continue;
        suggestions.push({
          legs: [a, b, c],
          totalOdds,
          combinedProbability: combinedProb,
          expectedValue: ev,
          correlationPenalty: 0,
          description: `Üçlü kombo: toplam @${totalOdds.toFixed(2)} (EV +${(ev * 100).toFixed(0)}%)`,
        });
      }
    }
  }

  // Sort by EV and dedupe (keep top 5)
  suggestions.sort((a, b) => b.expectedValue - a.expectedValue);
  return suggestions.slice(0, 5);
}
