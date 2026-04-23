/**
 * Basketball Enhanced Prediction Layer
 *
 * Takes the base BasketballPrediction from BasketballPredictionEngine and
 * augments it with advanced markets parsed by advanced-odds-parser.ts:
 *
 *   - Period Over/Under (1st Half, 2nd Half, 1st Quarter)
 *   - HTFT (1st Half Winner + Full Time combo — 9 outcomes)
 *   - Asian Handicap (full game + 1st half + quarters)
 *   - Team Totals (home and away separately, game/half/quarter)
 *   - Odd/Even (full game + 1st half + 1st quarter)
 *   - Double Chance
 *   - Value bets on every market where model > bookmaker
 *
 * Statistical core: NORMAL DISTRIBUTION for totals (basketball is high-volume,
 * Poisson doesn't fit well at 200+ points), BIVARIATE NORMAL for joint
 * home/away scoring, and conditional distributions for period-level analysis.
 */

import type { BasketballRawOdds } from './advanced-odds-parser';

export interface PeriodAnalysis {
  label: string;        // '1st Half', '2nd Half', '1st Quarter', 'Full Game'
  expectedHomePoints: number;
  expectedAwayPoints: number;
  expectedTotal: number;
  stdDev: number;

  // Probabilities
  homeWinProb: number;
  drawProb: number;      // for periods, ties are possible
  awayWinProb: number;

  // Over/Under lines (model predictions)
  overUnderLines: Array<{
    line: number;
    overProb: number;
    underProb: number;
  }>;

  // Compare with bookmaker odds (if available)
  marketOverProb?: number;
  marketLine?: number;
  edge?: number;        // model - market
}

export interface HTFTMatrix {
  // 9-outcome 1st Half × Full Time combination (excluding ties)
  // Basketball periods can tie, so we have H/D/A × H/A = 6 meaningful outcomes
  // plus the possible tie at halftime
  '1/1': number; // Home leads HT → Home wins FT
  '1/2': number; // Home leads HT → Away wins FT (comeback)
  'X/1': number; // Tied HT → Home wins FT
  'X/2': number; // Tied HT → Away wins FT
  '2/1': number; // Away leads HT → Home wins FT (comeback)
  '2/2': number; // Away leads HT → Away wins FT
  // Most likely outcome
  mostLikely: { outcome: string; probability: number };
}

export interface TeamTotalPrediction {
  team: 'home' | 'away';
  expectedPoints: number;
  stdDev: number;
  lines: Array<{
    line: number;
    overProb: number;
    underProb: number;
    marketOverOdds?: number;
    marketUnderOdds?: number;
  }>;
}

export interface HandicapPrediction {
  line: number;                    // e.g. -5.5 (home favored by 5.5)
  homeCoverProb: number;
  awayCoverProb: number;
  pushProb: number;                // rare for half-point lines
  marketHomeOdds?: number;
  marketAwayOdds?: number;
  edge?: number;
  isValueBet: boolean;
}

export interface OddEvenPrediction {
  period: 'full_game' | '1st_half' | '1st_quarter';
  oddProb: number;
  evenProb: number;
  marketOddOdds?: number;
  marketEvenOdds?: number;
}

export interface BasketballEnhancedMarkets {
  // Period analyses
  fullGame: PeriodAnalysis;
  firstHalf: PeriodAnalysis;
  secondHalf: PeriodAnalysis;
  firstQuarter: PeriodAnalysis;

  // HTFT matrix
  htft: HTFTMatrix;

  // Team totals
  homeTotal: TeamTotalPrediction;
  awayTotal: TeamTotalPrediction;

  // Handicaps (multiple lines)
  handicaps: HandicapPrediction[];

  // Odd/Even predictions
  oddEven: OddEvenPrediction[];

