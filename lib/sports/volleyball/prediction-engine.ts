
import {
  binomialProbability,
  bestOfNProbability,
  combination,
  calculateTeamForm,
  calculateExpectedValue,
  kellyPercentage,
  calculateConfidenceTier,
  probabilityToOdds,
  createValueBet,
  normalCDF,
  overProbabilityNormal,
} from '@/lib/sports/base/prediction-utils';
import { SportPredictionResult, ConfidenceTier } from '@/lib/sports/base/types';
import { ApiVolleyballService } from './api-volleyball';

/**
 * Volleyball-specific analysis weights.
 * Volleyball is set-based (best of 5, first to 3), NO draws possible.
 * Key factors: set win rate, attack efficiency, serve pressure, recent form, momentum.
 *
 * Key improvements:
 * - Attack efficiency elevated (most predictive stat in volleyball)
 * - Momentum factor added (first set winner wins match ~65-70% of the time)
 * - Set win rate and form use exponential recency weighting
 */
const WEIGHTS = {
  recent_form: 0.20,
  set_win_rate: 0.18,
  home_advantage: 0.12,
  attack_efficiency: 0.20,
  serve_stats: 0.10,
  h2h: 0.08,
  league_position: 0.05,
  momentum: 0.07,
};

/**
 * Average total points per volleyball match depends on number of sets.
 * 3-set match: ~145-155 total pts (avg ~25-26 pts per set)
 * 4-set match: ~195-205 total pts
 * 5-set match: ~235-250 total pts (5th set to 15)
 *
 * Weighted average across set distribution: ~185 pts with std dev ~25
 */
const AVG_POINTS_PER_SET = 49; // total points in a set (both teams combined, avg 25-24)
const AVG_POINTS_5TH_SET = 30; // 5th set goes to 15 with min 2-point lead
const TOTAL_POINTS_STD_DEV = 25;

/**
 * Momentum factor: teams winning the first set win the match ~67% of the time
 * in professional volleyball. This is one of the strongest single-game predictors.
 */
const FIRST_SET_MOMENTUM_BOOST = 0.67;

/** Value edge threshold: flag value bets where edge > 5% */
const VALUE_EDGE_THRESHOLD = 5.0;

/**
 * Value bet: our model probability vs bookmaker implied probability.
 * Flagged when our edge exceeds the threshold.
 */
interface ValueBetEntry {
  market: string;
  selection: string;
  model_probability: number;
  implied_probability: number;
  edge: number;
  bookmaker_odds: number;
  fair_odds: number;
  is_value: boolean;
}

/**
 * Parsed odds data from API-Volleyball odds endpoint.
 * Market IDs: 2 = Home/Away (match winner, 2-way),
 * 3 = Asian Handicap (set handicap),
 * 4 = Over/Under (total sets or total points)
 *
 * Volleyball is 2-way (no draw), so we use market ID 2 for match winner.
 */
interface ParsedVolleyballOdds {
  match_winner: { home_odds: number; away_odds: number } | null;
  set_handicap: { line: number; home_odds: number; away_odds: number } | null;
  total_sets: { line: number; over_odds: number; under_odds: number } | null;
  total_points: { line: number; over_odds: number; under_odds: number } | null;
  bookmaker: string | null;
  raw_markets: Array<{ market_id: number; market_name: string; values: any[] }>;
}

/**
 * Volleyball Prediction Engine
 *
 * Uses binomial distribution for set-based outcomes.
 * Volleyball is best-of-5 (first to win 3 sets), with no draw possible.
 *
 * Key markets:
 * - Match winner (Home/Away only)
 * - Exact set score (3-0, 3-1, 3-2, 0-3, 1-3, 2-3)
 * - Set handicap (-1.5/+1.5)
 * - Total sets over/under 3.5
 * - Total points over/under (170.5, 180.5, 190.5)
 * - First set winner
 */
