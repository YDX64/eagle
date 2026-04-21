/**
 * Market Models v1.0 — Einstein-Level Prediction for ALL Markets
 *
 * Her market MatchContext'ten beslenir.
 * Cross-market sinerji: intensity → cards + corners,
 *                       tempo → goals + corners + HT/FT
 *
 * Markets:
 * 1. Goals (O/U 0.5-5.5, team goals)
 * 2. BTTS
 * 3. HT/FT (9 combinations)
 * 4. Exact Score (top 20)
 * 5. First Half Goals (O/U 0.5-2.5)
 * 6. Second Half Goals (O/U 0.5-2.5)
 * 7. Cards (O/U 1.5-6.5, per team, per half)
 * 8. Corners (O/U 7.5-12.5, per team, per half)
 */

import { AdvancedPredictionEngine } from './advanced-prediction-engine';
import type { MatchContext } from './match-context';

// ═══════════════════════════════════════
// POISSON HELPERS
// ═══════════════════════════════════════

const poisson = (k: number, lambda: number) => AdvancedPredictionEngine.poissonProbability(k, lambda);
const poissonCDF = (k: number, lambda: number) => AdvancedPredictionEngine.poissonCumulativeBelow(k, lambda);

/** Negative Binomial PMF — better than Poisson for overdispersed data (cards, corners) */
function negBinomialPMF(k: number, r: number, p: number): number {
  // P(X=k) = C(k+r-1, k) * p^r * (1-p)^k
  const logComb = logGamma(k + r) - logGamma(k + 1) - logGamma(r);
  return Math.exp(logComb + r * Math.log(p) + k * Math.log(1 - p));
}