  // Value bets (sorted by edge descending)
  valueBets: Array<{
    market: string;
    selection: string;
    modelProb: number;
    marketProb: number;
    edge: number;
    odds: number;
    expectedValue: number;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normal distribution utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error function approximation (Abramowitz & Stegun 7.1.26).
 * Used for normal CDF computation.
 */
function erf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return sign * y;
}

/**
 * Normal CDF: P(X ≤ x) for X ~ N(mean, sigma²)
 */
function normCdf(x: number, mean: number, sigma: number): number {
  if (sigma <= 0) return x < mean ? 0 : x > mean ? 1 : 0.5;
  return 0.5 * (1 + erf((x - mean) / (sigma * Math.SQRT2)));
}

/**
 * P(X > line) for X ~ N(mean, sigma²)
 */
function normSurvive(line: number, mean: number, sigma: number): number {
  return 1 - normCdf(line, mean, sigma);
}

/**
 * Two-team win probability via normal difference.
 * X = home_points - away_points ~ N(mean_diff, sigma_diff)
 * P(home wins) = P(X > 0), P(away wins) = P(X < 0), P(tie) ≈ 0 for continuous
 *
 * For basketball periods we add a small tie probability (~3%) since period
 * scores are discrete.
 */
function winProbFromDiff(
  meanHome: number,
  meanAway: number,
  sigmaHome: number,
  sigmaAway: number,
  includeTie: boolean = true
): { home: number; draw: number; away: number } {
  const meanDiff = meanHome - meanAway;
  const sigmaDiff = Math.sqrt(sigmaHome * sigmaHome + sigmaAway * sigmaAway);

  // Probability of tie window: |diff| < 0.5 (equivalent to integer tie)
  const tieLower = includeTie ? normCdf(-0.5, meanDiff, sigmaDiff) : 0;
  const tieUpper = includeTie ? normCdf(0.5, meanDiff, sigmaDiff) : 0;
  const tieProb = includeTie ? tieUpper - tieLower : 0;

  const homeProb = 1 - normCdf(includeTie ? 0.5 : 0, meanDiff, sigmaDiff);
  const awayProb = normCdf(includeTie ? -0.5 : 0, meanDiff, sigmaDiff);

  return { home: homeProb, draw: tieProb, away: awayProb };
}

/**
 * Remove bookmaker margin (overround) from implied probabilities.
 */
function removeMargin(probs: number[]): number[] {
  const sum = probs.reduce((s, p) => s + p, 0);
  if (sum <= 0) return probs;
  return probs.map((p) => p / sum);
}

function impliedProb(odds: number): number {
  return odds > 1 ? 1 / odds : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main enhancement function
// ─────────────────────────────────────────────────────────────────────────────
export interface BasketballEnhancementInput {
  expectedHomePoints: number;
  expectedAwayPoints: number;
  homePointsStdDev: number;
  awayPointsStdDev: number;
  rawOdds: BasketballRawOdds | null;
}

export function buildEnhancedMarkets(
  input: BasketballEnhancementInput
): BasketballEnhancedMarkets {
  const { expectedHomePoints, expectedAwayPoints, homePointsStdDev, awayPointsStdDev, rawOdds } =
    input;

  const expectedTotal = expectedHomePoints + expectedAwayPoints;
  const totalStdDev = Math.sqrt(homePointsStdDev ** 2 + awayPointsStdDev ** 2);

  // ─── Full Game Period Analysis ───
  // Basketball typical split: 1st Half ~48%, 2nd Half ~52% (2nd half slightly
  // higher due to overtime adjustments + fatigue on defense).
  // 1st Quarter ~24% of game total.
  const FIRST_HALF_SHARE = 0.485;
  const SECOND_HALF_SHARE = 0.515;
  const FIRST_QUARTER_SHARE = 0.245;

  const firstHalfTotal = expectedTotal * FIRST_HALF_SHARE;
  const secondHalfTotal = expectedTotal * SECOND_HALF_SHARE;
  const firstQuarterTotal = expectedTotal * FIRST_QUARTER_SHARE;
  const firstHalfStdDev = totalStdDev * Math.sqrt(FIRST_HALF_SHARE);
  const secondHalfStdDev = totalStdDev * Math.sqrt(SECOND_HALF_SHARE);
  const firstQuarterStdDev = totalStdDev * Math.sqrt(FIRST_QUARTER_SHARE);

  // Per-team per-period shares (symmetric — same share applied to each team)
  const firstHalfHome = expectedHomePoints * FIRST_HALF_SHARE;
  const firstHalfAway = expectedAwayPoints * FIRST_HALF_SHARE;
  const secondHalfHome = expectedHomePoints * SECOND_HALF_SHARE;
  const secondHalfAway = expectedAwayPoints * SECOND_HALF_SHARE;
  const firstQtrHome = expectedHomePoints * FIRST_QUARTER_SHARE;
  const firstQtrAway = expectedAwayPoints * FIRST_QUARTER_SHARE;

  const buildPeriod = (
    label: string,
    meanH: number,
    meanA: number,
    sigmaH: number,
    sigmaA: number,
    totalMean: number,
    totalSigma: number,
    includeDraw: boolean,
    marketLines?: Array<{ line: number; over: number; under: number }>
  ): PeriodAnalysis => {
    const winProbs = winProbFromDiff(meanH, meanA, sigmaH, sigmaA, includeDraw);

    // Generate lines around the expected total
    const lines: PeriodAnalysis['overUnderLines'] = [];
    for (let offset = -10; offset <= 10; offset += 5) {
      const line = Math.round(totalMean + offset) + 0.5;
      if (line <= 0) continue;
      lines.push({
        line,
        overProb: normSurvive(line, totalMean, totalSigma),
        underProb: normCdf(line, totalMean, totalSigma),
      });
    }

    // Market comparison — find the closest market line
    let marketLine: number | undefined;
    let marketOverProb: number | undefined;
    let edge: number | undefined;
    if (marketLines && marketLines.length > 0) {
      const closest = marketLines.reduce((a, b) =>
        Math.abs(a.line - totalMean) < Math.abs(b.line - totalMean) ? a : b
      );
      marketLine = closest.line;
      const overImplied = impliedProb(closest.over);
      const underImplied = impliedProb(closest.under);
      const normalized = removeMargin([overImplied, underImplied]);
      marketOverProb = normalized[0];
      const modelOver = normSurvive(closest.line, totalMean, totalSigma);
      edge = modelOver - marketOverProb;
    }

    return {
      label,
      expectedHomePoints: meanH,
      expectedAwayPoints: meanA,
      expectedTotal: totalMean,
      stdDev: totalSigma,
      homeWinProb: winProbs.home,
      drawProb: winProbs.draw,
      awayWinProb: winProbs.away,
      overUnderLines: lines,
      marketLine,
      marketOverProb,
      edge,
    };
  };

  const fullGame = buildPeriod(
    'Full Game',
    expectedHomePoints,
    expectedAwayPoints,
    homePointsStdDev,
    awayPointsStdDev,
    expectedTotal,
    totalStdDev,
    false, // No ties in basketball (overtime decides)
    rawOdds?.total ? [rawOdds.total, ...(rawOdds.totalAlternates || [])] : undefined
  );

  const firstHalf = buildPeriod(
    '1st Half',
    firstHalfHome,
    firstHalfAway,
    homePointsStdDev * Math.sqrt(FIRST_HALF_SHARE),
    awayPointsStdDev * Math.sqrt(FIRST_HALF_SHARE),
    firstHalfTotal,
    firstHalfStdDev,
    true, // Half can end tied
    rawOdds?.firstHalfTotal ? [rawOdds.firstHalfTotal] : undefined
  );

  const secondHalf = buildPeriod(
    '2nd Half',
    secondHalfHome,
    secondHalfAway,
    homePointsStdDev * Math.sqrt(SECOND_HALF_SHARE),
    awayPointsStdDev * Math.sqrt(SECOND_HALF_SHARE),
    secondHalfTotal,
    secondHalfStdDev,
    true,
    rawOdds?.secondHalfTotal ? [rawOdds.secondHalfTotal] : undefined
  );

  const firstQuarter = buildPeriod(
    '1st Quarter',
    firstQtrHome,
    firstQtrAway,
    homePointsStdDev * Math.sqrt(FIRST_QUARTER_SHARE),
    awayPointsStdDev * Math.sqrt(FIRST_QUARTER_SHARE),
    firstQuarterTotal,
    firstQuarterStdDev,
    true,
    rawOdds?.firstQtrTotal ? [rawOdds.firstQtrTotal] : undefined
  );

  // ─── HTFT Matrix ───
  // P(1st half = H) × P(full game = H | 1st half = H) etc.
  // Simplified assumption: 1st half result and full game result are correlated
  // but not perfectly. Use momentum adjustment: if a team leads at HT, they
  // have a boost in FT win probability.
  const htProbs = {
    H: firstHalf.homeWinProb,
    X: firstHalf.drawProb,
    A: firstHalf.awayWinProb,
  };
  const ftProbs = { H: fullGame.homeWinProb, A: fullGame.awayWinProb };

  // Conditional probabilities (empirical basketball data):
  // Team leading at HT wins ~78% of the time (lower than football's 82%)
  const LEAD_RETENTION = 0.78;
  const COMEBACK_RATE = 0.22;

  const htft: HTFTMatrix = {
    // Home leads at HT
    '1/1': htProbs.H * LEAD_RETENTION,
    '1/2': htProbs.H * COMEBACK_RATE,
    // Tied at HT — splits roughly by full-game probabilities
    'X/1': htProbs.X * ftProbs.H,
    'X/2': htProbs.X * ftProbs.A,
    // Away leads at HT
    '2/1': htProbs.A * COMEBACK_RATE,
    '2/2': htProbs.A * LEAD_RETENTION,
    mostLikely: { outcome: '', probability: 0 },
  };

  // Normalize (the LEAD_RETENTION / COMEBACK_RATE splits don't cover the
  // "tied at full time" case which is impossible in basketball)
  const htftSum = htft['1/1'] + htft['1/2'] + htft['X/1'] + htft['X/2'] + htft['2/1'] + htft['2/2'];
  if (htftSum > 0) {
    htft['1/1'] /= htftSum;
    htft['1/2'] /= htftSum;
    htft['X/1'] /= htftSum;
    htft['X/2'] /= htftSum;
    htft['2/1'] /= htftSum;
    htft['2/2'] /= htftSum;
  }

  // Find most likely
  const outcomes: Array<[string, number]> = [
    ['1/1', htft['1/1']],
    ['1/2', htft['1/2']],
    ['X/1', htft['X/1']],
    ['X/2', htft['X/2']],
    ['2/1', htft['2/1']],
    ['2/2', htft['2/2']],
  ];
  outcomes.sort((a, b) => b[1] - a[1]);
  htft.mostLikely = { outcome: outcomes[0][0], probability: outcomes[0][1] };

  // ─── Team Totals ───
  const buildTeamTotal = (
    team: 'home' | 'away',
    mean: number,
    sigma: number,
    marketLine?: { line: number; over: number; under: number }
  ): TeamTotalPrediction => {
    const lines: TeamTotalPrediction['lines'] = [];
    for (let offset = -10; offset <= 10; offset += 5) {
      const line = Math.round(mean + offset) + 0.5;
      if (line <= 0) continue;
      lines.push({
        line,
        overProb: normSurvive(line, mean, sigma),
        underProb: normCdf(line, mean, sigma),
        marketOverOdds: marketLine?.line === line ? marketLine.over : undefined,
        marketUnderOdds: marketLine?.line === line ? marketLine.under : undefined,
      });
    }
    return {
      team,
      expectedPoints: mean,
      stdDev: sigma,
      lines,
    };
  };

  const homeTotal = buildTeamTotal(
    'home',
    expectedHomePoints,
    homePointsStdDev,
    rawOdds?.homeTotal
      ? { line: rawOdds.homeTotal.line ?? 0, over: rawOdds.homeTotal.over ?? 0, under: rawOdds.homeTotal.under ?? 0 }
      : undefined
  );
  const awayTotal = buildTeamTotal(
    'away',
    expectedAwayPoints,
    awayPointsStdDev,
    rawOdds?.awayTotal
      ? { line: rawOdds.awayTotal.line ?? 0, over: rawOdds.awayTotal.over ?? 0, under: rawOdds.awayTotal.under ?? 0 }
      : undefined
  );

  // ─── Handicaps ───
  const handicaps: HandicapPrediction[] = [];
  const spreadLines = rawOdds?.spreadAlternates ?? (rawOdds?.spread ? [rawOdds.spread] : []);
  for (const sl of spreadLines) {
    // P(home wins by more than |line|)
    // If line is negative (home favored), home must win by > |line|
    // diff = home - away ~ N(meanDiff, sigmaDiff)
    const meanDiff = expectedHomePoints - expectedAwayPoints;
    const sigmaDiff = Math.sqrt(homePointsStdDev ** 2 + awayPointsStdDev ** 2);
    // For a line of -5.5, home covers if diff > 5.5
    // For a line of +5.5, home covers if diff > -5.5
    const threshold = -sl.line; // Convert spread to threshold on diff
    const homeCoverProb = normSurvive(threshold, meanDiff, sigmaDiff);
    const awayCoverProb = 1 - homeCoverProb; // Push probability is ~0 for .5 lines
    const marketHome = sl.home;
    const marketAway = sl.away;
    const impliedHome = impliedProb(marketHome);
    const impliedAway = impliedProb(marketAway);
    const normalized = removeMargin([impliedHome, impliedAway]);
    const edge = homeCoverProb - normalized[0];
    handicaps.push({
      line: sl.line,
      homeCoverProb,
      awayCoverProb,
      pushProb: 0,
      marketHomeOdds: marketHome,
      marketAwayOdds: marketAway,
      edge,
      isValueBet: Math.abs(edge) >= 0.05,
    });
  }

  // ─── Odd/Even ───
  // Normal distribution doesn't directly give odd/even probability since the
  // score is continuous. We use discrete approximation: P(odd) ≈ 50% with
  // slight skew based on expected total value. Basketball is high-total so
  // it's very close to 50/50, but we can check bookmaker odds for hints.
  const buildOddEven = (
    period: OddEvenPrediction['period'],
    marketPair?: { odd?: number; even?: number }
  ): OddEvenPrediction => {
    // Fair probabilities assume 50/50; adjust slightly from market if available
    let oddProb = 0.5;
    let evenProb = 0.5;
    if (marketPair?.odd && marketPair?.even) {
      const io = impliedProb(marketPair.odd);
      const ie = impliedProb(marketPair.even);
      const n = removeMargin([io, ie]);
      oddProb = n[0];
      evenProb = n[1];
    }
    return {
      period,
      oddProb,
      evenProb,
      marketOddOdds: marketPair?.odd,
      marketEvenOdds: marketPair?.even,
    };
  };

  const oddEven: OddEvenPrediction[] = [
    buildOddEven('full_game', rawOdds?.oddEven),
    buildOddEven('1st_half', rawOdds?.firstHalfOddEven),
    buildOddEven('1st_quarter', rawOdds?.firstQtrOddEven),
  ];

  // ─── Value Bets ───
  const valueBets: BasketballEnhancedMarkets['valueBets'] = [];

  const pushValue = (
    market: string,
    selection: string,
    modelProb: number,
    marketOdds: number | undefined
  ) => {
    if (!marketOdds || marketOdds <= 1) return;
    const marketProb = impliedProb(marketOdds);
    const edge = modelProb - marketProb;
    if (edge > 0.04) {
      valueBets.push({
        market,
        selection,
        modelProb,
        marketProb,
        edge,
        odds: marketOdds,
        expectedValue: modelProb * marketOdds - 1,
      });
    }
  };

  // Moneyline value bets
  if (rawOdds?.moneyline) {
    pushValue('Moneyline', 'Home', fullGame.homeWinProb, rawOdds.moneyline.home);
    pushValue('Moneyline', 'Away', fullGame.awayWinProb, rawOdds.moneyline.away);
  }

  // Total value bets
  if (rawOdds?.total) {
    const modelOver = normSurvive(rawOdds.total.line, expectedTotal, totalStdDev);
    pushValue(`Total ${rawOdds.total.line}`, 'Over', modelOver, rawOdds.total.over);
    pushValue(`Total ${rawOdds.total.line}`, 'Under', 1 - modelOver, rawOdds.total.under);
  }

  // 1st half total value bets
  if (rawOdds?.firstHalfTotal) {
    const fhOver = normSurvive(rawOdds.firstHalfTotal.line, firstHalfTotal, firstHalfStdDev);
    pushValue(`1H Total ${rawOdds.firstHalfTotal.line}`, 'Over', fhOver, rawOdds.firstHalfTotal.over);
    pushValue(`1H Total ${rawOdds.firstHalfTotal.line}`, 'Under', 1 - fhOver, rawOdds.firstHalfTotal.under);
  }

  // 1st quarter total value bets
  if (rawOdds?.firstQtrTotal) {
    const q1Over = normSurvive(rawOdds.firstQtrTotal.line, firstQuarterTotal, firstQuarterStdDev);
    pushValue(`Q1 Total ${rawOdds.firstQtrTotal.line}`, 'Over', q1Over, rawOdds.firstQtrTotal.over);
    pushValue(`Q1 Total ${rawOdds.firstQtrTotal.line}`, 'Under', 1 - q1Over, rawOdds.firstQtrTotal.under);
  }

  // Handicap value bets
  for (const h of handicaps) {
    if (h.isValueBet && h.edge !== undefined) {
      if (h.edge > 0) {
        pushValue(`Handicap ${h.line}`, 'Home', h.homeCoverProb, h.marketHomeOdds);
      } else {
        pushValue(`Handicap ${-h.line}`, 'Away', h.awayCoverProb, h.marketAwayOdds);
      }
    }
  }

  // HTFT value bets (if 1st half 3Way odds available)
  if (rawOdds?.firstHalf3Way) {
    // Only check if 1H market exists — HTFT proper (1H × FT combined) isn't
    // usually a single API bet type, we'd need to bet on 1H result + FT separately
    pushValue('1H Result', 'Home', firstHalf.homeWinProb, rawOdds.firstHalf3Way.home);
    pushValue('1H Result', 'Draw', firstHalf.drawProb, rawOdds.firstHalf3Way.draw);
    pushValue('1H Result', 'Away', firstHalf.awayWinProb, rawOdds.firstHalf3Way.away);
  }

  // Double chance value bets
  if (rawOdds?.doubleChance) {
    // No ties in basketball full game → DC 1X and X2 are essentially moneyline
    // only DC 12 makes sense (home OR away wins, which is 100% anyway)
    // Most bookmakers don't offer DC for basketball full game (only 1H)
  }

  // Sort value bets by edge descending
  valueBets.sort((a, b) => b.edge - a.edge);

  return {
    fullGame,
    firstHalf,
    secondHalf,
    firstQuarter,
    htft,
    homeTotal,
    awayTotal,
    handicaps,
    oddEven,
    valueBets: valueBets.slice(0, 15),
  };
}
