
import { ConfidenceTier, SportTeamForm, ValueBet, SportType } from './types';

/**
 * Poisson distribution probability P(X=k) = (lambda^k * e^-lambda) / k!
 * Best for low-scoring sports: football, hockey
 */
export function poissonProbability(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

export function factorial(n: number): number {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

/**
 * Normal distribution probability density function
 * Best for high-scoring sports: basketball, handball
 */
export function normalPDF(x: number, mean: number, stdDev: number): number {
  const exponent = -0.5 * Math.pow((x - mean) / stdDev, 2);
  return (1 / (stdDev * Math.sqrt(2 * Math.PI))) * Math.exp(exponent);
}

/**
 * Normal CDF approximation (Abramowitz and Stegun)
 */
export function normalCDF(x: number, mean: number, stdDev: number): number {
  const z = (x - mean) / stdDev;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327;
  const p =
    d *
    Math.exp((-z * z) / 2) *
    (t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.8212560 + t * 1.3302744)))));
  return z > 0 ? 1 - p : p;
}

/**
 * Probability that total score exceeds threshold (Normal distribution)
 * Used for basketball/handball over-under
 */
export function overProbabilityNormal(threshold: number, mean: number, stdDev: number): number {
  return 1 - normalCDF(threshold, mean, stdDev);
}

/**
 * Binomial probability P(X=k) = C(n,k) * p^k * (1-p)^(n-k)
 * Best for set-based sports: volleyball (best of 5 sets)
 */
export function binomialProbability(n: number, k: number, p: number): number {
  return combination(n, k) * Math.pow(p, k) * Math.pow(1 - p, n - k);
}

export function combination(n: number, k: number): number {
  if (k > n) return 0;
  if (k === 0 || k === n) return 1;
  return factorial(n) / (factorial(k) * factorial(n - k));
}

/**
 * Calculate probability of winning a best-of-N series given set win probability
 * E.g., volleyball best-of-5: win 3 sets before opponent
 */
export function bestOfNProbability(setsToWin: number, setWinProb: number): number {
  let totalProb = 0;
  // You can win in exactly setsToWin, setsToWin+1, ..., 2*setsToWin-1 total sets
  for (let totalSets = setsToWin; totalSets <= 2 * setsToWin - 1; totalSets++) {
    const lostSets = totalSets - setsToWin;
    // Must win final set, and win (setsToWin-1) of previous (totalSets-1)
    const prob =
      combination(totalSets - 1, setsToWin - 1) *
      Math.pow(setWinProb, setsToWin) *
      Math.pow(1 - setWinProb, lostSets);
    totalProb += prob;
  }
  return totalProb;
}

/**
 * Calculate Expected Value: EV = (probability * odds) - 1
 * Positive EV = value bet
 */
export function calculateExpectedValue(probability: number, decimalOdds: number): number {
  return probability * decimalOdds - 1;
}

/**
 * Kelly Criterion: optimal stake = (bp - q) / b
 * where b = odds-1, p = probability, q = 1-p
 * Returns as percentage (0-100)
 */
export function kellyPercentage(probability: number, decimalOdds: number): number {
  const b = decimalOdds - 1;
  const q = 1 - probability;
  const kelly = (b * probability - q) / b;
  // Fractional Kelly (quarter) for safety
  return Math.max(0, Math.min(25, kelly * 25));
}

/**
 * Determine confidence tier based on score.
 * Platinum is reserved for very strong signals with high data quality.
 */
export function calculateConfidenceTier(confidenceScore: number): ConfidenceTier | null {
  if (confidenceScore >= 82) return 'platinum';
  if (confidenceScore >= 65) return 'gold';
  if (confidenceScore >= 45) return 'silver';
  return null;
}

/**
 * Convert probability to decimal odds
 */
export function probabilityToOdds(probability: number): number {
  if (probability <= 0) return 100;
  return Math.round((1 / probability) * 100) / 100;
}

/**
 * Convert decimal odds to implied probability
 */
export function oddsToImpliedProbability(decimalOdds: number): number {
  if (decimalOdds <= 1) return 1;
  return 1 / decimalOdds;
}

/**
 * Calculate team form from recent game results using exponential weighting.
 * Most recent game gets the highest weight; the 5th most recent gets half the weight.
 * Decay factor: weight_i = decay^(n-1-i), where decay = 2^(1/4) ~ 1.189
 * This ensures: weight[0] / weight[4] = 2.0 (most recent = 2x weight of 5th game)
 */