export class VolleyballPredictionEngine {
  /**
   * Generate a comprehensive prediction for a volleyball match.
   * @param gameId - The game ID from API-Volleyball
   * @param client - ApiVolleyballService instance
   */
  static async generatePrediction(
    gameId: number,
    client: ApiVolleyballService
  ): Promise<SportPredictionResult> {
    // 1. Fetch game data
    const game = await client.getGameById(gameId);
    if (!game) {
      throw new Error(`Voleybol maci bulunamadi: ${gameId}`);
    }

    const homeTeam = game.teams?.home;
    const awayTeam = game.teams?.away;
    const league = game.league;

    if (!homeTeam?.id || !awayTeam?.id) {
      throw new Error(`Takim bilgileri eksik: mac ${gameId}`);
    }

    const season = league?.season || client.getCurrentSeason();

    // 2. Fetch data in parallel: recent games, standings, h2h, statistics, and REAL ODDS
    const [homeRecent, awayRecent, standings, h2hGames, homeStats, awayStats, rawOddsData] =
      await Promise.all([
        client.getRecentGames(homeTeam.id, league.id, season, 10).catch(() => []),
        client.getRecentGames(awayTeam.id, league.id, season, 10).catch(() => []),
        client.getStandings(league.id, season).catch(() => []),
        client.getH2H(homeTeam.id, awayTeam.id).catch(() => []),
        client.getTeamStatistics(league.id, season, homeTeam.id).catch(() => []),
        client.getTeamStatistics(league.id, season, awayTeam.id).catch(() => []),
        client.getOdds({ game: gameId }).catch(() => []),
      ]);

    // 2b. Parse real odds from API-Volleyball
    const parsedOdds = parseOddsResponse(rawOddsData);

    // 3. Calculate individual factors

    // --- Recent form ---
    const homeForm = calculateTeamForm(
      homeRecent.map((g: any) => ({
        homeTeamId: g.teams?.home?.id,
        awayTeamId: g.teams?.away?.id,
        homeScore: g.scores?.home?.total,
        awayScore: g.scores?.away?.total,
      })),
      homeTeam.id
    );

    const awayForm = calculateTeamForm(
      awayRecent.map((g: any) => ({
        homeTeamId: g.teams?.home?.id,
        awayTeamId: g.teams?.away?.id,
        homeScore: g.scores?.home?.total,
        awayScore: g.scores?.away?.total,
      })),
      awayTeam.id
    );

    const formFactor = homeForm.form_score - awayForm.form_score; // -1 to 1 range

    // --- Set win rate ---
    const homeSetWinRate = calculateSetWinRate(homeRecent, homeTeam.id);
    const awaySetWinRate = calculateSetWinRate(awayRecent, awayTeam.id);
    const setRateFactor = homeSetWinRate - awaySetWinRate;

    // --- Home advantage ---
    const homeAdvFactor = 0.10; // Volleyball home advantage ~55-57% in professional leagues

    // --- Attack efficiency (from statistics if available) ---
    const homeAttackEff = extractAttackEfficiency(homeStats);
    const awayAttackEff = extractAttackEfficiency(awayStats);
    const attackFactor = homeAttackEff - awayAttackEff;

    // --- Serve stats ---
    const homeServe = extractServeStrength(homeStats);
    const awayServe = extractServeStrength(awayStats);
    const serveFactor = homeServe - awayServe;

    // --- Head-to-head (recency-weighted) ---
    const h2hFactor = calculateH2HFactor(h2hGames, homeTeam.id);

    // --- League position ---
    const positionFactor = calculatePositionFactor(standings, homeTeam.id, awayTeam.id);

    // --- Momentum factor ---
    // Calculate from recent games: how often does each team win after winning set 1?
    const homeMomentum = calculateMomentumFactor(homeRecent, homeTeam.id);
    const awayMomentum = calculateMomentumFactor(awayRecent, awayTeam.id);
    const momentumFactor = homeMomentum - awayMomentum;

    // 4. Combine factors into set win probability (p)
    const rawAdvantage =
      WEIGHTS.recent_form * formFactor +
      WEIGHTS.set_win_rate * setRateFactor +
      WEIGHTS.home_advantage * homeAdvFactor +
      WEIGHTS.attack_efficiency * attackFactor +
      WEIGHTS.serve_stats * serveFactor +
      WEIGHTS.h2h * h2hFactor +
      WEIGHTS.league_position * positionFactor +
      WEIGHTS.momentum * momentumFactor;

    // Convert advantage to probability with sigmoid, centered at 0.50
    const setWinProb = sigmoid(rawAdvantage, 0.50);
    // Clamp between 0.25 and 0.75 to avoid extreme predictions
    const p = Math.max(0.25, Math.min(0.75, setWinProb));
    const q = 1 - p;

    // 5. Calculate match win probability using best-of-5 (first to 3)
    const homeMatchWin = bestOfNProbability(3, p);
    const awayMatchWin = 1 - homeMatchWin;

    // 6. Exact set score probabilities using conditional binomial
    // P(3-0) = p^3
    const p30 = Math.pow(p, 3);
    // P(3-1) = C(3,2) * p^3 * q  (must win last set, win 2 of first 3)
    const p31 = combination(3, 2) * Math.pow(p, 3) * q;
    // P(3-2) = C(4,2) * p^3 * q^2  (must win last set, win 2 of first 4)
    const p32 = combination(4, 2) * Math.pow(p, 3) * Math.pow(q, 2);
    // Mirror for away team
    const p03 = Math.pow(q, 3);
    const p13 = combination(3, 2) * Math.pow(q, 3) * p;
    const p23 = combination(4, 2) * Math.pow(q, 3) * Math.pow(p, 2);

    const exactSetScores = [
      { score: '3-0', probability: round4(p30), odds: probabilityToOdds(p30) },
      { score: '3-1', probability: round4(p31), odds: probabilityToOdds(p31) },
      { score: '3-2', probability: round4(p32), odds: probabilityToOdds(p32) },
      { score: '0-3', probability: round4(p03), odds: probabilityToOdds(p03) },
      { score: '1-3', probability: round4(p13), odds: probabilityToOdds(p13) },
      { score: '2-3', probability: round4(p23), odds: probabilityToOdds(p23) },
    ];

    // 7. Set handicap: -1.5 home means home wins 3-0 or 3-1
    //    Use REAL set handicap line from bookmaker when available
    const realSetHandicapLine = parsedOdds?.set_handicap?.line ?? null;
    const homeHandicapMinus15 = p30 + p31;
    const awayHandicapPlus15 = 1 - homeHandicapMinus15;
    const homeHandicapPlus15 = p03 + p13;
    const awayHandicapMinus15 = 1 - homeHandicapPlus15;

    // 8. Total sets over/under 3.5 (3-0 and 3-1 and 0-3 and 1-3 = under, 3-2 and 2-3 = over)
    //    Use REAL total sets line from bookmaker when available
    const realTotalSetsLine = parsedOdds?.total_sets?.line ?? null;
    const totalSetsUnder35 = p30 + p31 + p03 + p13;
    const totalSetsOver35 = p32 + p23;

    // 9. Total points over/under using normal distribution
    // Improved model: calculate expected points based on set distribution
    // Regular sets average ~49 combined points (25-24 typical), 5th set averages ~30 (15-15)
    const expectedTotalSets = 3 * (p30 + p03) + 4 * (p31 + p13) + 5 * (p32 + p23);

    // Points model: regular sets (1-4) have ~49 avg combined, 5th set has ~30
    const probFiveSets = p32 + p23;
    const expectedRegularSets = expectedTotalSets - probFiveSets;
    const meanTotalPoints = expectedRegularSets * AVG_POINTS_PER_SET + probFiveSets * AVG_POINTS_5TH_SET;

    // Standard deviation scales with number of sets (more sets = more variance)
    const stdDev = TOTAL_POINTS_STD_DEV * Math.sqrt(expectedTotalSets / 4);

    // Build total points lines using REAL bookmaker line as anchor when available
    const realTotalPointsLine = parsedOdds?.total_points?.line ?? null;
    const centerLine = realTotalPointsLine ?? Math.round(meanTotalPoints);

    const totalPointsLinesSet = new Set<number>();
    totalPointsLinesSet.add(centerLine + 0.5);
    totalPointsLinesSet.add(centerLine - 5 + 0.5);
    totalPointsLinesSet.add(centerLine + 5 + 0.5);
    totalPointsLinesSet.add(centerLine - 10 + 0.5);
    // If model expected differs significantly from bookmaker, add it
    const modelCenterLine = Math.round(meanTotalPoints);
    if (realTotalPointsLine !== null && Math.abs(modelCenterLine - centerLine) >= 3) {
      totalPointsLinesSet.add(modelCenterLine + 0.5);
    }
    const totalPointsLines = Array.from(totalPointsLinesSet)
      .filter(l => l > 100 && l < 300) // Volleyball range
      .sort((a, b) => a - b);

    const totalPointsMarkets = totalPointsLines.map(line => {
      const overProb = overProbabilityNormal(line, meanTotalPoints, stdDev);
      const underProb = 1 - overProb;
      // Check if this is the real bookmaker line (within 0.5 tolerance for rounding)
      const isRealLine = realTotalPointsLine !== null && Math.abs(line - (realTotalPointsLine + 0.5)) < 0.01;

      return {
        line,
        over: round4(overProb),
        under: round4(underProb),
        ...(isRealLine && parsedOdds?.total_points ? {
          bookmaker_over_odds: parsedOdds.total_points.over_odds,
          bookmaker_under_odds: parsedOdds.total_points.under_odds,
        } : {}),
        source: (isRealLine ? 'api_odds' : 'model') as 'api_odds' | 'model',
      };
    });

    // 10. First set winner
    // First set is closer to true team strength with less momentum effects.
    // Teams with better attack efficiency tend to dominate first sets.
    // Slight dampening from overall set probability (0.90 factor) because
    // first set has less fatigue/momentum variation.
    const attackBoost = (homeAttackEff - awayAttackEff) * 0.05;
    const firstSetHome = Math.max(0.25, Math.min(0.75, 0.5 + (p - 0.5) * 0.90 + attackBoost));
    const firstSetAway = 1 - firstSetHome;

    // 11. Confidence calculation
    const dataQuality =
      Math.min(homeRecent.length, 5) / 5 * 0.3 +
      Math.min(awayRecent.length, 5) / 5 * 0.3 +
      (standings.length > 0 ? 0.2 : 0) +
      (h2hGames.length > 0 ? 0.2 : 0);

    const predictionStrength = Math.abs(homeMatchWin - 0.5) * 2; // 0-1 how decisive
    const confidenceScore = Math.round(
      (dataQuality * 0.5 + predictionStrength * 0.5) * 100
    );
    const confidenceTier = calculateConfidenceTier(confidenceScore);

    // 11b. Calculate VALUE BETS: compare model probability vs bookmaker implied probability
    const valueBets: ValueBetEntry[] = [];

    if (parsedOdds) {
      // Match winner value (2-way, no draw in volleyball)
      if (parsedOdds.match_winner) {
        if (parsedOdds.match_winner.home_odds > 0) {
          const homeImplied = oddsToImpliedProbability(parsedOdds.match_winner.home_odds);
          const homeEdge = (homeMatchWin * 100) - homeImplied;
          valueBets.push({
            market: 'match_winner',
            selection: 'home',
            model_probability: round2(homeMatchWin * 100),
            implied_probability: round2(homeImplied),
            edge: round2(homeEdge),
            bookmaker_odds: parsedOdds.match_winner.home_odds,
            fair_odds: probabilityToOdds(homeMatchWin),
            is_value: homeEdge > VALUE_EDGE_THRESHOLD,
          });
        }
        if (parsedOdds.match_winner.away_odds > 0) {
          const awayImplied = oddsToImpliedProbability(parsedOdds.match_winner.away_odds);
          const awayEdge = (awayMatchWin * 100) - awayImplied;
          valueBets.push({
            market: 'match_winner',
            selection: 'away',
            model_probability: round2(awayMatchWin * 100),
            implied_probability: round2(awayImplied),
            edge: round2(awayEdge),
            bookmaker_odds: parsedOdds.match_winner.away_odds,
            fair_odds: probabilityToOdds(awayMatchWin),
            is_value: awayEdge > VALUE_EDGE_THRESHOLD,
          });
        }
      }

      // Set handicap value (typically -1.5/+1.5)
      if (parsedOdds.set_handicap) {
        const hcLine = parsedOdds.set_handicap.line;
        // -1.5 means home must win 3-0 or 3-1; +1.5 means away can lose 2-3 and still cover
        let homeCoverProb: number;
        let awayCoverProb: number;

        if (Math.abs(hcLine) === 1.5) {
          // Standard -1.5/+1.5 set handicap
          if (hcLine < 0) {
            // Home -1.5: home wins 3-0 or 3-1
            homeCoverProb = p30 + p31;
            awayCoverProb = 1 - homeCoverProb;
          } else {
            // Home +1.5: home wins or loses only 2-3
            homeCoverProb = homeMatchWin + p23;
            awayCoverProb = 1 - homeCoverProb;
          }
        } else {
          // Other lines: use simple approximation
          homeCoverProb = hcLine < 0 ? homeHandicapMinus15 : (1 - awayHandicapMinus15);
          awayCoverProb = 1 - homeCoverProb;
        }

        const homeHcImplied = oddsToImpliedProbability(parsedOdds.set_handicap.home_odds);
        const awayHcImplied = oddsToImpliedProbability(parsedOdds.set_handicap.away_odds);

        valueBets.push({
          market: 'set_handicap',
          selection: `home_${hcLine}`,
          model_probability: round2(homeCoverProb * 100),
          implied_probability: round2(homeHcImplied),
          edge: round2((homeCoverProb * 100) - homeHcImplied),
          bookmaker_odds: parsedOdds.set_handicap.home_odds,
          fair_odds: probabilityToOdds(homeCoverProb),
          is_value: ((homeCoverProb * 100) - homeHcImplied) > VALUE_EDGE_THRESHOLD,
        });
        valueBets.push({
          market: 'set_handicap',
          selection: `away_${hcLine}`,
          model_probability: round2(awayCoverProb * 100),
          implied_probability: round2(awayHcImplied),
          edge: round2((awayCoverProb * 100) - awayHcImplied),
          bookmaker_odds: parsedOdds.set_handicap.away_odds,
          fair_odds: probabilityToOdds(awayCoverProb),
          is_value: ((awayCoverProb * 100) - awayHcImplied) > VALUE_EDGE_THRESHOLD,
        });
      }

      // Total sets over/under value
      if (parsedOdds.total_sets) {
        const tsLine = parsedOdds.total_sets.line;
        // For 3.5: over = 5 sets (3-2 or 2-3), under = 3 or 4 sets
        const modelOverProb = tsLine === 3.5 ? totalSetsOver35 : (tsLine < 3.5 ? totalSetsOver35 : totalSetsUnder35);
        const modelUnderProb = 1 - modelOverProb;
        const overImplied = oddsToImpliedProbability(parsedOdds.total_sets.over_odds);
        const underImplied = oddsToImpliedProbability(parsedOdds.total_sets.under_odds);

        valueBets.push({
          market: 'total_sets',
          selection: `over_${tsLine}`,
          model_probability: round2(modelOverProb * 100),
          implied_probability: round2(overImplied),
          edge: round2((modelOverProb * 100) - overImplied),
          bookmaker_odds: parsedOdds.total_sets.over_odds,
          fair_odds: probabilityToOdds(modelOverProb),
          is_value: ((modelOverProb * 100) - overImplied) > VALUE_EDGE_THRESHOLD,
        });
        valueBets.push({
          market: 'total_sets',
          selection: `under_${tsLine}`,
          model_probability: round2(modelUnderProb * 100),
          implied_probability: round2(underImplied),
          edge: round2((modelUnderProb * 100) - underImplied),
          bookmaker_odds: parsedOdds.total_sets.under_odds,
          fair_odds: probabilityToOdds(modelUnderProb),
          is_value: ((modelUnderProb * 100) - underImplied) > VALUE_EDGE_THRESHOLD,
        });
      }

      // Total points over/under value
      if (parsedOdds.total_points) {
        const tpLine = parsedOdds.total_points.line;
        const modelOverProb = overProbabilityNormal(tpLine, meanTotalPoints, stdDev);
        const modelUnderProb = 1 - modelOverProb;
        const overImplied = oddsToImpliedProbability(parsedOdds.total_points.over_odds);
        const underImplied = oddsToImpliedProbability(parsedOdds.total_points.under_odds);

        valueBets.push({
          market: 'total_points',
          selection: `over_${tpLine}`,
          model_probability: round2(modelOverProb * 100),
          implied_probability: round2(overImplied),
          edge: round2((modelOverProb * 100) - overImplied),
          bookmaker_odds: parsedOdds.total_points.over_odds,
          fair_odds: probabilityToOdds(modelOverProb),
          is_value: ((modelOverProb * 100) - overImplied) > VALUE_EDGE_THRESHOLD,
        });
        valueBets.push({
          market: 'total_points',
          selection: `under_${tpLine}`,
          model_probability: round2(modelUnderProb * 100),
          implied_probability: round2(underImplied),
          edge: round2((modelUnderProb * 100) - underImplied),
          bookmaker_odds: parsedOdds.total_points.under_odds,
          fair_odds: probabilityToOdds(modelUnderProb),
          is_value: ((modelUnderProb * 100) - underImplied) > VALUE_EDGE_THRESHOLD,
        });
      }
    }

    // 12. Build bet recommendations
    const highConfidenceBets: SportPredictionResult['high_confidence_bets'] = [];
    const mediumRiskBets: SportPredictionResult['medium_risk_bets'] = [];
    const highRiskBets: SportPredictionResult['high_risk_bets'] = [];

    const homeName = homeTeam.name;
    const awayName = awayTeam.name;

    // --- Match winner (high confidence if probability > 0.60) -- annotate with value bet info ---
    if (homeMatchWin > 0.60) {
      const winnerValueBet = valueBets.find(vb => vb.market === 'match_winner' && vb.selection === 'home' && vb.is_value);
      const valueNote = winnerValueBet
        ? ` DEGER BAHIS: Model %${winnerValueBet.model_probability.toFixed(1)} vs bahis sirketi %${winnerValueBet.implied_probability.toFixed(1)} (avantaj: %${winnerValueBet.edge.toFixed(1)}).`
        : '';
      highConfidenceBets.push({
        title: `Mac Kazanani: ${homeName}`,
        description: `${homeName} takim %${round2(homeMatchWin * 100)} olasilikla maci kazanir. Son form, set kazanma orani ve ev sahibi avantaji destekliyor.${valueNote}`,
        confidence: round2(homeMatchWin * 100),
        reason: `Form skoru: ${round2(homeForm.form_score * 100)}%, Set kazanma: %${round2(homeSetWinRate * 100)}, Ev sahibi avantaji mevcut.`,
        recommendation: `${homeName} mac sonucu`,
        market: 'Mac Sonucu',
        selection: homeName,
        estimated_odds: probabilityToOdds(homeMatchWin),
      });
    } else if (awayMatchWin > 0.60) {
      const winnerValueBet = valueBets.find(vb => vb.market === 'match_winner' && vb.selection === 'away' && vb.is_value);
      const valueNote = winnerValueBet
        ? ` DEGER BAHIS: Model %${winnerValueBet.model_probability.toFixed(1)} vs bahis sirketi %${winnerValueBet.implied_probability.toFixed(1)} (avantaj: %${winnerValueBet.edge.toFixed(1)}).`
        : '';
      highConfidenceBets.push({
        title: `Mac Kazanani: ${awayName}`,
        description: `${awayName} takim %${round2(awayMatchWin * 100)} olasilikla maci kazanir. Deplasmanin guclu formu ve istatistikleri belirleyici.${valueNote}`,
        confidence: round2(awayMatchWin * 100),
        reason: `Form skoru: ${round2(awayForm.form_score * 100)}%, Set kazanma: %${round2(awaySetWinRate * 100)}, Deplasman performansi ustun.`,
        recommendation: `${awayName} mac sonucu`,
        market: 'Mac Sonucu',
        selection: awayName,
        estimated_odds: probabilityToOdds(awayMatchWin),
      });
    }

    // --- Set handicap bets (medium confidence) -- annotate with value bet info ---
    if (homeHandicapMinus15 > 0.45) {
      const hcValueBet = valueBets.find(vb => vb.market === 'set_handicap' && vb.selection.startsWith('home') && vb.is_value);
      const valueNote = hcValueBet
        ? ` DEGER BAHIS: Model %${hcValueBet.model_probability.toFixed(1)} vs bahis sirketi %${hcValueBet.implied_probability.toFixed(1)} (avantaj: %${hcValueBet.edge.toFixed(1)}).`
        : '';
      const hcSource = realSetHandicapLine !== null ? ' (bahis sirketi cizgisi)' : '';
      mediumRiskBets.push({
        title: `Set Handikap: ${homeName} -1.5${hcSource}`,
        description: `${homeName} 3-0 veya 3-1 ile kazanma olasiligi %${round2(homeHandicapMinus15 * 100)}. Ust duzey hakimiyet bekleniyor.${valueNote}`,
        confidence: round2(homeHandicapMinus15 * 100),
        reason: `3-0 olasiligi: %${round2(p30 * 100)}, 3-1 olasiligi: %${round2(p31 * 100)}. Rakibin set alma ihtimali dusuk.`,
        recommendation: `${homeName} -1.5 set handikap`,
      });
    }
    if (awayHandicapMinus15 > 0.45) {
      const hcValueBet = valueBets.find(vb => vb.market === 'set_handicap' && vb.selection.startsWith('away') && vb.is_value);
      const valueNote = hcValueBet
        ? ` DEGER BAHIS: Model %${hcValueBet.model_probability.toFixed(1)} vs bahis sirketi %${hcValueBet.implied_probability.toFixed(1)} (avantaj: %${hcValueBet.edge.toFixed(1)}).`
        : '';
      const hcSource = realSetHandicapLine !== null ? ' (bahis sirketi cizgisi)' : '';
      mediumRiskBets.push({
        title: `Set Handikap: ${awayName} -1.5${hcSource}`,
        description: `${awayName} 0-3 veya 1-3 ile kazanma olasiligi %${round2(awayHandicapMinus15 * 100)}. Deplasman ustunlugu belirgin.${valueNote}`,
        confidence: round2(awayHandicapMinus15 * 100),
        reason: `0-3 olasiligi: %${round2(p03 * 100)}, 1-3 olasiligi: %${round2(p13 * 100)}. Ev sahibinin set alma sansi dusuk.`,
        recommendation: `${awayName} -1.5 set handikap`,
      });
    }

    // --- Total sets over/under 3.5 -- annotate with value bet info ---
    if (totalSetsOver35 > 0.45) {
      const tsValueBet = valueBets.find(vb => vb.market === 'total_sets' && vb.selection.startsWith('over') && vb.is_value);
      const valueNote = tsValueBet
        ? ` DEGER BAHIS: Model %${tsValueBet.model_probability.toFixed(1)} vs bahis sirketi %${tsValueBet.implied_probability.toFixed(1)} (avantaj: %${tsValueBet.edge.toFixed(1)}).`
        : '';
      const tsSource = realTotalSetsLine !== null ? ' (bahis sirketi cizgisi)' : '';
      mediumRiskBets.push({
        title: `Toplam Set Ust 3.5${tsSource}`,
        description: `Macin 5 sete gitmesi (3-2 veya 2-3) olasiligi %${round2(totalSetsOver35 * 100)}. Dengeli bir karsilasma bekleniyor.${valueNote}`,
        confidence: round2(totalSetsOver35 * 100),
        reason: `3-2 olasiligi: %${round2(p32 * 100)}, 2-3 olasiligi: %${round2(p23 * 100)}. Takimlar yakin gucte.`,
        recommendation: 'Toplam set ust 3.5',
      });
    } else if (totalSetsUnder35 > 0.55) {
      const tsValueBet = valueBets.find(vb => vb.market === 'total_sets' && vb.selection.startsWith('under') && vb.is_value);
      const valueNote = tsValueBet
        ? ` DEGER BAHIS: Model %${tsValueBet.model_probability.toFixed(1)} vs bahis sirketi %${tsValueBet.implied_probability.toFixed(1)} (avantaj: %${tsValueBet.edge.toFixed(1)}).`
        : '';
      const tsSource = realTotalSetsLine !== null ? ' (bahis sirketi cizgisi)' : '';
      mediumRiskBets.push({
        title: `Toplam Set Alt 3.5${tsSource}`,
        description: `Macin 3 veya 4 sette bitmesi olasiligi %${round2(totalSetsUnder35 * 100)}. Acik bir guc farki mevcut.${valueNote}`,
        confidence: round2(totalSetsUnder35 * 100),
        reason: `3-0/0-3 toplam: %${round2((p30 + p03) * 100)}, 3-1/1-3 toplam: %${round2((p31 + p13) * 100)}.`,
        recommendation: 'Toplam set alt 3.5',
      });
    }

    // --- Total points over/under -- prefer real bookmaker line ---
    const realPointsEntry = totalPointsMarkets.find(m => m.source === 'api_odds');
    const bestPointsLine = realPointsEntry ?? totalPointsMarkets.reduce((best, m) => {
      const overEdge = Math.abs(m.over - 0.5);
      const bestEdge = Math.abs(best.over - 0.5);
      return overEdge > bestEdge ? m : best;
    }, totalPointsMarkets[1] || totalPointsMarkets[0]);

    if (bestPointsLine && Math.abs(bestPointsLine.over - 0.5) > 0.08) {
      const isOver = bestPointsLine.over > 0.5;
      const tpSource = bestPointsLine.source === 'api_odds' ? ' (bahis sirketi cizgisi)' : '';
      const tpValueBet = valueBets.find(
        vb => vb.market === 'total_points' && vb.selection === `${isOver ? 'over' : 'under'}_${parsedOdds?.total_points?.line}` && vb.is_value
      );
      const valueNote = tpValueBet
        ? ` DEGER BAHIS: Model %${tpValueBet.model_probability.toFixed(1)} vs bahis sirketi %${tpValueBet.implied_probability.toFixed(1)} (avantaj: %${tpValueBet.edge.toFixed(1)}).`
        : '';
      mediumRiskBets.push({
        title: `Toplam Sayi ${isOver ? 'Ust' : 'Alt'} ${bestPointsLine.line}${tpSource}`,
        description: `Toplam sayinin ${bestPointsLine.line} ${isOver ? 'ustu' : 'alti'} olasiligi %${round2((isOver ? bestPointsLine.over : bestPointsLine.under) * 100)}. Beklenen toplam sayi: ${round2(meanTotalPoints)}.${valueNote}`,
        confidence: round2((isOver ? bestPointsLine.over : bestPointsLine.under) * 100),
        reason: `Beklenen toplam set sayisi: ${round2(expectedTotalSets)}, ortalama sayi tahmini: ${round2(meanTotalPoints)}.`,
        recommendation: `Toplam sayi ${isOver ? 'ust' : 'alt'} ${bestPointsLine.line}`,
      });
    }

    // --- High risk: exact set score ---
    const sortedSetScores = [...exactSetScores].sort(
      (a, b) => b.probability - a.probability
    );

    // Most likely exact score
    if (sortedSetScores[0].probability > 0.15) {
      highRiskBets.push({
        title: `Kesin Set Skoru: ${sortedSetScores[0].score}`,
        description: `En yuksek olasilikli set skoru: ${sortedSetScores[0].score} (%${round2(sortedSetScores[0].probability * 100)}). Odds: ${sortedSetScores[0].odds}.`,
        confidence: round2(sortedSetScores[0].probability * 100),
        reason: `Takim guc analizi ve set kazanma olasiliklarina dayali hesaplama.`,
        recommendation: `Set skoru ${sortedSetScores[0].score}`,
      });
    }

    // 5-set match (3-2 or 2-3) - high odds value
    if (p32 > 0.10) {
      highRiskBets.push({
        title: `Kesin Set Skoru: 3-2`,
        description: `${homeName} 3-2 ile kazanir olasiligi %${round2(p32 * 100)}. Yuksek oran degeri (${probabilityToOdds(p32)}).`,
        confidence: round2(p32 * 100),
        reason: `5 set maci yuksek oran sunar. ${homeName} son setlerde avantajli.`,
        recommendation: `Set skoru 3-2 (${homeName})`,
      });
    }
    if (p23 > 0.10) {
      highRiskBets.push({
        title: `Kesin Set Skoru: 2-3`,
        description: `${awayName} 2-3 ile kazanir olasiligi %${round2(p23 * 100)}. Yuksek oran degeri (${probabilityToOdds(p23)}).`,
        confidence: round2(p23 * 100),
        reason: `5 set maci yuksek oran sunar. ${awayName} geri donme kapasitesine sahip.`,
        recommendation: `Set skoru 2-3 (${awayName})`,
      });
    }

    // --- Medium risk: first set winner ---
    if (Math.abs(firstSetHome - 0.5) > 0.06) {
      const firstSetFav = firstSetHome > firstSetAway ? homeName : awayName;
      const firstSetProb = Math.max(firstSetHome, firstSetAway);
      mediumRiskBets.push({
        title: `Ilk Set Kazanani: ${firstSetFav}`,
        description: `${firstSetFav} ilk seti kazanma olasiligi %${round2(firstSetProb * 100)}. Atak verimliligi ve servis baskisi belirleyici faktor.`,
        confidence: round2(firstSetProb * 100),
        reason: `Set kazanma olasiligi: %${round2(p * 100)} (ev sahibi), atak farki: ${round2(attackFactor)}, servis farki: ${round2(serveFactor)}.`,
        recommendation: `${firstSetFav} ilk set galibiyeti`,
      });
    }

    // --- Medium risk: match winner + total sets combo ---
    if (homeMatchWin > 0.55 && totalSetsUnder35 > 0.50) {
      const comboProb = homeMatchWin * totalSetsUnder35 * 0.9; // slight correlation adjustment
      mediumRiskBets.push({
        title: `${homeName} Kazanir + Alt 3.5 Set`,
        description: `${homeName} maci 3 veya 4 sette kazanir olasiligi %${round2(comboProb * 100)}. Net ustunluk ve set ekonomisi bekleniyor.`,
        confidence: round2(comboProb * 100),
        reason: `Mac kazanma: %${round2(homeMatchWin * 100)}, Alt 3.5 set: %${round2(totalSetsUnder35 * 100)}.`,
        recommendation: `${homeName} kazanir + alt 3.5 set kombini`,
      });
    } else if (awayMatchWin > 0.55 && totalSetsUnder35 > 0.50) {
      const comboProb = awayMatchWin * totalSetsUnder35 * 0.9;
      mediumRiskBets.push({
        title: `${awayName} Kazanir + Alt 3.5 Set`,
        description: `${awayName} maci 3 veya 4 sette kazanir olasiligi %${round2(comboProb * 100)}. Deplasman hakimiyeti bekleniyor.`,
        confidence: round2(comboProb * 100),
        reason: `Mac kazanma: %${round2(awayMatchWin * 100)}, Alt 3.5 set: %${round2(totalSetsUnder35 * 100)}.`,
        recommendation: `${awayName} kazanir + alt 3.5 set kombini`,
      });
    }

    // --- High risk: first set loser wins match (comeback) ---
    const comebackHomeProb = firstSetAway * homeMatchWin * 1.05;
    const comebackAwayProb = firstSetHome * awayMatchWin * 1.05;

    if (comebackHomeProb > 0.07) {
      highRiskBets.push({
        title: `Ilk Seti Kaybeden Maci Kazanir: ${homeName}`,
        description: `${homeName} ilk seti kaybetmesine ragmen maci kazanma olasiligi %${round2(comebackHomeProb * 100)}. Yuksek oran: ${probabilityToOdds(comebackHomeProb)}.`,
        confidence: round2(comebackHomeProb * 100),
        reason: `Geri donus olasiligi. ${homeName} takim derinligi ve kondisyon ustunlugu ile 5 setlik maclarda avantajli.`,
        recommendation: `${homeName} ilk seti kaybeder ama maci kazanir`,
      });
    }
    if (comebackAwayProb > 0.07) {
      highRiskBets.push({
        title: `Ilk Seti Kaybeden Maci Kazanir: ${awayName}`,
        description: `${awayName} ilk seti kaybetmesine ragmen maci kazanma olasiligi %${round2(comebackAwayProb * 100)}. Yuksek oran: ${probabilityToOdds(comebackAwayProb)}.`,
        confidence: round2(comebackAwayProb * 100),
        reason: `Geri donus olasiligi. ${awayName} deplasmanda yavas baslayip toparlanma egiliminde.`,
        recommendation: `${awayName} ilk seti kaybeder ama maci kazanir`,
      });
    }

    // --- High risk: exact total sets bet ---
    if (Math.abs(p - 0.5) < 0.10) {
      // Close match - 5 set bet
      highRiskBets.push({
        title: `Mac 5 Sete Gider`,
        description: `Dengeli guc yapisi nedeniyle mac 5 sete gidme olasiligi %${round2(totalSetsOver35 * 100)}. Yuksek oran: ${probabilityToOdds(totalSetsOver35)}.`,
        confidence: round2(totalSetsOver35 * 100),
        reason: `Set kazanma olasiliklari birbirine yakin: ev sahibi %${round2(p * 100)}, deplasman %${round2(q * 100)}.`,
        recommendation: `Toplam set ust 4.5 (5 set)`,
      });
    } else {
      // Dominant team - 3-0 bet
      const dominantScore = p > 0.5 ? p30 : p03;
      const dominantTeam = p > 0.5 ? homeName : awayName;
      const scoreLabel = p > 0.5 ? '3-0' : '0-3';
      if (dominantScore > 0.10) {
        highRiskBets.push({
          title: `${dominantTeam} 3-0 Kazanir`,
          description: `${dominantTeam} maci 3-0 ile kazanma olasiligi %${round2(dominantScore * 100)}. Oran: ${probabilityToOdds(dominantScore)}.`,
          confidence: round2(dominantScore * 100),
          reason: `Guc farki belirgin. ${dominantTeam} her uc seti kazanma kapasitesine sahip.`,
          recommendation: `Set skoru ${scoreLabel}`,
        });
      }
    }

    // 13. Build final prediction result
    return {
      sport: 'volleyball',
      game_id: gameId,
      match_info: {
        home_team: homeName,
        away_team: awayName,
        league: league?.name || 'Bilinmeyen Lig',
        country: game.country?.name || '',
        date: game.date || '',
        time: game.time || '',
        status: game.status?.long || '',
      },
      match_result: {
        home_win: {
          probability: round4(homeMatchWin),
          odds: probabilityToOdds(homeMatchWin),
        },
        away_win: {
          probability: round4(awayMatchWin),
          odds: probabilityToOdds(awayMatchWin),
        },
        // No draw in volleyball
        confidence: confidenceScore,
      },
      set_analysis: {
        home_set_win_probability: round4(p),
        away_set_win_probability: round4(q),
        exact_set_scores: exactSetScores,
        set_handicap: {
          home_minus_15: {
            probability: round4(homeHandicapMinus15),
            odds: probabilityToOdds(homeHandicapMinus15),
            ...(realSetHandicapLine !== null && parsedOdds?.set_handicap ? {
              bookmaker_home_odds: parsedOdds.set_handicap.home_odds,
              bookmaker_away_odds: parsedOdds.set_handicap.away_odds,
              source: 'api_odds' as 'api_odds' | 'model',
            } : {
              source: 'model' as 'api_odds' | 'model',
            }),
          },
          away_plus_15: {
            probability: round4(awayHandicapPlus15),
            odds: probabilityToOdds(awayHandicapPlus15),
            source: (realSetHandicapLine !== null ? 'api_odds' : 'model') as 'api_odds' | 'model',
          },
          home_plus_15: {
            probability: round4(homeHandicapPlus15),
            odds: probabilityToOdds(homeHandicapPlus15),
            source: 'model' as 'api_odds' | 'model',
          },
          away_minus_15: {
            probability: round4(awayHandicapMinus15),
            odds: probabilityToOdds(awayHandicapMinus15),
            source: 'model' as 'api_odds' | 'model',
          },
        },
        total_sets: {
          over_35: {
            probability: round4(totalSetsOver35),
            odds: probabilityToOdds(totalSetsOver35),
            ...(realTotalSetsLine !== null && parsedOdds?.total_sets ? {
              bookmaker_over_odds: parsedOdds.total_sets.over_odds,
              bookmaker_under_odds: parsedOdds.total_sets.under_odds,
            } : {}),
            source: (realTotalSetsLine !== null ? 'api_odds' : 'model') as 'api_odds' | 'model',
          },
          under_35: {
            probability: round4(totalSetsUnder35),
            odds: probabilityToOdds(totalSetsUnder35),
            source: (realTotalSetsLine !== null ? 'api_odds' : 'model') as 'api_odds' | 'model',
          },
        },
      },
      total_points: {
        expected_total: round2(meanTotalPoints),
        expected_sets: round2(expectedTotalSets),
        markets: totalPointsMarkets.map((m) => ({
          line: m.line,
          over: { probability: m.over, odds: probabilityToOdds(m.over) },
          under: { probability: m.under, odds: probabilityToOdds(m.under) },
          ...(m.bookmaker_over_odds ? {
            bookmaker_over_odds: m.bookmaker_over_odds,
            bookmaker_under_odds: m.bookmaker_under_odds,
          } : {}),
          source: m.source,
        })),
      },
      first_set: {
        home_win: {
          probability: round4(firstSetHome),
          odds: probabilityToOdds(firstSetHome),
        },
        away_win: {
          probability: round4(firstSetAway),
          odds: probabilityToOdds(firstSetAway),
        },
      },
      odds_data: parsedOdds,
      value_bets: valueBets,
      high_confidence_bets: highConfidenceBets,
      medium_risk_bets: mediumRiskBets,
      high_risk_bets: highRiskBets,
      prediction_confidence: confidenceScore,
      confidence_tier: confidenceTier,
      analysis_factors: {
        recent_form: round4(formFactor),
        set_win_rate: round4(setRateFactor),
        home_advantage: round4(homeAdvFactor),
        attack_efficiency: round4(attackFactor),
        serve_stats: round4(serveFactor),
        h2h: round4(h2hFactor),
        league_position: round4(positionFactor),
        momentum: round4(momentumFactor),
        set_win_probability: round4(p),
        data_quality: round4(dataQuality),
      },
      risk_analysis: {
        volatility: round2(totalSetsOver35 * 100), // Higher = more volatile match
        upset_probability: round2(Math.min(homeMatchWin, awayMatchWin) * 100),
        five_set_probability: round2(totalSetsOver35 * 100),
        data_completeness: round2(dataQuality * 100),
      },
    } as any;
  }
}

