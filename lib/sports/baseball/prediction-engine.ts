
import {
  poissonProbability,
  generateExactScores,
  calculateTeamForm,
  calculateConfidenceTier,
  probabilityToOdds,
  createValueBet,
  oddsToImpliedProbability,
} from '@/lib/sports/base/prediction-utils';
import { SportTeamForm, ValueBet } from '@/lib/sports/base/types';
import { ApiBaseballService } from './api-baseball';

/**
 * Algorithm weights for the baseball prediction model.
 *
 * Baseball is a medium-scoring sport (MLB typical totals 8.5-9.0 runs).
 * Starting pitching is the single largest driver of outcomes — we allocate
 * more weight to pitcher strength than to team form alone. Park factors
 * materially shift totals (Coors Field vs Oracle Park); when venue data
 * is available we honor it. Home advantage in MLB is ~0.54 win rate,
 * smaller than football.
 */
const weights = {
  recent_form: 0.20,
  home_advantage: 0.08,
  runs_scored: 0.12,
  runs_allowed: 0.12,
  pitcher: 0.22,
  h2h: 0.06,
  park_factor: 0.08,
  bullpen: 0.08,
  standings: 0.04,
};

/**
 * League-specific average runs per game. MLB averages ~4.4-4.6 R/G per side.
 * NPB averages a touch lower (~4.0-4.3), KBO a touch higher (~4.7-5.0).
 * Used as a regression-to-mean anchor when sample sizes are small.
 */
const LEAGUE_RUN_AVERAGES: Record<number, { homeAvg: number; awayAvg: number; label: string }> = {
  // MLB
  1: { homeAvg: 4.55, awayAvg: 4.35, label: 'MLB' },
  // NPB (Nippon Professional Baseball)
  2: { homeAvg: 4.20, awayAvg: 4.00, label: 'NPB' },
  // KBO (Korea Baseball Organization)
  5: { homeAvg: 4.95, awayAvg: 4.65, label: 'KBO' },
  // CPBL (Taiwan)
  6: { homeAvg: 4.80, awayAvg: 4.55, label: 'CPBL' },
  // Cuban National Series
  12: { homeAvg: 4.70, awayAvg: 4.40, label: 'Cuban Serie Nacional' },
  // LMB (Mexican League)
  13: { homeAvg: 5.20, awayAvg: 4.85, label: 'LMB' },
  // MLB Postseason (lower scoring due to best pitchers)
  21: { homeAvg: 4.10, awayAvg: 3.85, label: 'MLB Postseason' },
};

/** Default expected runs when league data is missing */
const DEFAULT_HOME_EXPECTED = 4.55;
const DEFAULT_AWAY_EXPECTED = 4.35;

/** Over/Under bands for total runs markets */
const TOTAL_RUNS_LINES = [6.5, 7.5, 8.5, 9.5, 10.5, 11.5];

/**
 * Fraction of total runs scored in the first 5 innings (F5).
 * Empirical MLB data shows ~58% of runs fall in innings 1-5 (starters pitch
 * longer, bullpens burn late). We clamp the F5 expected runs off this factor.
 */
const F5_FACTOR = 0.58;

/**
 * Park factor classifications — used when venue metadata is available but we
 * have no hit/run context for the specific stadium. Defaults to neutral.
 *
 * These labels are intentionally not specific to a single vendor; any upstream
 * park factor feed can map into the `hitter_friendly` / `pitcher_friendly`
 * buckets without changing the consumer code.
 */
type ParkProfile = 'hitter_friendly' | 'neutral' | 'pitcher_friendly';

const PARK_MULTIPLIER: Record<ParkProfile, number> = {
  hitter_friendly: 1.08,
  neutral: 1.0,
  pitcher_friendly: 0.93,
};

/**
 * Parsed odds data from API-Baseball odds endpoint.
 * Market IDs (API-Sports baseball commonly uses):
 *   1 = Home/Away (moneyline) — there is no draw in baseball
 *   2 = Run Line (handicap, usually ±1.5)
 *   3 = Over/Under (total runs)
 *   4 = Both Teams To Score (rare for baseball but occasionally surfaced)
 *   5 = First 5 Innings Winner
 *   6 = First 5 Innings Over/Under
 */
interface ParsedBaseballOddsData {
  moneyline: { home_odds: number; away_odds: number } | null;
  run_line: { line: number; home_odds: number; away_odds: number } | null;
  total: { line: number; over_odds: number; under_odds: number } | null;
  f5_moneyline: { home_odds: number; away_odds: number; draw_odds?: number } | null;
  f5_total: { line: number; over_odds: number; under_odds: number } | null;
  bookmaker: string | null;
  raw_markets: Array<{ market_id: number; market_name: string; values: any[] }>;
}

interface BaseballValueBetEntry {
  market: string;
  selection: string;
  model_probability: number;
  implied_probability: number;
  edge: number;
  bookmaker_odds: number;
  fair_odds: number;
  is_value: boolean;
}

interface BaseballAnalysisFactors {
  home_form: SportTeamForm;
  away_form: SportTeamForm;
  home_expected_runs: number;
  away_expected_runs: number;
  home_runs_allowed_avg: number;
  away_runs_allowed_avg: number;
  home_advantage_factor: number;
  pitcher_factor: number;
  bullpen_factor: number;
  h2h_factor: number;
  standings_factor: number;
  park_profile: ParkProfile;
  park_multiplier: number;
}

/**
 * BaseballPredictionEngine
 *
 * Generates comprehensive baseball game predictions using:
 * - Poisson-style distribution over runs for each side (independently).
 * - Team form from last 10 league games (win %, runs scored/allowed).
 * - Head-to-head (last 5-10 meetings).
 * - Pitcher strength (ERA / WHIP / recent form) when available in the game
 *   payload — otherwise falls back to team offensive / defensive aggregates.
 * - Park factors when venue metadata is present.
 * - Real bookmaker odds from API-Baseball `/odds` for value-bet detection.
 *
 * Markets produced:
 *   BS_HOME_ML, BS_AWAY_ML
 *   BS_RUNLINE_HOME_MINUS_15, BS_RUNLINE_AWAY_PLUS_15
 *   BS_OVER_65 .. BS_OVER_115, BS_UNDER_65 .. BS_UNDER_115
 *   (market codes match lib/tracking/market-taxonomy.ts)
 *
 * Plus bonus outputs: First 5 innings winner/totals, exact score candidates.
 */
