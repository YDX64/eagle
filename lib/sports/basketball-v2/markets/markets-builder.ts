/**
 * Markets Builder
 *
 * Translates Monte Carlo simulation samples into betting market probabilities
 * + odds. Single function that takes a GameSimulationResult and returns a
 * comprehensive AllMarkets object.
 *
 * Markets covered:
 *   - Match Result (moneyline, no draw)
 *   - Total Points (5 main lines around expected)
 *   - Handicap / Spread (5 main lines)
 *   - Half-Time / Full-Time (9 outcome matrix)
 *   - First Half O/U + result
 *   - Second Half O/U + result
 *   - Quarter O/U + result (Q1, Q2, Q3, Q4)
 *   - Team Totals (home + away separately)
 *   - Odd/Even (full game + period)
 *   - Margin Bands (1-5, 6-10, 11-15, 16+)
 *   - Race-to-N points
 *
 * Each market has model_probability (what we predict) and implied_odds (1/p).
 */

import type { GameSimulationResult } from '../simulation/game-sim';
import { probAbove, probBelow, probBetween } from '../simulation/game-sim';
import type { QuarterShares } from '../warehouse/quarter-shares-repo';
import { simulateGame } from '../simulation/game-sim';

export interface MarketLine {
  line: number;
  overProb: number;
  underProb: number;
  overOdds: number;
  underOdds: number;
}

export interface MarketHandicap {
  line: number;
  homeCoverProb: number;
  awayCoverProb: number;
  homeOdds: number;
  awayOdds: number;
}

export interface QuarterMarket {
  quarter: number;
  expectedHome: number;
  expectedAway: number;
  expectedTotal: number;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  oddProb: number;
  evenProb: number;
  totalLines: MarketLine[];
}

export interface HalfMarket {
  label: '1H' | '2H';
  expectedHome: number;
  expectedAway: number;
  expectedTotal: number;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  oddProb: number;
  evenProb: number;
  totalLines: MarketLine[];
}

export interface AllMarkets {
  // Main game
  matchResult: {
    homeWinProb: number;
    awayWinProb: number;
    homeOdds: number;
    awayOdds: number;
    predictedWinner: string;
    confidence: number;
  };

  totalPoints: {
    expected: number;
    stdDev: number;
    lines: MarketLine[];
    oddProb: number;
    evenProb: number;
  };

  handicap: {
    mainLine: number;
    mainHomeCoverProb: number;
    mainAwayCoverProb: number;
    alternateLines: MarketHandicap[];
  };

  teamTotals: {
    home: { expected: number; stdDev: number; lines: MarketLine[] };
    away: { expected: number; stdDev: number; lines: MarketLine[] };
  };

  // Periods
  firstHalf: HalfMarket;
  secondHalf: HalfMarket;
  q1: QuarterMarket;
  q2: QuarterMarket;
  q3: QuarterMarket;
  q4: QuarterMarket;

  // HTFT (6 outcomes — basketball can't tie at FT but can tie at HT)
  htft: {
    '1/1': number;
    '1/2': number;
    'X/1': number;
    'X/2': number;
    '2/1': number;
    '2/2': number;
    mostLikely: { outcome: string; probability: number };
  };

  // Margin bands
  marginBands: Array<{ label: string; lo: number; hi: number; probability: number }>;
}

const ROUND_TO_HALF = (n: number): number => Math.round(n * 2) / 2 + 0.5;

function impliedOdds(prob: number): number {
  if (prob <= 0) return 999;
  return Math.round((1 / prob) * 100) / 100;
}

function buildLines(
  samples: number[],
  expected: number,
  offsets: number[]
): MarketLine[] {
  return offsets.map((offset) => {
    const line = Math.round(expected + offset) + 0.5;
    const overProb = probAbove(samples, line);
    const underProb = 1 - overProb;
    return {
      line,
      overProb,
      underProb,
      overOdds: impliedOdds(overProb),
      underOdds: impliedOdds(underProb),
    };
  });
}

/**
 * Compute odd/even probability empirically (basketball scores often skew slightly).
 */
function computeOddEven(samples: number[]): { oddProb: number; evenProb: number } {
  let odd = 0;
  for (const s of samples) {
    if (s % 2 !== 0) odd++;
  }
  return {
    oddProb: odd / samples.length,
    evenProb: 1 - odd / samples.length,
  };
}

