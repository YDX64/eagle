/**
 * Poisson + xG Base Model
 *
 * Implementation of the Dixon-Coles inspired Poisson goal model,
 * augmented with xG (expected goals) for shot quality.
 *
 * Goals scored by each team are modeled as independent Poisson processes
 * where the rate parameters λ are functions of attack/defense strengths.
 *
 * Reference:
 *   - Dixon, M.J. and Coles, S.G. (1997). Modelling Association Football Scores.
 *   - ProphitBet uses similar Poisson modeling internally for goal predictions.
 */

import type { ProBetFeatures } from './feature-engineering';

export interface PoissonXGPrediction {
  // Expected goals
  expectedHomeGoals: number;
  expectedAwayGoals: number;

  // === Match outcome ===
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;

  // Double chance
  homeOrDraw: number; // 1X
  homeOrAway: number; // 12
  drawOrAway: number; // X2

  // Draw No Bet (excluding draw)
  dnbHome: number;
  dnbAway: number;

  // === Goal totals (combined) ===
  over05: number;
  over15: number;
  over25: number;
  over35: number;
  over45: number;
  over55: number;
  under15: number;
  under25: number;
  under35: number;
  under45: number;
  under55: number;

  // === BTTS ===
  bttsYes: number;
  bttsNo: number;

  // BTTS combined with O/U 2.5
  bttsYesAndOver25: number;
  bttsYesAndUnder25: number;
  bttsNoAndOver25: number;
  bttsNoAndUnder25: number;

  // === Team totals — home ===
  homeOver05: number;
  homeOver15: number;
  homeOver25: number;
  homeUnder05: number;
  homeUnder15: number;
  homeUnder25: number;

  // === Team totals — away ===
  awayOver05: number;
  awayOver15: number;
  awayOver25: number;
  awayUnder05: number;
  awayUnder15: number;
  awayUnder25: number;

  // === Clean sheet & Win to nil ===
  homeCleanSheet: number; // away scores 0
  awayCleanSheet: number; // home scores 0
  homeWinToNil: number;
  awayWinToNil: number;

  // === Asian Handicap ===
  ahHomeMinus1: number; // home wins by ≥ 2
  ahHomeMinus15: number; // home wins by ≥ 2
  ahAwayMinus1: number;
  ahAwayMinus15: number;
  ahHomePlus1: number; // home wins or draws or loses by 1
  ahAwayPlus1: number;

  // === Half-time markets (using λ/2 approximation) ===
  htHomeWin: number;
  htDraw: number;
  htAwayWin: number;
  htOver05: number;
  htOver15: number;
  htUnder05: number;
  htUnder15: number;

  // === Half-Time / Full-Time matrix (9 outcomes) ===
  htft: Record<string, number>; // keys: "H/H", "H/D", "H/A", "D/H", ...

  // === Highest scoring half ===
  highestScoringHalf: { firstHalf: number; secondHalf: number; equal: number };

  // === Both halves over 0.5 / 1.5 ===
  bothHalvesOver05: number;
  bothHalvesOver15: number;

  // === Corners (new) ===
  expectedCornersTotal: number;
  expectedCornersHome: number;
  expectedCornersAway: number;
  cornersOver75: number;
  cornersOver85: number;
  cornersOver95: number;
  cornersOver105: number;
  cornersOver115: number;
  cornersUnder75: number;
  cornersUnder85: number;
  cornersUnder95: number;
  cornersUnder105: number;
  cornersUnder115: number;

  // === Cards (new) ===
  expectedCardsTotal: number;
  cardsOver25: number;
  cardsOver35: number;
  cardsOver45: number;
  cardsOver55: number;
  cardsUnder25: number;
  cardsUnder35: number;
  cardsUnder45: number;
  cardsUnder55: number;

  // === First goal (new) ===
  firstGoalHome: number;
  firstGoalAway: number;
  firstGoalNone: number;

  // === Most likely exact scores (top 10) ===
  topScores: Array<{ score: string; probability: number }>;

  // Confidence (entropy-based)
  confidence: number;
}

/**
 * Poisson PMF: P(X = k | λ)
 */