// ============================================================
// Helper functions
// ============================================================

/**
 * Sigmoid function to map raw advantage to probability.
 * center = base probability (0.50 for neutral).
 * Steepness controls how quickly advantage maps to high/low prob.
 */
function sigmoid(x: number, center: number): number {
  const steepness = 4.0;
  return center + (1 - center * 2) * (1 / (1 + Math.exp(-steepness * x)) - 0.5) * 2;
}

/**
 * Calculate set win rate from recent games with exponential recency weighting.
 * More recent games get higher weight in the calculation.
 * Decay: 0.85 per game (most recent game = 2x weight of 5th game back).
 */
function calculateSetWinRate(recentGames: any[], teamId: number): number {
  const DECAY = 0.85;
  let weightedSetsWon = 0;
  let totalWeight = 0;

  for (let gameIdx = 0; gameIdx < recentGames.length; gameIdx++) {
    const game = recentGames[gameIdx];
    const isHome = game.teams?.home?.id === teamId;
    const homeScores = game.scores?.home;
    const awayScores = game.scores?.away;

    if (!homeScores || !awayScores) continue;

    // Recency weight: most recent game (last index) = highest weight
    const recencyIdx = recentGames.length - 1 - gameIdx;
    const gameWeight = Math.pow(DECAY, recencyIdx);

    // Count sets from individual set scores (set_1 through set_5)
    const setKeys = ['set_1', 'set_2', 'set_3', 'set_4', 'set_5'] as const;
    for (const key of setKeys) {
      const homeSetScore = homeScores[key];
      const awaySetScore = awayScores[key];

      if (homeSetScore == null || awaySetScore == null) continue;
      if (homeSetScore === 0 && awaySetScore === 0) continue;

      totalWeight += gameWeight;
      if (isHome && homeSetScore > awaySetScore) weightedSetsWon += gameWeight;
      if (!isHome && awaySetScore > homeSetScore) weightedSetsWon += gameWeight;
    }
  }

  return totalWeight > 0 ? weightedSetsWon / totalWeight : 0.5;
}

