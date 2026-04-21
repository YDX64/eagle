
import {
  normalCDF,
  overProbabilityNormal,
  calculateTeamForm,
  calculateConfidenceTier,
  probabilityToOdds,
} from '@/lib/sports/base/prediction-utils';
import { ConfidenceTier, SportTeamForm } from '@/lib/sports/base/types';
import { ApiBasketballService } from './api-basketball';

/**
 * Algorithm weight factors for basketball prediction.
 * Basketball is a high-possession, high-scoring sport where
 * offensive/defensive efficiency and pace are dominant factors.
 */
const WEIGHTS = {
  recent_form: 0.22,
  home_court: 0.13,
  offensive_rating: 0.20,
  defensive_rating: 0.15,
  pace: 0.10,
  h2h: 0.08,
  rest_days: 0.07,
  league_position: 0.05,
} as const;

/**
 * League-specific average total points and home court advantage.
 * These constants are derived from multi-season statistical analysis.
 */
const LEAGUE_PROFILES: Record<number, { avgTotal: number; homeAdv: number; stdDev: number; teamStdDev: number; label: string }> = {
  // NBA
  12:  { avgTotal: 224.5, homeAdv: 3.5, stdDev: 18, teamStdDev: 12, label: 'NBA' },
  // Euroleague
  120: { avgTotal: 160.0, homeAdv: 4.5, stdDev: 14, teamStdDev: 9, label: 'Euroleague' },
  // Eurocup
  121: { avgTotal: 157.0, homeAdv: 4.0, stdDev: 14, teamStdDev: 9, label: 'Eurocup' },
  // BSL (Turkish Basketball Super League)
  79:  { avgTotal: 162.0, homeAdv: 5.0, stdDev: 14, teamStdDev: 9, label: 'BSL' },
  // ACB (Spanish Liga)
  117: { avgTotal: 162.0, homeAdv: 4.5, stdDev: 14, teamStdDev: 9, label: 'ACB' },
  // German BBL
  132: { avgTotal: 166.0, homeAdv: 4.0, stdDev: 15, teamStdDev: 10, label: 'BBL' },
  // French LNB Pro A
  126: { avgTotal: 160.0, homeAdv: 4.5, stdDev: 14, teamStdDev: 9, label: 'Pro A' },
  // Italian Lega Basket
  136: { avgTotal: 160.0, homeAdv: 4.5, stdDev: 14, teamStdDev: 9, label: 'Lega Basket' },
  // CBA (Chinese)
  99:  { avgTotal: 210.0, homeAdv: 5.0, stdDev: 17, teamStdDev: 11, label: 'CBA' },
  // NBB (Brazilian)
  168: { avgTotal: 168.0, homeAdv: 4.5, stdDev: 15, teamStdDev: 10, label: 'NBB' },
  // KBL (Korean)
  110: { avgTotal: 170.0, homeAdv: 4.0, stdDev: 15, teamStdDev: 10, label: 'KBL' },
  // NBL (Australian)
  116: { avgTotal: 176.0, homeAdv: 4.0, stdDev: 15, teamStdDev: 10, label: 'NBL' },
};

/** Default profile for leagues not in the map */
const DEFAULT_LEAGUE_PROFILE = { avgTotal: 165.0, homeAdv: 4.0, stdDev: 15, teamStdDev: 10, label: 'Default' };

/**
 * Rest day impact multiplier.
 * NBA back-to-back penalty is significant (~2-3 points).
 * 0 rest days (back-to-back) = big penalty, 1 day = small penalty, 2+ = neutral/boost
 */
const REST_DAY_ADJUSTMENTS: Record<number, number> = {
  0: -3.5,  // Back-to-back: significant fatigue
  1: -1.0,  // One day rest: mild fatigue
  2: 0,     // Standard rest: neutral
  3: 0.5,   // Extra rest: slight boost
  4: 0.3,   // Diminishing returns after 3+ days
};

/**
 * Bet recommendation structure
 */
interface BetRecommendation {
  title: string;
  description: string;
  confidence: number;
  reason: string;
  recommendation: string;
  market: string;
  selection: string;
  estimated_odds: number;
}

/**
 * Value bet: our model probability vs bookmaker implied probability.
 * Flagged when our edge exceeds the threshold (typically >5%).
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
 * Parsed odds data from API-Basketball odds endpoint.
 * Market IDs: 2 = Home/Away, 3 = Asian Handicap, 4 = Over/Under,
 * 5 = Over/Under 1st Half, 16 = Over/Under 1st Qtr
 */
interface ParsedOddsData {
  moneyline: { home_odds: number; away_odds: number } | null;
  spread: { line: number; home_odds: number; away_odds: number } | null;
  total: { line: number; over_odds: number; under_odds: number } | null;
  first_half_total: { line: number; over_odds: number; under_odds: number } | null;
  first_quarter_total: { line: number; over_odds: number; under_odds: number } | null;
  bookmaker: string | null;
  raw_markets: Array<{ market_id: number; market_name: string; values: any[] }>;
}

/**
 * Full basketball prediction result
 */
interface BasketballPrediction {
  sport: 'basketball';
  game_id: number;
  game_info: {
    home_team: string;
    away_team: string;
    league: string;
    date: string;
    status: string;
  };
  match_result: {
    home_win: { probability: number; odds: number };
    away_win: { probability: number; odds: number };
    predicted_winner: string;
    confidence: number;
  };
  point_spread: Array<{
    spread: number;
    home_cover_probability: number;
    away_cover_probability: number;
    home_odds: number;
    away_odds: number;
    bookmaker_home_odds?: number;
    bookmaker_away_odds?: number;
    source: 'api_odds' | 'model';
  }>;
  total_points: {
    expected_total: number;
    std_dev: number;
    lines: Array<{
      line: number;
      over_probability: number;
      under_probability: number;
      over_odds: number;
      under_odds: number;
      bookmaker_over_odds?: number;
      bookmaker_under_odds?: number;
      source: 'api_odds' | 'model';
    }>;
  };
  halftime_analysis: {
    expected_first_half_total: number;
    expected_second_half_total: number;
    first_half_lines: Array<{
      line: number;
      over_probability: number;
      under_probability: number;
      over_odds: number;
      under_odds: number;
      bookmaker_over_odds?: number;
      bookmaker_under_odds?: number;
      source: 'api_odds' | 'model';
    }>;
    /** @deprecated Use first_half_lines instead */
    first_half_over_probability: Record<string, number>;
  };
  quarter_analysis: Array<{
    quarter: string;
    home_win_probability: number;
    away_win_probability: number;
  }>;
  score_ranges: {
    home: Array<{ range: string; probability: number }>;
    away: Array<{ range: string; probability: number }>;
  };
  team_stats: {
    home: {
      ppg: number;
      opp_ppg: number;
      form: SportTeamForm;
      offensive_rating: number;
      defensive_rating: number;
    };
    away: {
      ppg: number;
      opp_ppg: number;
      form: SportTeamForm;
      offensive_rating: number;
      defensive_rating: number;
    };
  };
  h2h_summary: {
    total_games: number;
    home_wins: number;
    away_wins: number;
    avg_total_points: number;
  };
  odds_data: ParsedOddsData | null;
  value_bets: ValueBetEntry[];
  high_confidence_bets: BetRecommendation[];
  medium_risk_bets: BetRecommendation[];
  high_risk_bets: BetRecommendation[];
  prediction_confidence: number;
  confidence_tier: ConfidenceTier | null;
  analysis_factors: Record<string, number>;
  risk_analysis: {
    high_confidence_bets: BetRecommendation[];
    medium_risk_bets: BetRecommendation[];
    high_risk_bets: BetRecommendation[];
  };
}