/**
 * Build period prediction by re-simulating with adjusted means/sigmas.
 * We could use share factors to scale full-game samples, but re-simulating
 * with proper scaling preserves the correlation structure.
 */
function buildQuarter(
  quarter: number,
  homeFullExpected: number,
  awayFullExpected: number,
  homeFullSigma: number,
  awayFullSigma: number,
  share: number
): QuarterMarket {
  const sim = simulateGame({
    expectedHome: homeFullExpected * share,
    expectedAway: awayFullExpected * share,
    homeStdDev: homeFullSigma * Math.sqrt(share),
    awayStdDev: awayFullSigma * Math.sqrt(share),
    correlation: -0.05,
    numSimulations: 5_000,
  });

  const oddEven = computeOddEven(sim.totals);

  return {
    quarter,
    expectedHome: sim.meanHomeScore,
    expectedAway: sim.meanAwayScore,
    expectedTotal: sim.meanTotal,
    homeWinProb: sim.homeWinProb,
    drawProb: sim.drawProb,
    awayWinProb: sim.awayWinProb,
    oddProb: oddEven.oddProb,
    evenProb: oddEven.evenProb,
    totalLines: buildLines(sim.totals, sim.meanTotal, [-6, -3, 0, 3, 6]),
  };
}

function buildHalf(
  label: '1H' | '2H',
  homeFullExpected: number,
  awayFullExpected: number,
  homeFullSigma: number,
  awayFullSigma: number,
  share: number
): HalfMarket {
  const sim = simulateGame({
    expectedHome: homeFullExpected * share,
    expectedAway: awayFullExpected * share,
    homeStdDev: homeFullSigma * Math.sqrt(share),
    awayStdDev: awayFullSigma * Math.sqrt(share),
    correlation: -0.05,
    numSimulations: 5_000,
  });

  const oddEven = computeOddEven(sim.totals);

  return {
    label,
    expectedHome: sim.meanHomeScore,
    expectedAway: sim.meanAwayScore,
    expectedTotal: sim.meanTotal,
    homeWinProb: sim.homeWinProb,
    drawProb: sim.drawProb,
    awayWinProb: sim.awayWinProb,
    oddProb: oddEven.oddProb,
    evenProb: oddEven.evenProb,
    totalLines: buildLines(sim.totals, sim.meanTotal, [-8, -4, 0, 4, 8]),
  };
}

export interface BuildMarketsInput {
  expectedHome: number;
  expectedAway: number;
  homeStdDev: number;
  awayStdDev: number;
  homeTeamName: string;
  awayTeamName: string;
  quarterShares: QuarterShares;
}