/**
 * Extract attack efficiency from team statistics.
 * Attack efficiency is the single most predictive stat in volleyball.
 *
 * Attack efficiency = (kills - errors) / total attempts
 * Professional teams: 0.20-0.35 range (top teams 0.30+)
 *
 * Returns a normalized value (0-1 scale).
 */
function extractAttackEfficiency(stats: any[]): number {
  if (!stats || stats.length === 0) return 0.5;

  const stat = stats[0];

  // Try to get true attack efficiency (kills - errors) / attempts
  const kills = stat?.statistics?.attacks?.kills
    ?? stat?.statistics?.attacks?.successful
    ?? null;
  const errors = stat?.statistics?.attacks?.errors
    ?? stat?.statistics?.attacks?.blocked
    ?? 0;
  const attempts = stat?.statistics?.attacks?.total
    ?? stat?.statistics?.attacks?.attempts
    ?? null;

  if (kills != null && attempts != null && attempts > 0) {
    // True volleyball attack efficiency
    const efficiency = (kills - errors) / attempts;
    // Map 0.15-0.35 range to 0.25-0.75
    return Math.max(0.20, Math.min(0.80, 0.5 + (efficiency - 0.25) * 2.5));
  }

  // Fallback: use total points scored
  const attackPoints = stat?.statistics?.points?.total
    ?? stat?.games?.points?.for?.total
    ?? null;
  const gamesPlayed = stat?.statistics?.games?.played
    ?? stat?.games?.played?.total
    ?? null;

  if (attackPoints != null && gamesPlayed != null && gamesPlayed > 0) {
    const avgPerGame = attackPoints / gamesPlayed;
    // Normalize: average volleyball team scores ~60-80 points per match
    return Math.max(0.20, Math.min(0.80, avgPerGame / 140));
  }

  return 0.5; // Default neutral
}