/**
 * Basketball Prediction Engine
 *
 * Uses normal distribution for score modeling (not Poisson, as basketball
 * is a high-scoring sport with ~190-230 total points per game).
 *
 * Key differences from football prediction:
 * - No draws (overtime decides the winner)
 * - Point spread / handicap markets are central
 * - Total points (over/under) is the dominant market
 * - Quarter and half analysis provides additional value
 */
export class BasketballPredictionEngine {
  /**
   * Generate a comprehensive basketball prediction for a given game.
   *
   * @param gameId - API-Basketball game ID
   * @param client - ApiBasketballService instance
   * @returns Full prediction object with all markets and bet recommendations
   */
  static async generatePrediction(
    gameId: number,
    client: ApiBasketballService
  ): Promise<BasketballPrediction> {
    // 1. Fetch game details
    const game = await client.getGameById(gameId);
    if (!game) {
      throw new Error(`Basketbol maci bulunamadi: ${gameId}`);
    }

    const homeTeam = game.teams?.home;
    const awayTeam = game.teams?.away;
    const league = game.league;

    if (!homeTeam?.id || !awayTeam?.id) {
      throw new Error(`Mac icin takim bilgileri eksik: ${gameId}`);
    }

    const season = league?.season || client.getCurrentSeason();
    const leagueId = league?.id;

    // 2. Fetch data in parallel: standings, recent games, H2H, and REAL ODDS
    const [standings, homeRecent, awayRecent, h2hGames, rawOddsData] = await Promise.all([
      leagueId ? client.getStandings(leagueId, season).catch(() => []) : Promise.resolve([]),
      leagueId
        ? client.getRecentGames(homeTeam.id, leagueId, season, 10).catch(() => [])
        : Promise.resolve([]),
      leagueId
        ? client.getRecentGames(awayTeam.id, leagueId, season, 10).catch(() => [])
        : Promise.resolve([]),
      client.getH2H(homeTeam.id, awayTeam.id).catch(() => []),
      client.getOdds({ game: gameId }).catch(() => []),
    ]);

    // 2b. Parse real odds from API-Basketball
    const parsedOdds = parseOddsResponse(rawOddsData);

    // 3. Calculate team form
    const homeForm = calculateTeamForm(
      homeRecent.map((g: any) => ({
        homeTeamId: g.teams?.home?.id,
        awayTeamId: g.teams?.away?.id,
        homeScore: g.scores?.home?.total ?? null,
        awayScore: g.scores?.away?.total ?? null,
      })),
      homeTeam.id
    );

    const awayForm = calculateTeamForm(
      awayRecent.map((g: any) => ({
        homeTeamId: g.teams?.home?.id,
        awayTeamId: g.teams?.away?.id,
        homeScore: g.scores?.home?.total ?? null,
        awayScore: g.scores?.away?.total ?? null,
      })),
      awayTeam.id
    );

    // 4. Calculate offensive and defensive ratings (points per game)
    const homeOffensiveStats = calculateScoringStats(homeRecent, homeTeam.id);
    const awayOffensiveStats = calculateScoringStats(awayRecent, awayTeam.id);

    // 5. Extract standings data
    const homeStanding = findTeamStanding(standings, homeTeam.id);
    const awayStanding = findTeamStanding(standings, awayTeam.id);

    // 6. H2H analysis
    const h2hSummary = analyzeH2H(h2hGames, homeTeam.id, awayTeam.id);

    // 7. Compute composite strength scores
    const homeStrength = computeTeamStrength(
      homeForm,
      homeOffensiveStats,
      homeStanding,
      h2hSummary,
      true // is home
    );

    const awayStrength = computeTeamStrength(
      awayForm,
      awayOffensiveStats,
      awayStanding,
      h2hSummary,
      false
    );

    // 8. Normalize to probabilities (no draw in basketball)
    const totalStrength = homeStrength + awayStrength;
    const homeWinProb = totalStrength > 0 ? homeStrength / totalStrength : 0.5;
    const awayWinProb = 1 - homeWinProb;

    // 9. Expected points using team averages, opponent defense, and league-specific data
    const leagueProfile = LEAGUE_PROFILES[leagueId || 0] || DEFAULT_LEAGUE_PROFILE;
    const leagueAvgPerTeam = leagueProfile.avgTotal / 2;

    const expectedHomePoints = calculateExpectedPoints(
      homeOffensiveStats.ppg,
      awayOffensiveStats.oppPpg,
      leagueAvgPerTeam
    );

    const expectedAwayPoints = calculateExpectedPoints(
      awayOffensiveStats.ppg,
      homeOffensiveStats.oppPpg,
      leagueAvgPerTeam
    );

    // League-specific home court advantage (NBA ~3.5, European ~4-5)
    const homeCourtAdv = leagueProfile.homeAdv;

    // Rest day impact: calculate from recent game dates
    const homeRestAdj = calculateRestDayAdjustment(homeRecent, game.date);
    const awayRestAdj = calculateRestDayAdjustment(awayRecent, game.date);

    const adjustedHomePoints = expectedHomePoints + homeCourtAdv + homeRestAdj;
    const adjustedAwayPoints = expectedAwayPoints + awayRestAdj;
    const expectedTotal = adjustedHomePoints + adjustedAwayPoints;

    // Use league-specific standard deviations
    const teamStdDev = leagueProfile.teamStdDev;
    const totalStdDev = leagueProfile.stdDev;

    // 10. Generate point spread analysis using REAL odds when available
    const pointDiff = adjustedHomePoints - adjustedAwayPoints;
    const diffStdDev = Math.sqrt(teamStdDev ** 2 + teamStdDev ** 2);

    // Build spread lines: use real API spread as primary, add model-generated alternatives
    const spreadValues: number[] = [];
    const realSpreadLine = parsedOdds?.spread?.line ?? null;

    if (realSpreadLine !== null) {
      // Real spread from bookmakers is the anchor; add nearby alternatives
      spreadValues.push(realSpreadLine);
      // Add model-based alternatives that differ from the real line
      const modelAlternatives = [
        realSpreadLine + 3,
        realSpreadLine - 3,
        realSpreadLine + 6,
      ].filter(v => Math.abs(v) <= 30 && v !== realSpreadLine);
      spreadValues.push(...modelAlternatives.slice(0, 2));
    } else {
      // Fallback: generate spreads around model-estimated point differential
      const modelSpread = -Math.round(pointDiff * 2) / 2; // Round to nearest 0.5
      spreadValues.push(
        modelSpread,
        modelSpread + 3,
        modelSpread - 3,
        modelSpread + 7,
      );
    }

    const pointSpread = spreadValues.map((spread) => {
      // Home team covers if (homePoints - awayPoints) > |spread|
      // For negative spread (home favored): home needs to win by more than spread
      const coverThreshold = -spread; // e.g., spread -5.5 means home must win by 6+
      const homeCoverProb = overProbabilityNormal(coverThreshold, pointDiff, diffStdDev);
      const awayCoverProb = 1 - homeCoverProb;

      // Attach real bookmaker odds if this is the API spread line
      const isRealLine = realSpreadLine !== null && spread === realSpreadLine;

      return {
        spread,
        home_cover_probability: round2(homeCoverProb * 100),
        away_cover_probability: round2(awayCoverProb * 100),
        home_odds: probabilityToOdds(homeCoverProb),
        away_odds: probabilityToOdds(awayCoverProb),
        ...(isRealLine && parsedOdds?.spread ? {
          bookmaker_home_odds: parsedOdds.spread.home_odds,
          bookmaker_away_odds: parsedOdds.spread.away_odds,
        } : {}),
        source: (isRealLine ? 'api_odds' : 'model') as 'api_odds' | 'model',
      };
    });

    // 11. Total points over/under lines -- use REAL bookmaker line as anchor
    const realTotalLine = parsedOdds?.total?.line ?? null;
    const anchorLine = realTotalLine ?? (Math.round(expectedTotal * 2) / 2); // Nearest 0.5

    // Build lines: real bookmaker line first, then model alternatives around it
    const totalLinesSet = new Set<number>();
    totalLinesSet.add(anchorLine);
    totalLinesSet.add(anchorLine - 5);
    totalLinesSet.add(anchorLine + 5);
    // If model expected total differs significantly from bookmaker, add it too
    const modelLine = Math.round(expectedTotal * 2) / 2;
    if (Math.abs(modelLine - anchorLine) >= 2) {
      totalLinesSet.add(modelLine);
    }
    const totalLines = Array.from(totalLinesSet)
      .filter(l => l > 120 && l < 300)
      .sort((a, b) => a - b);

    const totalPointsAnalysis = {
      expected_total: round2(expectedTotal),
      std_dev: totalStdDev,
      lines: totalLines.map((line) => {
        const overProb = overProbabilityNormal(line, expectedTotal, totalStdDev);
        const underProb = 1 - overProb;

        // Attach real bookmaker odds if this is the API total line
        const isRealLine = realTotalLine !== null && line === realTotalLine;

        return {
          line,
          over_probability: round2(overProb * 100),
          under_probability: round2(underProb * 100),
          over_odds: probabilityToOdds(overProb),
          under_odds: probabilityToOdds(underProb),
          ...(isRealLine && parsedOdds?.total ? {
            bookmaker_over_odds: parsedOdds.total.over_odds,
            bookmaker_under_odds: parsedOdds.total.under_odds,
          } : {}),
          source: (isRealLine ? 'api_odds' : 'model') as 'api_odds' | 'model',
        };
      }),
    };

    // 12. Half-time analysis (first half typically ~48% of total)
    const firstHalfRatio = 0.48;
    const secondHalfRatio = 0.52;
    const expectedFirstHalf = expectedTotal * firstHalfRatio;
    const expectedSecondHalf = expectedTotal * secondHalfRatio;
    const halfStdDev = totalStdDev * 0.7; // Halves have lower variance

    // Build first half lines: use REAL 1st half line from API as anchor
    const realFirstHalfLine = parsedOdds?.first_half_total?.line ?? null;
    const halfAnchor = realFirstHalfLine ?? (Math.round(expectedFirstHalf * 2) / 2);

    const firstHalfLinesSet = new Set<number>();
    firstHalfLinesSet.add(halfAnchor);
    firstHalfLinesSet.add(halfAnchor - 5);
    firstHalfLinesSet.add(halfAnchor + 5);
    const halfModelLine = Math.round(expectedFirstHalf * 2) / 2;
    if (Math.abs(halfModelLine - halfAnchor) >= 2) {
      firstHalfLinesSet.add(halfModelLine);
    }
    const firstHalfLineValues = Array.from(firstHalfLinesSet)
      .filter(l => l > 60 && l < 160)
      .sort((a, b) => a - b);

    const firstHalfLineEntries = firstHalfLineValues.map((line) => {
      const overProb = overProbabilityNormal(line, expectedFirstHalf, halfStdDev);
      const underProb = 1 - overProb;
      const isRealLine = realFirstHalfLine !== null && line === realFirstHalfLine;

      return {
        line,
        over_probability: round2(overProb * 100),
        under_probability: round2(underProb * 100),
        over_odds: probabilityToOdds(overProb),
        under_odds: probabilityToOdds(underProb),
        ...(isRealLine && parsedOdds?.first_half_total ? {
          bookmaker_over_odds: parsedOdds.first_half_total.over_odds,
          bookmaker_under_odds: parsedOdds.first_half_total.under_odds,
        } : {}),
        source: (isRealLine ? 'api_odds' : 'model') as 'api_odds' | 'model',
      };
    });

    // Legacy format for backward compatibility
    const firstHalfLines: Record<string, number> = {};
    firstHalfLineEntries.forEach((entry) => {
      firstHalfLines[entry.line.toString()] = entry.over_probability;
    });

    // 13. Quarter analysis
    const quarterAnalysis = ['Q1', 'Q2', 'Q3', 'Q4'].map((q, idx) => {
      // Each quarter is roughly 25% with home advantage distributed
      let qHomeAdv = homeWinProb;
      // Q1 is often closer; Q4 diverges for stronger teams
      if (idx === 0) qHomeAdv = 0.5 + (homeWinProb - 0.5) * 0.7;
      if (idx === 3) qHomeAdv = 0.5 + (homeWinProb - 0.5) * 1.15;
      qHomeAdv = Math.max(0.1, Math.min(0.9, qHomeAdv));

      return {
        quarter: q,
        home_win_probability: round2(qHomeAdv * 100),
        away_win_probability: round2((1 - qHomeAdv) * 100),
      };
    });

    // 14. Score range predictions
    const homeScoreRanges = generateScoreRanges(adjustedHomePoints, teamStdDev);
    const awayScoreRanges = generateScoreRanges(adjustedAwayPoints, teamStdDev);

    // 14b. Calculate VALUE BETS: compare model probability vs bookmaker implied probability
    const VALUE_EDGE_THRESHOLD = 5.0; // Flag value bets where edge > 5%
    const valueBets: ValueBetEntry[] = [];

    if (parsedOdds) {
      // Moneyline value
      if (parsedOdds.moneyline) {
        const homeImplied = oddsToImpliedProbability(parsedOdds.moneyline.home_odds);
        const awayImplied = oddsToImpliedProbability(parsedOdds.moneyline.away_odds);

        const homeEdge = (homeWinProb * 100) - homeImplied;
        const awayEdge = (awayWinProb * 100) - awayImplied;

        valueBets.push({
          market: 'moneyline',
          selection: 'home',
          model_probability: round2(homeWinProb * 100),
          implied_probability: round2(homeImplied),
          edge: round2(homeEdge),
          bookmaker_odds: parsedOdds.moneyline.home_odds,
          fair_odds: probabilityToOdds(homeWinProb),
          is_value: homeEdge > VALUE_EDGE_THRESHOLD,
        });
        valueBets.push({
          market: 'moneyline',
          selection: 'away',
          model_probability: round2(awayWinProb * 100),
          implied_probability: round2(awayImplied),
          edge: round2(awayEdge),
          bookmaker_odds: parsedOdds.moneyline.away_odds,
          fair_odds: probabilityToOdds(awayWinProb),
          is_value: awayEdge > VALUE_EDGE_THRESHOLD,
        });
      }

      // Total over/under value (on the real bookmaker line)
      if (parsedOdds.total) {
        const realLine = parsedOdds.total.line;
        const modelOverProb = overProbabilityNormal(realLine, expectedTotal, totalStdDev);
        const modelUnderProb = 1 - modelOverProb;
        const overImplied = oddsToImpliedProbability(parsedOdds.total.over_odds);
        const underImplied = oddsToImpliedProbability(parsedOdds.total.under_odds);

        valueBets.push({
          market: 'total',
          selection: `over_${realLine}`,
          model_probability: round2(modelOverProb * 100),
          implied_probability: round2(overImplied),
          edge: round2((modelOverProb * 100) - overImplied),
          bookmaker_odds: parsedOdds.total.over_odds,
          fair_odds: probabilityToOdds(modelOverProb),
          is_value: ((modelOverProb * 100) - overImplied) > VALUE_EDGE_THRESHOLD,
        });
        valueBets.push({
          market: 'total',
          selection: `under_${realLine}`,
          model_probability: round2(modelUnderProb * 100),
          implied_probability: round2(underImplied),
          edge: round2((modelUnderProb * 100) - underImplied),
          bookmaker_odds: parsedOdds.total.under_odds,
          fair_odds: probabilityToOdds(modelUnderProb),
          is_value: ((modelUnderProb * 100) - underImplied) > VALUE_EDGE_THRESHOLD,
        });
      }

      // Spread value
      if (parsedOdds.spread) {
        const realSpread = parsedOdds.spread.line;
        const coverThreshold = -realSpread;
        const homeCoverProb = overProbabilityNormal(coverThreshold, pointDiff, diffStdDev);
        const awayCoverProb = 1 - homeCoverProb;
        const homeSpreadImplied = oddsToImpliedProbability(parsedOdds.spread.home_odds);
        const awaySpreadImplied = oddsToImpliedProbability(parsedOdds.spread.away_odds);

        valueBets.push({
          market: 'spread',
          selection: `home_${realSpread}`,
          model_probability: round2(homeCoverProb * 100),
          implied_probability: round2(homeSpreadImplied),
          edge: round2((homeCoverProb * 100) - homeSpreadImplied),
          bookmaker_odds: parsedOdds.spread.home_odds,
          fair_odds: probabilityToOdds(homeCoverProb),
          is_value: ((homeCoverProb * 100) - homeSpreadImplied) > VALUE_EDGE_THRESHOLD,
        });
        valueBets.push({
          market: 'spread',
          selection: `away_${realSpread}`,
          model_probability: round2(awayCoverProb * 100),
          implied_probability: round2(awaySpreadImplied),
          edge: round2((awayCoverProb * 100) - awaySpreadImplied),
          bookmaker_odds: parsedOdds.spread.away_odds,
          fair_odds: probabilityToOdds(awayCoverProb),
          is_value: ((awayCoverProb * 100) - awaySpreadImplied) > VALUE_EDGE_THRESHOLD,
        });
      }

      // First half total value
      if (parsedOdds.first_half_total) {
        const fhLine = parsedOdds.first_half_total.line;
        const fhOverProb = overProbabilityNormal(fhLine, expectedFirstHalf, halfStdDev);
        const fhUnderProb = 1 - fhOverProb;
        const fhOverImplied = oddsToImpliedProbability(parsedOdds.first_half_total.over_odds);
        const fhUnderImplied = oddsToImpliedProbability(parsedOdds.first_half_total.under_odds);

        valueBets.push({
          market: 'first_half_total',
          selection: `over_${fhLine}`,
          model_probability: round2(fhOverProb * 100),
          implied_probability: round2(fhOverImplied),
          edge: round2((fhOverProb * 100) - fhOverImplied),
          bookmaker_odds: parsedOdds.first_half_total.over_odds,
          fair_odds: probabilityToOdds(fhOverProb),
          is_value: ((fhOverProb * 100) - fhOverImplied) > VALUE_EDGE_THRESHOLD,
        });
        valueBets.push({
          market: 'first_half_total',
          selection: `under_${fhLine}`,
          model_probability: round2(fhUnderProb * 100),
          implied_probability: round2(fhUnderImplied),
          edge: round2((fhUnderProb * 100) - fhUnderImplied),
          bookmaker_odds: parsedOdds.first_half_total.under_odds,
          fair_odds: probabilityToOdds(fhUnderProb),
          is_value: ((fhUnderProb * 100) - fhUnderImplied) > VALUE_EDGE_THRESHOLD,
        });
      }
    }

    // 15. Compute overall prediction confidence
    const confidenceScore = computeConfidence(
      homeWinProb,
      awayWinProb,
      homeForm,
      awayForm,
      h2hSummary,
      homeRecent.length,
      awayRecent.length
    );
    const confidenceTier = calculateConfidenceTier(confidenceScore);

    // 16. Generate bet recommendations (in Turkish)
    const predictedWinner =
      homeWinProb >= awayWinProb ? homeTeam.name : awayTeam.name;
    const winnerProb = Math.max(homeWinProb, awayWinProb);
    const loserProb = Math.min(homeWinProb, awayWinProb);
    const isHomeFavored = homeWinProb >= awayWinProb;

    const highConfidenceBets: BetRecommendation[] = [];
    const mediumRiskBets: BetRecommendation[] = [];
    const highRiskBets: BetRecommendation[] = [];

    // --- HIGH CONFIDENCE BETS ---

    // Match winner (if strong edge)
    if (winnerProb >= 0.60) {
      highConfidenceBets.push({
        title: `Mac Sonucu: ${predictedWinner} Kazanir`,
        description: `${predictedWinner} takiminin bu maci kazanma olasiligi %${round2(winnerProb * 100)} olarak hesaplandi. ${isHomeFavored ? 'Ev sahibi avantaji' : 'Deplasman performansi'} ve son form durumu bu tahmini destekliyor.`,
        confidence: round2(winnerProb * 100),
        reason: `Son ${homeForm.recent_matches} macta ${isHomeFavored ? homeForm.wins : awayForm.wins} galibiyet. Ortalama ${isHomeFavored ? homeOffensiveStats.ppg.toFixed(1) : awayOffensiveStats.ppg.toFixed(1)} sayi atiyor, rakibe ${isHomeFavored ? homeOffensiveStats.oppPpg.toFixed(1) : awayOffensiveStats.oppPpg.toFixed(1)} sayi veriyor.`,
        recommendation: `${predictedWinner} mac sonucu galibiyetine oyna`,
        market: 'match_winner',
        selection: isHomeFavored ? 'home' : 'away',
        estimated_odds: probabilityToOdds(winnerProb),
      });
    }

    // Total points -- prefer the REAL bookmaker line, fall back to closest model line
    const primaryTotalLine = realTotalLine ?? totalLines.reduce((prev, curr) =>
      Math.abs(curr - expectedTotal) < Math.abs(prev - expectedTotal) ? curr : prev
    );
    const lineEntry = totalPointsAnalysis.lines.find((l) => l.line === primaryTotalLine);
    if (lineEntry) {
      const isOver = lineEntry.over_probability > 55;
      const isUnder = lineEntry.under_probability > 55;
      if (isOver || isUnder) {
        const totalProb = isOver ? lineEntry.over_probability : lineEntry.under_probability;
        const lineSource = lineEntry.source === 'api_odds' ? ' (bahis sirketi cizgisi)' : '';
        // Identify value bets on total
        const totalValueBet = valueBets.find(
          vb => vb.market === 'total' && vb.selection === (isOver ? `over_${primaryTotalLine}` : `under_${primaryTotalLine}`) && vb.is_value
        );
        const valueNote = totalValueBet
          ? ` DEGER BAHIS: Model %${totalValueBet.model_probability.toFixed(1)} vs bahis sirketi %${totalValueBet.implied_probability.toFixed(1)} (avantaj: %${totalValueBet.edge.toFixed(1)}).`
          : '';
        highConfidenceBets.push({
          title: `Toplam Sayi: ${isOver ? 'Ust' : 'Alt'} ${primaryTotalLine}${lineSource}`,
          description: `Beklenen toplam sayi ${expectedTotal.toFixed(1)}. ${isOver ? 'Ust' : 'Alt'} ${primaryTotalLine} olasiligi %${totalProb.toFixed(1)}.${isOver ? ' Her iki takim da yuksek tempolu ofansif basketbol oynuyor.' : ' Defansif yaklasimlar toplam sayiyi dusuk tutabilir.'}${valueNote}`,
          confidence: totalProb,
          reason: `Ev sahibi ortalamalari: ${homeOffensiveStats.ppg.toFixed(1)} sayi/mac. Deplasman ortalamalari: ${awayOffensiveStats.ppg.toFixed(1)} sayi/mac. Beklenen toplam: ${expectedTotal.toFixed(1)}.`,
          recommendation: `${primaryTotalLine} ${isOver ? 'ust' : 'alt'} toplam sayiya oyna`,
          market: 'total_points',
          selection: isOver ? `over_${primaryTotalLine}` : `under_${primaryTotalLine}`,
          estimated_odds: isOver ? lineEntry.over_odds : lineEntry.under_odds,
        });
      }
    }

    // Point spread -- prefer the REAL bookmaker spread, fall back to closest model spread
    const bestSpread = realSpreadLine !== null
      ? pointSpread.find(s => s.spread === realSpreadLine) || pointSpread[0]
      : pointSpread.reduce((prev, curr) =>
          Math.abs(-curr.spread - pointDiff) < Math.abs(-prev.spread - pointDiff) ? curr : prev
        );
    const spreadWinnerProb = isHomeFavored
      ? bestSpread.home_cover_probability
      : bestSpread.away_cover_probability;
    if (spreadWinnerProb > 55) {
      const spreadSource = bestSpread.source === 'api_odds' ? ' (bahis sirketi cizgisi)' : '';
      // Identify value bet on spread
      const spreadValueBet = valueBets.find(
        vb => vb.market === 'spread' && vb.is_value &&
          vb.selection === `${isHomeFavored ? 'home' : 'away'}_${bestSpread.spread}`
      );
      const spreadValueNote = spreadValueBet
        ? ` DEGER BAHIS: Model %${spreadValueBet.model_probability.toFixed(1)} vs bahis sirketi %${spreadValueBet.implied_probability.toFixed(1)} (avantaj: %${spreadValueBet.edge.toFixed(1)}).`
        : '';
      highConfidenceBets.push({
        title: `Handikap: ${isHomeFavored ? homeTeam.name : awayTeam.name} ${bestSpread.spread}${spreadSource}`,
        description: `${isHomeFavored ? homeTeam.name : awayTeam.name} takimi ${Math.abs(bestSpread.spread)} sayilik handikapi kapatma olasiligi %${spreadWinnerProb.toFixed(1)}. Beklenen fark: ${pointDiff.toFixed(1)} sayi.${spreadValueNote}`,
        confidence: spreadWinnerProb,
        reason: `Ofansif ve defansif verimlilik farki, son form ve ev sahibi avantaji baz alinarak hesaplandi.`,
        recommendation: `${isHomeFavored ? homeTeam.name : awayTeam.name} ${bestSpread.spread} handikap bahsine oyna`,
        market: 'point_spread',
        selection: `${isHomeFavored ? 'home' : 'away'}_${bestSpread.spread}`,
        estimated_odds: isHomeFavored ? bestSpread.home_odds : bestSpread.away_odds,
      });
    }

    // --- MEDIUM RISK BETS ---

    // First half total -- prefer REAL first half line from API
    const primaryFHEntry = realFirstHalfLine !== null
      ? firstHalfLineEntries.find(e => e.line === realFirstHalfLine)
      : null;

    const bestFirstHalfLine = primaryFHEntry
      ? {
          line: String(primaryFHEntry.line),
          prob: Math.max(primaryFHEntry.over_probability, primaryFHEntry.under_probability),
          isOver: primaryFHEntry.over_probability > primaryFHEntry.under_probability,
          source: primaryFHEntry.source,
        }
      : Object.entries(firstHalfLines).reduce(
          (best, [line, prob]) => {
            const overP = prob;
            const underP = 100 - prob;
            const bestP = Math.max(overP, underP);
            return bestP > best.prob ? { line, prob: bestP, isOver: overP > underP, source: 'model' as const } : best;
          },
          { line: String(halfAnchor), prob: 0, isOver: true, source: 'model' as const }
        );

    if (bestFirstHalfLine.prob > 52) {
      const fhSource = bestFirstHalfLine.source === 'api_odds' ? ' (bahis sirketi cizgisi)' : '';
      const fhValueBet = valueBets.find(
        vb => vb.market === 'first_half_total' && vb.is_value &&
          vb.selection === `${bestFirstHalfLine.isOver ? 'over' : 'under'}_${bestFirstHalfLine.line}`
      );
      const fhValueNote = fhValueBet
        ? ` DEGER BAHIS: Model %${fhValueBet.model_probability.toFixed(1)} vs bahis sirketi %${fhValueBet.implied_probability.toFixed(1)} (avantaj: %${fhValueBet.edge.toFixed(1)}).`
        : '';
      mediumRiskBets.push({
        title: `Ilk Yari Toplam: ${bestFirstHalfLine.isOver ? 'Ust' : 'Alt'} ${bestFirstHalfLine.line}${fhSource}`,
        description: `Ilk yari beklenen toplam sayi: ${expectedFirstHalf.toFixed(1)}. ${bestFirstHalfLine.isOver ? 'Ust' : 'Alt'} ${bestFirstHalfLine.line} olasiligi %${bestFirstHalfLine.prob.toFixed(1)}.${fhValueNote}`,
        confidence: bestFirstHalfLine.prob,
        reason: `Ilk yari genellikle toplam sayinin %48'ini olusturur. Takim tempolari ve erken oyun stratejileri dikkate alindi.`,
        recommendation: `Ilk yari ${bestFirstHalfLine.line} ${bestFirstHalfLine.isOver ? 'ust' : 'alt'} bahsine oyna`,
        market: 'first_half_total',
        selection: `${bestFirstHalfLine.isOver ? 'over' : 'under'}_${bestFirstHalfLine.line}`,
        estimated_odds: probabilityToOdds(bestFirstHalfLine.prob / 100),
      });
    }

    // Alternative point spread
    const altSpread = pointSpread.find((s) => s !== bestSpread);
    if (altSpread) {
      const altProb = isHomeFavored
        ? altSpread.home_cover_probability
        : altSpread.away_cover_probability;
      if (altProb > 50) {
        mediumRiskBets.push({
          title: `Alternatif Handikap: ${isHomeFavored ? homeTeam.name : awayTeam.name} ${altSpread.spread}`,
          description: `Daha genis handikap secenegi. ${isHomeFavored ? homeTeam.name : awayTeam.name} ${Math.abs(altSpread.spread)} sayilik handikapi kapatma olasiligi %${altProb.toFixed(1)}.`,
          confidence: altProb,
          reason: `Alternatif handikap cizgisi daha yuksek oran sunarken makul bir olasilik koruyor.`,
          recommendation: `${isHomeFavored ? homeTeam.name : awayTeam.name} ${altSpread.spread} handikap bahsini dusun`,
          market: 'point_spread_alt',
          selection: `${isHomeFavored ? 'home' : 'away'}_${altSpread.spread}`,
          estimated_odds: isHomeFavored ? altSpread.home_odds : altSpread.away_odds,
        });
      }
    }

    // H2H based recommendation
    if (h2hSummary.total_games >= 3) {
      const h2hDominant =
        h2hSummary.home_wins > h2hSummary.away_wins ? homeTeam.name : awayTeam.name;
      const h2hDominantWins = Math.max(h2hSummary.home_wins, h2hSummary.away_wins);
      const h2hTotalLine = Math.round(h2hSummary.avg_total_points * 2) / 2;
      const h2hOverProb = overProbabilityNormal(h2hTotalLine, expectedTotal, totalStdDev);

      mediumRiskBets.push({
        title: `H2H Bazli: ${h2hOverProb > 0.5 ? 'Ust' : 'Alt'} ${h2hTotalLine.toFixed(1)}`,
        description: `Bu iki takim arasindaki son ${h2hSummary.total_games} macta ortalama toplam ${h2hSummary.avg_total_points.toFixed(1)} sayi atildi. ${h2hDominant} ${h2hDominantWins} mac kazandi.`,
        confidence: round2(Math.max(h2hOverProb, 1 - h2hOverProb) * 100),
        reason: `Karsilasma gecmisi, bu iki takim arasindaki maclarin sayi dagilimini gosteriyor.`,
        recommendation: `H2H verilerine gore ${h2hTotalLine.toFixed(1)} ${h2hOverProb > 0.5 ? 'ust' : 'alt'} bahsini degerlendir`,
        market: 'h2h_total',
        selection: h2hOverProb > 0.5 ? `over_${h2hTotalLine}` : `under_${h2hTotalLine}`,
        estimated_odds: probabilityToOdds(Math.max(h2hOverProb, 1 - h2hOverProb)),
      });
    }

    // --- HIGH RISK BETS ---

    // Q1 winner + match winner combo
    const q1 = quarterAnalysis[0];
    const q1WinnerIsHome = q1.home_win_probability > q1.away_win_probability;
    const comboProb =
      (q1WinnerIsHome ? q1.home_win_probability / 100 : q1.away_win_probability / 100) *
      winnerProb;
    highRiskBets.push({
      title: `Kombin: Q1 + Mac Kazanani - ${predictedWinner}`,
      description: `${predictedWinner} hem ilk ceyrek hem de maci kazanir. Kombinasyon olasiligi %${round2(comboProb * 100)}.`,
      confidence: round2(comboProb * 100),
      reason: `Q1 kazanma olasiligi: %${q1WinnerIsHome ? q1.home_win_probability : q1.away_win_probability}. Mac kazanma olasiligi: %${round2(winnerProb * 100)}. Bagimsiz olaylar olarak carpildi.`,
      recommendation: `${predictedWinner} Q1 + mac galibiyeti kombinine oyna`,
      market: 'quarter_match_combo',
      selection: `q1_and_match_${isHomeFavored ? 'home' : 'away'}`,
      estimated_odds: probabilityToOdds(comboProb),
    });

    // Score range prediction
    const bestHomeRange = homeScoreRanges.reduce((prev, curr) =>
      curr.probability > prev.probability ? curr : prev
    );
    const bestAwayRange = awayScoreRanges.reduce((prev, curr) =>
      curr.probability > prev.probability ? curr : prev
    );
    highRiskBets.push({
      title: `Sayi Araligi: ${homeTeam.name} ${bestHomeRange.range} - ${awayTeam.name} ${bestAwayRange.range}`,
      description: `En olasilikli skor araligi kombinasyonu. ${homeTeam.name}: ${bestHomeRange.range} (%${bestHomeRange.probability.toFixed(1)}), ${awayTeam.name}: ${bestAwayRange.range} (%${bestAwayRange.probability.toFixed(1)}).`,
      confidence: round2(bestHomeRange.probability * bestAwayRange.probability / 100),
      reason: `Normal dagilim kullanilarak her iki takim icin en yuksek olasilikli sayi araliklari hesaplandi.`,
      recommendation: `${homeTeam.name} ${bestHomeRange.range} ve ${awayTeam.name} ${bestAwayRange.range} sayi araligi bahsini degerlendir`,
      market: 'score_range_combo',
      selection: `home_${bestHomeRange.range}_away_${bestAwayRange.range}`,
      estimated_odds: probabilityToOdds((bestHomeRange.probability / 100) * (bestAwayRange.probability / 100)),
    });

    // Half handicap + total combo
    const halfHandicapPoints = isHomeFavored
      ? adjustedHomePoints * firstHalfRatio - adjustedAwayPoints * firstHalfRatio
      : adjustedAwayPoints * firstHalfRatio - adjustedHomePoints * firstHalfRatio;
    const halfHandicapProb = overProbabilityNormal(
      2.5,
      Math.abs(halfHandicapPoints),
      halfStdDev * 0.7
    );
    const halfTotalProb = bestFirstHalfLine.prob / 100;
    const halfComboProb = halfHandicapProb * halfTotalProb;

    highRiskBets.push({
      title: `Ilk Yari Kombin: ${predictedWinner} Handikap + ${bestFirstHalfLine.isOver ? 'Ust' : 'Alt'} ${bestFirstHalfLine.line}`,
      description: `Ilk yarida ${predictedWinner} handikap galibiyeti ve toplam ${bestFirstHalfLine.isOver ? 'ust' : 'alt'} ${bestFirstHalfLine.line} kombinasyonu. Beklesen olasilik: %${round2(halfComboProb * 100)}.`,
      confidence: round2(halfComboProb * 100),
      reason: `Ilk yari handikap ve toplam sayi kombini yuksek oran saglarken, her iki olayin ayri ayri gerceklesme olasiliklarinin carpimi baz alindi.`,
      recommendation: `Yuksek riskli: Ilk yari ${predictedWinner} handikap + ${bestFirstHalfLine.isOver ? 'ust' : 'alt'} ${bestFirstHalfLine.line} kombinine oyna`,
      market: 'first_half_combo',
      selection: `half_handicap_and_total`,
      estimated_odds: probabilityToOdds(halfComboProb),
    });

    // Build the full prediction
    const prediction: BasketballPrediction = {
      sport: 'basketball',
      game_id: gameId,
      game_info: {
        home_team: homeTeam.name,
        away_team: awayTeam.name,
        league: league?.name || 'Bilinmeyen Lig',
        date: game.date || '',
        status: game.status?.long || game.status?.short || 'N/A',
      },
      match_result: {
        home_win: {
          probability: round2(homeWinProb * 100),
          odds: probabilityToOdds(homeWinProb),
        },
        away_win: {
          probability: round2(awayWinProb * 100),
          odds: probabilityToOdds(awayWinProb),
        },
        predicted_winner: predictedWinner,
        confidence: round2(winnerProb * 100),
      },
      point_spread: pointSpread,
      total_points: totalPointsAnalysis,
      halftime_analysis: {
        expected_first_half_total: round2(expectedFirstHalf),
        expected_second_half_total: round2(expectedSecondHalf),
        first_half_lines: firstHalfLineEntries,
        first_half_over_probability: firstHalfLines,
      },
      quarter_analysis: quarterAnalysis,
      score_ranges: {
        home: homeScoreRanges,
        away: awayScoreRanges,
      },
      team_stats: {
        home: {
          ppg: round2(homeOffensiveStats.ppg),
          opp_ppg: round2(homeOffensiveStats.oppPpg),
          form: homeForm,
          offensive_rating: round2(homeOffensiveStats.offRating),
          defensive_rating: round2(homeOffensiveStats.defRating),
        },
        away: {
          ppg: round2(awayOffensiveStats.ppg),
          opp_ppg: round2(awayOffensiveStats.oppPpg),
          form: awayForm,
          offensive_rating: round2(awayOffensiveStats.offRating),
          defensive_rating: round2(awayOffensiveStats.defRating),
        },
      },
      h2h_summary: h2hSummary,
      odds_data: parsedOdds,
      value_bets: valueBets,
      high_confidence_bets: highConfidenceBets,
      medium_risk_bets: mediumRiskBets,
      high_risk_bets: highRiskBets,
      prediction_confidence: confidenceScore,
      confidence_tier: confidenceTier,
      analysis_factors: {
        recent_form: WEIGHTS.recent_form,
        home_court: WEIGHTS.home_court,
        offensive_rating: WEIGHTS.offensive_rating,
        defensive_rating: WEIGHTS.defensive_rating,
        pace: WEIGHTS.pace,
        h2h: WEIGHTS.h2h,
        rest_days: WEIGHTS.rest_days,
        league_position: WEIGHTS.league_position,
      },
      risk_analysis: {
        high_confidence_bets: highConfidenceBets,
        medium_risk_bets: mediumRiskBets,
        high_risk_bets: highRiskBets,
      },
    };

    return prediction;
  }
}