function poissonPMF(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  // log-space for numerical stability with high goal counts
  const logP = -lambda + k * Math.log(lambda) - logFactorial(k);
  return Math.exp(logP);
}

const LOG_FACTORIAL_CACHE: number[] = [0, 0]; // log(0!) = log(1!) = 0

function logFactorial(n: number): number {
  if (n < LOG_FACTORIAL_CACHE.length) return LOG_FACTORIAL_CACHE[n];
  let result = LOG_FACTORIAL_CACHE[LOG_FACTORIAL_CACHE.length - 1];
  for (let i = LOG_FACTORIAL_CACHE.length; i <= n; i++) {
    result += Math.log(i);
    LOG_FACTORIAL_CACHE.push(result);
  }
  return result;
}

/**
 * Build the joint score probability matrix (home goals × away goals).
 * Each entry [h][a] is P(homeGoals=h, awayGoals=a).
 *
 * Uses the Dixon-Coles tau correction for low-scoring games (0-0, 1-0, 0-1, 1-1)
 * to compensate for the independence assumption breakdown at low scores.
 */
export function buildScoreMatrix(
  lambdaHome: number,
  lambdaAway: number,
  maxGoals: number = 6,
  rho: number = -0.1
): number[][] {
  const matrix: number[][] = [];
  for (let h = 0; h <= maxGoals; h++) {
    matrix.push([]);
    for (let a = 0; a <= maxGoals; a++) {
      let prob = poissonPMF(lambdaHome, h) * poissonPMF(lambdaAway, a);

      // Dixon-Coles correction for low-score adjustment
      if (h === 0 && a === 0) prob *= 1 - lambdaHome * lambdaAway * rho;
      else if (h === 0 && a === 1) prob *= 1 + lambdaHome * rho;
      else if (h === 1 && a === 0) prob *= 1 + lambdaAway * rho;
      else if (h === 1 && a === 1) prob *= 1 - rho;

      matrix[h].push(prob);
    }
  }

  // Normalize to sum to 1
  let total = 0;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      total += matrix[h][a];
    }
  }
  if (total > 0) {
    for (let h = 0; h <= maxGoals; h++) {
      for (let a = 0; a <= maxGoals; a++) {
        matrix[h][a] /= total;
      }
    }
  }
  return matrix;
}

/**
 * Calculate λ (expected goals) for home and away using attack/defense strengths.
 *
 * λ_home = leagueAvgHome * homeAttackStrength * awayDefenseStrength
 * λ_away = leagueAvgAway * awayAttackStrength * homeDefenseStrength
 *
 * Then blend with xG estimates for robustness.
 */
export function computeLambdas(features: ProBetFeatures): {
  lambdaHome: number;
  lambdaAway: number;
} {
  // Defense strengths represent goals conceded - higher is WORSE defense.
  // So a high opponent defense strength inflates expected goals against them.
  const lambdaHomeStrength =
    features.leagueAvgHomeGoals *
    features.homeAttackStrength *
    features.awayDefenseStrength;

  const lambdaAwayStrength =
    features.leagueAvgAwayGoals *
    features.awayAttackStrength *
    features.homeDefenseStrength;

  // Blend with raw xG (50/50) for stability
  const lambdaHome = 0.5 * lambdaHomeStrength + 0.5 * features.homeXG;
  const lambdaAway = 0.5 * lambdaAwayStrength + 0.5 * features.awayXG;

  // Sanity bounds
  return {
    lambdaHome: Math.max(0.1, Math.min(5.5, lambdaHome)),
    lambdaAway: Math.max(0.1, Math.min(5.0, lambdaAway)),
  };
}

/**
 * Marginal probabilities for ONE team's goal count, P(X=k | λ).
 * Used for team totals (e.g. home over 1.5 = 1 - P(X<=1)).
 */
function teamGoalProbs(lambda: number, maxGoals: number): number[] {
  const probs: number[] = [];
  for (let k = 0; k <= maxGoals; k++) {
    probs.push(poissonPMF(lambda, k));
  }
  return probs;
}

/**
 * P(X > threshold | X ~ Poisson(lambda)) for a total-count market.
 * Used for corners and cards over/under calculations.
 */
