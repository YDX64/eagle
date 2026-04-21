
import {
  poissonProbability,
  generateExactScores,
  calculateTeamForm,
  calculateConfidenceTier,
  probabilityToOdds,
  createValueBet,
} from '@/lib/sports/base/prediction-utils';
import { SportTeamForm, ValueBet } from '@/lib/sports/base/types';
import { ApiHockeyService } from './api-hockey';

/**
 * Algorithm weights for hockey prediction model.
 *
 * Hockey is a low-scoring sport (~4-6 total goals per game).
 * Goaltending dominates outcomes; special teams (PP/PK) swing results.
 * Home-ice advantage is meaningful but smaller than in football.
 *
 * Key improvement: goalie factor significantly raised (was 0.05, now 0.15)
 * as goaltending is the single most impactful factor in hockey outcomes.
 * Power play and penalty kill also elevated.
 */
const weights = {
  recent_form: 0.15,
  home_ice: 0.10,
  goals_per_game: 0.12,
  goals_against: 0.12,
  power_play: 0.13,
  penalty_kill: 0.13,
  h2h: 0.08,
  goalie: 0.15,
  standings: 0.02,
};

/**
 * League-specific average goals per game.
 * NHL averages ~6.0 total, SHL ~5.4, KHL ~4.8, etc.
 */
const LEAGUE_GOAL_AVERAGES: Record<number, { homeAvg: number; awayAvg: number; label: string }> = {
  // NHL
  57: { homeAvg: 3.15, awayAvg: 2.85, label: 'NHL' },
  // SHL (Swedish Hockey League)
  89: { homeAvg: 2.95, awayAvg: 2.55, label: 'SHL' },
  // KHL
  55: { homeAvg: 2.70, awayAvg: 2.30, label: 'KHL' },
  // DEL (German)
  78: { homeAvg: 3.10, awayAvg: 2.70, label: 'DEL' },
  // Liiga (Finnish)
  69: { homeAvg: 2.90, awayAvg: 2.50, label: 'Liiga' },
  // Czech Extraliga
  62: { homeAvg: 2.95, awayAvg: 2.55, label: 'Extraliga' },
  // AHL
  58: { homeAvg: 3.10, awayAvg: 2.80, label: 'AHL' },
  // NLA (Swiss)
  82: { homeAvg: 3.05, awayAvg: 2.65, label: 'NLA' },
};

/** Default expected goals when data is missing */
const DEFAULT_HOME_EXPECTED = 2.90;
const DEFAULT_AWAY_EXPECTED = 2.50;

/** Over/under thresholds for hockey total goals markets */
const TOTAL_GOALS_LINES = [3.5, 4.5, 5.5, 6.5];

/** First period goal distribution: ~31% of total goals scored in P1 */
const FIRST_PERIOD_FACTOR = 0.31;
/** Second period: ~34%, Third period: ~35% (slight increase due to pulling goalies late) */

/**
 * Parsed odds data from API-Hockey odds endpoint.
 * Market IDs:
 *   1 = 3Way Result (regulation)
 *   2 = Home/Away (moneyline including OT)
 *   3 = Asian Handicap / Puck Line
 *   4 = Over/Under (total goals)
 *   5 = Both Teams To Score
 *   8 = Highest Scoring Half
 *   9 = Double Chance
 */
interface ParsedHockeyOddsData {
  moneyline_1x2: { home_odds: number; draw_odds: number; away_odds: number } | null;
  moneyline_2way: { home_odds: number; away_odds: number } | null;
  puck_line: { line: number; home_odds: number; away_odds: number } | null;
  total: { line: number; over_odds: number; under_odds: number } | null;
  btts: { yes_odds: number; no_odds: number } | null;
  double_chance: { home_draw_odds: number; home_away_odds: number; draw_away_odds: number } | null;
  bookmaker: string | null;
  raw_markets: Array<{ market_id: number; market_name: string; values: any[] }>;
}

/**
 * Value bet: our model probability vs bookmaker implied probability.
 * Flagged when our edge exceeds the threshold (typically >5%).
 */
interface HockeyValueBetEntry {
  market: string;
  selection: string;
  model_probability: number;
  implied_probability: number;
  edge: number;
  bookmaker_odds: number;
  fair_odds: number;
  is_value: boolean;
}

interface HockeyAnalysisFactors {
  home_form: SportTeamForm;
  away_form: SportTeamForm;
  home_expected_goals: number;
  away_expected_goals: number;
  home_goals_against_avg: number;
  away_goals_against_avg: number;
  home_ice_factor: number;
  power_play_factor: number;
  penalty_kill_factor: number;
  h2h_factor: number;
  goalie_factor: number;
  standings_factor: number;
}

/**
 * HockeyPredictionEngine
 *
 * Generates comprehensive hockey match predictions using:
 * - Poisson distribution for goal modeling (low-scoring sport)
 * - Team form analysis from recent games
 * - Head-to-head historical records
 * - League standings for relative strength
 * - Special teams efficiency (power play / penalty kill)
 * - Home ice advantage
 * - Overtime probability modeling
 */