// ============================================================
// Helper functions
// ============================================================

interface ScoringStats {
  ppg: number; // points per game
  oppPpg: number; // opponent points per game
  offRating: number; // offensive efficiency (0-1 scale)
  defRating: number; // defensive efficiency (0-1 scale, lower opp score = better)
}

/**
 * Calculate scoring statistics from recent games for a team.
 */
function calculateScoringStats(recentGames: any[], teamId: number): ScoringStats {
  if (!recentGames || recentGames.length === 0) {
    return { ppg: 105, oppPpg: 105, offRating: 0.5, defRating: 0.5 };
  }

  let totalScored = 0;
  let totalConceded = 0;
  let count = 0;

  recentGames.forEach((game: any) => {
    const homeId = game.teams?.home?.id;
    const homeTotal = game.scores?.home?.total;
    const awayTotal = game.scores?.away?.total;

    if (homeTotal == null || awayTotal == null) return;

    const isHome = homeId === teamId;
    totalScored += isHome ? homeTotal : awayTotal;
    totalConceded += isHome ? awayTotal : homeTotal;
    count++;
  });

  if (count === 0) {
    return { ppg: 105, oppPpg: 105, offRating: 0.5, defRating: 0.5 };
  }

  const ppg = totalScored / count;
  const oppPpg = totalConceded / count;

  // Normalize to 0-1 scale (based on typical basketball scoring range 80-130)
  const offRating = Math.max(0, Math.min(1, (ppg - 80) / 50));
  const defRating = Math.max(0, Math.min(1, 1 - (oppPpg - 80) / 50)); // Lower opp score = better

  return { ppg, oppPpg, offRating, defRating };
}