/**
 * Extract serve strength from team statistics.
 * Serve pressure in volleyball comes from both aces and serve errors.
 * Net serve impact = (aces - serve_errors) / total_serves
 *
 * Returns a normalized value (0-1 scale).
 */
function extractServeStrength(stats: any[]): number {
  if (!stats || stats.length === 0) return 0.5;

  const stat = stats[0];

  const aces = stat?.statistics?.serves?.aces
    ?? stat?.statistics?.aces?.total
    ?? null;
  const serveErrors = stat?.statistics?.serves?.errors
    ?? stat?.statistics?.serve_errors?.total
    ?? 0;
  const totalServes = stat?.statistics?.serves?.total
    ?? stat?.statistics?.serves?.attempts
    ?? null;

  const gamesPlayed = stat?.statistics?.games?.played
    ?? stat?.games?.played?.total
    ?? null;

  if (aces != null && gamesPlayed != null && gamesPlayed > 0) {
    // Calculate net serve impact per game
    const netAcesPerGame = (aces - serveErrors * 0.5) / gamesPlayed;
    // Top teams: 5-8 aces, 8-12 serve errors per match
    // Net positive serve impact: 2-4 per game is good
    // Map -2 to +6 range to 0.2-0.8
    return Math.max(0.20, Math.min(0.80, 0.5 + netAcesPerGame * 0.05));
  }

  return 0.5; // Default neutral
}

