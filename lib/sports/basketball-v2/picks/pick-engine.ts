/**
 * Pick Recommendation Engine
 *
 * The heart of the "what should I bet?" answer. Takes a BasketballV2Prediction
 * and (optionally) real bookmaker odds, then produces clear, categorized
 * betting recommendations with explicit actions.
 *
 * Each recommendation has:
 *   - A strength level (ELITE / STRONG / VALUE / SKIP)
 *   - Model probability vs implied market probability
 *   - Expected Value calculation (+EV is the only way to win long-term)
 *   - Explicit action text: "BU BAHSİ OYNA" / "GÜVENLİ PICK" / "ATLAMA"
 *   - Reasoning: why this is a good/bad bet
 *
 * Strength classification logic (based on Expected Value):
 *   - ELITE:  EV ≥ +10%  (bet confidently)
 *   - STRONG: EV ≥ +5%   (good value)
 *   - VALUE:  EV ≥ +2%   (slight edge, smaller stake)
 *   - FAIR:   -2% < EV < +2%  (roughly fair, skip unless high prob)
 *   - SKIP:   EV < -2%   (market is right, avoid)
 *
 * For markets without real odds (player props), we use "typical NBA market"
 * odds estimates — still useful for identifying high-confidence picks even
 * without real data.
 */

import type { BasketballV2Prediction } from '../engine';
import type { ParsedOdds } from '../odds/fetch-odds';
import type { PlayerPropPrediction } from '../markets/player-props';

export type PickStrength = 'elite' | 'strong' | 'value' | 'fair' | 'skip';

export interface BetRecommendation {
  id: string;
  category:
    | 'moneyline'
    | 'spread'
    | 'total'
    | 'team_total'
    | 'half'
    | 'quarter'
    | 'htft'
    | 'odd_even'
    | 'margin'
    | 'player_points'
    | 'player_rebounds'
    | 'player_assists'
    | 'player_threes'
    | 'player_combo'
    | 'special';

  label: string;          // "Los Angeles Lakers ML"
  pickText: string;       // Sub-label: "Model güçlü pick"
  action: string;         // "BU BAHSİ OYNA" | "GÜVENLİ PICK" | "KAÇIR" | "FAIR"
  strength: PickStrength;

  modelProb: number;      // Our model's probability
  impliedProb: number;    // Market implied probability (1/odds)
  marketOdds: number;     // Real bookmaker odds (or typical market estimate)
  fairOdds: number;       // 1/modelProb (what's "fair" per our model)
  expectedValue: number;  // (modelProb × odds) - 1 — the edge
  kellyFraction: number;  // Kelly Criterion optimal stake fraction (capped at 0.25)

  reasoning: string;      // Human explanation
  oddsSource: 'real' | 'estimated';  // Is marketOdds from real bookmakers?
  playerName?: string;    // For player props
}