export class HockeyPredictionEngine {
  /**
   * Main entry point: generate a full prediction for a given game.
   *
   * @param gameId - API-Sports game ID
   * @param client - ApiHockeyService instance for real API calls
   * @returns Complete prediction object with markets and value bets
   */
  static async generatePrediction(gameId: number, client: ApiHockeyService) {
    // ── Fetch game data ──────────────────────────────────────────
    const game = await client.getGameById(gameId);
    if (!game) {
      throw new Error(`Buz hokeyi macı bulunamadı: ${gameId}`);
    }

    const homeTeam = game.teams.home;
    const awayTeam = game.teams.away;
    const leagueId = game.league?.id;
    const season = client.getCurrentSeason();

    // ── Parallel data fetching for speed (including REAL odds) ────
    const [h2hGames, standings, homeStats, awayStats, leagueGames, rawOddsData] = await Promise.all([
      client.getH2H(homeTeam.id, awayTeam.id).catch(() => [] as any[]),
      leagueId ? client.getStandings(leagueId, season).catch(() => [] as any[]) : Promise.resolve([]),
      leagueId ? client.getTeamStatistics({ league: leagueId, season, team: homeTeam.id }).catch(() => [] as any[]) : Promise.resolve([]),
      leagueId ? client.getTeamStatistics({ league: leagueId, season, team: awayTeam.id }).catch(() => [] as any[]) : Promise.resolve([]),
      leagueId ? client.getGamesByLeague(leagueId, season).catch(() => [] as any[]) : Promise.resolve([]),
      client.getOdds({ game: gameId }).catch(() => [] as any[]),
    ]);

    // ── Parse real odds from API-Hockey ─────────────────────────
    const parsedOdds = parseHockeyOddsResponse(rawOddsData);

    // ── Build team form from recent league games ─────────────────
    const recentHomeGames = leagueGames
      .filter((g: any) =>
        (g.teams?.home?.id === homeTeam.id || g.teams?.away?.id === homeTeam.id) &&
        g.scores?.home?.total != null &&
        g.scores?.away?.total != null &&
        g.id !== gameId
      )
      .slice(-10)
      .map((g: any) => ({
        homeTeamId: g.teams.home.id,
        awayTeamId: g.teams.away.id,
        homeScore: g.scores.home.total,
        awayScore: g.scores.away.total,
      }));

    const recentAwayGames = leagueGames
      .filter((g: any) =>
        (g.teams?.home?.id === awayTeam.id || g.teams?.away?.id === awayTeam.id) &&
        g.scores?.home?.total != null &&
        g.scores?.away?.total != null &&
        g.id !== gameId
      )
      .slice(-10)
      .map((g: any) => ({
        homeTeamId: g.teams.home.id,
        awayTeamId: g.teams.away.id,
        homeScore: g.scores.home.total,
        awayScore: g.scores.away.total,
      }));

    const homeForm = calculateTeamForm(recentHomeGames, homeTeam.id);
    const awayForm = calculateTeamForm(recentAwayGames, awayTeam.id);

    // ── Extract stats ────────────────────────────────────────────
    const homeStat = homeStats[0] || {};
    const awayStat = awayStats[0] || {};

    const homeGoalsFor = extractStatValue(homeStat, 'goals', 'for', homeForm, true);
    const homeGoalsAgainst = extractStatValue(homeStat, 'goals', 'against', homeForm, false);
    const awayGoalsFor = extractStatValue(awayStat, 'goals', 'for', awayForm, true);
    const awayGoalsAgainst = extractStatValue(awayStat, 'goals', 'against', awayForm, false);

    // ── Expected goals (Poisson lambda) ──────────────────────────
    // Use league-specific averages for regression-to-mean
    const leagueAvgs = LEAGUE_GOAL_AVERAGES[leagueId || 0] || { homeAvg: DEFAULT_HOME_EXPECTED, awayAvg: DEFAULT_AWAY_EXPECTED };

    // Cross-reference: team attack strength vs opponent defensive weakness
    // Regress toward league average (30% regression) to avoid overfitting small samples
    const homeAttackStrength = homeGoalsFor / leagueAvgs.homeAvg;
    const awayDefenseWeakness = awayGoalsAgainst / leagueAvgs.homeAvg;
    const awayAttackStrength = awayGoalsFor / leagueAvgs.awayAvg;
    const homeDefenseWeakness = homeGoalsAgainst / leagueAvgs.awayAvg;

    let homeExpected = leagueAvgs.homeAvg * homeAttackStrength * awayDefenseWeakness;
    let awayExpected = leagueAvgs.awayAvg * awayAttackStrength * homeDefenseWeakness;

    // Regression to mean: blend with league average (30% weight to league avg)
    homeExpected = homeExpected * 0.70 + leagueAvgs.homeAvg * 0.30;
    awayExpected = awayExpected * 0.70 + leagueAvgs.awayAvg * 0.30;

    // Sanity-bound expected goals to hockey-realistic range
    homeExpected = Math.max(1.0, Math.min(5.0, homeExpected));
    awayExpected = Math.max(0.8, Math.min(4.5, awayExpected));

    // ── Analysis factors ─────────────────────────────────────────
    const homeIceFactor = computeHomeIceFactor(homeForm);
    const ppFactor = computePowerPlayFactor(homeStat, awayStat);
    const pkFactor = computePenaltyKillFactor(homeStat, awayStat);
    const h2hFactor = computeH2HFactor(h2hGames, homeTeam.id, awayTeam.id);
    const goalieFactor = computeGoalieFactor(homeStat, awayStat);
    const standingsFactor = computeStandingsFactor(standings, homeTeam.id, awayTeam.id);

    // ── Adjust expected goals with weighted factors ──────────────
    const homeAdjustment =
      homeIceFactor * weights.home_ice +
      homeForm.form_score * weights.recent_form +
      ppFactor * weights.power_play +
      pkFactor * weights.penalty_kill +
      h2hFactor * weights.h2h +
      goalieFactor * weights.goalie +
      standingsFactor * weights.standings;

    const awayAdjustment =
      (1 - homeIceFactor) * weights.home_ice +
      awayForm.form_score * weights.recent_form +
      (1 - ppFactor) * weights.power_play +
      (1 - pkFactor) * weights.penalty_kill +
      (1 - h2hFactor) * weights.h2h +
      (1 - goalieFactor) * weights.goalie +
      (1 - standingsFactor) * weights.standings;

    // Scale adjustments symmetrically around 1.0
    const homeMultiplier = 0.7 + homeAdjustment * 0.6;
    const awayMultiplier = 0.7 + awayAdjustment * 0.6;

    homeExpected *= homeMultiplier;
    awayExpected *= awayMultiplier;

    // Re-bound after adjustment
    homeExpected = Math.max(1.0, Math.min(5.5, homeExpected));
    awayExpected = Math.max(0.8, Math.min(5.0, awayExpected));

    const factors: HockeyAnalysisFactors = {
      home_form: homeForm,
      away_form: awayForm,
      home_expected_goals: Math.round(homeExpected * 100) / 100,
      away_expected_goals: Math.round(awayExpected * 100) / 100,
      home_goals_against_avg: Math.round(homeGoalsAgainst * 100) / 100,
      away_goals_against_avg: Math.round(awayGoalsAgainst * 100) / 100,
      home_ice_factor: Math.round(homeIceFactor * 1000) / 1000,
      power_play_factor: Math.round(ppFactor * 1000) / 1000,
      penalty_kill_factor: Math.round(pkFactor * 1000) / 1000,
      h2h_factor: Math.round(h2hFactor * 1000) / 1000,
      goalie_factor: Math.round(goalieFactor * 1000) / 1000,
      standings_factor: Math.round(standingsFactor * 1000) / 1000,
    };

    // ── 3-way match result (regulation time) ─────────────────────
    const { homeWin, draw, awayWin } = compute3WayRegulation(homeExpected, awayExpected);

    // ── 2-way match result (including OT/SO) ─────────────────────
    // Overtime probability: regulation draws go to OT.
    // Historical data: NHL ~23-26% of games go to OT, European leagues ~20-24%.
    // Adjust raw draw probability with a floor based on league norms.
    const rawOtProbability = draw;
    // Blend model draw with historical OT rate (prevents underestimation for close games)
    const leagueOTBase = leagueId && LEAGUE_GOAL_AVERAGES[leagueId] ? 0.24 : 0.22;
    const otProbability = rawOtProbability * 0.70 + leagueOTBase * 0.30;

    // In OT/SO, home team has ~54% win rate (home ice advantage persists)
    const homeOTWinShare = 0.54;
    const homeWinOT = homeWin + otProbability * homeOTWinShare;
    const awayWinOT = awayWin + otProbability * (1 - homeOTWinShare);

    // ── Puck line (handicap) -- use REAL line from bookmaker ─────
    // If real puck line is available (e.g., -1.5, -2.5), use it as primary;
    // otherwise fall back to model default of -1.5
    const realPuckLine = parsedOdds?.puck_line?.line ?? null;
    const primaryPuckLineValue = realPuckLine !== null ? Math.abs(realPuckLine) : 1.5;
    const puckLine = computePuckLineForLine(homeExpected, awayExpected, primaryPuckLineValue);

    // Build multiple puck line entries: real line first, plus model alternatives
    const puckLineEntries: Array<{
      line: number;
      favorite: 'home' | 'away';
      favorite_cover_prob: number;
      underdog_cover_prob: number;
      bookmaker_home_odds?: number;
      bookmaker_away_odds?: number;
      source: 'api_odds' | 'model';
    }> = [];

    // Primary line (real or default -1.5)
    puckLineEntries.push({
      line: primaryPuckLineValue,
      favorite: puckLine.favorite,
      favorite_cover_prob: puckLine.favorite_cover_prob,
      underdog_cover_prob: puckLine.underdog_cover_prob,
      ...(realPuckLine !== null && parsedOdds?.puck_line ? {
        bookmaker_home_odds: parsedOdds.puck_line.home_odds,
        bookmaker_away_odds: parsedOdds.puck_line.away_odds,
      } : {}),
      source: realPuckLine !== null ? 'api_odds' : 'model',
    });

    // Add alternative puck lines if they differ from primary
    const alternativeLines = [1.5, 2.5].filter(l => l !== primaryPuckLineValue);
    for (const altLine of alternativeLines) {
      const alt = computePuckLineForLine(homeExpected, awayExpected, altLine);
      puckLineEntries.push({
        line: altLine,
        favorite: alt.favorite,
        favorite_cover_prob: alt.favorite_cover_prob,
        underdog_cover_prob: alt.underdog_cover_prob,
        source: 'model',
      });
    }

    // ── Total goals over/under -- use REAL line from bookmaker ───
    const realTotalLine = parsedOdds?.total?.line ?? null;
    // Build lines: real bookmaker line as anchor, model alternatives around it
    const totalLinesSet = new Set<number>();
    if (realTotalLine !== null) {
      totalLinesSet.add(realTotalLine);
    }
    // Always include standard hockey lines
    for (const line of TOTAL_GOALS_LINES) {
      totalLinesSet.add(line);
    }
    const totalGoalsLines = Array.from(totalLinesSet)
      .filter(l => l >= 2.5 && l <= 9.5)
      .sort((a, b) => a - b);

    const totalGoalsMarkets = totalGoalsLines.map((line) => {
      const raw = computeTotalGoalsForLine(homeExpected, awayExpected, line);
      const isRealLine = realTotalLine !== null && line === realTotalLine;
      return {
        line,
        over_probability: raw.over_probability,
        under_probability: raw.under_probability,
        ...(isRealLine && parsedOdds?.total ? {
          bookmaker_over_odds: parsedOdds.total.over_odds,
          bookmaker_under_odds: parsedOdds.total.under_odds,
        } : {}),
        source: (isRealLine ? 'api_odds' : 'model') as 'api_odds' | 'model',
      };
    });

    // ── Both teams to score -- attach real BTTS odds ─────────────
    const bttsYes = computeBTTS(homeExpected, awayExpected);
    const bttsNo = 1 - bttsYes;

    // ── First period analysis ────────────────────────────────────
    const p1HomeExp = homeExpected * FIRST_PERIOD_FACTOR;
    const p1AwayExp = awayExpected * FIRST_PERIOD_FACTOR;
    const p1TotalExp = p1HomeExp + p1AwayExp;
    const p1Over05 = 1 - poissonProbability(0, p1TotalExp);
    const p1Over15 = 1 - poissonProbability(0, p1TotalExp) - poissonProbability(1, p1TotalExp);
    const p1Under05 = poissonProbability(0, p1TotalExp);

    // ── Exact scores (Poisson grid) ──────────────────────────────
    const exactScores = generateExactScores(homeExpected, awayExpected, 7, 0.005);

    // ── Goalie shutout probability ───────────────────────────────
    const homeShutout = poissonProbability(0, awayExpected);
    const awayShutout = poissonProbability(0, homeExpected);

    // ── Confidence calculation ────────────────────────────────────
    const dataQuality = Math.min(1, (recentHomeGames.length + recentAwayGames.length) / 16);
    const formStrength = Math.max(Math.abs(homeForm.form_score - 0.5), Math.abs(awayForm.form_score - 0.5));
    const predictionSpread = Math.max(homeWin, awayWin) - Math.min(homeWin, awayWin);

    const confidenceScore = Math.round(
      (dataQuality * 30 + formStrength * 40 + predictionSpread * 80 + (h2hGames.length > 0 ? 10 : 0)) * 0.85
    );
    const clampedConfidence = Math.max(20, Math.min(95, confidenceScore));
    const confidenceTier = calculateConfidenceTier(clampedConfidence);

    // ── Value bets: model probability vs bookmaker implied probability ─
    const VALUE_EDGE_THRESHOLD = 5.0; // Flag value bets where edge > 5%
    const apiValueBets: HockeyValueBetEntry[] = [];

    if (parsedOdds) {
      // --- 1X2 (3-way regulation) value ---
      if (parsedOdds.moneyline_1x2) {
        const homeImplied = oddsToImpliedProbability(parsedOdds.moneyline_1x2.home_odds);
        const drawImplied = oddsToImpliedProbability(parsedOdds.moneyline_1x2.draw_odds);
        const awayImplied = oddsToImpliedProbability(parsedOdds.moneyline_1x2.away_odds);

        apiValueBets.push({
          market: '1x2',
          selection: 'home',
          model_probability: round4(homeWin) * 100,
          implied_probability: round2(homeImplied),
          edge: round2((homeWin * 100) - homeImplied),
          bookmaker_odds: parsedOdds.moneyline_1x2.home_odds,
          fair_odds: probabilityToOdds(homeWin),
          is_value: ((homeWin * 100) - homeImplied) > VALUE_EDGE_THRESHOLD,
        });
        apiValueBets.push({
          market: '1x2',
          selection: 'draw',
          model_probability: round4(draw) * 100,
          implied_probability: round2(drawImplied),
          edge: round2((draw * 100) - drawImplied),
          bookmaker_odds: parsedOdds.moneyline_1x2.draw_odds,
          fair_odds: probabilityToOdds(draw),
          is_value: ((draw * 100) - drawImplied) > VALUE_EDGE_THRESHOLD,
        });
        apiValueBets.push({
          market: '1x2',
          selection: 'away',
          model_probability: round4(awayWin) * 100,
          implied_probability: round2(awayImplied),
          edge: round2((awayWin * 100) - awayImplied),
          bookmaker_odds: parsedOdds.moneyline_1x2.away_odds,
          fair_odds: probabilityToOdds(awayWin),
          is_value: ((awayWin * 100) - awayImplied) > VALUE_EDGE_THRESHOLD,
        });
      }

      // --- 2-way moneyline (including OT) value ---
      if (parsedOdds.moneyline_2way) {
        const homeImplied2w = oddsToImpliedProbability(parsedOdds.moneyline_2way.home_odds);
        const awayImplied2w = oddsToImpliedProbability(parsedOdds.moneyline_2way.away_odds);

        apiValueBets.push({
          market: 'moneyline',
          selection: 'home',
          model_probability: round2(homeWinOT * 100),
          implied_probability: round2(homeImplied2w),
          edge: round2((homeWinOT * 100) - homeImplied2w),
          bookmaker_odds: parsedOdds.moneyline_2way.home_odds,
          fair_odds: probabilityToOdds(homeWinOT),
          is_value: ((homeWinOT * 100) - homeImplied2w) > VALUE_EDGE_THRESHOLD,
        });
        apiValueBets.push({
          market: 'moneyline',
          selection: 'away',
          model_probability: round2(awayWinOT * 100),
          implied_probability: round2(awayImplied2w),
          edge: round2((awayWinOT * 100) - awayImplied2w),
          bookmaker_odds: parsedOdds.moneyline_2way.away_odds,
          fair_odds: probabilityToOdds(awayWinOT),
          is_value: ((awayWinOT * 100) - awayImplied2w) > VALUE_EDGE_THRESHOLD,
        });
      }

      // --- Total over/under value (on the real bookmaker line) ---
      if (parsedOdds.total) {
        const realTotLine = parsedOdds.total.line;
        const modelTotal = computeTotalGoalsForLine(homeExpected, awayExpected, realTotLine);
        const modelOverProb = modelTotal.over_probability;
        const modelUnderProb = modelTotal.under_probability;
        const overImplied = oddsToImpliedProbability(parsedOdds.total.over_odds);
        const underImplied = oddsToImpliedProbability(parsedOdds.total.under_odds);

        apiValueBets.push({
          market: 'total',
          selection: `over_${realTotLine}`,
          model_probability: round2(modelOverProb * 100),
          implied_probability: round2(overImplied),
          edge: round2((modelOverProb * 100) - overImplied),
          bookmaker_odds: parsedOdds.total.over_odds,
          fair_odds: probabilityToOdds(modelOverProb),
          is_value: ((modelOverProb * 100) - overImplied) > VALUE_EDGE_THRESHOLD,
        });
        apiValueBets.push({
          market: 'total',
          selection: `under_${realTotLine}`,
          model_probability: round2(modelUnderProb * 100),
          implied_probability: round2(underImplied),
          edge: round2((modelUnderProb * 100) - underImplied),
          bookmaker_odds: parsedOdds.total.under_odds,
          fair_odds: probabilityToOdds(modelUnderProb),
          is_value: ((modelUnderProb * 100) - underImplied) > VALUE_EDGE_THRESHOLD,
        });
      }

      // --- Puck line value ---
      if (parsedOdds.puck_line) {
        const realPL = Math.abs(parsedOdds.puck_line.line);
        const plModel = computePuckLineForLine(homeExpected, awayExpected, realPL);
        const favCoverProb = plModel.favorite_cover_prob;
        const undCoverProb = plModel.underdog_cover_prob;
        const homeSpreadImplied = oddsToImpliedProbability(parsedOdds.puck_line.home_odds);
        const awaySpreadImplied = oddsToImpliedProbability(parsedOdds.puck_line.away_odds);

        apiValueBets.push({
          market: 'puck_line',
          selection: `home_-${realPL}`,
          model_probability: round2((plModel.favorite === 'home' ? favCoverProb : undCoverProb) * 100),
          implied_probability: round2(homeSpreadImplied),
          edge: round2(((plModel.favorite === 'home' ? favCoverProb : undCoverProb) * 100) - homeSpreadImplied),
          bookmaker_odds: parsedOdds.puck_line.home_odds,
          fair_odds: probabilityToOdds(plModel.favorite === 'home' ? favCoverProb : undCoverProb),
          is_value: (((plModel.favorite === 'home' ? favCoverProb : undCoverProb) * 100) - homeSpreadImplied) > VALUE_EDGE_THRESHOLD,
        });
        apiValueBets.push({
          market: 'puck_line',
          selection: `away_+${realPL}`,
          model_probability: round2((plModel.favorite === 'away' ? favCoverProb : undCoverProb) * 100),
          implied_probability: round2(awaySpreadImplied),
          edge: round2(((plModel.favorite === 'away' ? favCoverProb : undCoverProb) * 100) - awaySpreadImplied),
          bookmaker_odds: parsedOdds.puck_line.away_odds,
          fair_odds: probabilityToOdds(plModel.favorite === 'away' ? favCoverProb : undCoverProb),
          is_value: (((plModel.favorite === 'away' ? favCoverProb : undCoverProb) * 100) - awaySpreadImplied) > VALUE_EDGE_THRESHOLD,
        });
      }

      // --- BTTS value ---
      if (parsedOdds.btts) {
        const bttsYesImplied = oddsToImpliedProbability(parsedOdds.btts.yes_odds);
        const bttsNoImplied = oddsToImpliedProbability(parsedOdds.btts.no_odds);

        apiValueBets.push({
          market: 'btts',
          selection: 'yes',
          model_probability: round2(bttsYes * 100),
          implied_probability: round2(bttsYesImplied),
          edge: round2((bttsYes * 100) - bttsYesImplied),
          bookmaker_odds: parsedOdds.btts.yes_odds,
          fair_odds: probabilityToOdds(bttsYes),
          is_value: ((bttsYes * 100) - bttsYesImplied) > VALUE_EDGE_THRESHOLD,
        });
        apiValueBets.push({
          market: 'btts',
          selection: 'no',
          model_probability: round2(bttsNo * 100),
          implied_probability: round2(bttsNoImplied),
          edge: round2((bttsNo * 100) - bttsNoImplied),
          bookmaker_odds: parsedOdds.btts.no_odds,
          fair_odds: probabilityToOdds(bttsNo),
          is_value: ((bttsNo * 100) - bttsNoImplied) > VALUE_EDGE_THRESHOLD,
        });
      }
    }

    // ── Build bet recommendations ────────────────────────────────
    const leagueName = game.league?.name || 'Buz Hokeyi';
    const gameDate = game.date || new Date().toISOString().split('T')[0];

    const highConfidenceBets: any[] = [];
    const mediumRiskBets: any[] = [];
    const highRiskBets: any[] = [];

    // --- Match result (3-way regulation) ---
    const maxRegProb = Math.max(homeWin, draw, awayWin);
    const regWinner =
      homeWin === maxRegProb ? 'Ev Sahibi' : awayWin === maxRegProb ? 'Deplasman' : 'Beraberlik';
    const regSelection =
      homeWin === maxRegProb ? homeTeam.name : awayWin === maxRegProb ? awayTeam.name : 'Beraberlik';

    if (maxRegProb >= 0.45) {
      highConfidenceBets.push({
        title: 'Mac Sonucu (Normal Sure)',
        description: `${regWinner} kazanir (normal surede): ${regSelection}`,
        confidence: Math.round(maxRegProb * 100),
        reason: `Form ve istatistiksel analiz ${regSelection} tarafini destekliyor`,
        recommendation: `${regSelection} Mac Sonucu (Normal Sure)`,
        market: 'match_result_3way',
        selection: regSelection,
        estimated_odds: probabilityToOdds(maxRegProb),
      });
    } else if (maxRegProb >= 0.35) {
      mediumRiskBets.push({
        title: 'Mac Sonucu (Normal Sure)',
        description: `${regWinner} kazanir (normal surede): ${regSelection}`,
        confidence: Math.round(maxRegProb * 100),
        reason: `Istatistiksel avantaj ${regSelection} tarafinda`,
        recommendation: `${regSelection} Mac Sonucu`,
      });
    }

    // --- Match result (2-way including OT) ---
    const twoWayWinner = homeWinOT > awayWinOT ? homeTeam.name : awayTeam.name;
    const twoWayProb = Math.max(homeWinOT, awayWinOT);
    if (twoWayProb >= 0.55) {
      highConfidenceBets.push({
        title: 'Mac Sonucu (Uzatmalar Dahil)',
        description: `${twoWayWinner} kazanir (uzatmalar/penaltilar dahil)`,
        confidence: Math.round(twoWayProb * 100),
        reason: `Uzatma/penalti dahil edildikten sonra ${twoWayWinner} guclu favori`,
        recommendation: `${twoWayWinner} Uzatmalar Dahil`,
        market: 'match_result_2way',
        selection: twoWayWinner,
        estimated_odds: probabilityToOdds(twoWayProb),
      });
    }

    // --- Puck line (handicap -- use real bookmaker line when available) ---
    const puckLineSource = realPuckLine !== null ? ' (bahis sirketi cizgisi)' : '';
    const plValueBet = apiValueBets.find(vb => vb.market === 'puck_line' && vb.is_value);
    if (puckLine.favorite_cover_prob >= 0.42) {
      const puckFav = puckLine.favorite === 'home' ? homeTeam.name : awayTeam.name;
      const favValueNote = plValueBet && plValueBet.selection.startsWith(puckLine.favorite === 'home' ? 'home' : 'away')
        ? ` DEGER BAHIS: Model %${plValueBet.model_probability.toFixed(1)} vs bahis sirketi %${plValueBet.implied_probability.toFixed(1)} (avantaj: %${plValueBet.edge.toFixed(1)})`
        : '';
      mediumRiskBets.push({
        title: `Puck Line -${primaryPuckLineValue}${puckLineSource}`,
        description: `${puckFav} handikap -${primaryPuckLineValue} (en az ${Math.ceil(primaryPuckLineValue)} farkla kazanir)${favValueNote}`,
        confidence: Math.round(puckLine.favorite_cover_prob * 100),
        reason: `${puckFav} son maclarda guclu gol averajina sahip`,
        recommendation: `${puckFav} -${primaryPuckLineValue} Puck Line`,
      });
    }
    if (puckLine.underdog_cover_prob >= 0.55) {
      const puckUnd = puckLine.favorite === 'home' ? awayTeam.name : homeTeam.name;
      const undValueNote = plValueBet && plValueBet.selection.startsWith(puckLine.favorite === 'home' ? 'away' : 'home')
        ? ` DEGER BAHIS: Model %${plValueBet.model_probability.toFixed(1)} vs bahis sirketi %${plValueBet.implied_probability.toFixed(1)} (avantaj: %${plValueBet.edge.toFixed(1)})`
        : '';
      highConfidenceBets.push({
        title: `Puck Line +${primaryPuckLineValue}${puckLineSource}`,
        description: `${puckUnd} handikap +${primaryPuckLineValue} (en fazla ${Math.ceil(primaryPuckLineValue) - 1} farkla kaybeder veya kazanir)${undValueNote}`,
        confidence: Math.round(puckLine.underdog_cover_prob * 100),
        reason: `${puckUnd} savunmasi saglam, buyuk farkli maglubiyet beklenmez`,
        recommendation: `${puckUnd} +${primaryPuckLineValue} Puck Line`,
        market: 'puck_line',
        selection: `${puckUnd} +${primaryPuckLineValue}`,
        estimated_odds: probabilityToOdds(puckLine.underdog_cover_prob),
      });
    }

    // --- Total goals over/under (prefer real bookmaker line) ---
    for (const market of totalGoalsMarkets) {
      const overProb = market.over_probability;
      const underProb = market.under_probability;
      const line = market.line;
      const lineSource = market.source === 'api_odds' ? ' (bahis sirketi cizgisi)' : '';

      // Find matching value bet from API odds for this line
      const overValueBet = apiValueBets.find(vb => vb.market === 'total' && vb.selection === `over_${line}` && vb.is_value);
      const underValueBet = apiValueBets.find(vb => vb.market === 'total' && vb.selection === `under_${line}` && vb.is_value);

      if (overProb >= 0.58 && line <= 5.5) {
        const bucket = overProb >= 0.65 ? highConfidenceBets : mediumRiskBets;
        const valueNote = overValueBet
          ? ` DEGER BAHIS: Model %${overValueBet.model_probability.toFixed(1)} vs bahis sirketi %${overValueBet.implied_probability.toFixed(1)} (avantaj: %${overValueBet.edge.toFixed(1)})`
          : '';
        bucket.push({
          title: `Toplam Gol Ust ${line}${lineSource}`,
          description: `Macta ${line} ustunde gol atilir${valueNote}`,
          confidence: Math.round(overProb * 100),
          reason: `Beklenen toplam gol: ${(homeExpected + awayExpected).toFixed(2)} - ust ${line} olasi`,
          recommendation: `Ust ${line} Gol`,
          ...(overProb >= 0.65
            ? { market: `total_goals_over_${line}`, selection: `Ust ${line}`, estimated_odds: probabilityToOdds(overProb) }
            : {}),
        });
      }
      if (underProb >= 0.58 && line >= 4.5) {
        const bucket = underProb >= 0.65 ? highConfidenceBets : mediumRiskBets;
        const valueNote = underValueBet
          ? ` DEGER BAHIS: Model %${underValueBet.model_probability.toFixed(1)} vs bahis sirketi %${underValueBet.implied_probability.toFixed(1)} (avantaj: %${underValueBet.edge.toFixed(1)})`
          : '';
        bucket.push({
          title: `Toplam Gol Alt ${line}${lineSource}`,
          description: `Macta ${line} altinda gol atilir${valueNote}`,
          confidence: Math.round(underProb * 100),
          reason: `Beklenen toplam gol: ${(homeExpected + awayExpected).toFixed(2)} - alt ${line} olasi`,
          recommendation: `Alt ${line} Gol`,
          ...(underProb >= 0.65
            ? { market: `total_goals_under_${line}`, selection: `Alt ${line}`, estimated_odds: probabilityToOdds(underProb) }
            : {}),
        });
      }
    }

    // --- Both teams to score (with real odds annotation) ---
    const bttsYesValueBet = apiValueBets.find(vb => vb.market === 'btts' && vb.selection === 'yes' && vb.is_value);
    const bttsNoValueBet = apiValueBets.find(vb => vb.market === 'btts' && vb.selection === 'no' && vb.is_value);
    const bttsSource = parsedOdds?.btts ? ' (bahis sirketi orani)' : '';
    if (bttsYes >= 0.62) {
      const bttsValueNote = bttsYesValueBet
        ? ` DEGER BAHIS: Model %${bttsYesValueBet.model_probability.toFixed(1)} vs bahis sirketi %${bttsYesValueBet.implied_probability.toFixed(1)} (avantaj: %${bttsYesValueBet.edge.toFixed(1)})`
        : '';
      highConfidenceBets.push({
        title: `Karsilikli Gol${bttsSource}`,
        description: `Her iki takim da en az bir gol atar${bttsValueNote}`,
        confidence: Math.round(bttsYes * 100),
        reason: `Her iki takim da gol atma konusunda verimli: beklenen goller ${homeExpected.toFixed(2)} - ${awayExpected.toFixed(2)}`,
        recommendation: 'Karsilikli Gol Var',
        market: 'btts',
        selection: 'Evet',
        estimated_odds: probabilityToOdds(bttsYes),
      });
    } else if (bttsNo >= 0.40) {
      const bttsNoNote = bttsNoValueBet
        ? ` DEGER BAHIS: Model %${bttsNoValueBet.model_probability.toFixed(1)} vs bahis sirketi %${bttsNoValueBet.implied_probability.toFixed(1)} (avantaj: %${bttsNoValueBet.edge.toFixed(1)})`
        : '';
      mediumRiskBets.push({
        title: `Karsilikli Gol Yok${bttsSource}`,
        description: `En az bir takim gol atamaz${bttsNoNote}`,
        confidence: Math.round(bttsNo * 100),
        reason: 'Kaleci performansi veya dusuk gol beklentisi nedeniyle tek tarafin skor yapma ihtimali yuksek',
        recommendation: 'Karsilikli Gol Yok',
      });
    }

    // --- First period over/under ---
    if (p1Over05 >= 0.70) {
      highConfidenceBets.push({
        title: '1. Periyot Ust 0.5 Gol',
        description: 'Ilk periyotta en az 1 gol atilir',
        confidence: Math.round(p1Over05 * 100),
        reason: `Ilk periyot beklenen gol: ${p1TotalExp.toFixed(2)} - bos periyot olma ihtimali dusuk`,
        recommendation: '1. Periyot Ust 0.5',
        market: 'period_1_over_05',
        selection: 'Ust 0.5',
        estimated_odds: probabilityToOdds(p1Over05),
      });
    }
    if (p1Over15 >= 0.45) {
      mediumRiskBets.push({
        title: '1. Periyot Ust 1.5 Gol',
        description: 'Ilk periyotta en az 2 gol atilir',
        confidence: Math.round(p1Over15 * 100),
        reason: `Yuksek tempolu acilis bekleniyor`,
        recommendation: '1. Periyot Ust 1.5',
      });
    }

    // --- Overtime probability ---
    if (otProbability >= 0.22) {
      mediumRiskBets.push({
        title: 'Uzatmaya Gider',
        description: 'Mac normal surede berabere biter, uzatmaya gider',
        confidence: Math.round(otProbability * 100),
        reason: `Takimlar birbirine yakin gucte, beraberlik olasiligi %${(otProbability * 100).toFixed(1)}`,
        recommendation: 'Uzatma Var',
      });
    }

    // --- Exact scores (high risk, high reward) ---
    const topExactScores = exactScores.slice(0, 5);
    for (const es of topExactScores) {
      if (es.odds >= 8.0 && es.probability >= 1.5) {
        highRiskBets.push({
          title: `Skor Tahmini: ${es.score}`,
          description: `Macin ${es.score} bitmesi bekleniyor (normal sure)`,
          confidence: Math.round(es.probability),
          reason: `Poisson dagilimina gore en olasi skorlardan biri (%${es.probability.toFixed(1)})`,
          recommendation: `Skor: ${es.score} @ ${es.odds.toFixed(2)}`,
        });
      }
    }

    // --- Goalie shutout (high risk) ---
    if (homeShutout >= 0.06) {
      highRiskBets.push({
        title: `${homeTeam.name} Kalesini Gole Kapatir`,
        description: `${homeTeam.name} kalecisi gol yemez (shutout)`,
        confidence: Math.round(homeShutout * 100),
        reason: `Deplasman takimi beklenen gol ${awayExpected.toFixed(2)} - shutout olasiligi %${(homeShutout * 100).toFixed(1)}`,
        recommendation: `${homeTeam.name} Shutout @ ${probabilityToOdds(homeShutout).toFixed(2)}`,
      });
    }
    if (awayShutout >= 0.05) {
      highRiskBets.push({
        title: `${awayTeam.name} Kalesini Gole Kapatir`,
        description: `${awayTeam.name} kalecisi gol yemez (shutout)`,
        confidence: Math.round(awayShutout * 100),
        reason: `Ev sahibi beklenen gol ${homeExpected.toFixed(2)} - shutout olasiligi %${(awayShutout * 100).toFixed(1)}`,
        recommendation: `${awayTeam.name} Shutout @ ${probabilityToOdds(awayShutout).toFixed(2)}`,
      });
    }

    // --- First period + match result combo (high risk) ---
    const p1HomeWinProb = computeP1WinProb(p1HomeExp, p1AwayExp);
    const fullHomeWin = homeWin;
    const comboProb = p1HomeWinProb * fullHomeWin * 1.1; // slight correlation boost
    if (comboProb >= 0.05) {
      highRiskBets.push({
        title: `1P ${homeTeam.name} & Mac ${homeTeam.name}`,
        description: `${homeTeam.name} ilk periyodu ve maci kazanir`,
        confidence: Math.round(comboProb * 100),
        reason: `Kombine olasilik: 1P galibiyet x mac galibiyet`,
        recommendation: `1P/Mac ${homeTeam.name} @ ${probabilityToOdds(comboProb).toFixed(2)}`,
      });
    }

    // ── Legacy value bets (createValueBet format) ───────────────
    const valueBets: ValueBet[] = [];

    // When real odds are available, use actual bookmaker odds; otherwise estimate with margin
    for (const bet of highConfidenceBets) {
      if (bet.market && bet.estimated_odds) {
        // Find matching real odds from API for this market
        const matchingApiVb = apiValueBets.find(vb =>
          vb.is_value && (
            (bet.market === 'match_result_3way' && vb.market === '1x2') ||
            (bet.market === 'match_result_2way' && vb.market === 'moneyline') ||
            (bet.market === 'puck_line' && vb.market === 'puck_line') ||
            (bet.market?.startsWith('total_goals') && vb.market === 'total') ||
            (bet.market === 'btts' && vb.market === 'btts') ||
            (bet.market === 'period_1_over_05')
          )
        );

        const effectiveOdds = matchingApiVb ? matchingApiVb.bookmaker_odds : bet.estimated_odds * 1.08;

        const vb = createValueBet({
          sport: 'hockey',
          game_id: gameId,
          home_team: homeTeam.name,
          away_team: awayTeam.name,
          league_name: leagueName,
          game_date: gameDate,
          market: bet.market,
          selection: bet.selection,
          our_probability: bet.confidence / 100,
          market_odds: effectiveOdds,
          reasoning: matchingApiVb
            ? `${bet.reason} | DEGER BAHIS: Model %${matchingApiVb.model_probability.toFixed(1)} vs bahis sirketi %${matchingApiVb.implied_probability.toFixed(1)} (avantaj: %${matchingApiVb.edge.toFixed(1)})`
            : bet.reason,
        });
        if (vb) valueBets.push(vb);
      }
    }

    // ── Assemble final prediction ────────────────────────────────
    return {
      sport: 'hockey' as const,
      game_id: gameId,
      game_info: {
        home_team: homeTeam,
        away_team: awayTeam,
        league: game.league,
        date: gameDate,
        status: game.status,
      },
      match_result: {
        regulation_3way: {
          home_win: {
            probability: round4(homeWin),
            odds: probabilityToOdds(homeWin),
            ...(parsedOdds?.moneyline_1x2 ? { bookmaker_odds: parsedOdds.moneyline_1x2.home_odds } : {}),
          },
          draw: {
            probability: round4(draw),
            odds: probabilityToOdds(draw),
            ...(parsedOdds?.moneyline_1x2 ? { bookmaker_odds: parsedOdds.moneyline_1x2.draw_odds } : {}),
          },
          away_win: {
            probability: round4(awayWin),
            odds: probabilityToOdds(awayWin),
            ...(parsedOdds?.moneyline_1x2 ? { bookmaker_odds: parsedOdds.moneyline_1x2.away_odds } : {}),
          },
          source: (parsedOdds?.moneyline_1x2 ? 'api_odds' : 'model') as 'api_odds' | 'model',
        },
        including_ot_2way: {
          home_win: {
            probability: round4(homeWinOT),
            odds: probabilityToOdds(homeWinOT),
            ...(parsedOdds?.moneyline_2way ? { bookmaker_odds: parsedOdds.moneyline_2way.home_odds } : {}),
          },
          away_win: {
            probability: round4(awayWinOT),
            odds: probabilityToOdds(awayWinOT),
            ...(parsedOdds?.moneyline_2way ? { bookmaker_odds: parsedOdds.moneyline_2way.away_odds } : {}),
          },
          source: (parsedOdds?.moneyline_2way ? 'api_odds' : 'model') as 'api_odds' | 'model',
        },
        confidence: Math.round(Math.max(homeWin, draw, awayWin) * 100),
      },
      puck_line: puckLineEntries.map((entry) => ({
        line: -entry.line,
        favorite: entry.favorite,
        favorite_team: entry.favorite === 'home' ? homeTeam.name : awayTeam.name,
        underdog_team: entry.favorite === 'home' ? awayTeam.name : homeTeam.name,
        favorite_cover: { probability: round4(entry.favorite_cover_prob), odds: probabilityToOdds(entry.favorite_cover_prob) },
        underdog_cover: { probability: round4(entry.underdog_cover_prob), odds: probabilityToOdds(entry.underdog_cover_prob) },
        ...(entry.bookmaker_home_odds ? { bookmaker_home_odds: entry.bookmaker_home_odds } : {}),
        ...(entry.bookmaker_away_odds ? { bookmaker_away_odds: entry.bookmaker_away_odds } : {}),
        source: entry.source,
      })),
      total_goals: totalGoalsMarkets.map((m) => ({
        line: m.line,
        over: { probability: round4(m.over_probability), odds: probabilityToOdds(m.over_probability) },
        under: { probability: round4(m.under_probability), odds: probabilityToOdds(m.under_probability) },
        ...('bookmaker_over_odds' in m ? { bookmaker_over_odds: m.bookmaker_over_odds } : {}),
        ...('bookmaker_under_odds' in m ? { bookmaker_under_odds: m.bookmaker_under_odds } : {}),
        source: m.source,
      })),
      both_teams_to_score: {
        yes: {
          probability: round4(bttsYes),
          odds: probabilityToOdds(bttsYes),
          ...(parsedOdds?.btts ? { bookmaker_odds: parsedOdds.btts.yes_odds } : {}),
        },
        no: {
          probability: round4(bttsNo),
          odds: probabilityToOdds(bttsNo),
          ...(parsedOdds?.btts ? { bookmaker_odds: parsedOdds.btts.no_odds } : {}),
        },
        source: (parsedOdds?.btts ? 'api_odds' : 'model') as 'api_odds' | 'model',
      },
      first_period: {
        expected_goals: Math.round(p1TotalExp * 100) / 100,
        over_05: { probability: round4(p1Over05), odds: probabilityToOdds(p1Over05) },
        over_15: { probability: round4(p1Over15), odds: probabilityToOdds(p1Over15) },
        under_05: { probability: round4(p1Under05), odds: probabilityToOdds(p1Under05) },
      },
      overtime: {
        probability: round4(otProbability),
        odds: probabilityToOdds(otProbability),
      },
      exact_scores: exactScores.slice(0, 10),
      goalie_shutout: {
        home: { probability: round4(homeShutout), odds: probabilityToOdds(homeShutout) },
        away: { probability: round4(awayShutout), odds: probabilityToOdds(awayShutout) },
      },
      expected_goals: {
        home: factors.home_expected_goals,
        away: factors.away_expected_goals,
        total: Math.round((homeExpected + awayExpected) * 100) / 100,
      },
      odds_data: parsedOdds,
      api_value_bets: apiValueBets,
      high_confidence_bets: highConfidenceBets,
      medium_risk_bets: mediumRiskBets,
      high_risk_bets: highRiskBets,
      value_bets: valueBets,
      prediction_confidence: clampedConfidence,
      confidence_tier: confidenceTier,
      analysis_factors: {
        recent_form: weights.recent_form,
        home_ice: weights.home_ice,
        goals_per_game: weights.goals_per_game,
        goals_against: weights.goals_against,
        power_play: weights.power_play,
        penalty_kill: weights.penalty_kill,
        h2h: weights.h2h,
        goalie: weights.goalie,
        standings: weights.standings,
      },
      detailed_factors: factors,
      risk_analysis: {
        data_quality: Math.round(dataQuality * 100),
        form_divergence: Math.round(Math.abs(homeForm.form_score - awayForm.form_score) * 100),
        h2h_sample_size: h2hGames.length,
        home_games_analyzed: recentHomeGames.length,
        away_games_analyzed: recentAwayGames.length,
      },
      generated_at: new Date().toISOString(),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Extract a numeric stat value from API-Sports team statistics response.
 * Falls back to form-based calculation when API data is unavailable.
 */
function extractStatValue(
  stat: any,
  category: string,
  direction: 'for' | 'against',
  form: SportTeamForm,
  isFor: boolean
): number {
  // Try API-Sports statistics format
  if (stat?.games?.played?.all && stat?.goals) {
    const played = stat.games.played.all;
    if (direction === 'for' && stat.goals.for?.total?.all != null) {
      return stat.goals.for.total.all / played;
    }
    if (direction === 'against' && stat.goals.against?.total?.all != null) {
      return stat.goals.against.total.all / played;
    }
  }

  // Fallback: derive from recent form
  if (form.recent_matches > 0) {
    return isFor
      ? form.points_for / form.recent_matches
      : form.points_against / form.recent_matches;
  }

  // Final fallback: league average approximation
  return isFor ? DEFAULT_HOME_EXPECTED : DEFAULT_AWAY_EXPECTED;
}

/**
 * Home ice advantage factor (0.5 = neutral, >0.5 = home favored).
 * Based on home form and general home-ice statistical edge.
 */
function computeHomeIceFactor(homeForm: SportTeamForm): number {
  // NHL average home win% is ~55%. Adjust by actual home form.
  const baseHomeAdvantage = 0.55;
  const homeFormWeight = homeForm.home_form_score || 0.5;
  return Math.max(0.35, Math.min(0.70, baseHomeAdvantage * 0.5 + homeFormWeight * 0.5));
}

/**
 * Power play comparative factor.
 * Compares home PP% against away PK% to estimate special teams advantage.
 * NHL average PP%: ~20-22%, average PK%: ~78-80%.
 * A team's PP is more valuable when facing a weak PK.
 * >0.5 means home has better special teams on the offensive side.
 */
function computePowerPlayFactor(homeStat: any, awayStat: any): number {
  const homePP = extractPercentage(homeStat, 'power_play') ?? 20;
  const awayPK = extractPercentage(awayStat, 'penalty_kill') ?? 80;
  const awayPP = extractPercentage(awayStat, 'power_play') ?? 20;
  const homePK = extractPercentage(homeStat, 'penalty_kill') ?? 80;

  // Cross-reference: home PP vs away PK, and away PP vs home PK
  // Higher home PP + lower away PK = bigger advantage for home
  const homePPEfficiency = homePP * (100 - awayPK) / 100; // Expected PP goal generation
  const awayPPEfficiency = awayPP * (100 - homePK) / 100;

  const total = homePPEfficiency + awayPPEfficiency;
  if (total <= 0) return 0.5;

  // Scale to 0.3-0.7 range (avoid extreme values)
  const raw = homePPEfficiency / total;
  return Math.max(0.30, Math.min(0.70, raw));
}

/**
 * Penalty kill comparative factor.
 * Evaluates how well each team's PK neutralizes the opponent's PP.
 * >0.5 means home PK gives them an advantage (they kill penalties better).
 */
function computePenaltyKillFactor(homeStat: any, awayStat: any): number {
  const homePK = extractPercentage(homeStat, 'penalty_kill') ?? 80;
  const awayPK = extractPercentage(awayStat, 'penalty_kill') ?? 80;

  // Normalize: higher PK% = better. NHL average is ~79-80%.
  // A 2% PK difference is significant in hockey.
  const diff = homePK - awayPK;
  // Map to 0-1 scale: +10% diff -> 0.70, -10% diff -> 0.30
  return Math.max(0.25, Math.min(0.75, 0.5 + diff * 0.02));
}

/**
 * Try to extract a percentage stat from the API-Sports statistics response.
 */
function extractPercentage(stat: any, key: string): number | null {
  // Multiple possible formats from the API
  if (stat?.[key]?.percentage != null) {
    return parseFloat(stat[key].percentage);
  }
  if (stat?.[key]?.total != null && stat?.[key]?.attempts != null && stat[key].attempts > 0) {
    return (stat[key].total / stat[key].attempts) * 100;
  }
  return null;
}

/**
 * Head-to-head factor from past meetings with recency weighting.
 * More recent H2H games get exponentially higher weight.
 * >0.5 = home team historically dominant.
 */
function computeH2HFactor(h2hGames: any[], homeId: number, awayId: number): number {
  if (!h2hGames || h2hGames.length === 0) return 0.5;

  const H2H_DECAY = 0.82;
  let weightedHomeWins = 0;
  let totalWeight = 0;

  for (let i = 0; i < h2hGames.length; i++) {
    const g = h2hGames[i];
    const hScore = g.scores?.home?.total;
    const aScore = g.scores?.away?.total;
    if (hScore == null || aScore == null) continue;

    // Recency weight: last game in array = most recent
    const recencyIdx = h2hGames.length - 1 - i;
    const weight = Math.pow(H2H_DECAY, recencyIdx);
    totalWeight += weight;

    const isHomeTeam = g.teams?.home?.id === homeId;
    const teamScore = isHomeTeam ? hScore : aScore;
    const oppScore = isHomeTeam ? aScore : hScore;

    if (teamScore > oppScore) weightedHomeWins += weight;
    else if (teamScore === oppScore) weightedHomeWins += weight * 0.5;
  }

  if (totalWeight === 0) return 0.5;

  // Blend with neutral proportional to sample size (reduces impact of 1-2 game samples)
  const sampleWeight = Math.min(h2hGames.length, 6) / 6;
  const rawFactor = weightedHomeWins / totalWeight;
  return rawFactor * sampleWeight + 0.5 * (1 - sampleWeight);
}

/**
 * Goalie factor: uses both goals-against average and save percentage.
 * Save percentage is a much stronger predictor of goalie quality than raw GAA.
 * >0.5 = home goalie is relatively better.
 *
 * Weighting: 60% save percentage, 40% GAA-based
 * (save percentage isolates goalie skill from team defense)
 */
function computeGoalieFactor(homeStat: any, awayStat: any): number {
  // --- GAA component (lower = better) ---
  const homeGAA = homeStat?.goals?.against?.total?.all && homeStat?.games?.played?.all
    ? homeStat.goals.against.total.all / homeStat.games.played.all
    : 2.8;
  const awayGAA = awayStat?.goals?.against?.total?.all && awayStat?.games?.played?.all
    ? awayStat.goals.against.total.all / awayStat.games.played.all
    : 2.8;

  const totalGAA = homeGAA + awayGAA;
  const gaaFactor = totalGAA > 0 ? awayGAA / totalGAA : 0.5;

  // --- Save percentage component (higher = better) ---
  // Try to extract save percentage from API stats
  const homeSVPct = extractSavePercentage(homeStat);
  const awaySVPct = extractSavePercentage(awayStat);

  let svPctFactor = 0.5;
  if (homeSVPct !== null && awaySVPct !== null) {
    // Convert save% difference to factor
    // Average NHL save% is ~0.905. A 0.01 difference is significant.
    const svDiff = homeSVPct - awaySVPct;
    // Map difference to 0-1 range: +0.03 diff maps to ~0.65, -0.03 maps to ~0.35
    svPctFactor = Math.max(0.25, Math.min(0.75, 0.5 + svDiff * 5));
  }

  // Blend: 60% save percentage (better predictor), 40% GAA
  const hasSVPct = homeSVPct !== null && awaySVPct !== null;
  return hasSVPct ? svPctFactor * 0.60 + gaaFactor * 0.40 : gaaFactor;
}

/**
 * Extract save percentage from team/goalie statistics.
 * Returns null if not available.
 */
function extractSavePercentage(stat: any): number | null {
  // Try multiple API paths for save percentage
  if (stat?.goalie?.save_percentage != null) {
    return parseFloat(stat.goalie.save_percentage) / 100;
  }
  if (stat?.goalkeeping?.save_percentage != null) {
    return parseFloat(stat.goalkeeping.save_percentage) / 100;
  }
  // Calculate from goals against and shots against
  if (stat?.goals?.against?.total?.all != null && stat?.shots?.against?.total?.all != null) {
    const goalsAgainst = stat.goals.against.total.all;
    const shotsAgainst = stat.shots.against.total.all;
    if (shotsAgainst > 0) {
      return 1 - (goalsAgainst / shotsAgainst);
    }
  }
  return null;
}

/**
 * Standings-based strength factor.
 * >0.5 = home team is higher in standings.
 */
function computeStandingsFactor(standings: any[], homeId: number, awayId: number): number {
  if (!standings || standings.length === 0) return 0.5;

  // API-Sports standings can be nested in groups
  const flat = standings.flatMap((s: any) => (Array.isArray(s) ? s : [s]));

  let homePos = 0;
  let awayPos = 0;
  const total = flat.length || 30;

  for (const entry of flat) {
    if (entry?.team?.id === homeId) homePos = entry.position || entry.rank || 0;
    if (entry?.team?.id === awayId) awayPos = entry.position || entry.rank || 0;
  }

  if (homePos === 0 && awayPos === 0) return 0.5;
  if (homePos === 0) return 0.4; // no data for home
  if (awayPos === 0) return 0.6; // no data for away

  const homeStrength = (total - homePos + 1) / total;
  const awayStrength = (total - awayPos + 1) / total;
  const sum = homeStrength + awayStrength;
  return sum > 0 ? homeStrength / sum : 0.5;
}

/**
 * Compute 3-way regulation-time probabilities using Poisson.
 * Sums the full Poisson score grid for home win / draw / away win.
 */
function compute3WayRegulation(homeLambda: number, awayLambda: number) {
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  for (let h = 0; h <= 10; h++) {
    for (let a = 0; a <= 10; a++) {
      const prob = poissonProbability(h, homeLambda) * poissonProbability(a, awayLambda);
      if (h > a) homeWin += prob;
      else if (h === a) draw += prob;
      else awayWin += prob;
    }
  }

  // Normalize to account for truncation
  const total = homeWin + draw + awayWin;
  return {
    homeWin: homeWin / total,
    draw: draw / total,
    awayWin: awayWin / total,
  };
}

/**
 * Puck line: probability that the favorite wins by 2+ goals (covers -1.5).
 */
function computePuckLine(homeLambda: number, awayLambda: number) {
  let homeBy2Plus = 0;
  let awayBy2Plus = 0;
  let totalProb = 0;

  for (let h = 0; h <= 10; h++) {
    for (let a = 0; a <= 10; a++) {
      const prob = poissonProbability(h, homeLambda) * poissonProbability(a, awayLambda);
      totalProb += prob;
      if (h - a >= 2) homeBy2Plus += prob;
      if (a - h >= 2) awayBy2Plus += prob;
    }
  }

  const favorite = homeLambda >= awayLambda ? 'home' : 'away';
  const favoriteCover = favorite === 'home' ? homeBy2Plus / totalProb : awayBy2Plus / totalProb;
  const underdogCover = 1 - favoriteCover;

  return {
    favorite: favorite as 'home' | 'away',
    favorite_cover_prob: favoriteCover,
    underdog_cover_prob: underdogCover,
  };
}

/**
 * Compute total goals over/under for each line.
 */
function computeTotalGoals(homeLambda: number, awayLambda: number) {
  const totalLambda = homeLambda + awayLambda;

  return TOTAL_GOALS_LINES.map((line) => {
    // P(total > line) = 1 - P(total <= floor(line))
    const maxGoals = Math.floor(line);
    let underProb = 0;

    for (let h = 0; h <= maxGoals; h++) {
      for (let a = 0; a <= maxGoals - h; a++) {
        if (h + a <= maxGoals) {
          underProb += poissonProbability(h, homeLambda) * poissonProbability(a, awayLambda);
        }
      }
    }

    return {
      line,
      over_probability: 1 - underProb,
      under_probability: underProb,
    };
  });
}

/**
 * Both teams to score: P(home>=1) * P(away>=1)
 */
function computeBTTS(homeLambda: number, awayLambda: number): number {
  const homeScores = 1 - poissonProbability(0, homeLambda);
  const awayScores = 1 - poissonProbability(0, awayLambda);
  return homeScores * awayScores;
}

/**
 * Probability that a team wins the first period outright.
 */
function computeP1WinProb(p1HomeLambda: number, p1AwayLambda: number): number {
  let winProb = 0;
  for (let h = 0; h <= 5; h++) {
    for (let a = 0; a <= 5; a++) {
      if (h > a) {
        winProb += poissonProbability(h, p1HomeLambda) * poissonProbability(a, p1AwayLambda);
      }
    }
  }
  return winProb;
}

/**
 * Compute puck line for a specific handicap value (e.g., 1.5, 2.5).
 * Generalizes the original computePuckLine to support real bookmaker lines.
 * Returns the probability that the favorite/underdog covers the line.
 */
function computePuckLineForLine(
  homeLambda: number,
  awayLambda: number,
  lineValue: number
): { favorite: 'home' | 'away'; favorite_cover_prob: number; underdog_cover_prob: number } {
  let homeByLine = 0;
  let awayByLine = 0;
  let totalProb = 0;

  const threshold = Math.ceil(lineValue); // e.g., 1.5 -> must win by 2+, 2.5 -> must win by 3+

  for (let h = 0; h <= 10; h++) {
    for (let a = 0; a <= 10; a++) {
      const prob = poissonProbability(h, homeLambda) * poissonProbability(a, awayLambda);
      totalProb += prob;
      if (h - a >= threshold) homeByLine += prob;
      if (a - h >= threshold) awayByLine += prob;
    }
  }

  const favorite = homeLambda >= awayLambda ? 'home' : 'away';
  const favoriteCover = favorite === 'home' ? homeByLine / totalProb : awayByLine / totalProb;
  const underdogCover = 1 - favoriteCover;

  return {
    favorite: favorite as 'home' | 'away',
    favorite_cover_prob: favoriteCover,
    underdog_cover_prob: underdogCover,
  };
}

/**
 * Compute total goals over/under for a specific line.
 * Generalizes the original computeTotalGoals to support real bookmaker lines.
 */
function computeTotalGoalsForLine(
  homeLambda: number,
  awayLambda: number,
  line: number
): { over_probability: number; under_probability: number } {
  const maxGoals = Math.floor(line);
  let underProb = 0;

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals - h; a++) {
      if (h + a <= maxGoals) {
        underProb += poissonProbability(h, homeLambda) * poissonProbability(a, awayLambda);
      }
    }
  }

  return {
    over_probability: 1 - underProb,
    under_probability: underProb,
  };
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
 * Round to 2 decimal places
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ═══════════════════════════════════════════════════════════════════
// ODDS PARSING FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Parse the raw odds response from API-Hockey into structured data.
 *
 * API-Hockey (v1.hockey.api-sports.io) odds response structure:
 * response[].bookmakers[].bets[].values[]
 *
 * Market IDs:
 *   1 = 3Way Result (regulation: Home/Draw/Away)
 *   2 = Home/Away (moneyline including OT/SO)
 *   3 = Asian Handicap / Puck Line
 *   4 = Over/Under (total goals)
 *   5 = Both Teams To Score
 *   8 = Highest Scoring Half
 *   9 = Double Chance
 *
 * Each bet value has: { value: "Home", odd: "2.05" }
 */
function parseHockeyOddsResponse(rawOdds: any[]): ParsedHockeyOddsData | null {
  if (!rawOdds || rawOdds.length === 0) return null;

  // The response may contain multiple entries; take the first game entry
  const gameOdds = rawOdds[0];
  const bookmakers = gameOdds?.bookmakers;
  if (!bookmakers || bookmakers.length === 0) return null;

  // Use the first available bookmaker (usually the most reliable)
  const bookmaker = bookmakers[0];
  const bets: any[] = bookmaker?.bets || [];

  let moneyline1x2: ParsedHockeyOddsData['moneyline_1x2'] = null;
  let moneyline2way: ParsedHockeyOddsData['moneyline_2way'] = null;
  let puckLine: ParsedHockeyOddsData['puck_line'] = null;
  let total: ParsedHockeyOddsData['total'] = null;
  let btts: ParsedHockeyOddsData['btts'] = null;
  let doubleCh: ParsedHockeyOddsData['double_chance'] = null;
  const rawMarkets: ParsedHockeyOddsData['raw_markets'] = [];

  for (const bet of bets) {
    const marketId = bet.id;
    const marketName = bet.name || '';
    const values: any[] = bet.values || [];

    rawMarkets.push({ market_id: marketId, market_name: marketName, values });

    switch (marketId) {
      case 1: // 3Way Result (regulation)
        moneyline1x2 = parseHockey1X2(values);
        break;
      case 2: // Home/Away (including OT)
        moneyline2way = parseHockeyMoneyline(values);
        break;
      case 3: // Asian Handicap / Puck Line
        puckLine = parseHockeyPuckLine(values);
        break;
      case 4: // Over/Under (total goals)
        total = parseHockeyOverUnder(values);
        break;
      case 5: // Both Teams To Score
        btts = parseHockeyBTTS(values);
        break;
      case 9: // Double Chance
        doubleCh = parseHockeyDoubleChance(values);
        break;
    }
  }

  return {
    moneyline_1x2: moneyline1x2,
    moneyline_2way: moneyline2way,
    puck_line: puckLine,
    total,
    btts,
    double_chance: doubleCh,
    bookmaker: bookmaker?.name || null,
    raw_markets: rawMarkets,
  };
}

/**
 * Parse 3Way Result (ID:1) market values.
 * Values: [{ value: "Home", odd: "2.05" }, { value: "Draw", odd: "3.95" }, { value: "Away", odd: "2.85" }]
 */
function parseHockey1X2(values: any[]): ParsedHockeyOddsData['moneyline_1x2'] {
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

  if (homeOdds <= 0 && drawOdds <= 0 && awayOdds <= 0) return null;
  return { home_odds: homeOdds, draw_odds: drawOdds, away_odds: awayOdds };
}

/**
 * Parse Home/Away (ID:2) moneyline market values (including OT/SO).
 * Values: [{ value: "Home", odd: "1.67" }, { value: "Away", odd: "2.25" }]
 */
function parseHockeyMoneyline(values: any[]): ParsedHockeyOddsData['moneyline_2way'] {
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
 * Parse Asian Handicap / Puck Line (ID:3) market values.
 * Values: [{ value: "Home -1.5", odd: "2.60" }, { value: "Away -1.5", odd: "1.50" }]
 * The line value represents the puck line (e.g., -1.5, -2.5).
 */
function parseHockeyPuckLine(values: any[]): ParsedHockeyOddsData['puck_line'] {
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
      line = num; // Home puck line (e.g., -1.5 means home favored by 1.5)
      homeOdds = odd;
    } else if (lowerLabel.includes('away')) {
      awayOdds = odd;
      // If we haven't set the line from home, derive it from away
      if (line === 0) {
        line = -num; // Away -1.5 means home line is +1.5
      }
    }
  }

  if (line === 0 && homeOdds <= 0 && awayOdds <= 0) return null;
  return { line, home_odds: homeOdds, away_odds: awayOdds };
}

/**
 * Parse Over/Under (ID:4) total goals market values.
 * Values may contain multiple lines:
 *   [{ value: "Over 4.5", odd: "1.25" }, { value: "Under 4.5", odd: "3.45" },
 *    { value: "Over 7.5", odd: "3.00" }]
 * We select the primary line (first over/under pair with matching line values).
 */
function parseHockeyOverUnder(values: any[]): ParsedHockeyOddsData['total'] {
  // Group by line value to find complete pairs
  const lineMap: Map<number, { over_odds: number; under_odds: number }> = new Map();

  for (const v of values) {
    const label = String(v.value || '');
    const odd = parseFloat(v.odd);
    if (isNaN(odd)) continue;

    const numMatch = label.match(/(\d+\.?\d*)/);
    if (!numMatch) continue;

    const num = parseFloat(numMatch[1]);
    const lowerLabel = label.toLowerCase();

    if (!lineMap.has(num)) {
      lineMap.set(num, { over_odds: 0, under_odds: 0 });
    }
    const entry = lineMap.get(num)!;

    if (lowerLabel.includes('over')) {
      entry.over_odds = odd;
    } else if (lowerLabel.includes('under')) {
      entry.under_odds = odd;
    }
  }

  // Find the first complete pair (both over and under present)
  // Prefer lines in hockey-typical range (4.5-6.5)
  const preferredLines = [5.5, 4.5, 6.5, 3.5, 7.5];
  for (const preferred of preferredLines) {
    const entry = lineMap.get(preferred);
    if (entry && entry.over_odds > 0 && entry.under_odds > 0) {
      return { line: preferred, over_odds: entry.over_odds, under_odds: entry.under_odds };
    }
  }

  // Fall back to first complete pair
  for (const [line, entry] of lineMap.entries()) {
    if (entry.over_odds > 0 && entry.under_odds > 0) {
      return { line, over_odds: entry.over_odds, under_odds: entry.under_odds };
    }
  }

  // Fall back to first entry with any odds
  for (const [line, entry] of lineMap.entries()) {
    if (entry.over_odds > 0 || entry.under_odds > 0) {
      return { line, over_odds: entry.over_odds, under_odds: entry.under_odds };
    }
  }

  return null;
}

/**
 * Parse Both Teams To Score (ID:5) market values.
 * Values: [{ value: "Yes", odd: "1.05" }, { value: "No", odd: "8.00" }]
 */
function parseHockeyBTTS(values: any[]): ParsedHockeyOddsData['btts'] {
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

/**
 * Parse Double Chance (ID:9) market values.
 * Values: [{ value: "Home/Draw", odd: "1.33" }, { value: "Home/Away", odd: "1.20" }, { value: "Draw/Away", odd: "1.62" }]
 */
function parseHockeyDoubleChance(values: any[]): ParsedHockeyOddsData['double_chance'] {
  let homeDrawOdds = 0;
  let homeAwayOdds = 0;
  let drawAwayOdds = 0;

  for (const v of values) {
    const label = String(v.value || '').toLowerCase().trim();
    const odd = parseFloat(v.odd);
    if (isNaN(odd)) continue;

    if (label.includes('home') && label.includes('draw')) {
      homeDrawOdds = odd;
    } else if (label.includes('home') && label.includes('away')) {
      homeAwayOdds = odd;
    } else if (label.includes('draw') && label.includes('away')) {
      drawAwayOdds = odd;
    }
  }

  if (homeDrawOdds <= 0 && homeAwayOdds <= 0 && drawAwayOdds <= 0) return null;
  return { home_draw_odds: homeDrawOdds, home_away_odds: homeAwayOdds, draw_away_odds: drawAwayOdds };
}