/**
 * Calculate H2H factor from historical matchups with recency weighting.
 * More recent matches get exponentially higher weight.
 * Returns -1 to 1 advantage for home team.
 */
function calculateH2HFactor(h2hGames: any[], homeTeamId: number): number {
  if (!h2hGames || h2hGames.length === 0) return 0;

  const H2H_DECAY = 0.82;
  let weightedHomeWins = 0;
  let totalWeight = 0;

  for (let i = 0; i < h2hGames.length; i++) {
    const game = h2hGames[i];
    const homeScore = game.scores?.home?.total;
    const awayScore = game.scores?.away?.total;

    if (homeScore == null || awayScore == null) continue;

    // Recency weight: last in array = most recent
    const recencyIdx = h2hGames.length - 1 - i;
    const weight = Math.pow(H2H_DECAY, recencyIdx);
    totalWeight += weight;

    const isHome = game.teams?.home?.id === homeTeamId;

    if (isHome && homeScore > awayScore) weightedHomeWins += weight;
    if (!isHome && awayScore > homeScore) weightedHomeWins += weight;
  }

  if (totalWeight === 0) return 0;

  // Blend with neutral based on sample size (fewer games = less influence)
  const sampleWeight = Math.min(h2hGames.length, 5) / 5;
  const rawWinRate = weightedHomeWins / totalWeight;
  const blendedWinRate = rawWinRate * sampleWeight + 0.5 * (1 - sampleWeight);

  // Convert to -1 to 1 scale
  return (blendedWinRate - 0.5) * 2;
}