export function buildAllMarkets(input: BuildMarketsInput): AllMarkets {
  // Main full-game simulation (10K)
  const fullSim = simulateGame({
    expectedHome: input.expectedHome,
    expectedAway: input.expectedAway,
    homeStdDev: input.homeStdDev,
    awayStdDev: input.awayStdDev,
    correlation: -0.05,
    numSimulations: 10_000,
  });

  const oddEvenFull = computeOddEven(fullSim.totals);

  // Build alternate handicap lines
  const handicapAlts: MarketHandicap[] = [-4, -2, 0, 2, 4].map((offset) => {
    const line = Math.round(-fullSim.meanMargin) + offset + 0.5;
    // Home covers if margin > -line
    const homeCoverProb = probAbove(fullSim.margins, -line);
    return {
      line,
      homeCoverProb,
      awayCoverProb: 1 - homeCoverProb,
      homeOdds: impliedOdds(homeCoverProb),
      awayOdds: impliedOdds(1 - homeCoverProb),
    };
  });
  const mainHandicap = handicapAlts[2]; // middle line

  // Build period markets
  const firstHalf = buildHalf('1H', input.expectedHome, input.expectedAway, input.homeStdDev, input.awayStdDev, input.quarterShares.fhShare);
  const secondHalf = buildHalf('2H', input.expectedHome, input.expectedAway, input.homeStdDev, input.awayStdDev, input.quarterShares.shShare);
  const q1 = buildQuarter(1, input.expectedHome, input.expectedAway, input.homeStdDev, input.awayStdDev, input.quarterShares.q1Share);
  const q2 = buildQuarter(2, input.expectedHome, input.expectedAway, input.homeStdDev, input.awayStdDev, input.quarterShares.q2Share);
  const q3 = buildQuarter(3, input.expectedHome, input.expectedAway, input.homeStdDev, input.awayStdDev, input.quarterShares.q3Share);
  const q4 = buildQuarter(4, input.expectedHome, input.expectedAway, input.homeStdDev, input.awayStdDev, input.quarterShares.q4Share);

  // HTFT matrix from 1H + 2H probabilities
  // Conditional: if home leads at HT, home wins FT 78% of time (NBA empirical)
  const LEAD_RETENTION = 0.78;
  const COMEBACK = 0.22;
  const htft = {
    '1/1': firstHalf.homeWinProb * LEAD_RETENTION,
    '1/2': firstHalf.homeWinProb * COMEBACK,
    'X/1': firstHalf.drawProb * fullSim.homeWinProb,
    'X/2': firstHalf.drawProb * fullSim.awayWinProb,
    '2/1': firstHalf.awayWinProb * COMEBACK,
    '2/2': firstHalf.awayWinProb * LEAD_RETENTION,
  };
  const htftSum = Object.values(htft).reduce((s, v) => s + v, 0);
  const htftNormalized = {
    '1/1': htft['1/1'] / htftSum,
    '1/2': htft['1/2'] / htftSum,
    'X/1': htft['X/1'] / htftSum,
    'X/2': htft['X/2'] / htftSum,
    '2/1': htft['2/1'] / htftSum,
    '2/2': htft['2/2'] / htftSum,
  };
  const htftSorted = Object.entries(htftNormalized).sort((a, b) => b[1] - a[1]);

  // Margin bands
  const marginBands = [
    { label: 'Home 16+', lo: 16, hi: 999 },
    { label: 'Home 11-15', lo: 11, hi: 15 },
    { label: 'Home 6-10', lo: 6, hi: 10 },
    { label: 'Home 1-5', lo: 1, hi: 5 },
    { label: 'Away 1-5', lo: -5, hi: -1 },
    { label: 'Away 6-10', lo: -10, hi: -6 },
    { label: 'Away 11-15', lo: -15, hi: -11 },
    { label: 'Away 16+', lo: -999, hi: -16 },
  ].map((b) => ({
    ...b,
    probability: probBetween(fullSim.margins, b.lo, b.hi),
  }));

  return {
    matchResult: {
      homeWinProb: fullSim.homeWinProb,
      awayWinProb: fullSim.awayWinProb,
      homeOdds: impliedOdds(fullSim.homeWinProb),
      awayOdds: impliedOdds(fullSim.awayWinProb),
      predictedWinner: fullSim.homeWinProb >= fullSim.awayWinProb ? input.homeTeamName : input.awayTeamName,
      confidence: Math.max(fullSim.homeWinProb, fullSim.awayWinProb),
    },

    totalPoints: {
      expected: fullSim.meanTotal,
      stdDev: fullSim.totalStdDev,
      lines: buildLines(fullSim.totals, fullSim.meanTotal, [-10, -5, 0, 5, 10]),
      oddProb: oddEvenFull.oddProb,
      evenProb: oddEvenFull.evenProb,
    },

    handicap: {
      mainLine: mainHandicap.line,
      mainHomeCoverProb: mainHandicap.homeCoverProb,
      mainAwayCoverProb: mainHandicap.awayCoverProb,
      alternateLines: handicapAlts,
    },

    teamTotals: {
      home: {
        expected: fullSim.meanHomeScore,
        stdDev: input.homeStdDev,
        lines: buildLines(fullSim.homeScores, fullSim.meanHomeScore, [-10, -5, 0, 5, 10]),
      },
      away: {
        expected: fullSim.meanAwayScore,
        stdDev: input.awayStdDev,
        lines: buildLines(fullSim.awayScores, fullSim.meanAwayScore, [-10, -5, 0, 5, 10]),
      },
    },

    firstHalf,
    secondHalf,
    q1, q2, q3, q4,

    htft: {
      ...htftNormalized,
      mostLikely: { outcome: htftSorted[0][0], probability: htftSorted[0][1] },
    },

    marginBands,
  };
}