function poissonOver(lambda: number, threshold: number): number {
  // Sum P(X=k) for k > threshold
  let cumulative = 0;
  const maxK = Math.floor(threshold);
  for (let k = 0; k <= maxK; k++) {
    cumulative += poissonPMF(lambda, k);
  }
  return Math.max(0, Math.min(1, 1 - cumulative));
}

/**
 * Lambda estimation for corners using a simple model:
 *   λ_corners ≈ base × (1 + (attack_strength - 1) × 0.4)
 *
 * Tuned from backtest results (April 2026):
 *   - High-scoring major leagues (>3.0 goals/match): base 10.2
 *   - Balanced top leagues (2.6-3.0 goals): base 9.5
 *   - Lower divisions / defensive leagues: base 8.0-8.8
 *
 * Home teams typically get ~55% of total corners (home advantage).
 */
function computeCornerLambdas(features: ProBetFeatures): {
  lambdaHome: number;
  lambdaAway: number;
  lambdaTotal: number;
} {
  // Base rate scales with league's total goals expectation
  // Backtest showed we over-estimate corners in 2nd-division/defensive leagues,
  // so we bumped the default down from 9.5 → 8.8
  const totalGoalRate = features.leagueAvgHomeGoals + features.leagueAvgAwayGoals;
  let baseCornerRate = 8.8;
  if (totalGoalRate > 3.0) baseCornerRate = 10.2;
  else if (totalGoalRate > 2.6) baseCornerRate = 9.5;
  else if (totalGoalRate < 2.2) baseCornerRate = 8.0;

  // Home team: 55% of corners, scaled by attack strength vs average
  // Reduced the attack-factor coefficient from 0.5 → 0.4 to prevent extreme values
  const homeAttackFactor = 1 + (features.homeAttackStrength - 1) * 0.4;
  const awayAttackFactor = 1 + (features.awayAttackStrength - 1) * 0.4;
  const homeDefenseFactor = 1 + (features.homeDefenseStrength - 1) * 0.25;
  const awayDefenseFactor = 1 + (features.awayDefenseStrength - 1) * 0.25;

  const lambdaHome = Math.max(
    1.5,
    Math.min(9, baseCornerRate * 0.55 * homeAttackFactor * awayDefenseFactor)
  );
  const lambdaAway = Math.max(
    1.0,
    Math.min(8, baseCornerRate * 0.45 * awayAttackFactor * homeDefenseFactor)
  );

  return {
    lambdaHome,
    lambdaAway,
    lambdaTotal: lambdaHome + lambdaAway,
  };
}

/**
 * Lambda estimation for cards. Base rate ~3.8 yellow+red per match for major
 * European leagues. Scales with match tempo (close matches = more cards),
 * and slightly with league.
 */
function computeCardLambda(features: ProBetFeatures): number {
  const totalGoalRate = features.leagueAvgHomeGoals + features.leagueAvgAwayGoals;
  let baseCardRate = 3.8;
  // Low-scoring defensive leagues tend to be more physical → more cards
  if (totalGoalRate < 2.3) baseCardRate = 4.3;
  else if (totalGoalRate > 3.0) baseCardRate = 3.4;

  // Close matches (small xG gap) tend to be tense → more cards
  const xgGap = Math.abs(features.homeXG - features.awayXG);
  const tenseMultiplier = xgGap < 0.5 ? 1.15 : xgGap > 1.5 ? 0.92 : 1.0;

  return Math.max(1.5, Math.min(7, baseCardRate * tenseMultiplier));
}

/**
 * Predict the full set of markets using the Poisson + xG model.
 * Computes 50+ market probabilities from a single joint score matrix.
 */