/**
 * Find a team's standing from the standings array.
 * API-Basketball standings come in nested arrays by group/conference.
 */
function findTeamStanding(standings: any[], teamId: number): any | null {
  if (!standings || standings.length === 0) return null;

  // Standings can be nested: [[group1 teams], [group2 teams]] or flat
  for (const entry of standings) {
    if (Array.isArray(entry)) {
      const found = entry.find((s: any) => s.team?.id === teamId);
      if (found) return found;
    } else if (entry?.team?.id === teamId) {
      return entry;
    }
  }
  return null;
}

/**
 * Analyze head-to-head history between two teams with recency weighting.
 * More recent H2H games receive higher weight in the analysis.
 * Decay factor: 0.85 per game (most recent = 1.0, 5th game back = ~0.44)
 */
function analyzeH2H(
  h2hGames: any[],
  homeTeamId: number,
  awayTeamId: number
): { total_games: number; home_wins: number; away_wins: number; avg_total_points: number } {
  if (!h2hGames || h2hGames.length === 0) {
    return { total_games: 0, home_wins: 0, away_wins: 0, avg_total_points: 210 };
  }

  let homeWins = 0;
  let awayWins = 0;
  let totalPoints = 0;
  let weightedTotalPoints = 0;
  let totalWeight = 0;
  let countWithScores = 0;

  const H2H_DECAY = 0.85;

  // Assume h2hGames are ordered oldest first; reverse for recency
  const orderedGames = [...h2hGames];

  orderedGames.forEach((game: any, idx: number) => {
    const hTotal = game.scores?.home?.total;
    const aTotal = game.scores?.away?.total;
    const hTeamId = game.teams?.home?.id;

    if (hTotal == null || aTotal == null) return;

    // Recency weight: most recent game = highest weight
    const recencyIdx = orderedGames.length - 1 - idx;
    const weight = Math.pow(H2H_DECAY, recencyIdx);
    totalWeight += weight;

    totalPoints += hTotal + aTotal;
    weightedTotalPoints += (hTotal + aTotal) * weight;
    countWithScores++;

    if (hTotal > aTotal) {
      if (hTeamId === homeTeamId) homeWins++;
      else awayWins++;
    } else if (aTotal > hTotal) {
      if (hTeamId === homeTeamId) awayWins++;
      else homeWins++;
    }
  });

  return {
    total_games: countWithScores,
    home_wins: homeWins,
    away_wins: awayWins,
    avg_total_points: totalWeight > 0 ? weightedTotalPoints / totalWeight : 210,
  };
}

