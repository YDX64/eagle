
import {
  normalCDF,
  overProbabilityNormal,
  calculateTeamForm,
  calculateExpectedValue,
  kellyPercentage,
  calculateConfidenceTier,
  probabilityToOdds,
  calculateHandicapProbabilities,
  createValueBet,
} from '@/lib/sports/base/prediction-utils';
import { SportPredictionResult, ConfidenceTier } from '@/lib/sports/base/types';
import { ApiHandballService } from './api-handball';

/**
 * Handball prediction weights.
 * Handball is a medium-high scoring sport (~50-65 total goals per match).
 * Draws are possible but rarer than football (~8-12%).
 *
 * Key improvements:
 * - Half-time correlation with full-time is strong in handball (~75% correlation)
 * - 7-meter penalty efficiency matters (teams average 4-6 penalties per game)
 * - Home advantage is significant (~60-63% home win rate in top leagues)
 */
const WEIGHTS = {
  recent_form: 0.22,
  home_advantage: 0.14,
  goals_per_game: 0.18,
  defensive_efficiency: 0.15,
  league_position: 0.10,
  h2h: 0.08,
  fatigue: 0.05,
  seven_meter_efficiency: 0.08,
};

/**
 * League-specific handball averages.
 * Top leagues (Bundesliga, LNH) tend to be higher scoring than smaller leagues.
 */
const LEAGUE_PROFILES: Record<number, { avgTeamGoals: number; totalStdDev: number; teamStdDev: number; homeAdvPct: number; label: string }> = {
  // Bundesliga (German)
  35: { avgTeamGoals: 28.5, totalStdDev: 7.0, teamStdDev: 4.0, homeAdvPct: 0.10, label: 'Bundesliga' },
  // Starligue (French LNH)
  36: { avgTeamGoals: 28.0, totalStdDev: 7.0, teamStdDev: 4.0, homeAdvPct: 0.09, label: 'Starligue' },
  // Liga ASOBAL (Spanish)
  37: { avgTeamGoals: 28.5, totalStdDev: 7.5, teamStdDev: 4.5, homeAdvPct: 0.10, label: 'ASOBAL' },
  // EHF Champions League
  38: { avgTeamGoals: 28.0, totalStdDev: 6.5, teamStdDev: 3.8, homeAdvPct: 0.08, label: 'EHF CL' },
  // Danish League
  39: { avgTeamGoals: 27.5, totalStdDev: 7.0, teamStdDev: 4.2, homeAdvPct: 0.09, label: 'Danish League' },
  // Turkish Super League
  40: { avgTeamGoals: 27.0, totalStdDev: 7.5, teamStdDev: 4.5, homeAdvPct: 0.10, label: 'TSL Handball' },
};

const DEFAULT_HANDBALL_PROFILE = { avgTeamGoals: 27.0, totalStdDev: 7.5, teamStdDev: 4.5, homeAdvPct: 0.09, label: 'Default' };

/** Draw probability base for handball (~8-12%) */
const HANDBALL_DRAW_BASE = 0.10;

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
 * Parsed odds data from API-Handball odds endpoint.
 * Market IDs: 1 = 3Way Result (H/D/A), 3 = Asian Handicap,
 * 4 = Over/Under (total goals), 5 = Both Teams To Score
 */
interface ParsedHandballOdds {
  match_winner: { home_odds: number; draw_odds: number; away_odds: number } | null;
  handicap: { line: number; home_odds: number; away_odds: number } | null;
  total: { line: number; over_odds: number; under_odds: number } | null;
  btts: { yes_odds: number; no_odds: number } | null;
  bookmaker: string | null;
  raw_markets: Array<{ market_id: number; market_name: string; values: any[] }>;
}

/**
 * Half-time to full-time correlation coefficient in handball.
 * Teams leading at half-time win ~75% of the time.
 * This is used for HT/FT market calculations.
 */
const HT_FT_CORRELATION = 0.75;

/**
 * HandballPredictionEngine generates predictions for handball matches
 * using Normal distribution modeling for goal totals.
 *
 * Handball characteristics:
 * - Medium-high scoring (~50-60 total goals per match, ~25-35 per team)
 * - Uses Normal distribution (like basketball but lower scores)
 * - Draws are possible but rare
 * - Half-time analysis is important
 */