export function predictWithPoissonXG(features: ProBetFeatures): PoissonXGPrediction {
  const { lambdaHome, lambdaAway } = computeLambdas(features);
  const maxGoals = 8; // increased from 6 to capture high-scoring tails
  const matrix = buildScoreMatrix(lambdaHome, lambdaAway, maxGoals);

  // === Aggregate over the joint matrix ===
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let over05 = 0;
  let over15 = 0;
  let over25 = 0;
  let over35 = 0;
  let over45 = 0;
  let over55 = 0;
  let bttsYes = 0;
  let bttsYesAndOver25 = 0;
  let bttsYesAndUnder25 = 0;
  let bttsNoAndOver25 = 0;
  let bttsNoAndUnder25 = 0;

  // Asian Handicap counters
  let ahHomeMinus1 = 0; // home wins by 2+
  let ahHomeMinus15 = 0; // home wins by 2+
  let ahAwayMinus1 = 0;
  let ahAwayMinus15 = 0;
  let ahHomePlus1 = 0; // home doesn't lose by 2+
  let ahAwayPlus1 = 0;

  // Clean sheets
  let homeCleanSheet = 0;
  let awayCleanSheet = 0;
  let homeWinToNil = 0;
  let awayWinToNil = 0;

  const scoresList: Array<{ score: string; probability: number }> = [];

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = matrix[h][a];
      const total = h + a;
      const diff = h - a;
      const btts = h > 0 && a > 0;

      // 1X2
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;

      // Over/Under
      if (total >= 1) over05 += p;
      if (total >= 2) over15 += p;
      if (total >= 3) over25 += p;
      if (total >= 4) over35 += p;
      if (total >= 5) over45 += p;
      if (total >= 6) over55 += p;

      // BTTS combos
      if (btts) {
        bttsYes += p;
        if (total >= 3) bttsYesAndOver25 += p;
        else bttsYesAndUnder25 += p;
      } else {
        if (total >= 3) bttsNoAndOver25 += p;
        else bttsNoAndUnder25 += p;
      }

      // Asian Handicap (-1 for home means home goals - 1 > away goals)
      if (diff >= 2) ahHomeMinus1 += p;
      if (diff >= 2) ahHomeMinus15 += p;
      if (-diff >= 2) ahAwayMinus1 += p;
      if (-diff >= 2) ahAwayMinus15 += p;
      // +1 means h+1 > a (i.e., diff >= 0), counted as win
      if (diff >= 0) ahHomePlus1 += p;
      if (-diff >= 0) ahAwayPlus1 += p;

      // Clean sheets
      if (a === 0) homeCleanSheet += p;
      if (h === 0) awayCleanSheet += p;
      if (a === 0 && h > 0) homeWinToNil += p;
      if (h === 0 && a > 0) awayWinToNil += p;

      scoresList.push({ score: `${h}-${a}`, probability: p });
    }
  }

  // === Team totals (marginal Poisson, not joint matrix) ===
  const homeProbs = teamGoalProbs(lambdaHome, maxGoals);
  const awayProbs = teamGoalProbs(lambdaAway, maxGoals);
  const homeUnder05 = homeProbs[0];
  const homeUnder15 = homeProbs[0] + homeProbs[1];
  const homeUnder25 = homeProbs[0] + homeProbs[1] + homeProbs[2];
  const homeOver05 = 1 - homeUnder05;
  const homeOver15 = 1 - homeUnder15;
  const homeOver25 = 1 - homeUnder25;
  const awayUnder05 = awayProbs[0];
  const awayUnder15 = awayProbs[0] + awayProbs[1];
  const awayUnder25 = awayProbs[0] + awayProbs[1] + awayProbs[2];
  const awayOver05 = 1 - awayUnder05;
  const awayOver15 = 1 - awayUnder15;
  const awayOver25 = 1 - awayUnder25;

  // === Half-time markets — assume goals are uniformly distributed across halves ===
  // λ_HT = λ_FT / 2 (this is the standard Dixon-Coles assumption)
  const lambdaHomeHT = lambdaHome / 2;
  const lambdaAwayHT = lambdaAway / 2;
  const htMatrix = buildScoreMatrix(lambdaHomeHT, lambdaAwayHT, 6);
  let htHomeWin = 0;
  let htDraw = 0;
  let htAwayWin = 0;
  let htOver05 = 0;
  let htOver15 = 0;
  for (let h = 0; h <= 6; h++) {
    for (let a = 0; a <= 6; a++) {
      const p = htMatrix[h][a];
      if (h > a) htHomeWin += p;
      else if (h === a) htDraw += p;
      else htAwayWin += p;
      if (h + a >= 1) htOver05 += p;
      if (h + a >= 2) htOver15 += p;
    }
  }

  // === HT/FT matrix — joint over half-time and full-time ===
  // P(HT=X, FT=Y) ≈ P(HT=X) * P(FT-HT = Y-X | half2)
  // Approximation: assume halves are independent Poisson with same λ/2 parameters.
  const htft: Record<string, number> = {};
  const htOutcomes: Array<'H' | 'D' | 'A'> = ['H', 'D', 'A'];
  for (const ht of htOutcomes) {
    for (const ft of htOutcomes) {
      htft[`${ht}/${ft}`] = 0;
    }
  }
  // For each (h1,a1) HT score and (h2,a2) 2nd half score, compute joint
  // Use coarser grid (5x5 each half) for tractability
  const halfMatrix = buildScoreMatrix(lambdaHomeHT, lambdaAwayHT, 5);
  for (let h1 = 0; h1 <= 5; h1++) {
    for (let a1 = 0; a1 <= 5; a1++) {
      const p1 = halfMatrix[h1][a1];
      if (p1 < 1e-6) continue;
      const htOutcome: 'H' | 'D' | 'A' = h1 > a1 ? 'H' : h1 < a1 ? 'A' : 'D';
      for (let h2 = 0; h2 <= 5; h2++) {
        for (let a2 = 0; a2 <= 5; a2++) {
          const p2 = halfMatrix[h2][a2];
          if (p2 < 1e-6) continue;
          const fh = h1 + h2;
          const fa = a1 + a2;
          const ftOutcome: 'H' | 'D' | 'A' = fh > fa ? 'H' : fh < fa ? 'A' : 'D';
          htft[`${htOutcome}/${ftOutcome}`] += p1 * p2;
        }
      }
    }
  }
  // Normalize htft (small loss from truncation)
  const htftTotal = Object.values(htft).reduce((s, v) => s + v, 0);
  if (htftTotal > 0) {
    for (const k of Object.keys(htft)) htft[k] /= htftTotal;
  }

  // Highest scoring half (using independent Poisson half assumption)
  // P(1st half goals > 2nd half goals) etc.
  let firstHalfHigher = 0;
  let secondHalfHigher = 0;
  let halvesEqual = 0;
  for (let g1 = 0; g1 <= 8; g1++) {
    const p1Total = poissonPMF(lambdaHome / 2 + lambdaAway / 2, g1);
    for (let g2 = 0; g2 <= 8; g2++) {
      const p2Total = poissonPMF(lambdaHome / 2 + lambdaAway / 2, g2);
      const joint = p1Total * p2Total;
      if (g1 > g2) firstHalfHigher += joint;
      else if (g2 > g1) secondHalfHigher += joint;
      else halvesEqual += joint;
    }
  }
  const highestScoringHalf = {
    firstHalf: firstHalfHigher,
    secondHalf: secondHalfHigher,
    equal: halvesEqual,
  };

  // Both halves over 0.5 / 1.5
  const bothHalvesOver05 = htOver05 * htOver05; // P(half1 ≥1) * P(half2 ≥1)
  const bothHalvesOver15 = htOver15 * htOver15;

  // === CORNERS (new) ===
  const cornerLambdas = computeCornerLambdas(features);
  const cornersOver75 = poissonOver(cornerLambdas.lambdaTotal, 7);
  const cornersOver85 = poissonOver(cornerLambdas.lambdaTotal, 8);
  const cornersOver95 = poissonOver(cornerLambdas.lambdaTotal, 9);
  const cornersOver105 = poissonOver(cornerLambdas.lambdaTotal, 10);
  const cornersOver115 = poissonOver(cornerLambdas.lambdaTotal, 11);

  // === CARDS (new) ===
  const cardLambda = computeCardLambda(features);
  const cardsOver25 = poissonOver(cardLambda, 2);
  const cardsOver35 = poissonOver(cardLambda, 3);
  const cardsOver45 = poissonOver(cardLambda, 4);
  const cardsOver55 = poissonOver(cardLambda, 5);

  // === FIRST GOAL (new) ===
  // P(home scores first) under independent Poisson assumption
  //   = λ_home / (λ_home + λ_away) × P(at least 1 goal scored)
  // P(no goal) = P(0-0) = e^(-λ_home) × e^(-λ_away)
  const noGoalProb = Math.exp(-lambdaHome) * Math.exp(-lambdaAway);
  const totalGoalRate = lambdaHome + lambdaAway;
  const homeGoalShare = totalGoalRate > 0 ? lambdaHome / totalGoalRate : 0.5;
  const firstGoalHome = (1 - noGoalProb) * homeGoalShare;
  const firstGoalAway = (1 - noGoalProb) * (1 - homeGoalShare);
  const firstGoalNone = noGoalProb;

  scoresList.sort((a, b) => b.probability - a.probability);

  // Confidence: 1 - normalized entropy of the outcome distribution.
  const probs = [homeWin, draw, awayWin].filter((p) => p > 0);
  const entropy = -probs.reduce((s, p) => s + p * Math.log(p), 0);
  const maxEntropy = Math.log(3); // 3 outcomes
  const confidence = Math.max(0, Math.min(1, 1 - entropy / maxEntropy));

  return {
    expectedHomeGoals: lambdaHome,
    expectedAwayGoals: lambdaAway,
    homeWinProb: homeWin,
    drawProb: draw,
    awayWinProb: awayWin,

    homeOrDraw: homeWin + draw,
    homeOrAway: homeWin + awayWin,
    drawOrAway: draw + awayWin,
    dnbHome: homeWin / Math.max(homeWin + awayWin, 1e-12),
    dnbAway: awayWin / Math.max(homeWin + awayWin, 1e-12),

    over05,
    over15,
    over25,
    over35,
    over45,
    over55,
    under15: 1 - over15,
    under25: 1 - over25,
    under35: 1 - over35,
    under45: 1 - over45,
    under55: 1 - over55,

    bttsYes,
    bttsNo: 1 - bttsYes,
    bttsYesAndOver25,
    bttsYesAndUnder25,
    bttsNoAndOver25,
    bttsNoAndUnder25,

    homeOver05,
    homeOver15,
    homeOver25,
    homeUnder05,
    homeUnder15,
    homeUnder25,

    awayOver05,
    awayOver15,
    awayOver25,
    awayUnder05,
    awayUnder15,
    awayUnder25,

    homeCleanSheet,
    awayCleanSheet,
    homeWinToNil,
    awayWinToNil,

    ahHomeMinus1,
    ahHomeMinus15,
    ahAwayMinus1,
    ahAwayMinus15,
    ahHomePlus1,
    ahAwayPlus1,

    htHomeWin,
    htDraw,
    htAwayWin,
    htOver05,
    htOver15,
    htUnder05: 1 - htOver05,
    htUnder15: 1 - htOver15,

    htft,
    highestScoringHalf,
    bothHalvesOver05,
    bothHalvesOver15,

    // === Corners ===
    expectedCornersTotal: cornerLambdas.lambdaTotal,
    expectedCornersHome: cornerLambdas.lambdaHome,
    expectedCornersAway: cornerLambdas.lambdaAway,
    cornersOver75,
    cornersOver85,
    cornersOver95,
    cornersOver105,
    cornersOver115,
    cornersUnder75: 1 - cornersOver75,
    cornersUnder85: 1 - cornersOver85,
    cornersUnder95: 1 - cornersOver95,
    cornersUnder105: 1 - cornersOver105,
    cornersUnder115: 1 - cornersOver115,

    // === Cards ===
    expectedCardsTotal: cardLambda,
    cardsOver25,
    cardsOver35,
    cardsOver45,
    cardsOver55,
    cardsUnder25: 1 - cardsOver25,
    cardsUnder35: 1 - cardsOver35,
    cardsUnder45: 1 - cardsOver45,
    cardsUnder55: 1 - cardsOver55,

    // === First goal ===
    firstGoalHome,
    firstGoalAway,
    firstGoalNone,

    topScores: scoresList.slice(0, 10),
    confidence,
  };
}
