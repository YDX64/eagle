/**
 * System Coupon Engine
 *
 * Generates system bet coupons from high-odds predictions.
 * A system bet (e.g., 3/6) means: pick 6 matches, create all 3-match
 * combinations (C(6,3)=20 combos). If 3+ matches hit, at least one
 * combo wins.
 *
 * Key idea: individual high-odds picks (3.0+) that, when combined in a
 * system bet, provide positive expected value even if only a fraction hit.
 */

export interface SystemCouponPick {
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchDate: string;
  predictionType: string; // match_winner, both_teams_score, over_under_goals, exact_score
  predictedValue: string;
  displayLabel: string; // Turkish label for the prediction
  odds: number; // estimated or real odds
  confidenceScore: number;
  reasoning: string;
}

export interface SystemCoupon {
  id: string;
  name: string;
  picks: SystemCouponPick[];
  systemType: string; // e.g., "3/6", "4/7", "2/5"
  totalCombinations: number;
  minHitsForProfit: number;
  stakePerCombo: number;
  totalStake: number;
  potentialReturns: {
    hitsNeeded: number;
    winningCombos: number;
    estimatedReturn: number;
    profit: number;
  }[];
  riskLevel: 'low' | 'medium' | 'high' | 'very_high';
  expectedROI: number;
  createdAt: string;
}

/**
 * Calculate combinations C(n, k) = n! / (k! * (n-k)!)
 */
function combinations(n: number, k: number): number {
  if (k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = result * (n - i) / (i + 1);
  }
  return Math.round(result);
}

/**
 * Generate all k-sized index combinations from n items.
 */
function* generateCombinations(n: number, k: number): Generator<number[]> {
  const combo = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield [...combo];
    let i = k - 1;
    while (i >= 0 && combo[i] === n - k + i) i--;
    if (i < 0) break;
    combo[i]++;
    for (let j = i + 1; j < k; j++) {
      combo[j] = combo[j - 1] + 1;
    }
  }
}

/**
 * Calculate potential returns for a system coupon.
 */
function calculateReturns(
  picks: SystemCouponPick[],
  comboSize: number,
  stakePerCombo: number
): SystemCoupon['potentialReturns'] {
  const totalPicks = picks.length;
  const totalCombos = combinations(totalPicks, comboSize);
  const totalStake = totalCombos * stakePerCombo;
  const returns: SystemCoupon['potentialReturns'] = [];

  // For each possible number of hits (comboSize to totalPicks)
  for (let hits = comboSize; hits <= totalPicks; hits++) {
    // How many winning combos when exactly `hits` picks win?
    // A combo wins if all comboSize picks in it are among the `hits` winners.
    const winningCombos = combinations(hits, comboSize);

    // Estimate average combined odds for a winning combo
    // Sort picks by odds (ascending) to get conservative estimates
    const sortedOdds = picks.map(p => p.odds).sort((a, b) => a - b);

    // Average combo odds: use geometric mean of the comboSize lowest odds
    // (conservative estimate — real winners could be higher)
    const selectedOdds = sortedOdds.slice(0, comboSize);
    const comboOdds = selectedOdds.reduce((acc, o) => acc * o, 1);

    const estimatedReturn = winningCombos * comboOdds * stakePerCombo;
    const profit = estimatedReturn - totalStake;

    returns.push({
      hitsNeeded: hits,
      winningCombos,
      estimatedReturn: Math.round(estimatedReturn * 100) / 100,
      profit: Math.round(profit * 100) / 100,
    });
  }

  return returns;
}

/**
 * Determine risk level based on average odds and confidence.
 */
function getRiskLevel(picks: SystemCouponPick[]): SystemCoupon['riskLevel'] {
  const avgOdds = picks.reduce((sum, p) => sum + p.odds, 0) / picks.length;
  const avgConf = picks.reduce((sum, p) => sum + p.confidenceScore, 0) / picks.length;

  if (avgOdds > 5 || avgConf < 0.35) return 'very_high';
  if (avgOdds > 3.5 || avgConf < 0.45) return 'high';
  if (avgOdds > 2.5 || avgConf < 0.55) return 'medium';
  return 'low';
}

/**
 * Generate high-odds prediction picks from available matches.
 */