/**
 * Calculate momentum factor for a team.
 * Measures how often a team converts first-set wins into match wins.
 * Returns 0-1 (higher = stronger momentum/closing ability).
 */
function calculateMomentumFactor(recentGames: any[], teamId: number): number {
  let firstSetWins = 0;
  let matchWinsAfterFirstSet = 0;
  let totalGames = 0;

  for (const game of recentGames) {
    const isHome = game.teams?.home?.id === teamId;
    const homeScores = game.scores?.home;
    const awayScores = game.scores?.away;

    if (!homeScores || !awayScores) continue;

    const homeTotal = homeScores.total;
    const awayTotal = awayScores.total;
    if (homeTotal == null || awayTotal == null) continue;

    totalGames++;

    // Check first set winner
    const set1Home = homeScores.set_1;
    const set1Away = awayScores.set_1;
    if (set1Home == null || set1Away == null) continue;

    const wonFirstSet = isHome ? set1Home > set1Away : set1Away > set1Home;
    const wonMatch = isHome ? homeTotal > awayTotal : awayTotal > homeTotal;

    if (wonFirstSet) {
      firstSetWins++;
      if (wonMatch) matchWinsAfterFirstSet++;
    }
  }

  if (firstSetWins === 0) return 0.5; // Neutral if no data

  // Momentum = conversion rate of first-set win to match win
  // Average is ~0.67, so normalize around that
  const conversionRate = matchWinsAfterFirstSet / firstSetWins;
  return Math.max(0.2, Math.min(0.8, conversionRate));
}