export function calculateTeamForm(
  games: Array<{
    homeTeamId: number;
    awayTeamId: number;
    homeScore: number | null;
    awayScore: number | null;
    isHome?: boolean;
  }>,
  teamId: number
): SportTeamForm {
  let wins = 0, losses = 0, draws = 0;
  let pointsFor = 0, pointsAgainst = 0;
  let homeWins = 0, homeLosses = 0, homeGames = 0;
  let awayWins = 0, awayLosses = 0, awayGames = 0;
  let formString = '';

  const validGames = games.filter(g => g.homeScore !== null && g.awayScore !== null);

  // Exponential decay: most recent game (last in array) gets highest weight
  // decay^0 = 1.0 for most recent, decay^(n-1) for oldest
  // With decay = 0.84, after 4 steps: 0.84^4 ~ 0.50 (half the weight)
  const DECAY = 0.84;
  let weightedPoints = 0;
  let totalWeight = 0;

  validGames.forEach((game, idx) => {
    const isHome = game.homeTeamId === teamId;
    const teamScore = isHome ? game.homeScore! : game.awayScore!;
    const oppScore = isHome ? game.awayScore! : game.homeScore!;

    // Exponential weight: games later in array are more recent
    const recencyIndex = validGames.length - 1 - idx;
    const weight = Math.pow(DECAY, recencyIndex);
    totalWeight += weight;

    pointsFor += teamScore;
    pointsAgainst += oppScore;

    if (teamScore > oppScore) {
      wins++;
      formString += 'W';
      weightedPoints += 3 * weight;
      if (isHome) homeWins++;
      else awayWins++;
    } else if (teamScore < oppScore) {
      losses++;
      formString += 'L';
      // weightedPoints += 0
      if (isHome) homeLosses++;
      else awayLosses++;
    } else {
      draws++;
      formString += 'D';
      weightedPoints += 1 * weight;
    }

    if (isHome) homeGames++;
    else awayGames++;
  });

  const total = validGames.length;
  // Exponentially weighted form score: normalize by max possible weighted points (3 * totalWeight)
  const maxWeightedPoints = totalWeight * 3;
  const formScore = maxWeightedPoints > 0 ? weightedPoints / maxWeightedPoints : 0.5;

  return {
    recent_matches: total,
    wins,
    losses,
    draws,
    points_for: pointsFor,
    points_against: pointsAgainst,
    form_score: formScore,
    form_string: formString,
    home_form_score: homeGames > 0 ? homeWins / homeGames : 0.5,
    away_form_score: awayGames > 0 ? awayWins / awayGames : 0.5,
  };
}

/**
 * Generate exact score probabilities using Poisson distribution
 * For low-scoring sports (football, hockey)
 */
export function generateExactScores(
  homeExpected: number,
  awayExpected: number,
  maxGoals: number = 5,
  minProb: number = 0.01
): Array<{ score: string; probability: number; odds: number }> {
  const scores: Array<{ score: string; probability: number; odds: number }> = [];

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const prob = poissonProbability(h, homeExpected) * poissonProbability(a, awayExpected);
      if (prob > minProb) {
        scores.push({
          score: `${h}-${a}`,
          probability: Math.round(prob * 10000) / 100,
          odds: Math.round((1 / prob) * 100) / 100,
        });
      }
    }
  }

  return scores.sort((a, b) => b.probability - a.probability).slice(0, 15);
}

/**
 * Calculate handicap probabilities
 */
export function calculateHandicapProbabilities(
  homeStrength: number,
  awayStrength: number,
  handicapValues: number[]
): Array<{
  handicap: number;
  home_probability: number;
  away_probability: number;
  odds: { home: number; away: number };
}> {
  return handicapValues.map((handicap) => {
    let adjHome = homeStrength + handicap * 0.1;
    adjHome = Math.max(0.1, Math.min(0.9, adjHome));
    const adjAway = 1 - adjHome;

    return {
      handicap,
      home_probability: Math.round(adjHome * 10000) / 100,
      away_probability: Math.round(adjAway * 10000) / 100,
      odds: {
        home: Math.round((1 / adjHome) * 100) / 100,
        away: Math.round((1 / adjAway) * 100) / 100,
      },
    };
  });
}

/**
 * Create a ValueBet object from prediction data
 */
export function createValueBet(params: {
  sport: SportType;
  game_id: number;
  home_team: string;
  away_team: string;
  league_name: string;
  game_date: string;
  market: string;
  selection: string;
  our_probability: number;
  market_odds: number;
  reasoning: string;
}): ValueBet | null {
  const impliedProb = oddsToImpliedProbability(params.market_odds);
  const edge = params.our_probability - impliedProb;
  const ev = calculateExpectedValue(params.our_probability, params.market_odds);
  const kelly = kellyPercentage(params.our_probability, params.market_odds);

  // Only return if positive expected value
  if (ev <= 0) return null;

  const confidenceScore = Math.round(params.our_probability * 100);
  const tier = calculateConfidenceTier(confidenceScore);

  if (!tier) return null;

  return {
    sport: params.sport,
    game_id: params.game_id,
    home_team: params.home_team,
    away_team: params.away_team,
    league_name: params.league_name,
    game_date: params.game_date,
    market: params.market,
    selection: params.selection,
    our_probability: Math.round(params.our_probability * 10000) / 100,
    market_odds: params.market_odds,
    implied_probability: Math.round(impliedProb * 10000) / 100,
    value_edge: Math.round(edge * 10000) / 100,
    expected_value: Math.round(ev * 10000) / 100,
    kelly_percentage: Math.round(kelly * 100) / 100,
    confidence_tier: tier,
    confidence_score: confidenceScore,
    reasoning: params.reasoning,
  };
}