/**
 * Compute a composite team strength score using weighted factors.
 * Uses league-specific home court advantage and integrates standing win%.
 */
function computeTeamStrength(
  form: SportTeamForm,
  stats: ScoringStats,
  standing: any | null,
  h2h: { home_wins: number; away_wins: number; total_games: number },
  isHome: boolean
): number {
  let strength = 0;

  // Recent form (0-1) - already exponentially weighted from calculateTeamForm
  strength += WEIGHTS.recent_form * form.form_score;

  // Home court advantage - basketball home teams win ~57-60% depending on league
  if (isHome) {
    strength += WEIGHTS.home_court * 0.60;
  } else {
    strength += WEIGHTS.home_court * 0.40;
  }

  // Offensive rating (0-1)
  strength += WEIGHTS.offensive_rating * stats.offRating;

  // Defensive rating (0-1)
  strength += WEIGHTS.defensive_rating * stats.defRating;

  // Pace factor (approximated from scoring volume)
  const paceFactor = Math.max(0, Math.min(1, (stats.ppg - 90) / 30));
  strength += WEIGHTS.pace * paceFactor;

  // H2H factor with recency weighting
  if (h2h.total_games > 0) {
    const h2hWins = isHome ? h2h.home_wins : h2h.away_wins;
    const h2hFactor = h2hWins / h2h.total_games;
    // Blend h2h with neutral (0.5) proportionally to sample size (diminishes with <5 games)
    const h2hWeight = Math.min(h2h.total_games, 5) / 5;
    const blendedH2H = h2hFactor * h2hWeight + 0.5 * (1 - h2hWeight);
    strength += WEIGHTS.h2h * blendedH2H;
  } else {
    strength += WEIGHTS.h2h * 0.5;
  }

  // Rest days factor (handled via point adjustment, neutral in strength calc)
  strength += WEIGHTS.rest_days * 0.5;

  // League position factor from standings
  if (standing) {
    const winPct = standing.games?.win?.percentage
      ? parseFloat(standing.games.win.percentage)
      : null;
    if (winPct !== null && !isNaN(winPct)) {
      strength += WEIGHTS.league_position * winPct;
    } else {
      strength += WEIGHTS.league_position * 0.5;
    }
  } else {
    strength += WEIGHTS.league_position * 0.5;
  }

  return Math.max(0.05, Math.min(0.95, strength));
}