export class HandballPredictionEngine {
  /**
   * Generate a complete prediction for a handball match.
   * @param gameId - The API game identifier
   * @param client - ApiHandballService instance for data fetching
   */
  static async generatePrediction(
    gameId: number,
    client: ApiHandballService
  ): Promise<SportPredictionResult> {
    // 1. Fetch game data
    const game = await client.getGameById(gameId);
    if (!game) {
      throw new Error(`Hentbol macı bulunamadı: ${gameId}`);
    }

    const homeTeamId = game.teams?.home?.id;
    const awayTeamId = game.teams?.away?.id;
    const leagueId = game.league?.id;
    const homeName = game.teams?.home?.name || 'Ev Sahibi';
    const awayName = game.teams?.away?.name || 'Deplasman';
    const leagueName = game.league?.name || 'Bilinmeyen Lig';
    const gameDate = game.date || new Date().toISOString();

    if (!homeTeamId || !awayTeamId || !leagueId) {
      throw new Error('Maç verileri eksik: takım veya lig bilgisi bulunamadı');
    }

    // 2. Determine current season
    const season = client.getCurrentSeason();

    // 3. Fetch all supporting data in parallel (including REAL ODDS from API)
    const [h2hGames, standings, homeRecentGames, awayRecentGames, rawOddsData] = await Promise.all([
      client.getH2H(homeTeamId, awayTeamId).catch(() => []),
      client.getStandings(leagueId, season).catch(() => []),
      client.getRecentGames(homeTeamId, leagueId, season, 10).catch(() => []),
      client.getRecentGames(awayTeamId, leagueId, season, 10).catch(() => []),
      client.getOdds({ game: gameId }).catch(() => []),
    ]);

    // 3b. Parse real odds from API-Handball
    const parsedOdds = parseOddsResponse(rawOddsData);

    // 4. Calculate team forms
    const homeForm = calculateTeamForm(
      homeRecentGames.map((g: any) => ({
        homeTeamId: g.teams?.home?.id,
        awayTeamId: g.teams?.away?.id,
        homeScore: g.scores?.home?.total ?? null,
        awayScore: g.scores?.away?.total ?? null,
      })),
      homeTeamId
    );

    const awayForm = calculateTeamForm(
      awayRecentGames.map((g: any) => ({
        homeTeamId: g.teams?.home?.id,
        awayTeamId: g.teams?.away?.id,
        homeScore: g.scores?.home?.total ?? null,
        awayScore: g.scores?.away?.total ?? null,
      })),
      awayTeamId
    );

    // 5. Extract league positions
    const homeStanding = findTeamStanding(standings, homeTeamId);
    const awayStanding = findTeamStanding(standings, awayTeamId);
    const totalTeams = countTeamsInStandings(standings);

    // 6. Calculate analysis factors
    const factors = calculateFactors(
      homeForm,
      awayForm,
      homeStanding,
      awayStanding,
      totalTeams,
      h2hGames,
      homeTeamId,
      awayTeamId,
      homeRecentGames,
      awayRecentGames
    );

    // 7. Calculate expected goals per team using Normal distribution with league-specific data
    const leagueProfile = LEAGUE_PROFILES[leagueId] || DEFAULT_HANDBALL_PROFILE;

    const homeExpectedGoals = calculateExpectedGoals(
      homeForm,
      awayForm,
      factors,
      true,
      leagueProfile
    );
    const awayExpectedGoals = calculateExpectedGoals(
      homeForm,
      awayForm,
      factors,
      false,
      leagueProfile
    );

    const totalExpectedGoals = homeExpectedGoals + awayExpectedGoals;

    // 8. Calculate match result probabilities (3-way: H/D/A) with league-specific stddev
    const matchResult = calculateMatchResult(
      homeExpectedGoals,
      awayExpectedGoals,
      factors,
      leagueProfile
    );

    // 9. Calculate handicap probabilities -- use REAL handicap line from API as anchor
    const realHandicapLine = parsedOdds?.handicap?.line ?? null;
    const handicapLines: number[] = [];
    if (realHandicapLine !== null) {
      handicapLines.push(realHandicapLine);
      // Add model-generated alternatives around the real line
      const altLines = [realHandicapLine + 2, realHandicapLine - 2].filter(
        v => Math.abs(v) <= 15 && v !== realHandicapLine
      );
      handicapLines.push(...altLines);
    } else {
      handicapLines.push(-2.5, -4.5, -6.5);
    }
    const handicaps = calculateHandicapProbabilities(
      matchResult.home_win.probability / 100,
      matchResult.away_win.probability / 100,
      handicapLines
    );

    // 10. Calculate total goals over/under lines -- use REAL bookmaker line as anchor
    const realTotalLine = parsedOdds?.total?.line ?? null;
    const totalGoalsMarkets = calculateTotalGoalsMarketsWithOdds(
      totalExpectedGoals,
      leagueProfile,
      parsedOdds,
      realTotalLine
    );

    // 11. First half prediction (league-specific)
    const firstHalfResult = calculateFirstHalfResult(
      homeExpectedGoals,
      awayExpectedGoals,
      factors,
      leagueProfile
    );

    // 12. Both teams over 25 goals (league-specific)
    const bothOver25 = calculateBothTeamsOver25(homeExpectedGoals, awayExpectedGoals, leagueProfile);

    // 13. HT/FT combinations
    const htftCombos = calculateHTFTCombinations(
      firstHalfResult,
      matchResult
    );

    // 14. Score margin ranges (league-specific)
    const marginRanges = calculateScoreMarginRanges(
      homeExpectedGoals,
      awayExpectedGoals,
      leagueProfile
    );

    // 15. Overall confidence
    const confidenceScore = calculateOverallConfidence(factors, homeForm, awayForm);
    const confidenceTier = calculateConfidenceTier(confidenceScore);

    // 15b. Calculate VALUE BETS: compare model probability vs bookmaker implied probability
    const valueBets: ValueBetEntry[] = [];

    if (parsedOdds) {
      // Match winner value (3-way)
      if (parsedOdds.match_winner) {
        const homeModelProb = matchResult.home_win.probability / 100;
        const drawModelProb = matchResult.draw.probability / 100;
        const awayModelProb = matchResult.away_win.probability / 100;

        if (parsedOdds.match_winner.home_odds > 0) {
          const homeImplied = oddsToImpliedProbability(parsedOdds.match_winner.home_odds);
          const homeEdge = (homeModelProb * 100) - homeImplied;
          valueBets.push({
            market: 'match_winner',
            selection: 'home',
            model_probability: round2(homeModelProb * 100),
            implied_probability: round2(homeImplied),
            edge: round2(homeEdge),
            bookmaker_odds: parsedOdds.match_winner.home_odds,
            fair_odds: probabilityToOdds(homeModelProb),
            is_value: homeEdge > VALUE_EDGE_THRESHOLD,
          });
        }

        if (parsedOdds.match_winner.draw_odds > 0) {
          const drawImplied = oddsToImpliedProbability(parsedOdds.match_winner.draw_odds);
          const drawEdge = (drawModelProb * 100) - drawImplied;
          valueBets.push({
            market: 'match_winner',
            selection: 'draw',
            model_probability: round2(drawModelProb * 100),
            implied_probability: round2(drawImplied),
            edge: round2(drawEdge),
            bookmaker_odds: parsedOdds.match_winner.draw_odds,
            fair_odds: probabilityToOdds(drawModelProb),
            is_value: drawEdge > VALUE_EDGE_THRESHOLD,
          });
        }

        if (parsedOdds.match_winner.away_odds > 0) {
          const awayImplied = oddsToImpliedProbability(parsedOdds.match_winner.away_odds);
          const awayEdge = (awayModelProb * 100) - awayImplied;
          valueBets.push({
            market: 'match_winner',
            selection: 'away',
            model_probability: round2(awayModelProb * 100),
            implied_probability: round2(awayImplied),
            edge: round2(awayEdge),
            bookmaker_odds: parsedOdds.match_winner.away_odds,
            fair_odds: probabilityToOdds(awayModelProb),
            is_value: awayEdge > VALUE_EDGE_THRESHOLD,
          });
        }
      }

      // Total goals over/under value (on the real bookmaker line)
      if (parsedOdds.total) {
        const totalStdDev = leagueProfile.totalStdDev;
        const realLine = parsedOdds.total.line;
        const modelOverProb = overProbabilityNormal(realLine, totalExpectedGoals, totalStdDev);
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

      // Handicap value
      if (parsedOdds.handicap) {
        const totalStdDev = leagueProfile.totalStdDev;
        const teamStdDev = leagueProfile.teamStdDev;
        const goalDiff = homeExpectedGoals - awayExpectedGoals;
        const diffStdDev = Math.sqrt(teamStdDev ** 2 + teamStdDev ** 2);
        const realHcLine = parsedOdds.handicap.line;
        const coverThreshold = -realHcLine;
        const homeCoverProb = overProbabilityNormal(coverThreshold, goalDiff, diffStdDev);
        const awayCoverProb = 1 - homeCoverProb;
        const homeHcImplied = oddsToImpliedProbability(parsedOdds.handicap.home_odds);
        const awayHcImplied = oddsToImpliedProbability(parsedOdds.handicap.away_odds);

        valueBets.push({
          market: 'handicap',
          selection: `home_${realHcLine}`,
          model_probability: round2(homeCoverProb * 100),
          implied_probability: round2(homeHcImplied),
          edge: round2((homeCoverProb * 100) - homeHcImplied),
          bookmaker_odds: parsedOdds.handicap.home_odds,
          fair_odds: probabilityToOdds(homeCoverProb),
          is_value: ((homeCoverProb * 100) - homeHcImplied) > VALUE_EDGE_THRESHOLD,
        });
        valueBets.push({
          market: 'handicap',
          selection: `away_${realHcLine}`,
          model_probability: round2(awayCoverProb * 100),
          implied_probability: round2(awayHcImplied),
          edge: round2((awayCoverProb * 100) - awayHcImplied),
          bookmaker_odds: parsedOdds.handicap.away_odds,
          fair_odds: probabilityToOdds(awayCoverProb),
          is_value: ((awayCoverProb * 100) - awayHcImplied) > VALUE_EDGE_THRESHOLD,
        });
      }

      // BTTS value
      if (parsedOdds.btts) {
        const teamStdDev = leagueProfile.teamStdDev;
        // Both teams scoring 1+ goals: in handball this is near-certain (both teams always score 20+)
        // Use the "both over 20 goals" threshold as a proxy
        const homeScoreProb = overProbabilityNormal(0.5, homeExpectedGoals, teamStdDev);
        const awayScoreProb = overProbabilityNormal(0.5, awayExpectedGoals, teamStdDev);
        const bttsModelProb = homeScoreProb * awayScoreProb;
        const bttsNoModelProb = 1 - bttsModelProb;

        if (parsedOdds.btts.yes_odds > 0) {
          const yesImplied = oddsToImpliedProbability(parsedOdds.btts.yes_odds);
          valueBets.push({
            market: 'btts',
            selection: 'yes',
            model_probability: round2(bttsModelProb * 100),
            implied_probability: round2(yesImplied),
            edge: round2((bttsModelProb * 100) - yesImplied),
            bookmaker_odds: parsedOdds.btts.yes_odds,
            fair_odds: probabilityToOdds(bttsModelProb),
            is_value: ((bttsModelProb * 100) - yesImplied) > VALUE_EDGE_THRESHOLD,
          });
        }
        if (parsedOdds.btts.no_odds > 0) {
          const noImplied = oddsToImpliedProbability(parsedOdds.btts.no_odds);
          valueBets.push({
            market: 'btts',
            selection: 'no',
            model_probability: round2(bttsNoModelProb * 100),
            implied_probability: round2(noImplied),
            edge: round2((bttsNoModelProb * 100) - noImplied),
            bookmaker_odds: parsedOdds.btts.no_odds,
            fair_odds: probabilityToOdds(bttsNoModelProb),
            is_value: ((bttsNoModelProb * 100) - noImplied) > VALUE_EDGE_THRESHOLD,
          });
        }
      }
    }

    // 16. Build bet recommendations
    const highConfidenceBets = buildHighConfidenceBets(
      matchResult,
      totalGoalsMarkets,
      handicaps,
      homeName,
      awayName,
      confidenceScore,
      parsedOdds,
      valueBets
    );

    const mediumRiskBets = buildMediumRiskBets(
      firstHalfResult,
      bothOver25,
      marginRanges,
      homeName,
      awayName,
      confidenceScore
    );

    const highRiskBets = buildHighRiskBets(
      htftCombos,
      marginRanges,
      homeName,
      awayName,
      confidenceScore
    );

    return {
      sport: 'handball',
      game_id: gameId,
      match_result: {
        home_win: matchResult.home_win,
        away_win: matchResult.away_win,
        draw: matchResult.draw,
        confidence: confidenceScore,
      },
      odds_data: parsedOdds,
      value_bets: valueBets,
      high_confidence_bets: highConfidenceBets,
      medium_risk_bets: mediumRiskBets,
      high_risk_bets: highRiskBets,
      prediction_confidence: confidenceScore,
      confidence_tier: confidenceTier,
      analysis_factors: {
        recent_form: round2(factors.recentFormScore),
        home_advantage: round2(factors.homeAdvantageScore),
        goals_per_game: round2(factors.goalsPerGameScore),
        defensive_efficiency: round2(factors.defensiveEfficiencyScore),
        league_position: round2(factors.leaguePositionScore),
        h2h: round2(factors.h2hScore),
        fatigue: round2(factors.fatigueScore),
        seven_meter_efficiency: round2(factors.sevenMeterScore),
        home_expected_goals: round2(homeExpectedGoals),
        away_expected_goals: round2(awayExpectedGoals),
        total_expected_goals: round2(totalExpectedGoals),
      },
    };
  }
}

// ─── Internal Helper Types ────────────────────────────────────────────────────

interface AnalysisFactors {
  recentFormScore: number;
  homeAdvantageScore: number;
  goalsPerGameScore: number;
  defensiveEfficiencyScore: number;
  leaguePositionScore: number;
  h2hScore: number;
  fatigueScore: number;
  sevenMeterScore: number;
  compositeHomeStrength: number;
  compositeAwayStrength: number;
}

interface TeamFormData {
  recent_matches: number;
  wins: number;
  losses: number;
  draws: number;
  points_for: number;
  points_against: number;
  form_score: number;
  form_string: string;
  home_form_score: number;
  away_form_score: number;
}

interface MatchResultProbs {
  home_win: { probability: number; odds: number };
  draw: { probability: number; odds: number };
  away_win: { probability: number; odds: number };
}

interface FirstHalfProbs {
  home: number;
  draw: number;
  away: number;
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Find a team's standing from the standings data.
 * Standings can be nested arrays (groups).
 */
function findTeamStanding(standings: any[], teamId: number): any | null {
  if (!standings || standings.length === 0) return null;

  for (const entry of standings) {
    // Standings may be wrapped in an array of groups
    if (Array.isArray(entry)) {
      for (const standing of entry) {
        if (standing?.team?.id === teamId) return standing;
      }
    } else if (entry?.team?.id === teamId) {
      return entry;
    }
  }
  return null;
}

function countTeamsInStandings(standings: any[]): number {
  if (!standings || standings.length === 0) return 16; // default
  let count = 0;
  for (const entry of standings) {
    if (Array.isArray(entry)) {
      count += entry.length;
    } else {
      count++;
    }
  }
  return count || 16;
}

/**
 * Calculate all analysis factors from the gathered data.
 */
function calculateFactors(
  homeForm: TeamFormData,
  awayForm: TeamFormData,
  homeStanding: any | null,
  awayStanding: any | null,
  totalTeams: number,
  h2hGames: any[],
  homeTeamId: number,
  awayTeamId: number,
  homeRecentGames: any[],
  awayRecentGames: any[]
): AnalysisFactors {
  // Recent form (0-1 scale)
  const recentFormScore = (homeForm.form_score - awayForm.form_score + 1) / 2;

  // Home advantage
  const homeAdvantageScore = 0.5 + DEFAULT_HANDBALL_PROFILE.homeAdvPct +
    (homeForm.home_form_score - 0.5) * 0.2;

  // Goals per game scoring ability
  const homeGPG = homeForm.recent_matches > 0
    ? homeForm.points_for / homeForm.recent_matches
    : DEFAULT_HANDBALL_PROFILE.avgTeamGoals;
  const awayGPG = awayForm.recent_matches > 0
    ? awayForm.points_for / awayForm.recent_matches
    : DEFAULT_HANDBALL_PROFILE.avgTeamGoals;
  const goalsPerGameScore = clamp(
    (homeGPG - awayGPG) / (DEFAULT_HANDBALL_PROFILE.avgTeamGoals * 0.5) * 0.5 + 0.5,
    0,
    1
  );

  // Defensive efficiency (goals conceded)
  const homeDefense = homeForm.recent_matches > 0
    ? homeForm.points_against / homeForm.recent_matches
    : DEFAULT_HANDBALL_PROFILE.avgTeamGoals;
  const awayDefense = awayForm.recent_matches > 0
    ? awayForm.points_against / awayForm.recent_matches
    : DEFAULT_HANDBALL_PROFILE.avgTeamGoals;
  // Lower conceded = better defense
  const defensiveEfficiencyScore = clamp(
    (awayDefense - homeDefense) / (DEFAULT_HANDBALL_PROFILE.avgTeamGoals * 0.5) * 0.5 + 0.5,
    0,
    1
  );

  // League position
  const homePos = homeStanding?.position || Math.ceil(totalTeams / 2);
  const awayPos = awayStanding?.position || Math.ceil(totalTeams / 2);
  const leaguePositionScore = clamp(
    (awayPos - homePos) / totalTeams * 0.5 + 0.5,
    0,
    1
  );

  // Head-to-head with recency weighting
  const h2hScore = calculateH2HScore(h2hGames, homeTeamId);

  // Fatigue factor - based on number of recent games in a short window
  const fatigueScore = calculateFatigueScore(homeRecentGames, awayRecentGames);

  // 7-meter penalty efficiency factor
  // Handball teams get 4-6 7-meter penalties per game. Efficiency matters.
  const sevenMeterScore = calculate7MeterFactor(homeRecentGames, awayRecentGames, homeTeamId, awayTeamId);

  // Composite strengths using weights
  const compositeHomeStrength =
    recentFormScore * WEIGHTS.recent_form +
    homeAdvantageScore * WEIGHTS.home_advantage +
    goalsPerGameScore * WEIGHTS.goals_per_game +
    defensiveEfficiencyScore * WEIGHTS.defensive_efficiency +
    leaguePositionScore * WEIGHTS.league_position +
    h2hScore * WEIGHTS.h2h +
    fatigueScore * WEIGHTS.fatigue +
    sevenMeterScore * WEIGHTS.seven_meter_efficiency;

  const compositeAwayStrength = 1 - compositeHomeStrength;

  return {
    recentFormScore,
    homeAdvantageScore,
    goalsPerGameScore,
    defensiveEfficiencyScore,
    leaguePositionScore,
    h2hScore,
    fatigueScore,
    sevenMeterScore,
    compositeHomeStrength: clamp(compositeHomeStrength, 0.15, 0.85),
    compositeAwayStrength: clamp(compositeAwayStrength, 0.15, 0.85),
  };
}

/**
 * Recency-weighted H2H score.
 * More recent meetings get exponentially higher weight.
 * Decay: 0.83 per game (most recent = 1.0, 5th back = ~0.47)
 */
function calculateH2HScore(h2hGames: any[], homeTeamId: number): number {
  if (!h2hGames || h2hGames.length === 0) return 0.5;

  const H2H_DECAY = 0.83;
  const recentH2H = h2hGames.slice(0, 10);
  let weightedWins = 0;
  let totalWeight = 0;

  for (let i = 0; i < recentH2H.length; i++) {
    const game = recentH2H[i];
    const homeScore = game.scores?.home?.total;
    const awayScore = game.scores?.away?.total;
    if (homeScore == null || awayScore == null) continue;

    const recencyIdx = recentH2H.length - 1 - i;
    const weight = Math.pow(H2H_DECAY, recencyIdx);
    totalWeight += weight;

    const isHome = game.teams?.home?.id === homeTeamId;
    const teamScore = isHome ? homeScore : awayScore;
    const oppScore = isHome ? awayScore : homeScore;

    if (teamScore > oppScore) weightedWins += weight;
    else if (teamScore === oppScore) weightedWins += weight * 0.5;
  }

  if (totalWeight === 0) return 0.5;

  // Blend with neutral based on sample size
  const sampleWeight = Math.min(recentH2H.length, 5) / 5;
  const rawScore = weightedWins / totalWeight;
  return rawScore * sampleWeight + 0.5 * (1 - sampleWeight);
}

/**
 * Calculate 7-meter penalty efficiency factor.
 * Handball teams get 4-6 penalties per game. A team with 80% conversion
 * vs one with 60% conversion gains ~1 extra goal per game.
 * Returns 0-1 (>0.5 = home advantage in 7m penalties).
 */
function calculate7MeterFactor(
  homeRecent: any[],
  awayRecent: any[],
  homeTeamId: number,
  awayTeamId: number
): number {
  // Try to extract 7m stats from recent games
  const homeEfficiency = extract7MeterEfficiency(homeRecent, homeTeamId);
  const awayEfficiency = extract7MeterEfficiency(awayRecent, awayTeamId);

  if (homeEfficiency === null || awayEfficiency === null) return 0.5;

  // Normalize: 0.70 efficiency is average, range is typically 0.55-0.85
  const diff = homeEfficiency - awayEfficiency;
  return clamp(0.5 + diff * 1.5, 0.3, 0.7);
}

/**
 * Extract 7-meter penalty efficiency from game data.
 * Returns efficiency (0-1) or null if data unavailable.
 */
function extract7MeterEfficiency(recentGames: any[], teamId: number): number | null {
  // Look for 7m stats in game statistics
  let totalScored = 0;
  let totalAttempts = 0;

  for (const game of recentGames) {
    // Try various API paths for 7-meter data
    const stats = game.statistics || game.stats;
    if (!stats) continue;

    const teamStats = Array.isArray(stats)
      ? stats.find((s: any) => s.team?.id === teamId)
      : stats;

    if (!teamStats) continue;

    const scored = teamStats?.['7m_goals'] ?? teamStats?.seven_meter_goals ?? null;
    const attempts = teamStats?.['7m_attempts'] ?? teamStats?.seven_meter_attempts ?? null;

    if (scored != null && attempts != null && attempts > 0) {
      totalScored += scored;
      totalAttempts += attempts;
    }
  }

  if (totalAttempts < 3) return null; // Not enough data
  return totalScored / totalAttempts;
}

function calculateFatigueScore(
  homeRecent: any[],
  awayRecent: any[]
): number {
  // Check games in the last 7 days as a fatigue indicator
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  const homeRecentCount = homeRecent.filter(
    (g: any) => g.timestamp && (now - g.timestamp * 1000) < sevenDaysMs
  ).length;
  const awayRecentCount = awayRecent.filter(
    (g: any) => g.timestamp && (now - g.timestamp * 1000) < sevenDaysMs
  ).length;

  // More games in 7 days = more fatigue = disadvantage
  // Neutral = 0.5, home team more fatigued = < 0.5
  const diff = awayRecentCount - homeRecentCount;
  return clamp(0.5 + diff * 0.08, 0.2, 0.8);
}

/**
 * Calculate expected goals for a team using form data, analysis factors,
 * and league-specific averages.
 *
 * Handball expected goals formula:
 * 1. Start with team's actual scoring average
 * 2. Adjust for opponent's defensive quality (cross-reference)
 * 3. Apply home advantage (league-specific)
 * 4. Regress toward league mean (25% regression)
 * 5. Apply form momentum (exponentially weighted)
 * 6. Add 7-meter penalty efficiency differential
 */
function calculateExpectedGoals(
  homeForm: TeamFormData,
  awayForm: TeamFormData,
  factors: AnalysisFactors,
  isHome: boolean,
  leagueProfile?: { avgTeamGoals: number; homeAdvPct: number }
): number {
  const profile = leagueProfile || DEFAULT_HANDBALL_PROFILE;
  const teamForm = isHome ? homeForm : awayForm;
  const oppForm = isHome ? awayForm : homeForm;

  // Base: team's average scoring
  let teamAvg = teamForm.recent_matches > 0
    ? teamForm.points_for / teamForm.recent_matches
    : profile.avgTeamGoals;

  // Clamp to realistic range for handball (no team consistently scores <20 or >35)
  teamAvg = clamp(teamAvg, 20, 35);

  // Opponent's defensive quality: how many goals they allow
  const oppAllowed = oppForm.recent_matches > 0
    ? oppForm.points_against / oppForm.recent_matches
    : profile.avgTeamGoals;

  // Attack strength: team scoring relative to league average
  const attackStrength = teamAvg / profile.avgTeamGoals;
  // Defense weakness: opponent allowing relative to league average
  const defenseWeakness = oppAllowed / profile.avgTeamGoals;

  // Cross-reference: expected = league_avg * attack_strength * defense_weakness
  let baseGoals = profile.avgTeamGoals * attackStrength * defenseWeakness;

  // Regression to mean: 25% weight to league average
  baseGoals = baseGoals * 0.75 + profile.avgTeamGoals * 0.25;

  // Home advantage adjustment (league-specific)
  if (isHome) {
    baseGoals *= (1 + profile.homeAdvPct * 0.5);
  } else {
    baseGoals *= (1 - profile.homeAdvPct * 0.35);
  }

  // Form momentum: exponentially weighted form score pushes expected goals
  const formMomentum = (teamForm.form_score - 0.5) * 0.18;
  baseGoals *= (1 + formMomentum);

  return clamp(baseGoals, 18, 38);
}

/**
 * Calculate 3-way match result using Normal distribution simulation.
 */
function calculateMatchResult(
  homeExpected: number,
  awayExpected: number,
  factors: AnalysisFactors,
  leagueProfile?: { teamStdDev: number }
): MatchResultProbs {
  const teamStdDev = leagueProfile?.teamStdDev || DEFAULT_HANDBALL_PROFILE.teamStdDev;
  const diff = homeExpected - awayExpected;
  const combinedStdDev = Math.sqrt(teamStdDev ** 2 + teamStdDev ** 2);

  // Probability that home scores more than away (diff > 0 from home perspective)
  const rawHomeWin = overProbabilityNormal(0.5, diff, combinedStdDev);
  const rawAwayWin = 1 - overProbabilityNormal(-0.5, diff, combinedStdDev);

  // Adjust draw probability based on expected margin
  const marginAbsExpected = Math.abs(diff);
  const drawBase = HANDBALL_DRAW_BASE * Math.exp(-marginAbsExpected * 0.08);
  const drawProb = clamp(drawBase, 0.03, 0.20);

  // Distribute remaining probability
  const remainingProb = 1 - drawProb;
  const totalRaw = rawHomeWin + rawAwayWin;
  const homeWinProb = totalRaw > 0 ? (rawHomeWin / totalRaw) * remainingProb : remainingProb * 0.5;
  const awayWinProb = totalRaw > 0 ? (rawAwayWin / totalRaw) * remainingProb : remainingProb * 0.5;

  return {
    home_win: {
      probability: round2(homeWinProb * 100),
      odds: probabilityToOdds(homeWinProb),
    },
    draw: {
      probability: round2(drawProb * 100),
      odds: probabilityToOdds(drawProb),
    },
    away_win: {
      probability: round2(awayWinProb * 100),
      odds: probabilityToOdds(awayWinProb),
    },
  };
}

/**
 * Calculate over/under markets for total goals.
 * Handball uses lines like 48.5, 50.5, 52.5, 54.5, 56.5
 */
function calculateTotalGoalsMarkets(
  expectedTotal: number,
  leagueProfile?: { totalStdDev: number }
): Array<{ line: number; over: number; under: number; overOdds: number; underOdds: number; bookmaker_over_odds?: number; bookmaker_under_odds?: number; source: 'api_odds' | 'model' }> {
  const totalStdDev = leagueProfile?.totalStdDev || DEFAULT_HANDBALL_PROFILE.totalStdDev;
  // Dynamic lines centered around expected total
  const center = Math.round(expectedTotal);
  const lines = [center - 4 + 0.5, center - 2 + 0.5, center + 0.5, center + 2 + 0.5, center + 4 + 0.5];

  return lines.map((line) => {
    const overProb = overProbabilityNormal(line, expectedTotal, totalStdDev);
    const underProb = 1 - overProb;
    return {
      line,
      over: round2(overProb * 100),
      under: round2(underProb * 100),
      overOdds: probabilityToOdds(overProb),
      underOdds: probabilityToOdds(underProb),
      source: 'model' as 'api_odds' | 'model',
    };
  });
}

/**
 * Calculate total goals markets using REAL bookmaker line as anchor.
 * If real odds are available, the bookmaker line is included first,
 * then model-generated alternatives are added around it.
 */
function calculateTotalGoalsMarketsWithOdds(
  expectedTotal: number,
  leagueProfile: { totalStdDev: number },
  parsedOdds: ParsedHandballOdds | null,
  realTotalLine: number | null,
): Array<{ line: number; over: number; under: number; overOdds: number; underOdds: number; bookmaker_over_odds?: number; bookmaker_under_odds?: number; source: 'api_odds' | 'model' }> {
  const totalStdDev = leagueProfile.totalStdDev;

  // Determine anchor: use real bookmaker line when available
  const anchorLine = realTotalLine ?? Math.round(expectedTotal * 2) / 2;

  // Build lines: real bookmaker line first, then model alternatives
  const linesSet = new Set<number>();
  linesSet.add(anchorLine);
  linesSet.add(anchorLine - 2);
  linesSet.add(anchorLine + 2);
  linesSet.add(anchorLine - 4);
  linesSet.add(anchorLine + 4);

  // If model expected total differs significantly from bookmaker, add it
  const modelLine = Math.round(expectedTotal * 2) / 2;
  if (Math.abs(modelLine - anchorLine) >= 1.5) {
    linesSet.add(modelLine);
  }

  const lines = Array.from(linesSet)
    .filter(l => l > 30 && l < 80) // Handball range: 30-80 total goals
    .sort((a, b) => a - b);

  return lines.map((line) => {
    const overProb = overProbabilityNormal(line, expectedTotal, totalStdDev);
    const underProb = 1 - overProb;
    const isRealLine = realTotalLine !== null && line === realTotalLine;

    return {
      line,
      over: round2(overProb * 100),
      under: round2(underProb * 100),
      overOdds: probabilityToOdds(overProb),
      underOdds: probabilityToOdds(underProb),
      ...(isRealLine && parsedOdds?.total ? {
        bookmaker_over_odds: parsedOdds.total.over_odds,
        bookmaker_under_odds: parsedOdds.total.under_odds,
      } : {}),
      source: (isRealLine ? 'api_odds' : 'model') as 'api_odds' | 'model',
    };
  });
}

/**
 * Calculate first-half result probabilities.
 * Handball halves are 30 minutes. Typically ~45-50% of goals scored in first half.
 */
function calculateFirstHalfResult(
  homeExpected: number,
  awayExpected: number,
  factors: AnalysisFactors,
  leagueProfile?: { teamStdDev: number }
): FirstHalfProbs {
  const teamStdDev = leagueProfile?.teamStdDev || DEFAULT_HANDBALL_PROFILE.teamStdDev;
  // First half typically sees ~47% of total goals in handball
  const firstHalfRatio = 0.47;
  const homeFirstHalf = homeExpected * firstHalfRatio;
  const awayFirstHalf = awayExpected * firstHalfRatio;

  const diff = homeFirstHalf - awayFirstHalf;
  const halfStdDev = teamStdDev * Math.sqrt(firstHalfRatio);
  const combinedHalfStdDev = Math.sqrt(halfStdDev ** 2 + halfStdDev ** 2);

  const rawHome = overProbabilityNormal(0.5, diff, combinedHalfStdDev);
  const rawAway = 1 - overProbabilityNormal(-0.5, diff, combinedHalfStdDev);

  // Draws more common at half-time in handball (~18-22%)
  const drawProb = clamp(0.20 * Math.exp(-Math.abs(diff) * 0.12), 0.08, 0.28);
  const remaining = 1 - drawProb;
  const totalRaw = rawHome + rawAway;
  const homeProb = totalRaw > 0 ? (rawHome / totalRaw) * remaining : remaining * 0.5;
  const awayProb = totalRaw > 0 ? (rawAway / totalRaw) * remaining : remaining * 0.5;

  return {
    home: round2(homeProb * 100),
    draw: round2(drawProb * 100),
    away: round2(awayProb * 100),
  };
}

/**
 * Calculate probability that both teams score over 25 goals.
 */
function calculateBothTeamsOver25(
  homeExpected: number,
  awayExpected: number,
  leagueProfile?: { teamStdDev: number }
): { probability: number; odds: number } {
  const teamStdDev = leagueProfile?.teamStdDev || DEFAULT_HANDBALL_PROFILE.teamStdDev;
  const homeOver25 = overProbabilityNormal(25.5, homeExpected, teamStdDev);
  const awayOver25 = overProbabilityNormal(25.5, awayExpected, teamStdDev);
  const bothProb = homeOver25 * awayOver25;

  return {
    probability: round2(bothProb * 100),
    odds: probabilityToOdds(bothProb),
  };
}

/**
 * Calculate HT/FT combination probabilities.
 * Possible outcomes: H/H, H/D, H/A, D/H, D/D, D/A, A/H, A/D, A/A
 */
function calculateHTFTCombinations(
  firstHalf: FirstHalfProbs,
  fullTime: MatchResultProbs
): Array<{ combo: string; label: string; probability: number; odds: number }> {
  // Conditional probability approximation: P(FT|HT) with correlation
  const htProbs = { H: firstHalf.home / 100, D: firstHalf.draw / 100, A: firstHalf.away / 100 };
  const ftProbs = { H: fullTime.home_win.probability / 100, D: fullTime.draw.probability / 100, A: fullTime.away_win.probability / 100 };

  const labels: Record<string, string> = {
    'H/H': 'Ev Sahibi / Ev Sahibi',
    'H/D': 'Ev Sahibi / Berabere',
    'H/A': 'Ev Sahibi / Deplasman',
    'D/H': 'Berabere / Ev Sahibi',
    'D/D': 'Berabere / Berabere',
    'D/A': 'Berabere / Deplasman',
    'A/H': 'Deplasman / Ev Sahibi',
    'A/D': 'Deplasman / Berabere',
    'A/A': 'Deplasman / Deplasman',
  };

  // Correlation factor: HT and FT results are strongly correlated in handball (~75%)
  // Teams leading at HT win ~75% of the time in handball
  const sameResultBoost = 1.8;
  const reverseResultPenalty = 0.35;

  const combos: Array<{ combo: string; label: string; probability: number; odds: number }> = [];

  const htKeys: Array<'H' | 'D' | 'A'> = ['H', 'D', 'A'];
  const ftKeys: Array<'H' | 'D' | 'A'> = ['H', 'D', 'A'];

  let rawProbs: Array<{ combo: string; label: string; rawProb: number }> = [];
  let totalRaw = 0;

  for (const ht of htKeys) {
    for (const ft of ftKeys) {
      const key = `${ht}/${ft}`;
      let factor = 1;
      if (ht === ft) factor = sameResultBoost;
      else if ((ht === 'H' && ft === 'A') || (ht === 'A' && ft === 'H')) factor = reverseResultPenalty;

      const rawProb = htProbs[ht] * ftProbs[ft] * factor;
      rawProbs.push({ combo: key, label: labels[key], rawProb });
      totalRaw += rawProb;
    }
  }

  // Normalize to sum to 1
  for (const entry of rawProbs) {
    const prob = totalRaw > 0 ? entry.rawProb / totalRaw : 1 / 9;
    combos.push({
      combo: entry.combo,
      label: entry.label,
      probability: round2(prob * 100),
      odds: probabilityToOdds(prob),
    });
  }

  return combos.sort((a, b) => b.probability - a.probability);
}

/**
 * Calculate score margin range probabilities.
 * Ranges: 1-3, 4-6, 7-9, 10+ goal difference
 */
function calculateScoreMarginRanges(
  homeExpected: number,
  awayExpected: number,
  leagueProfile?: { teamStdDev: number }
): Array<{ range: string; label: string; probability: number; odds: number }> {
  const teamStdDev = leagueProfile?.teamStdDev || DEFAULT_HANDBALL_PROFILE.teamStdDev;
  const diff = homeExpected - awayExpected;
  const combinedStdDev = Math.sqrt(teamStdDev ** 2 + teamStdDev ** 2);

  // Probability of absolute margin falling within each range
  const ranges = [
    { range: '1-3', label: '1-3 gol fark', low: 1, high: 3 },
    { range: '4-6', label: '4-6 gol fark', low: 4, high: 6 },
    { range: '7-9', label: '7-9 gol fark', low: 7, high: 9 },
    { range: '10+', label: '10+ gol fark', low: 10, high: 30 },
  ];

  // Also include draw probability (margin = 0)
  const drawProb = normalCDF(0.5, Math.abs(diff), combinedStdDev) -
    normalCDF(-0.5, Math.abs(diff), combinedStdDev);

  const results: Array<{ range: string; label: string; probability: number; odds: number }> = [
    {
      range: '0',
      label: 'Berabere (0 fark)',
      probability: round2(Math.max(drawProb, 0.02) * 100),
      odds: probabilityToOdds(Math.max(drawProb, 0.02)),
    },
  ];

  for (const r of ranges) {
    // P(low <= |margin| <= high) = P(margin in [low, high]) + P(margin in [-high, -low])
    const probPositive =
      normalCDF(r.high + 0.5, diff, combinedStdDev) -
      normalCDF(r.low - 0.5, diff, combinedStdDev);
    const probNegative =
      normalCDF(-r.low + 0.5, diff, combinedStdDev) -
      normalCDF(-r.high - 0.5, diff, combinedStdDev);
    const prob = clamp(probPositive + probNegative, 0.01, 0.95);

    results.push({
      range: r.range,
      label: r.label,
      probability: round2(prob * 100),
      odds: probabilityToOdds(prob),
    });
  }

  return results.sort((a, b) => b.probability - a.probability);
}

/**
 * Calculate overall prediction confidence.
 */
function calculateOverallConfidence(
  factors: AnalysisFactors,
  homeForm: TeamFormData,
  awayForm: TeamFormData
): number {
  let confidence = 40; // base

  // Data availability bonus
  if (homeForm.recent_matches >= 8) confidence += 8;
  else if (homeForm.recent_matches >= 5) confidence += 5;
  else if (homeForm.recent_matches >= 3) confidence += 2;

  if (awayForm.recent_matches >= 8) confidence += 8;
  else if (awayForm.recent_matches >= 5) confidence += 5;
  else if (awayForm.recent_matches >= 3) confidence += 2;

  // Strong form differential increases confidence
  const formDiff = Math.abs(factors.compositeHomeStrength - factors.compositeAwayStrength);
  confidence += formDiff * 30;

  // Consistent form increases confidence
  const homeConsistency = homeForm.form_string.length >= 5
    ? calculateFormConsistency(homeForm.form_string) : 0;
  const awayConsistency = awayForm.form_string.length >= 5
    ? calculateFormConsistency(awayForm.form_string) : 0;
  confidence += (homeConsistency + awayConsistency) * 5;

  // H2H data bonus
  if (factors.h2hScore !== 0.5) confidence += 3;

  return clamp(Math.round(confidence), 15, 95);
}

function calculateFormConsistency(formString: string): number {
  if (formString.length < 3) return 0;
  const chars = formString.split('');
  let sameCount = 0;
  for (let i = 1; i < chars.length; i++) {
    if (chars[i] === chars[i - 1]) sameCount++;
  }
  return sameCount / (chars.length - 1);
}

// ─── Bet Builder Helpers ────────────────────────────────────────────────────

function buildHighConfidenceBets(
  matchResult: MatchResultProbs,
  totalGoals: Array<{ line: number; over: number; under: number; overOdds: number; underOdds: number; bookmaker_over_odds?: number; bookmaker_under_odds?: number; source: 'api_odds' | 'model' }>,
  handicaps: Array<{ handicap: number; home_probability: number; away_probability: number; odds: { home: number; away: number } }>,
  homeName: string,
  awayName: string,
  confidence: number,
  parsedOdds: ParsedHandballOdds | null,
  valueBets: ValueBetEntry[]
): SportPredictionResult['high_confidence_bets'] {
  const bets: SportPredictionResult['high_confidence_bets'] = [];

  // Match winner (if strong probability) -- annotate with value bet info if available
  const maxResult = [
    { sel: homeName, prob: matchResult.home_win.probability, odds: matchResult.home_win.odds, market: 'Mac Sonucu', side: 'home' },
    { sel: awayName, prob: matchResult.away_win.probability, odds: matchResult.away_win.odds, market: 'Mac Sonucu', side: 'away' },
  ].sort((a, b) => b.prob - a.prob)[0];

  if (maxResult.prob >= 55) {
    const winnerValueBet = valueBets.find(
      vb => vb.market === 'match_winner' && vb.selection === maxResult.side && vb.is_value
    );
    const valueNote = winnerValueBet
      ? ` DEGER BAHIS: Model %${winnerValueBet.model_probability.toFixed(1)} vs bahis sirketi %${winnerValueBet.implied_probability.toFixed(1)} (avantaj: %${winnerValueBet.edge.toFixed(1)}).`
      : '';
    bets.push({
      title: `${maxResult.market}: ${maxResult.sel}`,
      description: `${maxResult.sel} takiminin mac kazanma olasiligi %${maxResult.prob}.${valueNote}`,
      confidence: round2(maxResult.prob),
      reason: `Form analizi, lig siralamalari ve ev sahibi avantaji degerlendirmesi sonucu`,
      recommendation: `${maxResult.sel} mac sonucu`,
      market: maxResult.market,
      selection: maxResult.sel,
      estimated_odds: maxResult.odds,
    });
  }

  // Total goals - prefer real bookmaker line, annotate with value bet info
  const realLine = totalGoals.find(tg => tg.source === 'api_odds');
  const totalGoalsSorted = realLine
    ? [realLine, ...totalGoals.filter(tg => tg !== realLine)]
    : totalGoals;

  for (const tg of totalGoalsSorted) {
    const bestSide = tg.over >= tg.under
      ? { sel: `Ust ${tg.line}`, prob: tg.over, odds: tg.overOdds, selKey: `over_${tg.line}` }
      : { sel: `Alt ${tg.line}`, prob: tg.under, odds: tg.underOdds, selKey: `under_${tg.line}` };

    if (bestSide.prob >= 60) {
      const lineSource = tg.source === 'api_odds' ? ' (bahis sirketi cizgisi)' : '';
      const totalValueBet = valueBets.find(
        vb => vb.market === 'total' && vb.selection === bestSide.selKey && vb.is_value
      );
      const valueNote = totalValueBet
        ? ` DEGER BAHIS: Model %${totalValueBet.model_probability.toFixed(1)} vs bahis sirketi %${totalValueBet.implied_probability.toFixed(1)} (avantaj: %${totalValueBet.edge.toFixed(1)}).`
        : '';
      bets.push({
        title: `Toplam Gol: ${bestSide.sel}${lineSource}`,
        description: `Toplam gol ${bestSide.sel} olasiligi %${bestSide.prob}.${valueNote}`,
        confidence: round2(bestSide.prob),
        reason: `Takim basina beklenen gol ortalamasi ve savunma istatistikleri temel alinarak hesaplandi`,
        recommendation: `${bestSide.sel} toplam gol`,
        market: 'Toplam Gol',
        selection: bestSide.sel,
        estimated_odds: bestSide.odds,
      });
      break; // Only one total goals bet in high confidence
    }
  }

  // Handicap - strongest line, annotate with value bet info
  if (handicaps.length > 0) {
    const bestHandicap = handicaps[0];
    const bestSide = bestHandicap.home_probability >= bestHandicap.away_probability
      ? { sel: `${homeName} (${bestHandicap.handicap})`, prob: bestHandicap.home_probability, odds: bestHandicap.odds.home, selKey: `home_${bestHandicap.handicap}` }
      : { sel: `${awayName} (+${Math.abs(bestHandicap.handicap)})`, prob: bestHandicap.away_probability, odds: bestHandicap.odds.away, selKey: `away_${bestHandicap.handicap}` };

    if (bestSide.prob >= 55) {
      const hcValueBet = valueBets.find(
        vb => vb.market === 'handicap' && vb.is_value && vb.selection === bestSide.selKey
      );
      const valueNote = hcValueBet
        ? ` DEGER BAHIS: Model %${hcValueBet.model_probability.toFixed(1)} vs bahis sirketi %${hcValueBet.implied_probability.toFixed(1)} (avantaj: %${hcValueBet.edge.toFixed(1)}).`
        : '';
      bets.push({
        title: `Handikap: ${bestSide.sel}`,
        description: `Handikap bahsi olasiligi %${bestSide.prob}.${valueNote}`,
        confidence: round2(bestSide.prob),
        reason: `Takim gucu farki ve beklenen skor farki analizi`,
        recommendation: `${bestSide.sel} handikap`,
        market: 'Handikap',
        selection: bestSide.sel,
        estimated_odds: bestSide.odds,
      });
    }
  }

  return bets;
}

function buildMediumRiskBets(
  firstHalf: FirstHalfProbs,
  bothOver25: { probability: number; odds: number },
  marginRanges: Array<{ range: string; label: string; probability: number; odds: number }>,
  homeName: string,
  awayName: string,
  confidence: number
): SportPredictionResult['medium_risk_bets'] {
  const bets: SportPredictionResult['medium_risk_bets'] = [];

  // First half result
  const htBest = [
    { sel: `IY ${homeName}`, prob: firstHalf.home },
    { sel: 'IY Berabere', prob: firstHalf.draw },
    { sel: `IY ${awayName}`, prob: firstHalf.away },
  ].sort((a, b) => b.prob - a.prob)[0];

  if (htBest.prob >= 40) {
    bets.push({
      title: `Ilk Yari Sonucu: ${htBest.sel}`,
      description: `Ilk yari sonucu olasiligi %${htBest.prob}`,
      confidence: round2(htBest.prob),
      reason: `Ilk yari gol dagilimi ve takim performansi analizi`,
      recommendation: htBest.sel,
    });
  }

  // Both teams over 25 goals
  if (bothOver25.probability >= 35) {
    bets.push({
      title: `Her Iki Takim 25 Gol Ustu`,
      description: `Her iki takimin da 25 gol ustu atma olasiligi %${bothOver25.probability}`,
      confidence: round2(bothOver25.probability),
      reason: `Takim basina beklenen gol sayisi ve Normal dagilim modeli`,
      recommendation: `Her iki takim 25 gol ustu - Oran: ${bothOver25.odds}`,
    });
  }

  // Best margin range (3.5-5.0 odds range is medium risk)
  const mediumMargin = marginRanges.find(
    (m) => m.range !== '0' && m.probability >= 20 && m.probability <= 45
  );
  if (mediumMargin) {
    bets.push({
      title: `Skor Farki: ${mediumMargin.label}`,
      description: `Skor farkinin ${mediumMargin.range} araliginda olma olasiligi %${mediumMargin.probability}`,
      confidence: round2(mediumMargin.probability),
      reason: `Beklenen skor farki ve standart sapma modeli`,
      recommendation: `${mediumMargin.label} - Oran: ${mediumMargin.odds}`,
    });
  }

  return bets;
}

function buildHighRiskBets(
  htftCombos: Array<{ combo: string; label: string; probability: number; odds: number }>,
  marginRanges: Array<{ range: string; label: string; probability: number; odds: number }>,
  homeName: string,
  awayName: string,
  confidence: number
): SportPredictionResult['high_risk_bets'] {
  const bets: SportPredictionResult['high_risk_bets'] = [];

  // Best HT/FT combo (high-value: 3.0-8.0 odds)
  const bestHTFT = htftCombos.find(
    (c) => c.odds >= 3.0 && c.odds <= 8.0 && c.probability >= 8
  );
  if (bestHTFT) {
    bets.push({
      title: `IY/MS: ${bestHTFT.label}`,
      description: `Ilk yari / Mac sonucu kombine olasiligi %${bestHTFT.probability}`,
      confidence: round2(bestHTFT.probability),
      reason: `IY ve MS olasiliklari korelasyon faktoruyle birlestirildi. Yuksek oran potansiyeli.`,
      recommendation: `IY/MS ${bestHTFT.combo} - Oran: ${bestHTFT.odds}`,
    });
  }

  // Second best HT/FT (different from first)
  const secondHTFT = htftCombos.find(
    (c) => c.odds >= 4.0 && c.odds <= 12.0 && c.probability >= 5 && c !== bestHTFT
  );
  if (secondHTFT) {
    bets.push({
      title: `IY/MS Alternatif: ${secondHTFT.label}`,
      description: `Alternatif IY/MS kombinasyonu olasiligi %${secondHTFT.probability}`,
      confidence: round2(secondHTFT.probability),
      reason: `Daha yuksek oran ile alternatif senaryo`,
      recommendation: `IY/MS ${secondHTFT.combo} - Oran: ${secondHTFT.odds}`,
    });
  }

  // Large margin range (4.0-7.0 odds)
  const largeMargin = marginRanges.find(
    (m) => (m.range === '7-9' || m.range === '10+') && m.probability >= 5
  );
  if (largeMargin) {
    bets.push({
      title: `Buyuk Fark: ${largeMargin.label}`,
      description: `${largeMargin.label} olasiligi %${largeMargin.probability}`,
      confidence: round2(largeMargin.probability),
      reason: `Takimlar arasi guc farki buyuk oldugunda yuksek fark olasiligi artar`,
      recommendation: `${largeMargin.label} - Oran: ${largeMargin.odds}`,
    });
  }

  return bets;
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
 * Parse the raw odds response from API-Handball into structured data.
 *
 * API-Handball odds response structure:
 * response[].bookmakers[].bets[].values[]
 *
 * Market IDs:
 *   1 = 3Way Result (Home/Draw/Away)
 *   3 = Asian Handicap
 *   4 = Over/Under (total goals)
 *   5 = Both Teams To Score
 *
 * Each bet value has: { value: "Over 52.5", odd: "1.85" }
 */
function parseOddsResponse(rawOdds: any[]): ParsedHandballOdds | null {
  if (!rawOdds || rawOdds.length === 0) return null;

  // The response may contain multiple entries; take the first game entry
  const gameOdds = rawOdds[0];
  const bookmakers = gameOdds?.bookmakers;
  if (!bookmakers || bookmakers.length === 0) return null;

  // Use the first available bookmaker (usually the most reliable)
  const bookmaker = bookmakers[0];
  const bets: any[] = bookmaker?.bets || [];

  let matchWinner: ParsedHandballOdds['match_winner'] = null;
  let handicap: ParsedHandballOdds['handicap'] = null;
  let total: ParsedHandballOdds['total'] = null;
  let btts: ParsedHandballOdds['btts'] = null;
  const rawMarkets: ParsedHandballOdds['raw_markets'] = [];

  for (const bet of bets) {
    const marketId = bet.id;
    const marketName = bet.name || '';
    const values: any[] = bet.values || [];

    rawMarkets.push({ market_id: marketId, market_name: marketName, values });

    switch (marketId) {
      case 1: // 3Way Result (Home/Draw/Away)
        matchWinner = parseMatchWinner3Way(values);
        break;
      case 2: // Home/Away (2-way fallback)
        if (!matchWinner) {
          const twoWay = parseMoneyline2Way(values);
          if (twoWay) {
            matchWinner = { home_odds: twoWay.home_odds, draw_odds: 0, away_odds: twoWay.away_odds };
          }
        }
        break;
      case 3: // Asian Handicap
        handicap = parseHandicap(values);
        break;
      case 4: // Over/Under (total goals)
        total = parseOverUnder(values);
        break;
      case 5: // Both Teams To Score
        btts = parseBTTS(values);
        break;
    }
  }

  return {
    match_winner: matchWinner,
    handicap,
    total,
    btts,
    bookmaker: bookmaker?.name || null,
    raw_markets: rawMarkets,
  };
}

/**
 * Parse 3-way match winner market (Home/Draw/Away).
 * Values: [{ value: "Home", odd: "1.55" }, { value: "Draw", odd: "8.50" }, { value: "Away", odd: "3.80" }]
 */
function parseMatchWinner3Way(values: any[]): ParsedHandballOdds['match_winner'] {
  let homeOdds = 0;
  let drawOdds = 0;
  let awayOdds = 0;

  for (const v of values) {
    const label = String(v.value || '').toLowerCase().trim();
    const odd = parseFloat(v.odd);
    if (isNaN(odd)) continue;

    if (label === 'home' || label === '1' || label.startsWith('home')) {
      homeOdds = odd;
    } else if (label === 'draw' || label === 'x' || label.startsWith('draw')) {
      drawOdds = odd;
    } else if (label === 'away' || label === '2' || label.startsWith('away')) {
      awayOdds = odd;
    }
  }

  if (homeOdds <= 0 && awayOdds <= 0) return null;
  return { home_odds: homeOdds, draw_odds: drawOdds, away_odds: awayOdds };
}

/**
 * Parse 2-way moneyline (Home/Away) as fallback.
 */
function parseMoneyline2Way(values: any[]): { home_odds: number; away_odds: number } | null {
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
 * Values: [{ value: "Home -4.5", odd: "1.85" }, { value: "Away +4.5", odd: "1.90" }]
 */
function parseHandicap(values: any[]): ParsedHandballOdds['handicap'] {
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
 * Values: [{ value: "Over 52.5", odd: "1.85" }, { value: "Under 52.5", odd: "1.90" }]
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
 * Parse Both Teams To Score market.
 * Values: [{ value: "Yes", odd: "1.10" }, { value: "No", odd: "6.50" }]
 * Note: In handball, BTTS yes is almost always a heavy favorite (~1.02-1.15)
 * since both teams typically score 20+ goals.
 */
function parseBTTS(values: any[]): ParsedHandballOdds['btts'] {
  let yesOdds = 0;
  let noOdds = 0;

  for (const v of values) {
    const label = String(v.value || '').toLowerCase().trim();
    const odd = parseFloat(v.odd);
    if (isNaN(odd)) continue;

    if (label === 'yes' || label.startsWith('yes')) {
      yesOdds = odd;
    } else if (label === 'no' || label.startsWith('no')) {
      noOdds = odd;
    }
  }

  if (yesOdds <= 0 && noOdds <= 0) return null;
  return { yes_odds: yesOdds, no_odds: noOdds };
}