export class BaseballPredictionEngine {
  /**
   * Main entry point: generate a full prediction for a given game.
   *
   * @param gameId - API-Sports baseball game ID
   * @param client - ApiBaseballService for real API calls
   */
  static async generatePrediction(gameId: number, client: ApiBaseballService) {
    // ── Fetch core game data ─────────────────────────────────────
    const game = await client.getGameById(gameId);
    if (!game) {
      throw new Error(`Beyzbol maçı bulunamadı: ${gameId}`);
    }

    const homeTeam = game.teams.home;
    const awayTeam = game.teams.away;
    const leagueId = game.league?.id;
    const season = client.getCurrentSeason();

    // ── Parallel fetch: H2H, standings, team stats, league games, odds ──
    const [h2hGames, standings, homeStats, awayStats, leagueGames, rawOddsData] = await Promise.all([
      client.getH2H(homeTeam.id, awayTeam.id).catch(() => [] as any[]),
      leagueId ? client.getStandings(leagueId, season).catch(() => [] as any[]) : Promise.resolve([]),
      leagueId ? client.getTeamStatistics({ league: leagueId, season, team: homeTeam.id }).catch(() => [] as any[]) : Promise.resolve([]),
      leagueId ? client.getTeamStatistics({ league: leagueId, season, team: awayTeam.id }).catch(() => [] as any[]) : Promise.resolve([]),
      leagueId ? client.getGamesByLeague(leagueId, season).catch(() => [] as any[]) : Promise.resolve([]),
      client.getOdds({ game: gameId }).catch(() => [] as any[]),
    ]);

    // ── Parse real bookmaker odds ────────────────────────────────
    const parsedOdds = parseBaseballOddsResponse(rawOddsData);

    // ── Recent team form (last 10 finished league games) ────────
    const recentHomeGames = extractRecentGames(leagueGames, homeTeam.id, gameId);
    const recentAwayGames = extractRecentGames(leagueGames, awayTeam.id, gameId);
    const homeForm = calculateTeamForm(recentHomeGames, homeTeam.id);
    const awayForm = calculateTeamForm(recentAwayGames, awayTeam.id);

    // ── Runs scored / runs allowed averages ──────────────────────
    const homeStat = homeStats[0] || {};
    const awayStat = awayStats[0] || {};

    const homeRunsFor = extractRunsPerGame(homeStat, 'for', homeForm, true);
    const homeRunsAllowed = extractRunsPerGame(homeStat, 'against', homeForm, false);
    const awayRunsFor = extractRunsPerGame(awayStat, 'for', awayForm, true);
    const awayRunsAllowed = extractRunsPerGame(awayStat, 'against', awayForm, false);

    // ── Expected runs via Poisson lambdas ────────────────────────
    const leagueAvgs = LEAGUE_RUN_AVERAGES[leagueId || 0] || { homeAvg: DEFAULT_HOME_EXPECTED, awayAvg: DEFAULT_AWAY_EXPECTED };

    // Bayesian-style blend: team attack × opponent defense × league mean
    const homeAttackStrength = homeRunsFor / leagueAvgs.homeAvg;
    const awayDefenseWeakness = awayRunsAllowed / leagueAvgs.homeAvg;
    const awayAttackStrength = awayRunsFor / leagueAvgs.awayAvg;
    const homeDefenseWeakness = homeRunsAllowed / leagueAvgs.awayAvg;

    let homeExpected = leagueAvgs.homeAvg * homeAttackStrength * awayDefenseWeakness;
    let awayExpected = leagueAvgs.awayAvg * awayAttackStrength * homeDefenseWeakness;

    // 30% regression to league average — protects against small-sample noise
    homeExpected = homeExpected * 0.70 + leagueAvgs.homeAvg * 0.30;
    awayExpected = awayExpected * 0.70 + leagueAvgs.awayAvg * 0.30;

    // ── Analysis factors ─────────────────────────────────────────
    const homeAdvantageFactor = computeHomeAdvantageFactor(homeForm);
    const pitcherFactor = computePitcherFactor(game, homeStat, awayStat);
    const bullpenFactor = computeBullpenFactor(homeStat, awayStat);
    const h2hFactor = computeH2HFactor(h2hGames, homeTeam.id, awayTeam.id);
    const standingsFactor = computeStandingsFactor(standings, homeTeam.id, awayTeam.id);
    const { profile: parkProfile, multiplier: parkMultiplier } = computeParkProfile(game);

    // ── Adjust expected runs using weighted factors ──────────────
    const homeAdjustment =
      homeAdvantageFactor * weights.home_advantage +
      homeForm.form_score * weights.recent_form +
      pitcherFactor * weights.pitcher +
      bullpenFactor * weights.bullpen +
      h2hFactor * weights.h2h +
      standingsFactor * weights.standings;

    const awayAdjustment =
      (1 - homeAdvantageFactor) * weights.home_advantage +
      awayForm.form_score * weights.recent_form +
      (1 - pitcherFactor) * weights.pitcher +
      (1 - bullpenFactor) * weights.bullpen +
      (1 - h2hFactor) * weights.h2h +
      (1 - standingsFactor) * weights.standings;

    // Symmetric multiplier around 1.0
    const homeMultiplier = 0.75 + homeAdjustment * 0.5;
    const awayMultiplier = 0.75 + awayAdjustment * 0.5;

    homeExpected *= homeMultiplier;
    awayExpected *= awayMultiplier;

    // Park factor affects both sides equally (stadium plays the same for both teams)
    homeExpected *= parkMultiplier;
    awayExpected *= parkMultiplier;

    // Sanity bounds: baseball scores rarely go below 1.5 or above 9.5 avg
    homeExpected = Math.max(1.5, Math.min(9.5, homeExpected));
    awayExpected = Math.max(1.3, Math.min(9.0, awayExpected));

    const factors: BaseballAnalysisFactors = {
      home_form: homeForm,
      away_form: awayForm,
      home_expected_runs: round2(homeExpected),
      away_expected_runs: round2(awayExpected),
      home_runs_allowed_avg: round2(homeRunsAllowed),
      away_runs_allowed_avg: round2(awayRunsAllowed),
      home_advantage_factor: round3(homeAdvantageFactor),
      pitcher_factor: round3(pitcherFactor),
      bullpen_factor: round3(bullpenFactor),
      h2h_factor: round3(h2hFactor),
      standings_factor: round3(standingsFactor),
      park_profile: parkProfile,
      park_multiplier: round3(parkMultiplier),
    };

    // ── Match winner (2-way moneyline: no draws in baseball) ─────
    const { homeWin, awayWin } = compute2WayMoneyline(homeExpected, awayExpected);

    // ── Run line ±1.5 (real bookmaker line if available, default ±1.5) ──
    const realRunLine = parsedOdds?.run_line?.line ?? null;
    const primaryRunLineValue = realRunLine !== null ? Math.abs(realRunLine) : 1.5;
    const runLine = computeRunLineForLine(homeExpected, awayExpected, primaryRunLineValue);

    // Build run-line entries for both favorite side (real or model anchor) and
    // always include ±1.5 explicitly (since BS_RUNLINE_*_15 is the canonical code).
    const runLineEntries: Array<{
      line: number;
      favorite: 'home' | 'away';
      favorite_cover_prob: number;
      underdog_cover_prob: number;
      bookmaker_home_odds?: number;
      bookmaker_away_odds?: number;
      source: 'api_odds' | 'model';
    }> = [];

    runLineEntries.push({
      line: primaryRunLineValue,
      favorite: runLine.favorite,
      favorite_cover_prob: runLine.favorite_cover_prob,
      underdog_cover_prob: runLine.underdog_cover_prob,
      ...(realRunLine !== null && parsedOdds?.run_line ? {
        bookmaker_home_odds: parsedOdds.run_line.home_odds,
        bookmaker_away_odds: parsedOdds.run_line.away_odds,
      } : {}),
      source: realRunLine !== null ? 'api_odds' : 'model',
    });

    if (primaryRunLineValue !== 1.5) {
      // Always expose the canonical ±1.5 line too (matches BS_RUNLINE_*_15)
      const canonical = computeRunLineForLine(homeExpected, awayExpected, 1.5);
      runLineEntries.push({
        line: 1.5,
        favorite: canonical.favorite,
        favorite_cover_prob: canonical.favorite_cover_prob,
        underdog_cover_prob: canonical.underdog_cover_prob,
        source: 'model',
      });
    }

    // ── Totals over/under ─────────────────────────────────────────
    const realTotalLine = parsedOdds?.total?.line ?? null;
    const totalLinesSet = new Set<number>();
    if (realTotalLine !== null) totalLinesSet.add(realTotalLine);
    for (const line of TOTAL_RUNS_LINES) totalLinesSet.add(line);

    const totalRunsLines = Array.from(totalLinesSet)
      .filter(l => l >= 4.5 && l <= 14.5)
      .sort((a, b) => a - b);

    const totalRunsMarkets = totalRunsLines.map((line) => {
      const raw = computeTotalForLine(homeExpected, awayExpected, line);
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

    // ── First 5 innings (F5) ─────────────────────────────────────
    const f5HomeExp = homeExpected * F5_FACTOR;
    const f5AwayExp = awayExpected * F5_FACTOR;
    const { homeWin: f5HomeWin, draw: f5Draw, awayWin: f5AwayWin } = compute3WayF5(f5HomeExp, f5AwayExp);

    const f5TotalLine = parsedOdds?.f5_total?.line ?? 4.5;
    const f5Total = computeTotalForLine(f5HomeExp, f5AwayExp, f5TotalLine);

    // ── Exact score candidates (Poisson grid) ────────────────────
    const exactScores = generateExactScores(homeExpected, awayExpected, 12, 0.003);

    // ── Shutout probabilities ────────────────────────────────────
    const homeShutout = poissonProbability(0, awayExpected); // Away team scores 0
    const awayShutout = poissonProbability(0, homeExpected); // Home team scores 0

    // ── Overall confidence ───────────────────────────────────────
    const dataQuality = Math.min(1, (recentHomeGames.length + recentAwayGames.length) / 16);
    const formStrength = Math.max(Math.abs(homeForm.form_score - 0.5), Math.abs(awayForm.form_score - 0.5));
    const predictionSpread = Math.max(homeWin, awayWin) - Math.min(homeWin, awayWin);

    const confidenceScore = Math.round(
      (dataQuality * 30 + formStrength * 40 + predictionSpread * 80 + (h2hGames.length > 0 ? 10 : 0)) * 0.85,
    );
    const clampedConfidence = Math.max(20, Math.min(95, confidenceScore));
    const confidenceTier = calculateConfidenceTier(clampedConfidence);

    // ── Value bet detection vs bookmaker implied probabilities ───
    const VALUE_EDGE_THRESHOLD = 5.0;
    const apiValueBets: BaseballValueBetEntry[] = [];

    if (parsedOdds) {
      // Moneyline
      if (parsedOdds.moneyline) {
        const homeImplied = oddsToImpliedProbability(parsedOdds.moneyline.home_odds) * 100;
        const awayImplied = oddsToImpliedProbability(parsedOdds.moneyline.away_odds) * 100;

        apiValueBets.push({
          market: 'moneyline',
          selection: 'home',
          model_probability: round2(homeWin * 100),
          implied_probability: round2(homeImplied),
          edge: round2(homeWin * 100 - homeImplied),
          bookmaker_odds: parsedOdds.moneyline.home_odds,
          fair_odds: probabilityToOdds(homeWin),
          is_value: homeWin * 100 - homeImplied > VALUE_EDGE_THRESHOLD,
        });
        apiValueBets.push({
          market: 'moneyline',
          selection: 'away',
          model_probability: round2(awayWin * 100),
          implied_probability: round2(awayImplied),
          edge: round2(awayWin * 100 - awayImplied),
          bookmaker_odds: parsedOdds.moneyline.away_odds,
          fair_odds: probabilityToOdds(awayWin),
          is_value: awayWin * 100 - awayImplied > VALUE_EDGE_THRESHOLD,
        });
      }

      // Run line
      if (parsedOdds.run_line) {
        const absLine = Math.abs(parsedOdds.run_line.line);
        const rlModel = computeRunLineForLine(homeExpected, awayExpected, absLine);
        const homeSpreadImplied = oddsToImpliedProbability(parsedOdds.run_line.home_odds) * 100;
        const awaySpreadImplied = oddsToImpliedProbability(parsedOdds.run_line.away_odds) * 100;

        const homeProb = rlModel.favorite === 'home' ? rlModel.favorite_cover_prob : rlModel.underdog_cover_prob;
        const awayProb = rlModel.favorite === 'away' ? rlModel.favorite_cover_prob : rlModel.underdog_cover_prob;

        apiValueBets.push({
          market: 'run_line',
          selection: `home_${parsedOdds.run_line.line}`,
          model_probability: round2(homeProb * 100),
          implied_probability: round2(homeSpreadImplied),
          edge: round2(homeProb * 100 - homeSpreadImplied),
          bookmaker_odds: parsedOdds.run_line.home_odds,
          fair_odds: probabilityToOdds(homeProb),
          is_value: homeProb * 100 - homeSpreadImplied > VALUE_EDGE_THRESHOLD,
        });
        apiValueBets.push({
          market: 'run_line',
          selection: `away_${-parsedOdds.run_line.line}`,
          model_probability: round2(awayProb * 100),
          implied_probability: round2(awaySpreadImplied),
          edge: round2(awayProb * 100 - awaySpreadImplied),
          bookmaker_odds: parsedOdds.run_line.away_odds,
          fair_odds: probabilityToOdds(awayProb),
          is_value: awayProb * 100 - awaySpreadImplied > VALUE_EDGE_THRESHOLD,
        });
      }

      // Totals on the real line
      if (parsedOdds.total) {
        const realTotLine = parsedOdds.total.line;
        const modelTotal = computeTotalForLine(homeExpected, awayExpected, realTotLine);
        const overImplied = oddsToImpliedProbability(parsedOdds.total.over_odds) * 100;
        const underImplied = oddsToImpliedProbability(parsedOdds.total.under_odds) * 100;

        apiValueBets.push({
          market: 'total',
          selection: `over_${realTotLine}`,
          model_probability: round2(modelTotal.over_probability * 100),
          implied_probability: round2(overImplied),
          edge: round2(modelTotal.over_probability * 100 - overImplied),
          bookmaker_odds: parsedOdds.total.over_odds,
          fair_odds: probabilityToOdds(modelTotal.over_probability),
          is_value: modelTotal.over_probability * 100 - overImplied > VALUE_EDGE_THRESHOLD,
        });
        apiValueBets.push({
          market: 'total',
          selection: `under_${realTotLine}`,
          model_probability: round2(modelTotal.under_probability * 100),
          implied_probability: round2(underImplied),
          edge: round2(modelTotal.under_probability * 100 - underImplied),
          bookmaker_odds: parsedOdds.total.under_odds,
          fair_odds: probabilityToOdds(modelTotal.under_probability),
          is_value: modelTotal.under_probability * 100 - underImplied > VALUE_EDGE_THRESHOLD,
        });
      }
    }

    // ── Build Turkish human-readable bet recommendations ─────────
    const leagueName = game.league?.name || 'Beyzbol';
    const gameDate = game.date || new Date().toISOString().split('T')[0];

    const highConfidenceBets: any[] = [];
    const mediumRiskBets: any[] = [];
    const highRiskBets: any[] = [];

    // Match Winner (Maç Kazananı)
    const mlWinner = homeWin > awayWin ? homeTeam.name : awayTeam.name;
    const mlProb = Math.max(homeWin, awayWin);
    const mlMarket = homeWin > awayWin ? 'BS_HOME_ML' : 'BS_AWAY_ML';

    const mlValueBet = apiValueBets.find(vb =>
      vb.market === 'moneyline' && vb.selection === (homeWin > awayWin ? 'home' : 'away') && vb.is_value,
    );

    if (mlProb >= 0.60) {
      const valueNote = mlValueBet
        ? ` DEGER BAHIS: Model %${mlValueBet.model_probability.toFixed(1)} vs bahis sirketi %${mlValueBet.implied_probability.toFixed(1)} (avantaj: %${mlValueBet.edge.toFixed(1)})`
        : '';
      highConfidenceBets.push({
        title: 'Mac Kazanani',
        description: `${mlWinner} kazanir${valueNote}`,
        confidence: Math.round(mlProb * 100),
        reason: `Beklenen kosu farki: ${(homeExpected - awayExpected).toFixed(2)} — form ve pitcher avantaji ${mlWinner} tarafinda`,
        recommendation: `${mlWinner} Mac Kazanani`,
        market: mlMarket,
        selection: mlWinner,
        estimated_odds: probabilityToOdds(mlProb),
      });
    } else if (mlProb >= 0.52) {
      mediumRiskBets.push({
        title: 'Mac Kazanani',
        description: `${mlWinner} kazanir`,
        confidence: Math.round(mlProb * 100),
        reason: `Istatistiksel avantaj ${mlWinner} tarafinda`,
        recommendation: `${mlWinner} Mac Kazanani`,
      });
    }

    // Run Line (Koşu Çizgisi) ±1.5
    const runLineSource = realRunLine !== null ? ' (bahis sirketi cizgisi)' : '';
    const rlValueBet = apiValueBets.find(vb => vb.market === 'run_line' && vb.is_value);

    if (runLine.favorite_cover_prob >= 0.45) {
      const rlFav = runLine.favorite === 'home' ? homeTeam.name : awayTeam.name;
      const valueNote = rlValueBet && rlValueBet.selection.startsWith(runLine.favorite === 'home' ? 'home' : 'away')
        ? ` DEGER BAHIS: Model %${rlValueBet.model_probability.toFixed(1)} vs bahis sirketi %${rlValueBet.implied_probability.toFixed(1)} (avantaj: %${rlValueBet.edge.toFixed(1)})`
        : '';
      mediumRiskBets.push({
        title: `Kosu Cizgisi -${primaryRunLineValue}${runLineSource}`,
        description: `${rlFav} handikap -${primaryRunLineValue} (en az ${Math.ceil(primaryRunLineValue)} kosu farkla kazanir)${valueNote}`,
        confidence: Math.round(runLine.favorite_cover_prob * 100),
        reason: `${rlFav} offansif avantaji handikabi kapatmaya yeter`,
        recommendation: `${rlFav} -${primaryRunLineValue} Kosu Cizgisi`,
      });
    }

    if (runLine.underdog_cover_prob >= 0.58) {
      const rlUnd = runLine.favorite === 'home' ? awayTeam.name : homeTeam.name;
      const underdogMarket = runLine.favorite === 'home' ? 'BS_RUNLINE_AWAY_PLUS_15' : 'BS_RUNLINE_HOME_MINUS_15';
      const valueNote = rlValueBet && rlValueBet.selection.startsWith(runLine.favorite === 'home' ? 'away' : 'home')
        ? ` DEGER BAHIS: Model %${rlValueBet.model_probability.toFixed(1)} vs bahis sirketi %${rlValueBet.implied_probability.toFixed(1)} (avantaj: %${rlValueBet.edge.toFixed(1)})`
        : '';
      highConfidenceBets.push({
        title: `Kosu Cizgisi +${primaryRunLineValue}${runLineSource}`,
        description: `${rlUnd} handikap +${primaryRunLineValue} (en fazla ${Math.ceil(primaryRunLineValue) - 1} kosu farkla kaybeder)${valueNote}`,
        confidence: Math.round(runLine.underdog_cover_prob * 100),
        reason: `${rlUnd} yakin macda buyuk farkli maglubiyet beklenmez`,
        recommendation: `${rlUnd} +${primaryRunLineValue} Kosu Cizgisi`,
        market: underdogMarket,
        selection: `${rlUnd} +${primaryRunLineValue}`,
        estimated_odds: probabilityToOdds(runLine.underdog_cover_prob),
      });
    }

    // Total Runs (Üst/Alt Koşu)
    for (const market of totalRunsMarkets) {
      const overProb = market.over_probability;
      const underProb = market.under_probability;
      const line = market.line;
      const lineSource = market.source === 'api_odds' ? ' (bahis sirketi cizgisi)' : '';
      const lineCode = Math.round(line * 10); // e.g. 75 for 7.5 → matches BS_OVER_75

      const overValueBet = apiValueBets.find(vb => vb.market === 'total' && vb.selection === `over_${line}` && vb.is_value);
      const underValueBet = apiValueBets.find(vb => vb.market === 'total' && vb.selection === `under_${line}` && vb.is_value);

      if (overProb >= 0.60 && line >= 6.5 && line <= 11.5) {
        const bucket = overProb >= 0.68 ? highConfidenceBets : mediumRiskBets;
        const valueNote = overValueBet
          ? ` DEGER BAHIS: Model %${overValueBet.model_probability.toFixed(1)} vs bahis sirketi %${overValueBet.implied_probability.toFixed(1)} (avantaj: %${overValueBet.edge.toFixed(1)})`
          : '';
        bucket.push({
          title: `Ust ${line} Kosu${lineSource}`,
          description: `Macta ${line} ustunde toplam kosu atilir${valueNote}`,
          confidence: Math.round(overProb * 100),
          reason: `Beklenen toplam kosu: ${(homeExpected + awayExpected).toFixed(2)} — park: ${parkProfile}`,
          recommendation: `Ust ${line} Kosu`,
          ...(overProb >= 0.68
            ? { market: `BS_OVER_${lineCode}`, selection: `Ust ${line}`, estimated_odds: probabilityToOdds(overProb) }
            : {}),
        });
      }

      if (underProb >= 0.60 && line >= 6.5 && line <= 11.5) {
        const bucket = underProb >= 0.68 ? highConfidenceBets : mediumRiskBets;
        const valueNote = underValueBet
          ? ` DEGER BAHIS: Model %${underValueBet.model_probability.toFixed(1)} vs bahis sirketi %${underValueBet.implied_probability.toFixed(1)} (avantaj: %${underValueBet.edge.toFixed(1)})`
          : '';
        bucket.push({
          title: `Alt ${line} Kosu${lineSource}`,
          description: `Macta ${line} altinda toplam kosu atilir${valueNote}`,
          confidence: Math.round(underProb * 100),
          reason: `Beklenen toplam kosu: ${(homeExpected + awayExpected).toFixed(2)} — park: ${parkProfile}`,
          recommendation: `Alt ${line} Kosu`,
          ...(underProb >= 0.68
            ? { market: `BS_UNDER_${lineCode}`, selection: `Alt ${line}`, estimated_odds: probabilityToOdds(underProb) }
            : {}),
        });
      }
    }

    // First 5 Innings (İlk 5 Devre)
    const f5MaxWinner = Math.max(f5HomeWin, f5AwayWin);
    const f5Winner = f5HomeWin >= f5AwayWin ? homeTeam.name : awayTeam.name;
    if (f5MaxWinner >= 0.45) {
      mediumRiskBets.push({
        title: 'Ilk 5 Devre Kazanani',
        description: `${f5Winner} ilk 5 devreyi onde kapatir`,
        confidence: Math.round(f5MaxWinner * 100),
        reason: `Baslangic pitcher'lari ve ilk vuruscular ${f5Winner} lehine`,
        recommendation: `Ilk 5 Devre: ${f5Winner}`,
      });
    }
    if (f5Total.over_probability >= 0.58) {
      mediumRiskBets.push({
        title: `Ilk 5 Devre Ust ${f5TotalLine} Kosu`,
        description: `Ilk 5 devrede ${f5TotalLine} ustunde kosu atilir`,
        confidence: Math.round(f5Total.over_probability * 100),
        reason: `Ilk 5 beklenen kosu: ${(f5HomeExp + f5AwayExp).toFixed(2)}`,
        recommendation: `Ilk 5 Devre Ust ${f5TotalLine}`,
      });
    }

    // Exact score candidates (high risk)
    const topExactScores = exactScores.slice(0, 5);
    for (const es of topExactScores) {
      if (es.odds >= 10.0 && es.probability >= 1.2) {
        highRiskBets.push({
          title: `Skor Tahmini: ${es.score}`,
          description: `Macin ${es.score} bitmesi bekleniyor`,
          confidence: Math.round(es.probability),
          reason: `Poisson dagilimina gore olasi skorlardan biri (%${es.probability.toFixed(1)})`,
          recommendation: `Skor: ${es.score} @ ${es.odds.toFixed(2)}`,
        });
      }
    }

    // Shutout (high risk)
    if (homeShutout >= 0.10) {
      highRiskBets.push({
        title: `${homeTeam.name} Shutout`,
        description: `${homeTeam.name} pitcher'lari gol vermez (rakibe 0 kosu)`,
        confidence: Math.round(homeShutout * 100),
        reason: `Rakip beklenen kosu: ${awayExpected.toFixed(2)} — shutout olasi`,
        recommendation: `${homeTeam.name} Shutout @ ${probabilityToOdds(homeShutout).toFixed(2)}`,
      });
    }
    if (awayShutout >= 0.08) {
      highRiskBets.push({
        title: `${awayTeam.name} Shutout`,
        description: `${awayTeam.name} pitcher'lari gol vermez (rakibe 0 kosu)`,
        confidence: Math.round(awayShutout * 100),
        reason: `Rakip beklenen kosu: ${homeExpected.toFixed(2)} — shutout olasi`,
        recommendation: `${awayTeam.name} Shutout @ ${probabilityToOdds(awayShutout).toFixed(2)}`,
      });
    }

    // ── Legacy value bets (createValueBet format for cross-sport scanner) ──
    const valueBets: ValueBet[] = [];
    for (const bet of highConfidenceBets) {
      if (bet.market && bet.estimated_odds) {
        const matchingApiVb = apiValueBets.find(vb =>
          vb.is_value && (
            (bet.market === 'BS_HOME_ML' && vb.market === 'moneyline' && vb.selection === 'home') ||
            (bet.market === 'BS_AWAY_ML' && vb.market === 'moneyline' && vb.selection === 'away') ||
            (bet.market === 'BS_RUNLINE_HOME_MINUS_15' && vb.market === 'run_line' && vb.selection.startsWith('home')) ||
            (bet.market === 'BS_RUNLINE_AWAY_PLUS_15' && vb.market === 'run_line' && vb.selection.startsWith('away')) ||
            (bet.market?.startsWith('BS_OVER') && vb.market === 'total' && vb.selection.startsWith('over')) ||
            (bet.market?.startsWith('BS_UNDER') && vb.market === 'total' && vb.selection.startsWith('under'))
          ),
        );

        const effectiveOdds = matchingApiVb ? matchingApiVb.bookmaker_odds : bet.estimated_odds * 1.08;

        const vb = createValueBet({
          sport: 'baseball',
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

    // ── Assemble final prediction payload ────────────────────────
    return {
      sport: 'baseball' as const,
      game_id: gameId,
      game_info: {
        home_team: homeTeam,
        away_team: awayTeam,
        league: game.league,
        date: gameDate,
        status: game.status,
      },
      match_result: {
        home_win: {
          probability: round4(homeWin),
          odds: probabilityToOdds(homeWin),
          ...(parsedOdds?.moneyline ? { bookmaker_odds: parsedOdds.moneyline.home_odds } : {}),
        },
        away_win: {
          probability: round4(awayWin),
          odds: probabilityToOdds(awayWin),
          ...(parsedOdds?.moneyline ? { bookmaker_odds: parsedOdds.moneyline.away_odds } : {}),
        },
        confidence: Math.round(Math.max(homeWin, awayWin) * 100),
      },
      run_line: runLineEntries.map((entry) => ({
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
      total_runs: totalRunsMarkets.map((m) => ({
        line: m.line,
        over: { probability: round4(m.over_probability), odds: probabilityToOdds(m.over_probability) },
        under: { probability: round4(m.under_probability), odds: probabilityToOdds(m.under_probability) },
        ...('bookmaker_over_odds' in m ? { bookmaker_over_odds: m.bookmaker_over_odds } : {}),
        ...('bookmaker_under_odds' in m ? { bookmaker_under_odds: m.bookmaker_under_odds } : {}),
        source: m.source,
      })),
      first_five_innings: {
        expected_home_runs: round2(f5HomeExp),
        expected_away_runs: round2(f5AwayExp),
        home_win: { probability: round4(f5HomeWin), odds: probabilityToOdds(f5HomeWin) },
        draw: { probability: round4(f5Draw), odds: probabilityToOdds(f5Draw) },
        away_win: { probability: round4(f5AwayWin), odds: probabilityToOdds(f5AwayWin) },
        total: {
          line: f5TotalLine,
          over: { probability: round4(f5Total.over_probability), odds: probabilityToOdds(f5Total.over_probability) },
          under: { probability: round4(f5Total.under_probability), odds: probabilityToOdds(f5Total.under_probability) },
        },
      },
      exact_scores: exactScores.slice(0, 10),
      shutout: {
        home_shutout: { probability: round4(homeShutout), odds: probabilityToOdds(homeShutout) },
        away_shutout: { probability: round4(awayShutout), odds: probabilityToOdds(awayShutout) },
      },
      expected_runs: {
        home: factors.home_expected_runs,
        away: factors.away_expected_runs,
        total: round2(homeExpected + awayExpected),
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
        home_advantage: weights.home_advantage,
        runs_scored: weights.runs_scored,
        runs_allowed: weights.runs_allowed,
        pitcher: weights.pitcher,
        h2h: weights.h2h,
        park_factor: weights.park_factor,
        bullpen: weights.bullpen,
        standings: weights.standings,
      },
      detailed_factors: factors,
      risk_analysis: {
        data_quality: Math.round(dataQuality * 100),
        form_divergence: Math.round(Math.abs(homeForm.form_score - awayForm.form_score) * 100),
        h2h_sample_size: h2hGames.length,
        home_games_analyzed: recentHomeGames.length,
        away_games_analyzed: recentAwayGames.length,
        park_profile: parkProfile,
      },
      generated_at: new Date().toISOString(),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Pull the last ~10 finished games for a team out of the league schedule.
 */
function extractRecentGames(
  leagueGames: any[],
  teamId: number,
  excludeGameId: number,
): Array<{ homeTeamId: number; awayTeamId: number; homeScore: number | null; awayScore: number | null }> {
  return leagueGames
    .filter((g: any) =>
      (g.teams?.home?.id === teamId || g.teams?.away?.id === teamId) &&
      g.scores?.home?.total != null &&
      g.scores?.away?.total != null &&
      g.id !== excludeGameId,
    )
    .sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0))
    .slice(-10)
    .map((g: any) => ({
      homeTeamId: g.teams.home.id,
      awayTeamId: g.teams.away.id,
      homeScore: g.scores.home.total,
      awayScore: g.scores.away.total,
    }));
}

/**
 * Extract runs-per-game from the API-Baseball team stats payload.
 * API returns goals.for / goals.against over games.played — we treat
 * "goals" as runs in the baseball context (API reuses the schema).
 * Falls back to recent-form aggregates, then league default.
 */
function extractRunsPerGame(
  stat: any,
  direction: 'for' | 'against',
  form: SportTeamForm,
  isFor: boolean,
): number {
  // Primary: API-Sports standard stats schema
  if (stat?.games?.played?.all && stat?.goals) {
    const played = stat.games.played.all;
    if (direction === 'for' && stat.goals.for?.total?.all != null) {
      return stat.goals.for.total.all / played;
    }
    if (direction === 'against' && stat.goals.against?.total?.all != null) {
      return stat.goals.against.total.all / played;
    }
  }

  // Secondary: some baseball endpoints expose runs directly
  if (stat?.games?.played?.all && stat?.runs) {
    const played = stat.games.played.all;
    if (direction === 'for' && stat.runs.for?.total?.all != null) {
      return stat.runs.for.total.all / played;
    }
    if (direction === 'against' && stat.runs.against?.total?.all != null) {
      return stat.runs.against.total.all / played;
    }
  }

  // Tertiary: derive from form
  if (form.recent_matches > 0) {
    return isFor
      ? form.points_for / form.recent_matches
      : form.points_against / form.recent_matches;
  }

  return isFor ? DEFAULT_HOME_EXPECTED : DEFAULT_AWAY_EXPECTED;
}

/**
 * Home field advantage factor. MLB home teams win ~54% historically.
 * Factor returns 0.5 neutral, up to 0.65 for strong home-field teams.
 */
function computeHomeAdvantageFactor(homeForm: SportTeamForm): number {
  const baseHomeAdvantage = 0.54;
  const homeFormWeight = homeForm.home_form_score || 0.5;
  return Math.max(0.38, Math.min(0.68, baseHomeAdvantage * 0.5 + homeFormWeight * 0.5));
}

/**
 * Pitcher strength comparison. Baseball's single most predictive factor.
 * When the game payload contains starting pitcher data, use ERA / WHIP /
 * recent form. Otherwise fall back to team runs-allowed averages as a
 * coarse pitching-staff proxy.
 *
 * Returns 0.5 neutral, >0.5 when home pitcher is stronger.
 */
function computePitcherFactor(game: any, homeStat: any, awayStat: any): number {
  // Path 1: direct pitcher stats from game payload (ERA is the canonical metric)
  const homePitcherERA = extractPitcherERA(game?.teams?.home, game);
  const awayPitcherERA = extractPitcherERA(game?.teams?.away, game);

  if (homePitcherERA !== null && awayPitcherERA !== null) {
    const total = homePitcherERA + awayPitcherERA;
    if (total <= 0) return 0.5;
    // Lower ERA = better pitcher; away ERA in numerator means higher away ERA → home advantage
    const raw = awayPitcherERA / total;
    return Math.max(0.25, Math.min(0.75, raw));
  }

  // Path 2: team runs-allowed as a pitching-staff proxy
  const homeRA = extractRunsAllowed(homeStat);
  const awayRA = extractRunsAllowed(awayStat);
  if (homeRA !== null && awayRA !== null) {
    const total = homeRA + awayRA;
    if (total <= 0) return 0.5;
    const raw = awayRA / total; // higher away RA → home pitching advantage
    return Math.max(0.30, Math.min(0.70, raw));
  }

  return 0.5;
}

/**
 * Best-effort ERA extraction from API-Baseball game payload.
 * API-Sports includes a `pitchers` block on some baseball game responses
 * (starting rotation info). We check several common paths and return null
 * when pitcher data is not present so the engine degrades to team aggregates.
 */
function extractPitcherERA(teamBlock: any, game: any): number | null {
  // Try: game.teams.home.pitcher.era
  if (teamBlock?.pitcher?.era != null) {
    const era = parseFloat(teamBlock.pitcher.era);
    if (!isNaN(era) && era >= 0) return era;
  }
  // Try: game.pitchers.home.era
  const teamId = teamBlock?.id;
  if (teamId != null && game?.pitchers) {
    const pitchers = game.pitchers;
    if (Array.isArray(pitchers)) {
      const match = pitchers.find((p: any) => p.team?.id === teamId);
      if (match?.era != null) {
        const era = parseFloat(match.era);
        if (!isNaN(era) && era >= 0) return era;
      }
    } else if (pitchers.home?.team?.id === teamId && pitchers.home?.era != null) {
      const era = parseFloat(pitchers.home.era);
      if (!isNaN(era) && era >= 0) return era;
    } else if (pitchers.away?.team?.id === teamId && pitchers.away?.era != null) {
      const era = parseFloat(pitchers.away.era);
      if (!isNaN(era) && era >= 0) return era;
    }
  }
  return null;
}

/**
 * Pull runs-allowed-per-game from a team stats block.
 */
function extractRunsAllowed(stat: any): number | null {
  if (stat?.games?.played?.all) {
    const played = stat.games.played.all;
    if (stat?.goals?.against?.total?.all != null) {
      return stat.goals.against.total.all / played;
    }
    if (stat?.runs?.against?.total?.all != null) {
      return stat.runs.against.total.all / played;
    }
  }
  return null;
}

/**
 * Bullpen (relief pitching) factor. API-Baseball team stats sometimes expose
 * late-game splits; absent that, we rough-approximate with late-inning ERA
 * indicators. Conservative default: 0.5 neutral.
 */
function computeBullpenFactor(homeStat: any, awayStat: any): number {
  // Attempt to read a bullpen-specific stat if present (API varies)
  const homeBP = homeStat?.bullpen?.era != null ? parseFloat(homeStat.bullpen.era) : null;
  const awayBP = awayStat?.bullpen?.era != null ? parseFloat(awayStat.bullpen.era) : null;

  if (homeBP !== null && awayBP !== null && homeBP + awayBP > 0) {
    const raw = awayBP / (homeBP + awayBP); // lower home BP ERA → higher factor
    return Math.max(0.30, Math.min(0.70, raw));
  }

  // Fall back to overall runs allowed as a proxy
  const homeRA = extractRunsAllowed(homeStat);
  const awayRA = extractRunsAllowed(awayStat);
  if (homeRA !== null && awayRA !== null && homeRA + awayRA > 0) {
    const raw = awayRA / (homeRA + awayRA);
    return Math.max(0.35, Math.min(0.65, raw));
  }

  return 0.5;
}

/**
 * Head-to-head factor with recency weighting.
 * >0.5 = home team has dominated the recent matchups.
 */
function computeH2HFactor(h2hGames: any[], homeId: number, _awayId: number): number {
  if (!h2hGames || h2hGames.length === 0) return 0.5;

  const H2H_DECAY = 0.82;
  let weightedHomeWins = 0;
  let totalWeight = 0;

  const sorted = [...h2hGames].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  for (let i = 0; i < sorted.length; i++) {
    const g = sorted[i];
    const hScore = g.scores?.home?.total;
    const aScore = g.scores?.away?.total;
    if (hScore == null || aScore == null) continue;

    const recencyIdx = sorted.length - 1 - i;
    const weight = Math.pow(H2H_DECAY, recencyIdx);
    totalWeight += weight;

    const isHomeTeam = g.teams?.home?.id === homeId;
    const teamScore = isHomeTeam ? hScore : aScore;
    const oppScore = isHomeTeam ? aScore : hScore;

    if (teamScore > oppScore) weightedHomeWins += weight;
    else if (teamScore === oppScore) weightedHomeWins += weight * 0.5;
  }

  if (totalWeight === 0) return 0.5;

  // Reduce impact for very small samples
  const sampleWeight = Math.min(sorted.length, 6) / 6;
  const rawFactor = weightedHomeWins / totalWeight;
  return rawFactor * sampleWeight + 0.5 * (1 - sampleWeight);
}

/**
 * Standings-based strength factor. Higher position → stronger team.
 */
function computeStandingsFactor(standings: any[], homeId: number, awayId: number): number {
  if (!standings || standings.length === 0) return 0.5;

  const flat = standings.flatMap((s: any) => (Array.isArray(s) ? s : [s]));

  let homePos = 0;
  let awayPos = 0;
  const total = flat.length || 15;

  for (const entry of flat) {
    if (entry?.team?.id === homeId) homePos = entry.position || entry.rank || 0;
    if (entry?.team?.id === awayId) awayPos = entry.position || entry.rank || 0;
  }

  if (homePos === 0 && awayPos === 0) return 0.5;
  if (homePos === 0) return 0.4;
  if (awayPos === 0) return 0.6;

  const homeStrength = (total - homePos + 1) / total;
  const awayStrength = (total - awayPos + 1) / total;
  const sum = homeStrength + awayStrength;
  return sum > 0 ? homeStrength / sum : 0.5;
}

/**
 * Park profile detection from game venue/stadium metadata.
 *
 * We look for keywords in the venue name that reliably correlate with a
 * hitter-friendly or pitcher-friendly environment. When we cannot classify,
 * we return 'neutral'. The multiplier is applied symmetrically to both
 * team expected runs so park effects don't bias the match winner.
 *
 * NOTE: This is a conservative default classifier. Production deployments
 * that feed park factor data (Baseball Savant, StatCast) can layer more
 * precise multipliers on top.
 */
function computeParkProfile(game: any): { profile: ParkProfile; multiplier: number } {
  const venueName = String(game?.venue?.name || game?.stadium?.name || '').toLowerCase();

  // Classic hitter-friendly parks (light air, short porches)
  const hitterParks = ['coors', 'fenway', 'yankee', 'great american', 'camden', 'globe life', 'minute maid'];
  // Classic pitcher-friendly parks (large OF, heavy air)
  const pitcherParks = ['oracle', 'petco', 'tropicana', 'citi field', 't-mobile park', 'marlins park'];

  if (hitterParks.some(p => venueName.includes(p))) {
    return { profile: 'hitter_friendly', multiplier: PARK_MULTIPLIER.hitter_friendly };
  }
  if (pitcherParks.some(p => venueName.includes(p))) {
    return { profile: 'pitcher_friendly', multiplier: PARK_MULTIPLIER.pitcher_friendly };
  }
  return { profile: 'neutral', multiplier: PARK_MULTIPLIER.neutral };
}

/**
 * Compute 2-way moneyline probabilities by summing the Poisson score grid.
 * Baseball has no draws — we proportionally redistribute tied probability
 * 50/50 to the two sides (extra-inning outcome is ~50/50 with slight home
 * bump, but with the Poisson model the expected-value difference already
 * handles the overall lean).
 */
function compute2WayMoneyline(homeLambda: number, awayLambda: number) {
  let homeWin = 0;
  let tie = 0;
  let awayWin = 0;

  // Use a 0..15 grid — baseball rarely exceeds 15 runs for one side
  for (let h = 0; h <= 15; h++) {
    for (let a = 0; a <= 15; a++) {
      const prob = poissonProbability(h, homeLambda) * poissonProbability(a, awayLambda);
      if (h > a) homeWin += prob;
      else if (h === a) tie += prob;
      else awayWin += prob;
    }
  }

  const total = homeWin + tie + awayWin || 1;
  // Baseball tiebreakers favor home ~52/48 historically (bottom of 9th advantage)
  const HOME_TIE_SHARE = 0.52;
  const homeFinal = (homeWin + tie * HOME_TIE_SHARE) / total;
  const awayFinal = (awayWin + tie * (1 - HOME_TIE_SHARE)) / total;

  // Normalize (tiny rounding adjustment)
  const sum = homeFinal + awayFinal;
  return {
    homeWin: homeFinal / sum,
    awayWin: awayFinal / sum,
  };
}

/**
 * Compute 3-way First 5 Innings probabilities (F5 can end in a draw).
 */
function compute3WayF5(homeLambda: number, awayLambda: number) {
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

  const total = homeWin + draw + awayWin || 1;
  return {
    homeWin: homeWin / total,
    draw: draw / total,
    awayWin: awayWin / total,
  };
}

/**
 * Run line probability for an arbitrary handicap value (e.g. 1.5, 2.5).
 * Returns the probability that the favorite covers -X and that the
 * underdog covers +X (i.e. loses by less than X or wins outright).
 */
function computeRunLineForLine(
  homeLambda: number,
  awayLambda: number,
  lineValue: number,
): { favorite: 'home' | 'away'; favorite_cover_prob: number; underdog_cover_prob: number } {
  let homeByLine = 0;
  let awayByLine = 0;
  let totalProb = 0;

  const threshold = Math.ceil(lineValue); // 1.5 → need to win by 2+

  for (let h = 0; h <= 15; h++) {
    for (let a = 0; a <= 15; a++) {
      const prob = poissonProbability(h, homeLambda) * poissonProbability(a, awayLambda);
      totalProb += prob;
      if (h - a >= threshold) homeByLine += prob;
      if (a - h >= threshold) awayByLine += prob;
    }
  }

  const favorite: 'home' | 'away' = homeLambda >= awayLambda ? 'home' : 'away';
  const favoriteCover = favorite === 'home' ? homeByLine / totalProb : awayByLine / totalProb;
  const underdogCover = 1 - favoriteCover;

  return {
    favorite,
    favorite_cover_prob: favoriteCover,
    underdog_cover_prob: underdogCover,
  };
}

/**
 * Total runs over/under probability for a given line.
 */
function computeTotalForLine(
  homeLambda: number,
  awayLambda: number,
  line: number,
): { over_probability: number; under_probability: number } {
  const maxRuns = Math.floor(line);
  let underProb = 0;

  for (let h = 0; h <= maxRuns; h++) {
    for (let a = 0; a <= maxRuns - h; a++) {
      if (h + a <= maxRuns) {
        underProb += poissonProbability(h, homeLambda) * poissonProbability(a, awayLambda);
      }
    }
  }

  return {
    over_probability: 1 - underProb,
    under_probability: underProb,
  };
}

// ═══════════════════════════════════════════════════════════════════
// ODDS PARSING
// ═══════════════════════════════════════════════════════════════════

/**
 * Parse the raw odds response from API-Baseball into structured data.
 *
 * API-Baseball response shape (same envelope as other sports):
 *   response[].bookmakers[].bets[].values[]
 *
 * Known market IDs for baseball:
 *   1 = Home/Away (moneyline)
 *   2 = Asian Handicap / Run Line
 *   3 = Over/Under (total runs)
 *   5 = 1st 5 Innings Winner
 *   6 = 1st 5 Innings Over/Under
 */
function parseBaseballOddsResponse(rawOdds: any[]): ParsedBaseballOddsData | null {
  if (!rawOdds || rawOdds.length === 0) return null;

  const gameOdds = rawOdds[0];
  const bookmakers = gameOdds?.bookmakers;
  if (!bookmakers || bookmakers.length === 0) return null;

  const bookmaker = bookmakers[0];
  const bets: any[] = bookmaker?.bets || [];

  let moneyline: ParsedBaseballOddsData['moneyline'] = null;
  let runLine: ParsedBaseballOddsData['run_line'] = null;
  let total: ParsedBaseballOddsData['total'] = null;
  let f5Moneyline: ParsedBaseballOddsData['f5_moneyline'] = null;
  let f5Total: ParsedBaseballOddsData['f5_total'] = null;
  const rawMarkets: ParsedBaseballOddsData['raw_markets'] = [];

  for (const bet of bets) {
    const marketId = bet.id;
    const marketName = bet.name || '';
    const values: any[] = bet.values || [];

    rawMarkets.push({ market_id: marketId, market_name: marketName, values });

    // Match by id primarily; fall back to name matching for robustness
    const nameLower = String(marketName).toLowerCase();

    if (marketId === 1 || nameLower === 'home/away' || nameLower === 'moneyline' || nameLower === 'match winner') {
      moneyline = parseBaseballMoneyline(values);
    } else if (marketId === 2 || nameLower.includes('handicap') || nameLower.includes('run line')) {
      runLine = parseBaseballRunLine(values);
    } else if (marketId === 3 || nameLower.includes('over/under') || nameLower.includes('total')) {
      if (nameLower.includes('5 innings') || nameLower.includes('first 5')) {
        f5Total = parseBaseballOverUnder(values);
      } else {
        total = parseBaseballOverUnder(values);
      }
    } else if (marketId === 5 || nameLower.includes('1st 5 innings winner') || nameLower.includes('first 5 innings winner')) {
      f5Moneyline = parseBaseballF5Moneyline(values);
    } else if (marketId === 6) {
      f5Total = parseBaseballOverUnder(values);
    }
  }

  return {
    moneyline,
    run_line: runLine,
    total,
    f5_moneyline: f5Moneyline,
    f5_total: f5Total,
    bookmaker: bookmaker?.name || null,
    raw_markets: rawMarkets,
  };
}

function parseBaseballMoneyline(values: any[]): ParsedBaseballOddsData['moneyline'] {
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

function parseBaseballRunLine(values: any[]): ParsedBaseballOddsData['run_line'] {
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
      if (line === 0) line = -num;
    }
  }

  if (line === 0 && homeOdds <= 0 && awayOdds <= 0) return null;
  return { line, home_odds: homeOdds, away_odds: awayOdds };
}

function parseBaseballOverUnder(values: any[]): ParsedBaseballOddsData['total'] {
  const lineMap: Map<number, { over_odds: number; under_odds: number }> = new Map();

  for (const v of values) {
    const label = String(v.value || '');
    const odd = parseFloat(v.odd);
    if (isNaN(odd)) continue;

    const numMatch = label.match(/(\d+\.?\d*)/);
    if (!numMatch) continue;

    const num = parseFloat(numMatch[1]);
    const lowerLabel = label.toLowerCase();

    if (!lineMap.has(num)) lineMap.set(num, { over_odds: 0, under_odds: 0 });
    const entry = lineMap.get(num)!;

    if (lowerLabel.includes('over')) entry.over_odds = odd;
    else if (lowerLabel.includes('under')) entry.under_odds = odd;
  }

  // Prefer typical baseball totals (8.5, 9.5) first
  const preferredLines = [8.5, 9.5, 7.5, 10.5, 6.5, 11.5];
  for (const preferred of preferredLines) {
    const entry = lineMap.get(preferred);
    if (entry && entry.over_odds > 0 && entry.under_odds > 0) {
      return { line: preferred, over_odds: entry.over_odds, under_odds: entry.under_odds };
    }
  }

  // Otherwise return the first complete pair
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

function parseBaseballF5Moneyline(values: any[]): ParsedBaseballOddsData['f5_moneyline'] {
  let homeOdds = 0;
  let awayOdds = 0;
  let drawOdds: number | undefined;

  for (const v of values) {
    const label = String(v.value || '').toLowerCase().trim();
    const odd = parseFloat(v.odd);
    if (isNaN(odd)) continue;

    if (label === 'home' || label === '1' || label.startsWith('home')) {
      homeOdds = odd;
    } else if (label === 'away' || label === '2' || label.startsWith('away')) {
      awayOdds = odd;
    } else if (label === 'draw' || label === 'x' || label.startsWith('draw')) {
      drawOdds = odd;
    }
  }

  if (homeOdds <= 0 && awayOdds <= 0) return null;
  return { home_odds: homeOdds, away_odds: awayOdds, ...(drawOdds ? { draw_odds: drawOdds } : {}) };
}