export interface PickSummary {
  totalRecommendations: number;
  elitePicks: number;
  strongPicks: number;
  valuePicks: number;
  recommendations: BetRecommendation[];
  // Grouped by category for UI
  byCategory: Record<string, BetRecommendation[]>;
  // Top 3 for hero display
  topPicks: BetRecommendation[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Typical NBA Market Odds Estimates (when no real odds available)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Typical bookmaker odds when real odds aren't available.
 *
 * CRITICAL: These must NOT be derived from our model probability, because
 * then EV would always be zero (we'd just be comparing our model to itself).
 *
 * Instead, we use TYPICAL MARKET LINES based on empirical NBA pricing:
 *   - Main total O/U: ~1.87 each side (sharpest market, 4% house edge)
 *   - Main spread: ~1.87 each side
 *   - Moneyline: varies by favorite strength
 *   - Player points/reb/ast at main line: ~1.85
 *   - DD/TD: depends on player rank (see ddTypicalOdds below)
 *
 * This approach gives us ACTUAL edge detection: if our model says 70% but
 * typical market line is 1.87 (53% implied), we see real +EV (31%).
 */
function estimatePlayerPropOdds(modelProb: number): number {
  // Player prop lines are set near the mean, so main line is always ~1.85-1.95.
  // As we move away from the mean, odds diverge.
  // Key insight: If model says 75% over, bookies typically price ~1.60 (62% implied)
  // leaving room for our 13% edge.
  if (modelProb >= 0.75) return 1.55;
  if (modelProb >= 0.68) return 1.65;
  if (modelProb >= 0.62) return 1.75;
  if (modelProb >= 0.55) return 1.85;
  if (modelProb >= 0.48) return 1.90;
  if (modelProb >= 0.42) return 2.10;
  if (modelProb >= 0.35) return 2.40;
  if (modelProb >= 0.28) return 2.90;
  return 3.50;
}

/**
 * Typical bookmaker odds for match markets (ML/spread/total/etc).
 *
 * Returns a flat odds estimate based on market type and model probability.
 * These are EMPIRICAL typical lines — a heavy favorite in NBA always
 * gets ~1.35-1.50 odds regardless of how confident the model is above 70%.
 */
function estimateMarketOdds(modelProb: number, category: string): number {
  // Main total / spread markets are sharp — ~4% house edge
  if (category === 'total' || category === 'spread' || category === 'team_total') {
    if (modelProb >= 0.75) return 1.35;
    if (modelProb >= 0.68) return 1.48;
    if (modelProb >= 0.62) return 1.65;
    if (modelProb >= 0.55) return 1.80;
    if (modelProb >= 0.48) return 1.92;
    if (modelProb >= 0.42) return 2.15;
    if (modelProb >= 0.35) return 2.55;
    if (modelProb >= 0.28) return 3.15;
    return 4.00;
  }
  // Moneyline — larger margin at extremes
  if (category === 'moneyline') {
    if (modelProb >= 0.80) return 1.20;
    if (modelProb >= 0.72) return 1.35;
    if (modelProb >= 0.65) return 1.50;
    if (modelProb >= 0.58) return 1.70;
    if (modelProb >= 0.52) return 1.85;
    if (modelProb >= 0.45) return 2.00;
    if (modelProb >= 0.38) return 2.35;
    if (modelProb >= 0.30) return 2.90;
    return 3.80;
  }
  // Quarter markets — smaller samples, wider margins
  if (category === 'quarter') {
    if (modelProb >= 0.70) return 1.50;
    if (modelProb >= 0.62) return 1.70;
    if (modelProb >= 0.55) return 1.87;
    return 2.10;
  }
  // HTFT — combo market with natural margin
  if (category === 'htft') {
    if (modelProb >= 0.50) return 1.85;
    if (modelProb >= 0.35) return 2.65;
    if (modelProb >= 0.25) return 3.80;
    if (modelProb >= 0.18) return 5.00;
    if (modelProb >= 0.12) return 7.50;
    return 12.00;
  }
  // Default: use inverse with small margin
  return Math.max(1.15, 1 / Math.min(0.95, modelProb + 0.03));
}

// ─────────────────────────────────────────────────────────────────────────────
// Core scoring functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Expected Value: (probability of winning × payout) - 1
 * +EV means positive expected profit per unit staked.
 */
function computeEV(modelProb: number, odds: number): number {
  return modelProb * odds - 1;
}

/**
 * Kelly Criterion optimal stake fraction.
 * Returns fraction of bankroll to stake. Capped at 0.25 (quarter-Kelly)
 * for safety since variance is high in sports betting.
 *
 * f* = (bp - q) / b
 * where b = odds - 1, p = modelProb, q = 1 - p
 */
function computeKelly(modelProb: number, odds: number): number {
  if (odds <= 1 || modelProb <= 0 || modelProb >= 1) return 0;
  const b = odds - 1;
  const q = 1 - modelProb;
  const fStar = (b * modelProb - q) / b;
  // Cap at quarter-Kelly (0.25) and never below 0
  return Math.max(0, Math.min(0.25, fStar / 4));
}

/**
 * Classify a bet by EV strength.
 * EV thresholds are empirically tuned for NBA markets.
 */
function classifyStrength(ev: number, modelProb: number): PickStrength {
  // Reject any bet where model thinks it's a coin flip (too risky without edge)
  if (modelProb < 0.40) return 'skip';
  if (ev >= 0.10) return 'elite';
  if (ev >= 0.05) return 'strong';
  if (ev >= 0.02) return 'value';
  if (ev >= -0.02) return 'fair';
  return 'skip';
}

/**
 * Get the Turkish action text for a given strength.
 */
function strengthToAction(strength: PickStrength): string {
  switch (strength) {
    case 'elite':  return 'ELİT PICK - Güvenle Oyna';
    case 'strong': return 'GÜÇLÜ - Bu Bahsi Oyna';
    case 'value':  return 'DEĞER - Küçük Miktar';
    case 'fair':   return 'FAIR - Model Eşit';
    case 'skip':   return 'ATLA - Edge Yok';
  }
}

function buildReasoning(
  modelProb: number,
  impliedProb: number,
  ev: number,
  label: string
): string {
  const edgePercent = ((modelProb - impliedProb) * 100).toFixed(1);
  const evPercent = (ev * 100).toFixed(1);

  if (ev >= 0.10) {
    return `Model ${label}'yi %${(modelProb * 100).toFixed(1)} veriyor, piyasa %${(impliedProb * 100).toFixed(1)}. Edge: +%${edgePercent}, EV: +%${evPercent}.`;
  }
  if (ev >= 0.05) {
    return `Güçlü değer: Model %${(modelProb * 100).toFixed(1)} vs piyasa %${(impliedProb * 100).toFixed(1)}, EV +%${evPercent}.`;
  }
  if (ev >= 0.02) {
    return `Hafif değer: Model %${(modelProb * 100).toFixed(1)}, piyasa %${(impliedProb * 100).toFixed(1)}, EV +%${evPercent}.`;
  }
  if (ev >= -0.02) {
    return `Model piyasa ile uyumlu: %${(modelProb * 100).toFixed(1)} vs %${(impliedProb * 100).toFixed(1)}.`;
  }
  return `Piyasa modelden daha iyi fiyatlamış. Edge yok.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main pick generator
// ─────────────────────────────────────────────────────────────────────────────

export function generateBetRecommendations(
  prediction: BasketballV2Prediction,
  realOdds: ParsedOdds | null
): PickSummary {
  const recommendations: BetRecommendation[] = [];
  const m = prediction.markets;

  // ─── Moneyline ─────────────────────────────────────────────
  if (m.matchResult.homeWinProb > 0) {
    const realOddsHome = realOdds?.moneyline?.home;
    const marketOdds = realOddsHome ?? estimateMarketOdds(m.matchResult.homeWinProb, 'moneyline');
    const impliedProb = 1 / marketOdds;
    const ev = computeEV(m.matchResult.homeWinProb, marketOdds);
    const strength = classifyStrength(ev, m.matchResult.homeWinProb);
    if (strength !== 'skip') {
      recommendations.push({
        id: `ml_home`,
        category: 'moneyline',
        label: `${prediction.homeTeam} Kazanır`,
        pickText: `Moneyline — Ev Sahibi`,
        action: strengthToAction(strength),
        strength,
        modelProb: m.matchResult.homeWinProb,
        impliedProb,
        marketOdds,
        fairOdds: 1 / m.matchResult.homeWinProb,
        expectedValue: ev,
        kellyFraction: computeKelly(m.matchResult.homeWinProb, marketOdds),
        reasoning: buildReasoning(
          m.matchResult.homeWinProb,
          impliedProb,
          ev,
          `${prediction.homeTeam} kazanması`
        ),
        oddsSource: realOddsHome ? 'real' : 'estimated',
      });
    }
  }

  if (m.matchResult.awayWinProb > 0) {
    const realOddsAway = realOdds?.moneyline?.away;
    const marketOdds = realOddsAway ?? estimateMarketOdds(m.matchResult.awayWinProb, 'moneyline');
    const impliedProb = 1 / marketOdds;
    const ev = computeEV(m.matchResult.awayWinProb, marketOdds);
    const strength = classifyStrength(ev, m.matchResult.awayWinProb);
    if (strength !== 'skip') {
      recommendations.push({
        id: `ml_away`,
        category: 'moneyline',
        label: `${prediction.awayTeam} Kazanır`,
        pickText: `Moneyline — Deplasman`,
        action: strengthToAction(strength),
        strength,
        modelProb: m.matchResult.awayWinProb,
        impliedProb,
        marketOdds,
        fairOdds: 1 / m.matchResult.awayWinProb,
        expectedValue: ev,
        kellyFraction: computeKelly(m.matchResult.awayWinProb, marketOdds),
        reasoning: buildReasoning(
          m.matchResult.awayWinProb,
          impliedProb,
          ev,
          `${prediction.awayTeam} kazanması`
        ),
        oddsSource: realOddsAway ? 'real' : 'estimated',
      });
    }
  }

  // ─── Spread (Handicap) ─────────────────────────────────────
  // For each alternate handicap line, compute if there's value
  for (const alt of m.handicap.alternateLines) {
    // Home side
    const realSpreadLine = realOdds?.spreadAlts.find((s) => Math.abs(s.line - alt.line) < 0.25);
    const homeOdds = realSpreadLine?.home ?? estimateMarketOdds(alt.homeCoverProb, 'spread');
    const homeImplied = 1 / homeOdds;
    const homeEv = computeEV(alt.homeCoverProb, homeOdds);
    const homeStrength = classifyStrength(homeEv, alt.homeCoverProb);
    if (homeStrength === 'elite' || homeStrength === 'strong') {
      recommendations.push({
        id: `spread_home_${alt.line}`,
        category: 'spread',
        label: `${prediction.homeTeam} ${alt.line > 0 ? '+' : ''}${alt.line}`,
        pickText: `Handikap — Ev Sahibi`,
        action: strengthToAction(homeStrength),
        strength: homeStrength,
        modelProb: alt.homeCoverProb,
        impliedProb: homeImplied,
        marketOdds: homeOdds,
        fairOdds: 1 / alt.homeCoverProb,
        expectedValue: homeEv,
        kellyFraction: computeKelly(alt.homeCoverProb, homeOdds),
        reasoning: buildReasoning(alt.homeCoverProb, homeImplied, homeEv, `handikap ${alt.line}`),
        oddsSource: realSpreadLine ? 'real' : 'estimated',
      });
    }
    // Away side
    const awayOdds = realSpreadLine?.away ?? estimateMarketOdds(alt.awayCoverProb, 'spread');
    const awayImplied = 1 / awayOdds;
    const awayEv = computeEV(alt.awayCoverProb, awayOdds);
    const awayStrength = classifyStrength(awayEv, alt.awayCoverProb);
    if (awayStrength === 'elite' || awayStrength === 'strong') {
      recommendations.push({
        id: `spread_away_${alt.line}`,
        category: 'spread',
        label: `${prediction.awayTeam} ${-alt.line > 0 ? '+' : ''}${-alt.line}`,
        pickText: `Handikap — Deplasman`,
        action: strengthToAction(awayStrength),
        strength: awayStrength,
        modelProb: alt.awayCoverProb,
        impliedProb: awayImplied,
        marketOdds: awayOdds,
        fairOdds: 1 / alt.awayCoverProb,
        expectedValue: awayEv,
        kellyFraction: computeKelly(alt.awayCoverProb, awayOdds),
        reasoning: buildReasoning(alt.awayCoverProb, awayImplied, awayEv, `handikap ${-alt.line}`),
        oddsSource: realSpreadLine ? 'real' : 'estimated',
      });
    }
  }

  // ─── Total Points ──────────────────────────────────────────
  for (const line of m.totalPoints.lines) {
    // Over
    const realTotalLine = realOdds?.totalAlts.find((t) => Math.abs(t.line - line.line) < 0.25);
    const overOdds = realTotalLine?.over ?? estimateMarketOdds(line.overProb, 'total');
    const overImplied = 1 / overOdds;
    const overEv = computeEV(line.overProb, overOdds);
    const overStrength = classifyStrength(overEv, line.overProb);
    if (overStrength === 'elite' || overStrength === 'strong' || overStrength === 'value') {
      recommendations.push({
        id: `total_over_${line.line}`,
        category: 'total',
        label: `Üst ${line.line}`,
        pickText: `Toplam Sayı — Üst`,
        action: strengthToAction(overStrength),
        strength: overStrength,
        modelProb: line.overProb,
        impliedProb: overImplied,
        marketOdds: overOdds,
        fairOdds: 1 / line.overProb,
        expectedValue: overEv,
        kellyFraction: computeKelly(line.overProb, overOdds),
        reasoning: buildReasoning(line.overProb, overImplied, overEv, `Üst ${line.line}`),
        oddsSource: realTotalLine ? 'real' : 'estimated',
      });
    }
    // Under
    const underOdds = realTotalLine?.under ?? estimateMarketOdds(line.underProb, 'total');
    const underImplied = 1 / underOdds;
    const underEv = computeEV(line.underProb, underOdds);
    const underStrength = classifyStrength(underEv, line.underProb);
    if (underStrength === 'elite' || underStrength === 'strong' || underStrength === 'value') {
      recommendations.push({
        id: `total_under_${line.line}`,
        category: 'total',
        label: `Alt ${line.line}`,
        pickText: `Toplam Sayı — Alt`,
        action: strengthToAction(underStrength),
        strength: underStrength,
        modelProb: line.underProb,
        impliedProb: underImplied,
        marketOdds: underOdds,
        fairOdds: 1 / line.underProb,
        expectedValue: underEv,
        kellyFraction: computeKelly(line.underProb, underOdds),
        reasoning: buildReasoning(line.underProb, underImplied, underEv, `Alt ${line.line}`),
        oddsSource: realTotalLine ? 'real' : 'estimated',
      });
    }
  }

  // ─── Team Totals ───────────────────────────────────────────
  for (const line of m.teamTotals.home.lines) {
    if (line.overProb >= 0.55) {
      const odds = estimateMarketOdds(line.overProb, 'team_total');
      const ev = computeEV(line.overProb, odds);
      const strength = classifyStrength(ev, line.overProb);
      if (strength === 'elite' || strength === 'strong') {
        recommendations.push({
          id: `home_total_over_${line.line}`,
          category: 'team_total',
          label: `${prediction.homeTeam} Üst ${line.line}`,
          pickText: `Takım Toplamı — Ev Sahibi Üst`,
          action: strengthToAction(strength),
          strength,
          modelProb: line.overProb,
          impliedProb: 1 / odds,
          marketOdds: odds,
          fairOdds: 1 / line.overProb,
          expectedValue: ev,
          kellyFraction: computeKelly(line.overProb, odds),
          reasoning: buildReasoning(line.overProb, 1 / odds, ev, `Ev sahibi üst ${line.line}`),
          oddsSource: 'estimated',
        });
      }
    }
  }

  // ─── HTFT (Half-Time/Full-Time) ────────────────────────────
  // HTFT is gold when probability × odds gives strong EV because it's a
  // compound market with high payout.
  const htftOutcomes: Array<{ key: keyof typeof m.htft; label: string }> = [
    { key: '1/1' as any, label: `${prediction.homeTeam} İY/MS` },
    { key: '1/2' as any, label: `${prediction.homeTeam} İY - ${prediction.awayTeam} MS` },
    { key: 'X/1' as any, label: `Berabere İY - ${prediction.homeTeam} MS` },
    { key: 'X/2' as any, label: `Berabere İY - ${prediction.awayTeam} MS` },
    { key: '2/1' as any, label: `${prediction.awayTeam} İY - ${prediction.homeTeam} MS` },
    { key: '2/2' as any, label: `${prediction.awayTeam} İY/MS` },
  ];

  for (const { key, label } of htftOutcomes) {
    const prob = (m.htft as any)[key];
    if (prob < 0.08) continue; // Skip very unlikely
    const odds = estimateMarketOdds(prob, 'htft');
    const ev = computeEV(prob, odds);
    const strength = classifyStrength(ev, prob);
    if (strength === 'elite' || strength === 'strong' || strength === 'value') {
      recommendations.push({
        id: `htft_${key}`,
        category: 'htft',
        label,
        pickText: `İY/MS`,
        action: strengthToAction(strength),
        strength,
        modelProb: prob,
        impliedProb: 1 / odds,
        marketOdds: odds,
        fairOdds: 1 / prob,
        expectedValue: ev,
        kellyFraction: computeKelly(prob, odds),
        reasoning: `İY/MS ${label} için güçlü olasılık. ${buildReasoning(prob, 1 / odds, ev, label)}`,
        oddsSource: 'estimated',
      });
    }
  }

  // ─── Quarter markets (Q1 over/under, Q1 winner) ────────────
  for (const [qNum, q] of [[1, m.q1], [2, m.q2], [3, m.q3], [4, m.q4]] as const) {
    // Q winner
    if (q.homeWinProb >= 0.58 || q.awayWinProb >= 0.58) {
      const side: 'home' | 'away' = q.homeWinProb >= q.awayWinProb ? 'home' : 'away';
      const prob = side === 'home' ? q.homeWinProb : q.awayWinProb;
      const teamName = side === 'home' ? prediction.homeTeam : prediction.awayTeam;
      const odds = estimateMarketOdds(prob, 'quarter');
      const ev = computeEV(prob, odds);
      const strength = classifyStrength(ev, prob);
      if (strength === 'elite' || strength === 'strong') {
        recommendations.push({
          id: `q${qNum}_winner_${side}`,
          category: 'quarter',
          label: `${teamName} ${qNum}. Çeyrek Kazanır`,
          pickText: `Çeyrek Kazananı`,
          action: strengthToAction(strength),
          strength,
          modelProb: prob,
          impliedProb: 1 / odds,
          marketOdds: odds,
          fairOdds: 1 / prob,
          expectedValue: ev,
          kellyFraction: computeKelly(prob, odds),
          reasoning: `${qNum}. çeyrek ${teamName} favorisi. ${buildReasoning(prob, 1 / odds, ev, `${qNum}. çeyrek`)}`,
          oddsSource: 'estimated',
        });
      }
    }
    // Q total (main line)
    const mainLine = q.totalLines.find((l: any) => Math.abs(l.line - q.expectedTotal) < 2) ?? q.totalLines[2];
    if (mainLine && (mainLine.overProb >= 0.6 || mainLine.underProb >= 0.6)) {
      const side = mainLine.overProb >= mainLine.underProb ? 'over' : 'under';
      const prob = side === 'over' ? mainLine.overProb : mainLine.underProb;
      const odds = estimateMarketOdds(prob, 'quarter');
      const ev = computeEV(prob, odds);
      const strength = classifyStrength(ev, prob);
      if (strength === 'elite' || strength === 'strong') {
        recommendations.push({
          id: `q${qNum}_total_${side}_${mainLine.line}`,
          category: 'quarter',
          label: `${qNum}. Çeyrek ${side === 'over' ? 'Üst' : 'Alt'} ${mainLine.line}`,
          pickText: `Çeyrek Toplamı`,
          action: strengthToAction(strength),
          strength,
          modelProb: prob,
          impliedProb: 1 / odds,
          marketOdds: odds,
          fairOdds: 1 / prob,
          expectedValue: ev,
          kellyFraction: computeKelly(prob, odds),
          reasoning: buildReasoning(prob, 1 / odds, ev, `${qNum}. çeyrek ${side}`),
          oddsSource: 'estimated',
        });
      }
    }
  }

  // ─── Odd/Even ──────────────────────────────────────────────
  const oddEvenBetter = m.totalPoints.oddProb > m.totalPoints.evenProb ? 'odd' : 'even';
  const oddEvenProb = Math.max(m.totalPoints.oddProb, m.totalPoints.evenProb);
  if (oddEvenProb >= 0.54) {
    const odds = realOdds?.oddEven
      ? oddEvenBetter === 'odd'
        ? realOdds.oddEven.odd
        : realOdds.oddEven.even
      : estimateMarketOdds(oddEvenProb, 'odd_even');
    const ev = computeEV(oddEvenProb, odds);
    const strength = classifyStrength(ev, oddEvenProb);
    if (strength === 'strong' || strength === 'elite' || strength === 'value') {
      recommendations.push({
        id: `oddeven_${oddEvenBetter}`,
        category: 'odd_even',
        label: `${oddEvenBetter === 'odd' ? 'Tek' : 'Çift'} Toplam`,
        pickText: `Tek/Çift`,
        action: strengthToAction(strength),
        strength,
        modelProb: oddEvenProb,
        impliedProb: 1 / odds,
        marketOdds: odds,
        fairOdds: 1 / oddEvenProb,
        expectedValue: ev,
        kellyFraction: computeKelly(oddEvenProb, odds),
        reasoning: buildReasoning(
          oddEvenProb,
          1 / odds,
          ev,
          oddEvenBetter === 'odd' ? 'Tek' : 'Çift'
        ),
        oddsSource: realOdds?.oddEven ? 'real' : 'estimated',
      });
    }
  }

  // ─── Player Props (Points/Rebounds/Assists/3PM/DD/TD) ──────
  //
  // CRITICAL: Only consider lines in the "realistic market range" (50-78% prob).
  // Lines outside this range are trivially easy (e.g. "Over 0.5 assists")
  // or trivially hard — bookmakers wouldn't offer them at typical odds.
  // Real sportsbook player props cluster tightly around the mean where
  // probability is 50-65%.
  const REALISTIC_MIN = 0.55;
  const REALISTIC_MAX = 0.78;
  const isRealistic = (prob: number) => prob >= REALISTIC_MIN && prob <= REALISTIC_MAX;

  // Select the BEST line for a given stat — one that maximizes edge
  // while staying in a realistic market range.
  //
  // Strategy: find the line where modelProb is closest to 0.65 (sweet spot
  // where bookmakers offer value-adjusted lines). This prevents selecting
  // trivially easy lines (like "over 0.5 assists") or trivially hard ones.
  const bestLineInRange = (
    lines: any[],
    minLine: number
  ): { line: any; side: 'over' | 'under' } | null => {
    if (!lines || lines.length === 0) return null;

    let best: { line: any; side: 'over' | 'under'; score: number } | null = null;

    for (const line of lines) {
      // Reject lines below minimum realistic threshold
      if (line.line < minLine) continue;

      // Check OVER side: model favors over
      if (line.overProb >= REALISTIC_MIN && line.overProb <= REALISTIC_MAX) {
        // Score: how close to sweet spot (0.65)
        const score = 1 - Math.abs(line.overProb - 0.65);
        if (!best || score > best.score) {
          best = { line, side: 'over', score };
        }
      }
      // Check UNDER side
      if (line.underProb >= REALISTIC_MIN && line.underProb <= REALISTIC_MAX) {
        const score = 1 - Math.abs(line.underProb - 0.65);
        if (!best || score > best.score) {
          best = { line, side: 'under', score };
        }
      }
    }

    return best ? { line: best.line, side: best.side } : null;
  };

  for (const player of prediction.playerProps) {
    // Skip low-minute role players (unreliable props < 18 mpg)
    if (player.mpg < 18) continue;

    // POINTS — best realistic line only (min 7.5 points)
    const ptsPick = bestLineInRange(player.props.points, 7.5);
    if (ptsPick) {
      const prob = ptsPick.side === 'over' ? ptsPick.line.overProb : ptsPick.line.underProb;
      const odds = estimatePlayerPropOdds(prob);
      const ev = computeEV(prob, odds);
      const strength = classifyStrength(ev, prob);
      if (strength === 'elite' || strength === 'strong' || strength === 'value') {
        const sideText = ptsPick.side === 'over' ? 'Üst' : 'Alt';
        recommendations.push({
          id: `player_${player.playerId}_pts_${ptsPick.side}_${ptsPick.line.line}`,
          category: 'player_points',
          label: `${player.name} Sayı ${sideText} ${ptsPick.line.line}`,
          pickText: `${player.team} — ${player.projected.points.toFixed(1)} ort (${player.gamesPlayed} mac)`,
          action: strengthToAction(strength),
          strength,
          modelProb: prob,
          impliedProb: 1 / odds,
          marketOdds: odds,
          fairOdds: 1 / prob,
          expectedValue: ev,
          kellyFraction: computeKelly(prob, odds),
          reasoning: `${player.name} ortalaması ${player.projected.points.toFixed(1)} sayı, ${player.mpg.toFixed(1)} dk/mac. ${buildReasoning(prob, 1 / odds, ev, `sayı ${sideText} ${ptsPick.line.line}`)}`,
          oddsSource: 'estimated',
          playerName: player.name,
        });
      }
    }

    // REBOUNDS — best realistic line only (min 3.5 rebounds)
    const rebPick = bestLineInRange(player.props.rebounds, 3.5);
    if (rebPick) {
      const prob = rebPick.side === 'over' ? rebPick.line.overProb : rebPick.line.underProb;
      const odds = estimatePlayerPropOdds(prob);
      const ev = computeEV(prob, odds);
      const strength = classifyStrength(ev, prob);
      if (strength === 'elite' || strength === 'strong' || strength === 'value') {
        const sideText = rebPick.side === 'over' ? 'Üst' : 'Alt';
        recommendations.push({
          id: `player_${player.playerId}_reb_${rebPick.side}_${rebPick.line.line}`,
          category: 'player_rebounds',
          label: `${player.name} Ribaund ${sideText} ${rebPick.line.line}`,
          pickText: `${player.team} — ${player.projected.rebounds.toFixed(1)} ort`,
          action: strengthToAction(strength),
          strength,
          modelProb: prob,
          impliedProb: 1 / odds,
          marketOdds: odds,
          fairOdds: 1 / prob,
          expectedValue: ev,
          kellyFraction: computeKelly(prob, odds),
          reasoning: `${player.name} ${player.projected.rebounds.toFixed(1)} ribaund ortalıyor. ${buildReasoning(prob, 1 / odds, ev, `ribaund ${sideText} ${rebPick.line.line}`)}`,
          oddsSource: 'estimated',
          playerName: player.name,
        });
      }
    }

    // ASSISTS — best realistic line only (min 2.5 assists)
    const astPick = bestLineInRange(player.props.assists, 2.5);
    if (astPick) {
      const prob = astPick.side === 'over' ? astPick.line.overProb : astPick.line.underProb;
      const odds = estimatePlayerPropOdds(prob);
      const ev = computeEV(prob, odds);
      const strength = classifyStrength(ev, prob);
      if (strength === 'elite' || strength === 'strong' || strength === 'value') {
        const sideText = astPick.side === 'over' ? 'Üst' : 'Alt';
        recommendations.push({
          id: `player_${player.playerId}_ast_${astPick.side}_${astPick.line.line}`,
          category: 'player_assists',
          label: `${player.name} Asist ${sideText} ${astPick.line.line}`,
          pickText: `${player.team} — ${player.projected.assists.toFixed(1)} ort`,
          action: strengthToAction(strength),
          strength,
          modelProb: prob,
          impliedProb: 1 / odds,
          marketOdds: odds,
          fairOdds: 1 / prob,
          expectedValue: ev,
          kellyFraction: computeKelly(prob, odds),
          reasoning: `${player.name} ${player.projected.assists.toFixed(1)} asist ortalıyor. ${buildReasoning(prob, 1 / odds, ev, `asist ${sideText} ${astPick.line.line}`)}`,
          oddsSource: 'estimated',
          playerName: player.name,
        });
      }
    }

    // 3PM — best realistic line only (min 1.5 threes)
    const threesPick = bestLineInRange(player.props.threesMade, 1.5);
    if (threesPick) {
      const prob = threesPick.side === 'over' ? threesPick.line.overProb : threesPick.line.underProb;
      const odds = estimatePlayerPropOdds(prob);
      const ev = computeEV(prob, odds);
      const strength = classifyStrength(ev, prob);
      if (strength === 'elite' || strength === 'strong' || strength === 'value') {
        const sideText = threesPick.side === 'over' ? 'Üst' : 'Alt';
        recommendations.push({
          id: `player_${player.playerId}_tpm_${threesPick.side}_${threesPick.line.line}`,
          category: 'player_threes',
          label: `${player.name} 3PM ${sideText} ${threesPick.line.line}`,
          pickText: `${player.team} — ${player.projected.threesMade.toFixed(1)} ort`,
          action: strengthToAction(strength),
          strength,
          modelProb: prob,
          impliedProb: 1 / odds,
          marketOdds: odds,
          fairOdds: 1 / prob,
          expectedValue: ev,
          kellyFraction: computeKelly(prob, odds),
          reasoning: `${player.name} ${player.projected.threesMade.toFixed(1)} üçlük ortalıyor. ${buildReasoning(prob, 1 / odds, ev, `3PM ${sideText} ${threesPick.line.line}`)}`,
          oddsSource: 'estimated',
          playerName: player.name,
        });
      }
    }

    // Double-Double (special high-value market)
    if (player.combos.doubleDoubleProb >= 0.35) {
      const typicalOdds = ddTypicalOdds(player.combos.doubleDoubleProb);
      const ev = computeEV(player.combos.doubleDoubleProb, typicalOdds);
      const strength = classifyStrength(ev, player.combos.doubleDoubleProb);
      if (strength === 'elite' || strength === 'strong' || strength === 'value') {
        recommendations.push({
          id: `player_${player.playerId}_dd`,
          category: 'player_combo',
          label: `${player.name} Double-Double Evet`,
          pickText: `${player.team} — DD combo`,
          action: strengthToAction(strength),
          strength,
          modelProb: player.combos.doubleDoubleProb,
          impliedProb: 1 / typicalOdds,
          marketOdds: typicalOdds,
          fairOdds: 1 / player.combos.doubleDoubleProb,
          expectedValue: ev,
          kellyFraction: computeKelly(player.combos.doubleDoubleProb, typicalOdds),
          reasoning: `${player.name} ortalaması ${player.projected.points.toFixed(1)}p/${player.projected.rebounds.toFixed(1)}r/${player.projected.assists.toFixed(1)}a. 5000 multivariate Monte Carlo ile DD olasılığı %${(player.combos.doubleDoubleProb * 100).toFixed(1)}.`,
          oddsSource: 'estimated',
          playerName: player.name,
        });
      }
    }

    // Triple-Double (high-odds, need very confident pick)
    if (player.combos.tripleDoubleProb >= 0.20) {
      const typicalOdds = tdTypicalOdds(player.combos.tripleDoubleProb);
      const ev = computeEV(player.combos.tripleDoubleProb, typicalOdds);
      const strength = classifyStrength(ev, player.combos.tripleDoubleProb);
      if (strength === 'elite' || strength === 'strong') {
        recommendations.push({
          id: `player_${player.playerId}_td`,
          category: 'player_combo',
          label: `${player.name} Triple-Double Evet`,
          pickText: `${player.team} — TD rare pick`,
          action: strengthToAction(strength),
          strength,
          modelProb: player.combos.tripleDoubleProb,
          impliedProb: 1 / typicalOdds,
          marketOdds: typicalOdds,
          fairOdds: 1 / player.combos.tripleDoubleProb,
          expectedValue: ev,
          kellyFraction: computeKelly(player.combos.tripleDoubleProb, typicalOdds),
          reasoning: `${player.name} TD olasılığı %${(player.combos.tripleDoubleProb * 100).toFixed(1)}. Nadir pick ama yüksek EV.`,
          oddsSource: 'estimated',
          playerName: player.name,
        });
      }
    }
  }

  // ─── Sort by strength, then EV descending ──────────────────
  const strengthOrder: Record<PickStrength, number> = {
    elite: 4,
    strong: 3,
    value: 2,
    fair: 1,
    skip: 0,
  };
  recommendations.sort((a, b) => {
    if (strengthOrder[a.strength] !== strengthOrder[b.strength]) {
      return strengthOrder[b.strength] - strengthOrder[a.strength];
    }
    return b.expectedValue - a.expectedValue;
  });

  // ─── Build summary ─────────────────────────────────────────
  const byCategory: Record<string, BetRecommendation[]> = {};
  for (const rec of recommendations) {
    if (!byCategory[rec.category]) byCategory[rec.category] = [];
    byCategory[rec.category].push(rec);
  }

  return {
    totalRecommendations: recommendations.length,
    elitePicks: recommendations.filter((r) => r.strength === 'elite').length,
    strongPicks: recommendations.filter((r) => r.strength === 'strong').length,
    valuePicks: recommendations.filter((r) => r.strength === 'value').length,
    recommendations,
    byCategory,
    topPicks: recommendations.slice(0, 5),
  };
}

/**
 * Typical market odds for Double-Double based on model probability.
 * Star players (40%+ DD): odds ~1.80-2.20
 * Good players (25-40%): odds ~2.50-3.50
 * Role players (15-25%): odds ~4.00-6.00
 */
function ddTypicalOdds(prob: number): number {
  if (prob >= 0.65) return 1.35;
  if (prob >= 0.50) return 1.75;
  if (prob >= 0.40) return 2.15;
  if (prob >= 0.30) return 2.75;
  if (prob >= 0.20) return 3.80;
  return 5.00;
}

/**
 * Typical market odds for Triple-Double.
 * Only elite players have TD markets (Jokic, Luka, LeBron, Dray, Westbrook).
 */
function tdTypicalOdds(prob: number): number {
  if (prob >= 0.45) return 2.00;
  if (prob >= 0.30) return 3.00;
  if (prob >= 0.20) return 4.50;
  if (prob >= 0.12) return 7.00;
  return 12.00;
}