/**
 * Calculate league position factor.
 * Returns advantage for home team based on league standings (-1 to 1).
 */
function calculatePositionFactor(
  standings: any[],
  homeTeamId: number,
  awayTeamId: number
): number {
  if (!standings || standings.length === 0) return 0;

  // Flatten standings (may be nested in groups)
  const flatStandings: any[] = [];
  for (const entry of standings) {
    if (Array.isArray(entry)) {
      flatStandings.push(...entry);
    } else {
      flatStandings.push(entry);
    }
  }

  const homeStanding = flatStandings.find((s: any) => s.team?.id === homeTeamId);
  const awayStanding = flatStandings.find((s: any) => s.team?.id === awayTeamId);

  if (!homeStanding || !awayStanding) return 0;

  const homePos = homeStanding.position || homeStanding.rank || 0;
  const awayPos = awayStanding.position || awayStanding.rank || 0;
  const totalTeams = flatStandings.length || 16;

  if (homePos === 0 || awayPos === 0) return 0;

  // Normalize position difference: positive = home is better ranked
  const posDiff = (awayPos - homePos) / totalTeams;
  return Math.max(-1, Math.min(1, posDiff * 2));
}

/**
 * Round to 4 decimal places
 */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Round to 2 decimal places
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Odds Parsing Functions ─────────────────────────────────────────────────

/**
 * Convert decimal odds to implied probability (%).
 * E.g., odds 1.73 -> 1/1.73 = 57.8%
 * Handles edge cases: odds <= 1 returns 100%.
 */
function oddsToImpliedProbability(odds: number): number {
  if (!odds || odds <= 1) return 100;
  return (1 / odds) * 100;
}

/**
 * Parse the raw odds response from API-Volleyball into structured data.
 *
 * API-Volleyball odds response structure:
 * response[].bookmakers[].bets[].values[]
 *
 * Market IDs:
 *   2 = Home/Away (match winner, 2-way -- volleyball has no draw)
 *   3 = Asian Handicap (set handicap: -1.5/+1.5)
 *   4 = Over/Under (total sets 3.5 or total points)
 *
 * Each bet value has: { value: "Over 3.5", odd: "1.85" }
 *
 * Note: For volleyball, market ID 4 may appear multiple times:
 * once for total sets (line 3.5) and once for total points (line ~180.5).
 * We distinguish them by line value: < 10 = total sets, >= 100 = total points.
 */
function parseOddsResponse(rawOdds: any[]): ParsedVolleyballOdds | null {
  if (!rawOdds || rawOdds.length === 0) return null;

  const gameOdds = rawOdds[0];
  const bookmakers = gameOdds?.bookmakers;
  if (!bookmakers || bookmakers.length === 0) return null;

  const bookmaker = bookmakers[0];
  const bets: any[] = bookmaker?.bets || [];

  let matchWinner: ParsedVolleyballOdds['match_winner'] = null;
  let setHandicap: ParsedVolleyballOdds['set_handicap'] = null;
  let totalSets: ParsedVolleyballOdds['total_sets'] = null;
  let totalPoints: ParsedVolleyballOdds['total_points'] = null;
  const rawMarkets: ParsedVolleyballOdds['raw_markets'] = [];

  for (const bet of bets) {
    const marketId = bet.id;
    const marketName = bet.name || '';
    const values: any[] = bet.values || [];

    rawMarkets.push({ market_id: marketId, market_name: marketName, values });

    switch (marketId) {
      case 1: // 3Way Result (shouldn't appear in volleyball, but handle as fallback)
      case 2: // Home/Away (match winner, 2-way)
        matchWinner = parseMoneyline(values);
        break;
      case 3: // Asian Handicap (set handicap)
        setHandicap = parseSpread(values);
        break;
      case 4: { // Over/Under (total sets or total points)
        const parsed = parseOverUnder(values);
        if (parsed) {
          // Distinguish: line < 10 = total sets, line >= 100 = total points
          if (parsed.line < 10) {
            totalSets = parsed;
          } else {
            totalPoints = parsed;
          }
        }
        break;
      }
    }
  }

  return {
    match_winner: matchWinner,
    set_handicap: setHandicap,
    total_sets: totalSets,
    total_points: totalPoints,
    bookmaker: bookmaker?.name || null,
    raw_markets: rawMarkets,
  };
}

/**
 * Parse Home/Away (moneyline) market values.
 * Values: [{ value: "Home", odd: "1.30" }, { value: "Away", odd: "3.40" }]
 */
function parseMoneyline(values: any[]): ParsedVolleyballOdds['match_winner'] {
  let homeOdds = 0;
  let awayOdds = 0;

  for (const v of values) {
    const label = String(v.value || '').toLowerCase().trim();
    const odd = parseFloat(v.odd);
    if (isNaN(odd)) continue;

    if (label === 'home' || label === '1' || label.startsWith('home')) {
      homeOdds = odd;
    } else if (label === 'away' || label === '2' || label.startsWith('away')) {
      awayOdds = odd;
    }
  }

  if (homeOdds <= 0 && awayOdds <= 0) return null;
  return { home_odds: homeOdds, away_odds: awayOdds };
}

/**
 * Parse Asian Handicap (set handicap) market values.
 * Values: [{ value: "Home -1.5", odd: "1.75" }, { value: "Away +1.5", odd: "2.00" }]
 */
function parseSpread(values: any[]): ParsedVolleyballOdds['set_handicap'] {
  let line = 0;
  let homeOdds = 0;
  let awayOdds = 0;

  for (const v of values) {
    const label = String(v.value || '');
    const odd = parseFloat(v.odd);
    if (isNaN(odd)) continue;

    const numMatch = label.match(/([+-]?\d+\.?\d*)/);
    if (!numMatch) continue;

    const num = parseFloat(numMatch[1]);
    const lowerLabel = label.toLowerCase();

    if (lowerLabel.includes('home')) {
      line = num;
      homeOdds = odd;
    } else if (lowerLabel.includes('away')) {
      awayOdds = odd;
      if (line === 0) {
        line = -num;
      }
    }
  }

  if (line === 0 && homeOdds <= 0 && awayOdds <= 0) return null;
  return { line, home_odds: homeOdds, away_odds: awayOdds };
}

/**
 * Parse Over/Under market values.
 * Values: [{ value: "Over 3.5", odd: "2.10" }, { value: "Under 3.5", odd: "1.70" }]
 * or: [{ value: "Over 180.5", odd: "1.85" }, { value: "Under 180.5", odd: "1.90" }]
 */
function parseOverUnder(values: any[]): { line: number; over_odds: number; under_odds: number } | null {
  let line = 0;
  let overOdds = 0;
  let underOdds = 0;

  for (const v of values) {
    const label = String(v.value || '');
    const odd = parseFloat(v.odd);
    if (isNaN(odd)) continue;

    const numMatch = label.match(/(\d+\.?\d*)/);
    if (!numMatch) continue;

    const num = parseFloat(numMatch[1]);
    const lowerLabel = label.toLowerCase();

    if (lowerLabel.includes('over')) {
      line = num;
      overOdds = odd;
    } else if (lowerLabel.includes('under')) {
      if (line === 0) line = num;
      underOdds = odd;
    }
  }

  if (line <= 0) return null;
  return { line, over_odds: overOdds, under_odds: underOdds };
}