export function generateHighOddsPicks(
  predictions: Array<{
    matchId: number;
    homeTeam: string;
    awayTeam: string;
    league: string;
    matchDate: string;
    predictionType: string;
    predictedValue: string;
    confidenceScore: number;
    // market odds if available
    marketOddsHome?: number | null;
    marketOddsDraw?: number | null;
    marketOddsAway?: number | null;
  }>
): SystemCouponPick[] {
  const picks: SystemCouponPick[] = [];

  const typeLabels: Record<string, string> = {
    match_winner: 'Mac Sonucu',
    both_teams_score: 'Karsilikli Gol',
    over_under_goals: 'Ust/Alt 2.5',
  };

  const valueLabels: Record<string, string> = {
    home: 'Ev Sahibi Kazanir',
    away: 'Deplasman Kazanir',
    draw: 'Beraberlik',
    yes: 'KG Var',
    no: 'KG Yok',
    over: 'Ust 2.5',
    under: 'Alt 2.5',
  };

  for (const pred of predictions) {
    // Estimate odds based on prediction type and confidence
    let estimatedOdds = 2.0;

    if (pred.predictionType === 'match_winner') {
      if (pred.predictedValue === 'draw') {
        // Draws typically have higher odds (3.0-4.0)
        estimatedOdds = pred.marketOddsDraw || (3.0 + (1 - pred.confidenceScore) * 2);
      } else if (pred.predictedValue === 'away') {
        estimatedOdds = pred.marketOddsAway || (2.5 + (1 - pred.confidenceScore) * 3);
      } else {
        estimatedOdds = pred.marketOddsHome || (1.8 + (1 - pred.confidenceScore) * 2);
      }
    } else if (pred.predictionType === 'both_teams_score') {
      estimatedOdds = 1.7 + (1 - pred.confidenceScore) * 1.5;
    } else if (pred.predictionType === 'over_under_goals') {
      estimatedOdds = 1.6 + (1 - pred.confidenceScore) * 1.8;
    }

    // Only include picks with odds >= 2.5 for system coupons
    if (estimatedOdds < 2.5) continue;

    const displayLabel = `${valueLabels[pred.predictedValue] || pred.predictedValue}`;

    picks.push({
      matchId: pred.matchId,
      homeTeam: pred.homeTeam,
      awayTeam: pred.awayTeam,
      league: pred.league,
      matchDate: pred.matchDate,
      predictionType: pred.predictionType,
      predictedValue: pred.predictedValue,
      displayLabel,
      odds: Math.round(estimatedOdds * 100) / 100,
      confidenceScore: pred.confidenceScore,
      reasoning: `${typeLabels[pred.predictionType] || pred.predictionType}: ${displayLabel} (Guven: %${Math.round(pred.confidenceScore * 100)}, Oran: ${estimatedOdds.toFixed(2)})`,
    });
  }

  // Sort by a combined score: balance odds and confidence
  // Higher odds * reasonable confidence = better system coupon picks
  picks.sort((a, b) => {
    const scoreA = a.odds * (0.3 + a.confidenceScore * 0.7);
    const scoreB = b.odds * (0.3 + b.confidenceScore * 0.7);
    return scoreB - scoreA;
  });

  return picks;
}

/**
 * Build system coupons from available picks.
 */
export function buildSystemCoupons(
  allPicks: SystemCouponPick[],
  budget: number = 100, // Total budget in units
): SystemCoupon[] {
  const coupons: SystemCoupon[] = [];

  if (allPicks.length < 4) return coupons;

  // Strategy 1: Conservative 3/6 System
  if (allPicks.length >= 6) {
    const picks = allPicks.slice(0, 6);
    const comboSize = 3;
    const totalCombos = combinations(6, comboSize);
    const stakePerCombo = Math.round((budget * 0.4 / totalCombos) * 100) / 100;

    coupons.push({
      id: `sys-3-6-${Date.now()}`,
      name: 'Sistem 3/6 - Dengeli',
      picks,
      systemType: '3/6',
      totalCombinations: totalCombos,
      minHitsForProfit: 3,
      stakePerCombo,
      totalStake: Math.round(totalCombos * stakePerCombo * 100) / 100,
      potentialReturns: calculateReturns(picks, comboSize, stakePerCombo),
      riskLevel: getRiskLevel(picks),
      expectedROI: 0,
      createdAt: new Date().toISOString(),
    });
  }

  // Strategy 2: Aggressive 2/5 System (easier to hit)
  if (allPicks.length >= 5) {
    const picks = allPicks.slice(0, 5);
    const comboSize = 2;
    const totalCombos = combinations(5, comboSize);
    const stakePerCombo = Math.round((budget * 0.3 / totalCombos) * 100) / 100;

    coupons.push({
      id: `sys-2-5-${Date.now()}`,
      name: 'Sistem 2/5 - Kolay Tutma',
      picks,
      systemType: '2/5',
      totalCombinations: totalCombos,
      minHitsForProfit: 2,
      stakePerCombo,
      totalStake: Math.round(totalCombos * stakePerCombo * 100) / 100,
      potentialReturns: calculateReturns(picks, comboSize, stakePerCombo),
      riskLevel: getRiskLevel(picks),
      expectedROI: 0,
      createdAt: new Date().toISOString(),
    });
  }

  // Strategy 3: High-risk 4/7 System
  if (allPicks.length >= 7) {
    const picks = allPicks.slice(0, 7);
    const comboSize = 4;
    const totalCombos = combinations(7, comboSize);
    const stakePerCombo = Math.round((budget * 0.3 / totalCombos) * 100) / 100;

    coupons.push({
      id: `sys-4-7-${Date.now()}`,
      name: 'Sistem 4/7 - Yuksek Kazanc',
      picks,
      systemType: '4/7',
      totalCombinations: totalCombos,
      minHitsForProfit: 4,
      stakePerCombo,
      totalStake: Math.round(totalCombos * stakePerCombo * 100) / 100,
      potentialReturns: calculateReturns(picks, comboSize, stakePerCombo),
      riskLevel: getRiskLevel(picks),
      expectedROI: 0,
      createdAt: new Date().toISOString(),
    });
  }

  // Calculate expected ROI for each coupon
  for (const coupon of coupons) {
    const avgHitProb = coupon.picks.reduce((sum, p) => sum + p.confidenceScore, 0) / coupon.picks.length;
    // Simplified expected ROI based on hit probability
    const expectedHits = coupon.picks.length * avgHitProb;
    const nearestReturn = coupon.potentialReturns.find(r => r.hitsNeeded <= Math.ceil(expectedHits));
    coupon.expectedROI = nearestReturn
      ? Math.round((nearestReturn.profit / coupon.totalStake) * 100 * 10) / 10
      : -100;
  }

  return coupons;
}