function logGamma(z: number): number {
  // Stirling approximation for log(Gamma(z))
  if (z <= 0) return 0;
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function negBinomialCDF(k: number, r: number, p: number): number {
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += negBinomialPMF(i, r, p);
  return Math.min(1, sum);
}

// ═══════════════════════════════════════
// RESULT TYPES
// ═══════════════════════════════════════

export interface AllMarketPredictions {
  // 1X2
  matchResult: { home: number; draw: number; away: number };

  // Goals — all lines
  goals: {
    over_0_5: number; over_1_5: number; over_2_5: number;
    over_3_5: number; over_4_5: number; over_5_5: number;
    under_0_5: number; under_1_5: number; under_2_5: number;
    under_3_5: number; under_4_5: number; under_5_5: number;
  };

  // Team Goals
  homeGoals: { over_0_5: number; over_1_5: number; over_2_5: number };
  awayGoals: { over_0_5: number; over_1_5: number; over_2_5: number };

  // BTTS
  btts: { yes: number; no: number };

  // HT/FT (9 combinations)
  htft: {
    '1/1': number; '1/X': number; '1/2': number;
    'X/1': number; 'X/X': number; 'X/2': number;
    '2/1': number; '2/X': number; '2/2': number;
  };
  htResult: { home: number; draw: number; away: number };
  ftResult: { home: number; draw: number; away: number };

  // Exact Score (top 20)
  exactScores: Array<{ score: string; probability: number }>;

  // First Half Goals
  firstHalfGoals: {
    over_0_5: number; over_1_5: number; over_2_5: number;
    homeScore: number; awayScore: number; btts: number;
  };

  // Second Half Goals
  secondHalfGoals: {
    over_0_5: number; over_1_5: number; over_2_5: number;
  };

  // Cards
  cards: {
    totalExpected: number;
    over_1_5: number; over_2_5: number; over_3_5: number;
    over_4_5: number; over_5_5: number; over_6_5: number;
    under_2_5: number; under_3_5: number; under_4_5: number;
    homeOver_0_5: number; homeOver_1_5: number; homeOver_2_5: number;
    awayOver_0_5: number; awayOver_1_5: number; awayOver_2_5: number;
    firstHalf_over_0_5: number; firstHalf_over_1_5: number;
    secondHalf_over_1_5: number; secondHalf_over_2_5: number;
  };

  // Corners
  corners: {
    totalExpected: number;
    over_7_5: number; over_8_5: number; over_9_5: number;
    over_10_5: number; over_11_5: number; over_12_5: number;
    under_8_5: number; under_9_5: number; under_10_5: number;
    homeExpected: number; awayExpected: number;
    homeOver_3_5: number; homeOver_4_5: number; homeOver_5_5: number;
    awayOver_3_5: number; awayOver_4_5: number; awayOver_5_5: number;
    firstHalf_over_4_5: number; secondHalf_over_4_5: number;
  };

  // Confidence & metadata
  confidence: number;
  contextUsed: {
    intensityScore: number;
    tempoScore: number;
    homeDefStyle: string;
    awayDefStyle: string;
    oddsAvailable: boolean;
    xgAdjust: number;
  };
}

// ═══════════════════════════════════════
// MARKET PREDICTION ENGINE
// ═══════════════════════════════════════

export class MarketModels {

  /**
   * Generate ALL market predictions from a single MatchContext
   */
  static predict(ctx: MatchContext): AllMarketPredictions {
    // Apply odds xG adjustment if available
    // Positive xgAdjust favors home, negative favors away — split between the two sides
    const adjHomeXG = Math.max(0.1, ctx.xg.home + ctx.odds.xgAdjust * 0.5);
    const adjAwayXG = Math.max(0.1, ctx.xg.away - ctx.odds.xgAdjust * 0.5);
    const adjTotalXG = adjHomeXG + adjAwayXG;

    return {
      matchResult: this.predict1X2(ctx),
      goals: this.predictGoalLines(adjTotalXG),
      homeGoals: this.predictTeamGoals(adjHomeXG),
      awayGoals: this.predictTeamGoals(adjAwayXG),
      btts: this.predictBTTS(adjHomeXG, adjAwayXG),
      htft: this.predictHTFT(ctx),
      htResult: this.predictHalfResult(ctx.xg.firstHalfHome, ctx.xg.firstHalfAway),
      ftResult: { home: ctx.matchResult.homeProb, draw: ctx.matchResult.drawProb, away: ctx.matchResult.awayProb },
      exactScores: this.predictExactScores(adjHomeXG, adjAwayXG),
      firstHalfGoals: this.predictHalfGoals(ctx.xg.firstHalfHome, ctx.xg.firstHalfAway),
      secondHalfGoals: this.predictSecondHalfGoals(ctx),
      cards: this.predictCards(ctx),
      corners: this.predictCorners(ctx),
      confidence: Math.max(ctx.matchResult.homeProb, ctx.matchResult.drawProb, ctx.matchResult.awayProb),
      contextUsed: {
        intensityScore: ctx.intensity.score,
        tempoScore: ctx.tempo.score,
        homeDefStyle: ctx.defense.homeStyle,
        awayDefStyle: ctx.defense.awayStyle,
        oddsAvailable: ctx.odds.available,
        xgAdjust: ctx.odds.xgAdjust,
      },
    };
  }

  // ──────────────────────────────────────
  // 1X2 (from MatchContext, already calculated)
  // ──────────────────────────────────────
  private static predict1X2(ctx: MatchContext) {
    return {
      home: ctx.matchResult.homeProb,
      draw: ctx.matchResult.drawProb,
      away: ctx.matchResult.awayProb,
    };
  }

  // ──────────────────────────────────────
  // GOALS — All Lines (Poisson CDF)
  // ──────────────────────────────────────
  private static predictGoalLines(totalXG: number) {
    const u05 = poissonCDF(0, totalXG);
    const u15 = poissonCDF(1, totalXG);
    const u25 = poissonCDF(2, totalXG);
    const u35 = poissonCDF(3, totalXG);
    const u45 = poissonCDF(4, totalXG);
    const u55 = poissonCDF(5, totalXG);
    return {
      over_0_5: r((1 - u05) * 100), over_1_5: r((1 - u15) * 100), over_2_5: r((1 - u25) * 100),
      over_3_5: r((1 - u35) * 100), over_4_5: r((1 - u45) * 100), over_5_5: r((1 - u55) * 100),
      under_0_5: r(u05 * 100), under_1_5: r(u15 * 100), under_2_5: r(u25 * 100),
      under_3_5: r(u35 * 100), under_4_5: r(u45 * 100), under_5_5: r(u55 * 100),
    };
  }

  // ──────────────────────────────────────
  // TEAM GOALS
  // ──────────────────────────────────────
  private static predictTeamGoals(xg: number) {
    return {
      over_0_5: r((1 - poisson(0, xg)) * 100),
      over_1_5: r((1 - poissonCDF(1, xg)) * 100),
      over_2_5: r((1 - poissonCDF(2, xg)) * 100),
    };
  }

  // ──────────────────────────────────────
  // BTTS
  // ──────────────────────────────────────
  private static predictBTTS(homeXG: number, awayXG: number) {
    const homeNoGoal = poisson(0, homeXG);
    const awayNoGoal = poisson(0, awayXG);
    const btts = (1 - (homeNoGoal + awayNoGoal - homeNoGoal * awayNoGoal)) * 100;
    return { yes: r(btts), no: r(100 - btts) };
  }

  // ──────────────────────────────────────
  // HT/FT — Bivariate Time-Split Dixon-Coles
  // ──────────────────────────────────────
  private static predictHTFT(ctx: MatchContext) {
    const h1xg = ctx.xg.firstHalfHome;
    const a1xg = ctx.xg.firstHalfAway;
    const h2xg = ctx.xg.secondHalfHome;
    const a2xg = ctx.xg.secondHalfAway;

    // Build HT score grid
    const maxG = 5;
    const htScores: number[][] = []; // htScores[h][a] = probability
    for (let h = 0; h <= maxG; h++) {
      htScores[h] = [];
      for (let a = 0; a <= maxG; a++) {
        htScores[h][a] = poisson(h, h1xg) * poisson(a, a1xg);
      }
    }

    // For each HT score, calculate FT conditional probabilities
    // Key insight: If losing at HT, team gets more aggressive in 2H → xG boost
    const htft: Record<string, number> = {
      '1/1': 0, '1/X': 0, '1/2': 0,
      'X/1': 0, 'X/X': 0, 'X/2': 0,
      '2/1': 0, '2/X': 0, '2/2': 0,
    };

    for (let h1 = 0; h1 <= maxG; h1++) {
      for (let a1 = 0; a1 <= maxG; a1++) {
        const htProb = htScores[h1][a1];
        if (htProb < 0.001) continue;

        const htResult = h1 > a1 ? '1' : h1 < a1 ? '2' : 'X';

        // Conditional 2H xG based on HT situation
        let h2adj = h2xg, a2adj = a2xg;
        if (h1 < a1) { h2adj += 0.15; a2adj -= 0.05; } // Home losing → pushes harder
        if (a1 < h1) { a2adj += 0.15; h2adj -= 0.05; } // Away losing → pushes harder
        if (h1 === a1 && h1 > 0) { h2adj += 0.05; a2adj += 0.05; } // Even, both push

        // Build 2H score grid for this HT state
        for (let h2 = 0; h2 <= maxG; h2++) {
          for (let a2 = 0; a2 <= maxG; a2++) {
            const shProb = poisson(h2, h2adj) * poisson(a2, a2adj);
            const ftH = h1 + h2;
            const ftA = a1 + a2;
            const ftResult = ftH > ftA ? '1' : ftH < ftA ? '2' : 'X';

            const key = `${htResult}/${ftResult}` as keyof typeof htft;
            htft[key] += htProb * shProb;
          }
        }
      }
    }

    // Normalize to 100%
    const total = Object.values(htft).reduce((s, v) => s + v, 0);
    for (const key of Object.keys(htft)) {
      htft[key] = r((htft[key] / total) * 100);
    }

    return htft as AllMarketPredictions['htft'];
  }

  // ──────────────────────────────────────
  // HALF RESULT (Dixon-Coles for 1H)
  // ──────────────────────────────────────
  private static predictHalfResult(h1xg: number, a1xg: number) {
    let rawH = 0, rawD = 0, rawA = 0;
    for (let h = 0; h <= 5; h++) {
      for (let a = 0; a <= 5; a++) {
        const p = poisson(h, h1xg) * poisson(a, a1xg);
        if (h > a) rawH += p; else if (h === a) rawD += p; else rawA += p;
      }
    }
    const t = rawH + rawD + rawA;
    return { home: r(rawH / t * 100), draw: r(rawD / t * 100), away: r(rawA / t * 100) };
  }

  // ──────────────────────────────────────
  // FIRST HALF GOALS
  // ──────────────────────────────────────
  private static predictHalfGoals(h1xg: number, a1xg: number) {
    const total1H = h1xg + a1xg;
    return {
      over_0_5: r((1 - poissonCDF(0, total1H)) * 100),
      over_1_5: r((1 - poissonCDF(1, total1H)) * 100),
      over_2_5: r((1 - poissonCDF(2, total1H)) * 100),
      homeScore: r((1 - poisson(0, h1xg)) * 100),
      awayScore: r((1 - poisson(0, a1xg)) * 100),
      btts: r((1 - poisson(0, h1xg)) * (1 - poisson(0, a1xg)) * 100),
    };
  }

  // ──────────────────────────────────────
  // SECOND HALF GOALS
  // ──────────────────────────────────────
  private static predictSecondHalfGoals(ctx: MatchContext) {
    const total2H = ctx.xg.secondHalfTotal;
    // 2H typically has slightly more goals due to fatigue and tactical changes
    const adjusted = total2H * (1 + ctx.tempo.score * 0.05);
    return {
      over_0_5: r((1 - poissonCDF(0, adjusted)) * 100),
      over_1_5: r((1 - poissonCDF(1, adjusted)) * 100),
      over_2_5: r((1 - poissonCDF(2, adjusted)) * 100),
    };
  }

  // ──────────────────────────────────────
  // EXACT SCORE (Dixon-Coles grid, top 20)
  // ──────────────────────────────────────
  private static predictExactScores(homeXG: number, awayXG: number) {
    const RHO = -0.04;
    const scores: Array<{ score: string; probability: number }> = [];

    for (let h = 0; h <= 6; h++) {
      for (let a = 0; a <= 6; a++) {
        let p = poisson(h, homeXG) * poisson(a, awayXG);
        if (h === 0 && a === 0) p *= (1 - homeXG * awayXG * RHO);
        else if (h === 1 && a === 0) p *= (1 + awayXG * RHO);
        else if (h === 0 && a === 1) p *= (1 + homeXG * RHO);
        else if (h === 1 && a === 1) p *= (1 - RHO);
        p = Math.max(0, p);
        if (p > 0.005) scores.push({ score: `${h}-${a}`, probability: r(p * 100) });
      }
    }

    return scores.sort((a, b) => b.probability - a.probability).slice(0, 20);
  }

  // ──────────────────────────────────────
  // CARDS — Negative Binomial + Context Intensity
  // ──────────────────────────────────────
  private static predictCards(ctx: MatchContext) {
    // Base card rates from team data
    const homeBaseCards = ctx.homeTeam.cardsPerGame;
    const awayBaseCards = ctx.awayTeam.cardsPerGame;

    // Away team penalty: deplasman takımları %18 daha fazla kart görür
    const awayPenalty = 1.18;

    // Context multipliers (Deep Integration!)
    const intensityMult = ctx.intensity.multiplier;
    const refereeStrictness = ctx.referee.strictness;

    // Adjusted card rates
    const homeCards = homeBaseCards * intensityMult * refereeStrictness;
    const awayCards = awayBaseCards * awayPenalty * intensityMult * refereeStrictness;
    const totalCards = homeCards + awayCards;

    // Negative Binomial parameters
    // r controls overdispersion: lower r = more variance
    const rParam = 4.5;
    const pTotal = rParam / (rParam + totalCards);
    const pHome = rParam / (rParam + homeCards);
    const pAway = rParam / (rParam + awayCards);

    // First half: 38% of cards, second half: 62%
    const firstHalfCards = totalCards * 0.38;
    const secondHalfCards = totalCards * 0.62;
    const pFH = rParam / (rParam + firstHalfCards);
    const pSH = rParam / (rParam + secondHalfCards);

    return {
      totalExpected: r(totalCards),
      over_1_5: r((1 - negBinomialCDF(1, rParam, pTotal)) * 100),
      over_2_5: r((1 - negBinomialCDF(2, rParam, pTotal)) * 100),
      over_3_5: r((1 - negBinomialCDF(3, rParam, pTotal)) * 100),
      over_4_5: r((1 - negBinomialCDF(4, rParam, pTotal)) * 100),
      over_5_5: r((1 - negBinomialCDF(5, rParam, pTotal)) * 100),
      over_6_5: r((1 - negBinomialCDF(6, rParam, pTotal)) * 100),
      under_2_5: r(negBinomialCDF(2, rParam, pTotal) * 100),
      under_3_5: r(negBinomialCDF(3, rParam, pTotal) * 100),
      under_4_5: r(negBinomialCDF(4, rParam, pTotal) * 100),
      homeOver_0_5: r((1 - negBinomialCDF(0, rParam, pHome)) * 100),
      homeOver_1_5: r((1 - negBinomialCDF(1, rParam, pHome)) * 100),
      homeOver_2_5: r((1 - negBinomialCDF(2, rParam, pHome)) * 100),
      awayOver_0_5: r((1 - negBinomialCDF(0, rParam, pAway)) * 100),
      awayOver_1_5: r((1 - negBinomialCDF(1, rParam, pAway)) * 100),
      awayOver_2_5: r((1 - negBinomialCDF(2, rParam, pAway)) * 100),
      firstHalf_over_0_5: r((1 - negBinomialCDF(0, rParam, pFH)) * 100),
      firstHalf_over_1_5: r((1 - negBinomialCDF(1, rParam, pFH)) * 100),
      secondHalf_over_1_5: r((1 - negBinomialCDF(1, rParam, pSH)) * 100),
      secondHalf_over_2_5: r((1 - negBinomialCDF(2, rParam, pSH)) * 100),
    };
  }

  // ──────────────────────────────────────
  // CORNERS — Poisson + Possession × Shot-Block × Tempo
  // ──────────────────────────────────────
  private static predictCorners(ctx: MatchContext) {
    // Base corner rates
    let homeCornersBase = ctx.homeTeam.cornersPerGame;
    let awayCornersBase = ctx.awayTeam.cornersPerGame;

    // Home advantage: +0.85 corners
    const homeAdv = 0.85;
    homeCornersBase += homeAdv;

    // Defense style adjustment
    // Low-block opponents → more corners forced against them
    if (ctx.defense.awayStyle === 'low-block') homeCornersBase += 0.6;
    if (ctx.defense.homeStyle === 'low-block') awayCornersBase += 0.6;

    // High-press → fewer corners (ball doesn't reach final third as systematically)
    if (ctx.defense.awayStyle === 'high-press') homeCornersBase -= 0.3;
    if (ctx.defense.homeStyle === 'high-press') awayCornersBase -= 0.3;

    // Tempo multiplier (Deep Integration)
    const tempoMult = ctx.tempo.multiplier;
    homeCornersBase *= tempoMult;
    awayCornersBase *= tempoMult;

    // Possession factor (from context if available)
    const possDiff = ctx.tempo.possessionDiff;
    if (possDiff > 5) homeCornersBase *= 1.08;
    if (possDiff < -5) awayCornersBase *= 1.08;

    const homeCorners = Math.max(2, Math.min(9, homeCornersBase));
    const awayCorners = Math.max(2, Math.min(8, awayCornersBase));
    const totalCorners = homeCorners + awayCorners;

    // First half: 45% corners, second half: 55%
    const firstHalfCorners = totalCorners * 0.45;
    const secondHalfCorners = totalCorners * 0.55;

    return {
      totalExpected: r(totalCorners),
      over_7_5: r((1 - poissonCDF(7, totalCorners)) * 100),
      over_8_5: r((1 - poissonCDF(8, totalCorners)) * 100),
      over_9_5: r((1 - poissonCDF(9, totalCorners)) * 100),
      over_10_5: r((1 - poissonCDF(10, totalCorners)) * 100),
      over_11_5: r((1 - poissonCDF(11, totalCorners)) * 100),
      over_12_5: r((1 - poissonCDF(12, totalCorners)) * 100),
      under_8_5: r(poissonCDF(8, totalCorners) * 100),
      under_9_5: r(poissonCDF(9, totalCorners) * 100),
      under_10_5: r(poissonCDF(10, totalCorners) * 100),
      homeExpected: r(homeCorners),
      awayExpected: r(awayCorners),
      homeOver_3_5: r((1 - poissonCDF(3, homeCorners)) * 100),
      homeOver_4_5: r((1 - poissonCDF(4, homeCorners)) * 100),
      homeOver_5_5: r((1 - poissonCDF(5, homeCorners)) * 100),
      awayOver_3_5: r((1 - poissonCDF(3, awayCorners)) * 100),
      awayOver_4_5: r((1 - poissonCDF(4, awayCorners)) * 100),
      awayOver_5_5: r((1 - poissonCDF(5, awayCorners)) * 100),
      firstHalf_over_4_5: r((1 - poissonCDF(4, firstHalfCorners)) * 100),
      secondHalf_over_4_5: r((1 - poissonCDF(4, secondHalfCorners)) * 100),
    };
  }
}

/** Round to 2 decimal places */
function r(n: number): number { return Math.round(n * 100) / 100; }