/**
 * Calculate expected points using team offense, opponent defense, and league average.
 * Uses regression-to-mean approach calibrated with league-specific averages.
 *
 * Formula: E(pts) = 0.45 * teamPPG + 0.35 * oppAllowed + 0.20 * leagueAvg
 * This balances team scoring power, opponent defensive quality, and league context.
 */
function calculateExpectedPoints(
  teamPpg: number,
  opponentOppPpg: number,
  leagueAvgPerTeam: number
): number {
  // Weighted average: emphasize team offense slightly more than opponent defense
  // Regress toward league average to handle small sample sizes
  const rawExpected = teamPpg * 0.45 + opponentOppPpg * 0.35 + leagueAvgPerTeam * 0.20;
  return rawExpected;
}

/**
 * Calculate rest day adjustment from recent game dates.
 * Back-to-back games (0 rest days) incur significant fatigue penalty.
 * @returns Point adjustment (negative = penalty, positive = boost)
 */
function calculateRestDayAdjustment(recentGames: any[], gameDate: string | undefined): number {
  if (!recentGames || recentGames.length === 0 || !gameDate) return 0;

  // Find the most recent completed game date
  const gameDateTs = new Date(gameDate).getTime();
  if (isNaN(gameDateTs)) return 0;

  let closestDaysBefore = Infinity;
  for (const g of recentGames) {
    const gDate = g.date || g.timestamp;
    if (!gDate) continue;
    const gTs = typeof gDate === 'number' ? gDate * 1000 : new Date(gDate).getTime();
    if (isNaN(gTs) || gTs >= gameDateTs) continue;
    const daysBetween = Math.round((gameDateTs - gTs) / (24 * 60 * 60 * 1000));
    if (daysBetween < closestDaysBefore) closestDaysBefore = daysBetween;
  }

  if (closestDaysBefore === Infinity) return 0;

  // Map rest days to point adjustments
  const restDays = Math.max(0, closestDaysBefore - 1); // Days between, not counting game day
  if (restDays in REST_DAY_ADJUSTMENTS) return REST_DAY_ADJUSTMENTS[restDays];
  if (restDays >= 5) return 0; // Too much rest can lead to rust, neutral
  return 0;
}

/**
 * Generate score range probabilities using normal distribution.
 * Ranges: 80-90, 90-100, 100-110, 110-120, 120-130, 130+
 */
function generateScoreRanges(
  expectedPoints: number,
  stdDev: number
): Array<{ range: string; probability: number }> {
  const ranges = [
    { label: '80-90', low: 80, high: 90 },
    { label: '90-100', low: 90, high: 100 },
    { label: '100-110', low: 100, high: 110 },
    { label: '110-120', low: 110, high: 120 },
    { label: '120-130', low: 120, high: 130 },
    { label: '130+', low: 130, high: 200 },
  ];

  return ranges.map(({ label, low, high }) => {
    const pHigh = normalCDF(high, expectedPoints, stdDev);
    const pLow = normalCDF(low, expectedPoints, stdDev);
    const probability = round2((pHigh - pLow) * 100);
    return { range: label, probability: Math.max(0, probability) };
  });
}

/**
 * Compute overall prediction confidence (0-100).
 * Higher when: strong form difference, lots of data, clear H2H pattern.
 */
function computeConfidence(
  homeWinProb: number,
  awayWinProb: number,
  homeForm: SportTeamForm,
  awayForm: SportTeamForm,
  h2h: { total_games: number; home_wins: number; away_wins: number },
  homeDataCount: number,
  awayDataCount: number
): number {
  let confidence = 40; // Base confidence

  // Probability spread: bigger gap = more confident
  const probSpread = Math.abs(homeWinProb - awayWinProb);
  confidence += probSpread * 30; // Max +30 from probability difference

  // Data availability
  const dataFactor = Math.min(1, (homeDataCount + awayDataCount) / 16); // 8 games each = full
  confidence += dataFactor * 15; // Max +15 from data

  // H2H data
  if (h2h.total_games >= 5) {
    confidence += 5;
  } else if (h2h.total_games >= 3) {
    confidence += 3;
  }

  // Form consistency (less variance in form string = more predictable)
  const homeConsistency = calculateFormConsistency(homeForm.form_string);
  const awayConsistency = calculateFormConsistency(awayForm.form_string);
  confidence += ((homeConsistency + awayConsistency) / 2) * 10; // Max +10

  return Math.max(20, Math.min(95, Math.round(confidence)));
}

/**
 * Calculate how consistent a form string is (0-1).
 * "WWWWW" = 1.0, "WLWLW" = 0.0
 */
function calculateFormConsistency(formString: string): number {
  if (!formString || formString.length < 2) return 0.5;

  let transitions = 0;
  for (let i = 1; i < formString.length; i++) {
    if (formString[i] !== formString[i - 1]) transitions++;
  }

  // Fewer transitions = more consistent
  return 1 - transitions / (formString.length - 1);
}

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
 * Parse the raw odds response from API-Basketball into structured data.
 *
 * API-Basketball odds response structure:
 * response[].bookmakers[].bets[].values[]
 *
 * Market IDs:
 *   2 = Home/Away (moneyline)
 *   3 = Asian Handicap (spread)
 *   4 = Over/Under (total points)
 *   5 = Over/Under 1st Half
 *  16 = Over/Under 1st Quarter
 *
 * Each bet value has: { value: "Over 213.5", odd: "1.73" }
 */
function parseOddsResponse(rawOdds: any[]): ParsedOddsData | null {
  if (!rawOdds || rawOdds.length === 0) return null;

  // The response may contain multiple entries; take the first game entry
  const gameOdds = rawOdds[0];
  const bookmakers = gameOdds?.bookmakers;
  if (!bookmakers || bookmakers.length === 0) return null;

  // Use the first available bookmaker (usually the most reliable)
  const bookmaker = bookmakers[0];
  const bets: any[] = bookmaker?.bets || [];

  let moneyline: ParsedOddsData['moneyline'] = null;
  let spread: ParsedOddsData['spread'] = null;
  let total: ParsedOddsData['total'] = null;
  let firstHalfTotal: ParsedOddsData['first_half_total'] = null;
  let firstQuarterTotal: ParsedOddsData['first_quarter_total'] = null;
  const rawMarkets: ParsedOddsData['raw_markets'] = [];

  for (const bet of bets) {
    const marketId = bet.id;
    const marketName = bet.name || '';
    const values: any[] = bet.values || [];

    rawMarkets.push({ market_id: marketId, market_name: marketName, values });

    switch (marketId) {
      case 2: // Home/Away (moneyline)
        moneyline = parseMoneyline(values);
        break;
      case 3: // Asian Handicap (spread)
        spread = parseSpread(values);
        break;
      case 4: // Over/Under (total)
        total = parseOverUnder(values);
        break;
      case 5: // Over/Under 1st Half
        firstHalfTotal = parseOverUnder(values);
        break;
      case 16: // Over/Under 1st Quarter
        firstQuarterTotal = parseOverUnder(values);
        break;
    }
  }

  return {
    moneyline,
    spread,
    total,
    first_half_total: firstHalfTotal,
    first_quarter_total: firstQuarterTotal,
    bookmaker: bookmaker?.name || null,
    raw_markets: rawMarkets,
  };
}

/**
 * Parse Home/Away (moneyline) market values.
 * Values: [{ value: "Home", odd: "1.03" }, { value: "Away", odd: "13.25" }]
 */
function parseMoneyline(values: any[]): ParsedOddsData['moneyline'] {
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
 * Parse Asian Handicap (spread) market values.
 * Values: [{ value: "Home -5.5", odd: "1.85" }, { value: "Away +5.5", odd: "1.90" }]
 * or: [{ value: "Away -26.5", odd: "1.27" }]
 */
function parseSpread(values: any[]): ParsedOddsData['spread'] {
  let line = 0;
  let homeOdds = 0;
  let awayOdds = 0;

  for (const v of values) {
    const label = String(v.value || '');
    const odd = parseFloat(v.odd);
    if (isNaN(odd)) continue;

    // Extract the numeric line from the value string
    const numMatch = label.match(/([+-]?\d+\.?\d*)/);
    if (!numMatch) continue;

    const num = parseFloat(numMatch[1]);
    const lowerLabel = label.toLowerCase();

    if (lowerLabel.includes('home')) {
      line = num; // Home spread (e.g., -5.5 means home is favored by 5.5)
      homeOdds = odd;
    } else if (lowerLabel.includes('away')) {
      awayOdds = odd;
      // If we haven't set the line from home, derive it from away
      if (line === 0) {
        line = -num; // Away +5.5 means home line is -5.5
      }
    }
  }

  if (line === 0 && homeOdds <= 0 && awayOdds <= 0) return null;
  return { line, home_odds: homeOdds, away_odds: awayOdds };
}

/**
 * Parse Over/Under market values.
 * Values: [{ value: "Over 213.5", odd: "1.73" }, { value: "Under 213.5", odd: "2.02" }]
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

/**
 * Round to 2 decimal places
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
