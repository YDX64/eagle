/**
 * Large-Scale Backtest Engine v1.0
 *
 * API-Football'dan yüzlerce/binlerce bitmiş maçı çeker,
 * her biri için Dixon-Coles modeli ile tahmin üretir,
 * gerçek sonuçlarla karşılaştırır.
 *
 * Minimum API yükü: Lig başına sadece 2-3 API çağrısı
 *  - 1x getStandings (tüm takım istatistikleri)
 *  - 1x getFixturesByLeague (tüm maçlar + skorlar)
 *  - Nx getTeamStatistics (takım başına detaylı istat)
 *
 * Bu sayede 380 maçlık bir sezonu ~22 API çağrısıyla test edebilirsin.
 */

import { ApiFootballService, type Fixture, type Standing, MAJOR_LEAGUES } from './api-football';
import { AdvancedPredictionEngine } from './advanced-prediction-engine';
import { MatchContextBuilder } from './match-context';
import { MarketModels, type AllMarketPredictions } from './market-models';

// ═══════════════════════════════════════
// TYPES
// ═══════════════════════════════════════

export interface BacktestMatchResult {
  fixtureId: number;
  date: string;
  homeTeam: string;
  awayTeam: string;
  actualHomeGoals: number;
  actualAwayGoals: number;
  actualResult: '1' | 'X' | '2';
  predictedResult: '1' | 'X' | '2';
  predictedHomeProb: number;
  predictedDrawProb: number;
  predictedAwayProb: number;
  predictedHomeXG: number;
  predictedAwayXG: number;
  isCorrect: boolean;
  confidence: number;
  // Goals markets
  actualTotalGoals: number;
  predictedOver25: number;
  predictedBTTS: number;
  isOver25Correct: boolean;
  isBTTSCorrect: boolean;
  isOver15Correct: boolean;
  predictedOver15: number;
  // Extended markets
  predictedHTResult?: '1' | 'X' | '2';
  actualHTResult?: '1' | 'X' | '2';
  isHTCorrect?: boolean;
  predictedHTFT?: string;
  actualHTFT?: string;
  isHTFTCorrect?: boolean;
  predicted1HOver05?: number;
  actual1HGoals?: number;
  is1HOver05Correct?: boolean;
  predictedExactScore?: string;
  isExactScoreCorrect?: boolean;
}

export interface BacktestSummary {
  leagueId: number;
  leagueName: string;
  season: number;
  totalMatches: number;
  // 1X2 accuracy
  matchResult: {
    correct: number;
    total: number;
    accuracy: number;
    homeWinAccuracy: number;
    drawAccuracy: number;
    awayWinAccuracy: number;
    homePredicted: number;
    drawPredicted: number;
    awayPredicted: number;
    homeCorrect: number;
    drawCorrect: number;
    awayCorrect: number;
  };
  // Goals markets
  over25: { correct: number; total: number; accuracy: number };
  over15: { correct: number; total: number; accuracy: number };
  btts: { correct: number; total: number; accuracy: number };
  // Confidence tiers
  highConfidence: { correct: number; total: number; accuracy: number }; // >55%
  mediumConfidence: { correct: number; total: number; accuracy: number }; // 40-55%
  lowConfidence: { correct: number; total: number; accuracy: number }; // <40%
  // ROI simulation
  roi: {
    flatBetProfit: number; // 1 unit per bet on predicted result
    confidenceBetProfit: number; // Kelly-weighted
    totalStaked: number;
  };
  // Match details
  matches: BacktestMatchResult[];
  // Performance by month
  monthlyAccuracy: Record<string, { correct: number; total: number; accuracy: number }>;
}

// ═══════════════════════════════════════
// TEAM STATS CACHE (from standings)
// ═══════════════════════════════════════

interface CachedTeamStats {
  teamId: number;
  teamName: string;
  // From standings
  position: number;
  played: number;
  form: string;
  points: number;
  goalDiff: number;
  // Home
  homePlayed: number;
  homeWins: number;
  homeDraws: number;
  homeLosses: number;
  homeGoalsFor: number;
  homeGoalsAgainst: number;
  // Away
  awayPlayed: number;
  awayWins: number;
  awayDraws: number;
  awayLosses: number;
  awayGoalsFor: number;
  awayGoalsAgainst: number;
  // Calculated averages
  homeGoalsPerGame: number;
  awayGoalsPerGame: number;
  homeGoalsConcededPerGame: number;
  awayGoalsConcededPerGame: number;
  cleanSheetPct: number;
  formLast5Points: number;
  // From API team stats (optional)
  cardsPerGame?: number;
  cornersPerGame?: number;
}

// ═══════════════════════════════════════
// ENGINE
// ═══════════════════════════════════════

export class LargeScaleBacktest {

  /**
   * Build team stats cache from standings (minimal API calls)
   */
  private static buildTeamCache(standings: Standing[]): Map<number, CachedTeamStats> {
    const cache = new Map<number, CachedTeamStats>();

    for (const s of standings) {
      const played = s.all.played || 1;
      const homePlayed = s.home.played || 1;
      const awayPlayed = s.away.played || 1;

      // Parse form for last 5 points
      const formStr = (s.form || '').slice(-5);
      let formPoints = 0;
      for (const c of formStr) {
        if (c === 'W') formPoints += 3;
        else if (c === 'D') formPoints += 1;
      }

      // Clean sheets: estimate from goals against
      const cleanSheetPct = ((played - Math.min(played, Math.ceil(s.all.goals.against * 0.6))) / played) * 100;

      cache.set(s.team.id, {
        teamId: s.team.id,
        teamName: s.team.name,
        position: s.rank,
        played,
        form: s.form || 'DDDDD',
        points: s.points,
        goalDiff: s.goalsDiff,
        homePlayed,
        homeWins: s.home.win,
        homeDraws: s.home.draw,
        homeLosses: s.home.lose,
        homeGoalsFor: s.home.goals.for,
        homeGoalsAgainst: s.home.goals.against,
        awayPlayed,
        awayWins: s.away.win,
        awayDraws: s.away.draw,
        awayLosses: s.away.lose,
        awayGoalsFor: s.away.goals.for,
        awayGoalsAgainst: s.away.goals.against,
        homeGoalsPerGame: s.home.goals.for / homePlayed,
        awayGoalsPerGame: s.away.goals.for / awayPlayed,
        homeGoalsConcededPerGame: s.home.goals.against / homePlayed,
        awayGoalsConcededPerGame: s.away.goals.against / awayPlayed,
        cleanSheetPct,
        formLast5Points: formPoints,
      });
    }

    return cache;
  }

  /**
   * Full prediction from cached stats using MatchContext + MarketModels
   * NO API calls — uses pre-fetched standings data
   */
  private static predictAllMarketsFromCache(
    homeStanding: Standing,
    awayStanding: Standing,
    leagueId: number,
    season: number,
    fixtureId: number
  ): AllMarketPredictions {
    const ctx = MatchContextBuilder.buildFromStandings(homeStanding, awayStanding, leagueId, season, fixtureId);
    return MarketModels.predict(ctx);
  }

  /**
   * Dixon-Coles prediction from cached stats (NO API calls)
   */
  private static predictFromCache(
    homeTeam: CachedTeamStats,
    awayTeam: CachedTeamStats
  ): {
    homeProb: number; drawProb: number; awayProb: number;
    homeXG: number; awayXG: number;
    over25: number; over15: number; btts: number;
  } {
    const HOME_ADV = 0.12;

    // Expected goals
    let homeXG = Math.max(0.4, Math.min(4.0,
      (homeTeam.homeGoalsPerGame + awayTeam.awayGoalsConcededPerGame) / 2 + HOME_ADV * 0.3
    ));

    let awayXG = Math.max(0.3, Math.min(3.5,
      (awayTeam.awayGoalsPerGame + homeTeam.homeGoalsConcededPerGame) / 2 - HOME_ADV * 0.15
    ));

    // Form adjustment
    const formDiff = (homeTeam.formLast5Points - awayTeam.formLast5Points) / 15;
    homeXG += Math.max(-0.1, Math.min(0.1, formDiff * 0.08));
    awayXG -= Math.max(-0.1, Math.min(0.1, formDiff * 0.06));

    homeXG = Math.max(0.4, Math.min(4.0, homeXG));
    awayXG = Math.max(0.3, Math.min(3.5, awayXG));

    const totalXG = homeXG + awayXG;

    // Dixon-Coles Poisson grid
    const RHO = -0.04;
    const MAX_G = 8;
    let rawH = 0, rawD = 0, rawA = 0;

    for (let h = 0; h <= MAX_G; h++) {
      for (let a = 0; a <= MAX_G; a++) {
        let prob = AdvancedPredictionEngine.poissonProbability(h, homeXG) *
                   AdvancedPredictionEngine.poissonProbability(a, awayXG);

        if (h === 0 && a === 0) prob *= (1 - homeXG * awayXG * RHO);
        else if (h === 1 && a === 0) prob *= (1 + awayXG * RHO);
        else if (h === 0 && a === 1) prob *= (1 + homeXG * RHO);
        else if (h === 1 && a === 1) prob *= (1 - RHO);

        prob = Math.max(0, prob);
        if (h > a) rawH += prob;
        else if (h === a) rawD += prob;
        else rawA += prob;
      }
    }

    const t = rawH + rawD + rawA;
    let homeProb = rawH / t;
    let drawProb = rawD / t;
    let awayProb = rawA / t;

    // Position adjustment
    const posAdjust = Math.max(-0.025, Math.min(0.025,
      (awayTeam.position - homeTeam.position) / 20 * 0.03
    ));
    homeProb += posAdjust;
    awayProb -= posAdjust;
    const nt = homeProb + drawProb + awayProb;
    homeProb /= nt;
    drawProb /= nt;
    awayProb /= nt;

    // Over/Under from Poisson
    const u05 = AdvancedPredictionEngine.poissonProbability(0, totalXG);
    const u15 = u05 + AdvancedPredictionEngine.poissonProbability(1, totalXG);
    const u25 = u15 + AdvancedPredictionEngine.poissonProbability(2, totalXG);
    const over25 = (1 - u25) * 100;
    const over15 = (1 - u15) * 100;

    // BTTS
    const homeNoGoal = AdvancedPredictionEngine.poissonProbability(0, homeXG);
    const awayNoGoal = AdvancedPredictionEngine.poissonProbability(0, awayXG);
    const btts = (1 - (homeNoGoal + awayNoGoal - homeNoGoal * awayNoGoal)) * 100;

    return {
      homeProb: homeProb * 100,
      drawProb: drawProb * 100,
      awayProb: awayProb * 100,
      homeXG, awayXG,
      over25, over15, btts,
    };
  }

  /**
   * Run large-scale backtest for a league season
   *
   * Only 2 API calls needed:
   * 1. getStandings → team stats cache
   * 2. getFixturesByLeague → all finished matches with scores
   */
  static async runLeagueBacktest(
    leagueId: number,
    season: number,
    options?: { maxMatches?: number; minRound?: number }
  ): Promise<BacktestSummary> {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[BACKTEST] Starting large-scale backtest: League ${leagueId}, Season ${season}`);
    console.log(`${'═'.repeat(60)}\n`);

    // Step 1: Fetch standings (team stats cache)
    const standings = await ApiFootballService.getStandings(leagueId, season);
    if (!standings || standings.length === 0) {
      throw new Error(`No standings data for league ${leagueId} season ${season}`);
    }

    const teamCache = this.buildTeamCache(standings);
    console.log(`[BACKTEST] Team cache built: ${teamCache.size} teams`);

    // Step 2: Fetch all finished matches
    const fixtures = await ApiFootballService.getFixturesByLeague(leagueId, season, 'FT');
    console.log(`[BACKTEST] Fetched ${fixtures.length} finished matches`);

    // Filter to matches where both teams are in standings
    let testMatches = fixtures.filter(f =>
      teamCache.has(f.teams.home.id) && teamCache.has(f.teams.away.id) &&
      f.goals.home !== null && f.goals.away !== null
    );

    // Sort by date
    testMatches.sort((a, b) => new Date(a.fixture.date).getTime() - new Date(b.fixture.date).getTime());

    // Skip early rounds (data unreliable before round 5+)
    const minRound = options?.minRound || 5;
    testMatches = testMatches.filter((_, i) => {
      // Approximate: first 5 rounds = first 5 * (teams/2) matches
      const matchesPerRound = Math.floor(teamCache.size / 2);
      return i >= (minRound - 1) * matchesPerRound;
    });

    if (options?.maxMatches) {
      testMatches = testMatches.slice(0, options.maxMatches);
    }

    console.log(`[BACKTEST] Testing ${testMatches.length} matches (skipping first ${minRound - 1} rounds)`);

    // Step 3: Run predictions
    const results: BacktestMatchResult[] = [];
    const summary = {
      matchResult: { correct: 0, total: 0, homePredicted: 0, drawPredicted: 0, awayPredicted: 0, homeCorrect: 0, drawCorrect: 0, awayCorrect: 0 },
      over25: { correct: 0, total: 0 },
      over15: { correct: 0, total: 0 },
      btts: { correct: 0, total: 0 },
      highConf: { correct: 0, total: 0 },
      medConf: { correct: 0, total: 0 },
      lowConf: { correct: 0, total: 0 },
      flatProfit: 0,
      confProfit: 0,
      monthlyMap: new Map<string, { correct: number; total: number }>(),
    };

    // Also get standings for MatchContext-based predictions
    const standingsMap = new Map<number, Standing>();
    standings.forEach(s => standingsMap.set(s.team.id, s));

    for (const match of testMatches) {
      const homeTeam = teamCache.get(match.teams.home.id)!;
      const awayTeam = teamCache.get(match.teams.away.id)!;

      const pred = this.predictFromCache(homeTeam, awayTeam);

      // Also run full market predictions via MatchContext
      const homeSt = standingsMap.get(match.teams.home.id);
      const awaySt = standingsMap.get(match.teams.away.id);
      let allMarkets: AllMarketPredictions | null = null;
      if (homeSt && awaySt) {
        try {
          allMarkets = this.predictAllMarketsFromCache(homeSt, awaySt, leagueId, season, match.fixture.id);
        } catch {}
      }

      // Actual result
      const homeGoals = match.goals.home;
      const awayGoals = match.goals.away;
      const actualResult: '1' | 'X' | '2' = homeGoals > awayGoals ? '1' : homeGoals < awayGoals ? '2' : 'X';
      const actualTotalGoals = homeGoals + awayGoals;
      const actualBTTS = homeGoals > 0 && awayGoals > 0;

      // Predicted result (highest probability)
      const predictedResult: '1' | 'X' | '2' =
        pred.homeProb > pred.drawProb && pred.homeProb > pred.awayProb ? '1' :
        pred.awayProb > pred.homeProb && pred.awayProb > pred.drawProb ? '2' : 'X';

      const confidence = Math.max(pred.homeProb, pred.drawProb, pred.awayProb);
      const isCorrect = predictedResult === actualResult;

      // Over 2.5
      const predOver25 = pred.over25 > 50;
      const actualOver25 = actualTotalGoals > 2.5;
      const isOver25Correct = predOver25 === actualOver25;

      // Over 1.5
      const predOver15 = pred.over15 > 50;
      const actualOver15 = actualTotalGoals > 1.5;
      const isOver15Correct = predOver15 === actualOver15;

      // BTTS
      const predBTTS = pred.btts > 50;
      const isBTTSCorrect = predBTTS === actualBTTS;

      // ── HT/FT and extended markets from allMarkets ──
      let predictedHTResult: '1' | 'X' | '2' | undefined;
      let actualHTResult: '1' | 'X' | '2' | undefined;
      let isHTCorrect: boolean | undefined;
      let predictedHTFT: string | undefined;
      let actualHTFT: string | undefined;
      let isHTFTCorrect: boolean | undefined;
      let predicted1HOver05: number | undefined;
      let actual1HGoals: number | undefined;
      let is1HOver05Correct: boolean | undefined;
      let predictedExactScore: string | undefined;
      let isExactScoreCorrect: boolean | undefined;

      if (allMarkets && match.score?.halftime) {
        const htH = match.score.halftime.home ?? 0;
        const htA = match.score.halftime.away ?? 0;
        actualHTResult = htH > htA ? '1' : htH < htA ? '2' : 'X';
        actual1HGoals = htH + htA;
        actualHTFT = `${actualHTResult}/${actualResult}`;

        // HT prediction
        const htProbs = allMarkets.htResult;
        predictedHTResult = htProbs.home > htProbs.draw && htProbs.home > htProbs.away ? '1' :
                           htProbs.away > htProbs.home && htProbs.away > htProbs.draw ? '2' : 'X';
        isHTCorrect = predictedHTResult === actualHTResult;

        // HT/FT prediction (highest probability combination)
        const htftEntries = Object.entries(allMarkets.htft);
        htftEntries.sort((a, b) => b[1] - a[1]);
        predictedHTFT = htftEntries[0][0];
        isHTFTCorrect = predictedHTFT === actualHTFT;

        // 1H Over 0.5
        predicted1HOver05 = allMarkets.firstHalfGoals.over_0_5;
        is1HOver05Correct = (predicted1HOver05 > 50) === (actual1HGoals > 0.5);

        // Exact Score
        if (allMarkets.exactScores.length > 0) {
          predictedExactScore = allMarkets.exactScores[0].score;
          isExactScoreCorrect = predictedExactScore === `${homeGoals}-${awayGoals}`;
        }
      }

      results.push({
        fixtureId: match.fixture.id,
        date: match.fixture.date,
        homeTeam: homeTeam.teamName,
        awayTeam: awayTeam.teamName,
        actualHomeGoals: homeGoals,
        actualAwayGoals: awayGoals,
        actualResult,
        predictedResult,
        predictedHomeProb: Math.round(pred.homeProb * 100) / 100,
        predictedDrawProb: Math.round(pred.drawProb * 100) / 100,
        predictedAwayProb: Math.round(pred.awayProb * 100) / 100,
        predictedHomeXG: Math.round(pred.homeXG * 100) / 100,
        predictedAwayXG: Math.round(pred.awayXG * 100) / 100,
        isCorrect,
        confidence: Math.round(confidence * 100) / 100,
        actualTotalGoals,
        predictedOver25: Math.round(pred.over25 * 100) / 100,
        predictedBTTS: Math.round(pred.btts * 100) / 100,
        isOver25Correct,
        isBTTSCorrect,
        isOver15Correct,
        predictedOver15: Math.round(pred.over15 * 100) / 100,
        predictedHTResult, actualHTResult, isHTCorrect,
        predictedHTFT, actualHTFT, isHTFTCorrect,
        predicted1HOver05, actual1HGoals, is1HOver05Correct,
        predictedExactScore, isExactScoreCorrect,
      });

      // Aggregate
      summary.matchResult.total++;
      if (isCorrect) summary.matchResult.correct++;

      if (predictedResult === '1') { summary.matchResult.homePredicted++; if (isCorrect) summary.matchResult.homeCorrect++; }
      if (predictedResult === 'X') { summary.matchResult.drawPredicted++; if (isCorrect) summary.matchResult.drawCorrect++; }
      if (predictedResult === '2') { summary.matchResult.awayPredicted++; if (isCorrect) summary.matchResult.awayCorrect++; }

      summary.over25.total++;
      if (isOver25Correct) summary.over25.correct++;
      summary.over15.total++;
      if (isOver15Correct) summary.over15.correct++;
      summary.btts.total++;
      if (isBTTSCorrect) summary.btts.correct++;

      // Confidence tiers
      if (confidence > 55) {
        summary.highConf.total++;
        if (isCorrect) summary.highConf.correct++;
      } else if (confidence > 40) {
        summary.medConf.total++;
        if (isCorrect) summary.medConf.correct++;
      } else {
        summary.lowConf.total++;
        if (isCorrect) summary.lowConf.correct++;
      }

      // ROI: flat 1 unit bet on predicted result with typical odds
      const impliedOdds = 100 / confidence; // approximate decimal odds
      if (isCorrect) {
        summary.flatProfit += (impliedOdds - 1);
      } else {
        summary.flatProfit -= 1;
      }

      // Monthly tracking
      const month = match.fixture.date.substring(0, 7); // YYYY-MM
      if (!summary.monthlyMap.has(month)) {
        summary.monthlyMap.set(month, { correct: 0, total: 0 });
      }
      const m = summary.monthlyMap.get(month)!;
      m.total++;
      if (isCorrect) m.correct++;
    }

    // Build monthly accuracy
    const monthlyAccuracy: Record<string, { correct: number; total: number; accuracy: number }> = {};
    for (const [month, data] of summary.monthlyMap) {
      monthlyAccuracy[month] = {
        ...data,
        accuracy: data.total > 0 ? Math.round((data.correct / data.total) * 10000) / 100 : 0,
      };
    }

    const leagueName = standings[0]?.team?.name ? `League ${leagueId}` : `League ${leagueId}`;

    const finalSummary: BacktestSummary = {
      leagueId,
      leagueName,
      season,
      totalMatches: results.length,
      matchResult: {
        correct: summary.matchResult.correct,
        total: summary.matchResult.total,
        accuracy: summary.matchResult.total > 0 ? Math.round((summary.matchResult.correct / summary.matchResult.total) * 10000) / 100 : 0,
        homeWinAccuracy: summary.matchResult.homePredicted > 0 ? Math.round((summary.matchResult.homeCorrect / summary.matchResult.homePredicted) * 10000) / 100 : 0,
        drawAccuracy: summary.matchResult.drawPredicted > 0 ? Math.round((summary.matchResult.drawCorrect / summary.matchResult.drawPredicted) * 10000) / 100 : 0,
        awayWinAccuracy: summary.matchResult.awayPredicted > 0 ? Math.round((summary.matchResult.awayCorrect / summary.matchResult.awayPredicted) * 10000) / 100 : 0,
        homePredicted: summary.matchResult.homePredicted,
        drawPredicted: summary.matchResult.drawPredicted,
        awayPredicted: summary.matchResult.awayPredicted,
        homeCorrect: summary.matchResult.homeCorrect,
        drawCorrect: summary.matchResult.drawCorrect,
        awayCorrect: summary.matchResult.awayCorrect,
      },
      over25: {
        correct: summary.over25.correct,
        total: summary.over25.total,
        accuracy: summary.over25.total > 0 ? Math.round((summary.over25.correct / summary.over25.total) * 10000) / 100 : 0,
      },
      over15: {
        correct: summary.over15.correct,
        total: summary.over15.total,
        accuracy: summary.over15.total > 0 ? Math.round((summary.over15.correct / summary.over15.total) * 10000) / 100 : 0,
      },
      btts: {
        correct: summary.btts.correct,
        total: summary.btts.total,
        accuracy: summary.btts.total > 0 ? Math.round((summary.btts.correct / summary.btts.total) * 10000) / 100 : 0,
      },
      highConfidence: {
        correct: summary.highConf.correct,
        total: summary.highConf.total,
        accuracy: summary.highConf.total > 0 ? Math.round((summary.highConf.correct / summary.highConf.total) * 10000) / 100 : 0,
      },
      mediumConfidence: {
        correct: summary.medConf.correct,
        total: summary.medConf.total,
        accuracy: summary.medConf.total > 0 ? Math.round((summary.medConf.correct / summary.medConf.total) * 10000) / 100 : 0,
      },
      lowConfidence: {
        correct: summary.lowConf.correct,
        total: summary.lowConf.total,
        accuracy: summary.lowConf.total > 0 ? Math.round((summary.lowConf.correct / summary.lowConf.total) * 10000) / 100 : 0,
      },
      roi: {
        flatBetProfit: Math.round(summary.flatProfit * 100) / 100,
        confidenceBetProfit: Math.round(summary.confProfit * 100) / 100,
        totalStaked: results.length,
      },
      matches: results,
      monthlyAccuracy,
    };

    // Print summary
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[BACKTEST] RESULTS: League ${leagueId} Season ${season}`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`Total Matches: ${finalSummary.totalMatches}`);
    console.log(`\n── 1X2 Match Result ──`);
    console.log(`  Overall:  ${finalSummary.matchResult.accuracy}% (${finalSummary.matchResult.correct}/${finalSummary.matchResult.total})`);
    console.log(`  Home Win: ${finalSummary.matchResult.homeWinAccuracy}% (${finalSummary.matchResult.homeCorrect}/${finalSummary.matchResult.homePredicted})`);
    console.log(`  Draw:     ${finalSummary.matchResult.drawAccuracy}% (${finalSummary.matchResult.drawCorrect}/${finalSummary.matchResult.drawPredicted})`);
    console.log(`  Away Win: ${finalSummary.matchResult.awayWinAccuracy}% (${finalSummary.matchResult.awayCorrect}/${finalSummary.matchResult.awayPredicted})`);
    console.log(`\n── Goals Markets ──`);
    console.log(`  Over 2.5: ${finalSummary.over25.accuracy}% (${finalSummary.over25.correct}/${finalSummary.over25.total})`);
    console.log(`  Over 1.5: ${finalSummary.over15.accuracy}% (${finalSummary.over15.correct}/${finalSummary.over15.total})`);
    console.log(`  BTTS:     ${finalSummary.btts.accuracy}% (${finalSummary.btts.correct}/${finalSummary.btts.total})`);
    console.log(`\n── Confidence Tiers ──`);
    console.log(`  High (>55%):  ${finalSummary.highConfidence.accuracy}% (${finalSummary.highConfidence.correct}/${finalSummary.highConfidence.total})`);
    console.log(`  Med (40-55%): ${finalSummary.mediumConfidence.accuracy}% (${finalSummary.mediumConfidence.correct}/${finalSummary.mediumConfidence.total})`);
    console.log(`  Low (<40%):   ${finalSummary.lowConfidence.accuracy}% (${finalSummary.lowConfidence.correct}/${finalSummary.lowConfidence.total})`);
    console.log(`\n── ROI ──`);
    console.log(`  Flat Bet P/L: ${finalSummary.roi.flatBetProfit} units`);
    console.log(`${'═'.repeat(60)}\n`);

    return finalSummary;
  }

  /**
   * Run backtest across multiple leagues
   */
  static async runMultiLeagueBacktest(
    leagues: { id: number; name: string }[],
    season: number,
    options?: { maxMatchesPerLeague?: number; minRound?: number }
  ): Promise<{
    leagues: BacktestSummary[];
    aggregate: {
      totalMatches: number;
      matchResultAccuracy: number;
      over25Accuracy: number;
      over15Accuracy: number;
      bttsAccuracy: number;
      highConfAccuracy: number;
    };
  }> {
    const results: BacktestSummary[] = [];
    let totalCorrect1X2 = 0, total1X2 = 0;
    let totalCorrectO25 = 0, totalO25 = 0;
    let totalCorrectO15 = 0, totalO15 = 0;
    let totalCorrectBTTS = 0, totalBTTS = 0;
    let totalHighConfCorrect = 0, totalHighConf = 0;

    for (const league of leagues) {
      try {
        console.log(`\n[MULTI-BACKTEST] Processing ${league.name} (ID: ${league.id})...`);
        const result = await this.runLeagueBacktest(league.id, season, {
          maxMatches: options?.maxMatchesPerLeague,
          minRound: options?.minRound,
        });
        result.leagueName = league.name;
        results.push(result);

        totalCorrect1X2 += result.matchResult.correct;
        total1X2 += result.matchResult.total;
        totalCorrectO25 += result.over25.correct;
        totalO25 += result.over25.total;
        totalCorrectO15 += result.over15.correct;
        totalO15 += result.over15.total;
        totalCorrectBTTS += result.btts.correct;
        totalBTTS += result.btts.total;
        totalHighConfCorrect += result.highConfidence.correct;
        totalHighConf += result.highConfidence.total;
      } catch (err: any) {
        console.error(`[MULTI-BACKTEST] Failed for ${league.name}:`, err.message);
      }
    }

    return {
      leagues: results,
      aggregate: {
        totalMatches: total1X2,
        matchResultAccuracy: total1X2 > 0 ? Math.round((totalCorrect1X2 / total1X2) * 10000) / 100 : 0,
        over25Accuracy: totalO25 > 0 ? Math.round((totalCorrectO25 / totalO25) * 10000) / 100 : 0,
        over15Accuracy: totalO15 > 0 ? Math.round((totalCorrectO15 / totalO15) * 10000) / 100 : 0,
        bttsAccuracy: totalBTTS > 0 ? Math.round((totalCorrectBTTS / totalBTTS) * 10000) / 100 : 0,
        highConfAccuracy: totalHighConf > 0 ? Math.round((totalHighConfCorrect / totalHighConf) * 10000) / 100 : 0,
      },
    };
  }

  /**
   * Quick preset: Top 5 European Leagues
   */
  static async runTop5Backtest(season: number = 2024): Promise<any> {
    return this.runMultiLeagueBacktest([
      { id: MAJOR_LEAGUES.PREMIER_LEAGUE, name: 'Premier League' },
      { id: MAJOR_LEAGUES.LA_LIGA, name: 'La Liga' },
      { id: MAJOR_LEAGUES.BUNDESLIGA, name: 'Bundesliga' },
      { id: MAJOR_LEAGUES.SERIE_A, name: 'Serie A' },
      { id: MAJOR_LEAGUES.LIGUE_1, name: 'Ligue 1' },
    ], season, { minRound: 5 });
  }

  // ═══════════════════════════════════════════════════════════
  // MASSIVE BACKTEST: Multi-Season, Multi-League, Calibration
  // ═══════════════════════════════════════════════════════════

  /**
   * All available leagues for massive backtest
   */
  static readonly ALL_LEAGUES = [
    // Top 5 European
    { id: 39, name: 'Premier League' },
    { id: 140, name: 'La Liga' },
    { id: 78, name: 'Bundesliga' },
    { id: 135, name: 'Serie A' },
    { id: 61, name: 'Ligue 1' },
    // Secondary European
    { id: 203, name: 'Süper Lig' },
    { id: 88, name: 'Eredivisie' },
    { id: 94, name: 'Primeira Liga' },
    { id: 144, name: 'Belgian Pro League' },
    { id: 179, name: 'Scottish Premiership' },
    { id: 207, name: 'Swiss Super League' },
    { id: 218, name: 'Austrian Bundesliga' },
    { id: 197, name: 'Greek Super League' },
    { id: 235, name: 'Russian Premier' },
    // England lower
    { id: 40, name: 'Championship' },
    // South American
    { id: 71, name: 'Brazilian Serie A' },
    { id: 128, name: 'Argentine Primera' },
    // Other major
    { id: 253, name: 'MLS' },
    { id: 98, name: 'J-League' },
    { id: 169, name: 'Chinese Super League' },
  ];

  /**
   * Run MASSIVE backtest across many leagues and seasons.
   * Goal: Test with tens of thousands of matches.
   *
   * Includes:
   * - All markets: 1X2, Over/Under (1.5, 2.5, 3.5), BTTS
   * - Probability calibration analysis (Brier Score + calibration bins)
   * - HT/FT analysis from halftime data
   * - ROI simulation with implied odds
   * - Confidence-tiered performance
   *
   * API calls: 2 per league-season (standings + fixtures)
   * Example: 20 leagues × 5 seasons = 200 API calls = ~60K matches
   */
  static async runMassiveBacktest(options: {
    leagues?: { id: number; name: string }[];
    seasons?: number[];
    minRound?: number;
  } = {}): Promise<MassiveBacktestResult> {
    const leagues = options.leagues || this.ALL_LEAGUES;
    const seasons = options.seasons || [2024, 2023, 2022];
    const minRound = options.minRound || 5;

    console.log(`\n${'█'.repeat(70)}`);
    console.log(`  MASSIVE BACKTEST: ${leagues.length} leagues × ${seasons.length} seasons`);
    console.log(`  Estimated matches: ~${leagues.length * seasons.length * 300}`);
    console.log(`  API calls needed: ~${leagues.length * seasons.length * 2}`);
    console.log(`${'█'.repeat(70)}\n`);

    const allMatches: BacktestMatchResult[] = [];
    const leagueResults: { league: string; season: number; accuracy1x2: number; matches: number; over25: number; btts: number }[] = [];
    let successCount = 0, failCount = 0;

    // Process each league-season
    for (const league of leagues) {
      for (const season of seasons) {
        try {
          console.log(`[MASSIVE] ${league.name} ${season}...`);
          const result = await this.runLeagueBacktest(league.id, season, { minRound });

          // Don't store individual match details to save memory for massive runs
          allMatches.push(...result.matches.map(m => ({ ...m })));

          leagueResults.push({
            league: league.name,
            season,
            accuracy1x2: result.matchResult.accuracy,
            matches: result.totalMatches,
            over25: result.over25.accuracy,
            btts: result.btts.accuracy,
          });

          successCount++;
          console.log(`[MASSIVE] ✓ ${league.name} ${season}: ${result.totalMatches} matches, 1X2=${result.matchResult.accuracy}%`);
        } catch (err: any) {
          failCount++;
          console.log(`[MASSIVE] ✗ ${league.name} ${season}: ${err.message}`);
        }

        // Small delay to avoid API rate limits
        await new Promise(r => setTimeout(r, 300));
      }
    }

    // ── AGGREGATE ANALYSIS ──
    const total = allMatches.length;
    const correct1X2 = allMatches.filter(m => m.isCorrect).length;
    const correctO25 = allMatches.filter(m => m.isOver25Correct).length;
    const correctO15 = allMatches.filter(m => m.isOver15Correct).length;
    const correctBTTS = allMatches.filter(m => m.isBTTSCorrect).length;

    // Extended markets
    const htMatches = allMatches.filter(m => m.isHTCorrect !== undefined);
    const correctHT = htMatches.filter(m => m.isHTCorrect).length;
    const htftMatches = allMatches.filter(m => m.isHTFTCorrect !== undefined);
    const correctHTFT = htftMatches.filter(m => m.isHTFTCorrect).length;
    const fhMatches = allMatches.filter(m => m.is1HOver05Correct !== undefined);
    const correctFH05 = fhMatches.filter(m => m.is1HOver05Correct).length;
    const esMatches = allMatches.filter(m => m.isExactScoreCorrect !== undefined);
    const correctES = esMatches.filter(m => m.isExactScoreCorrect).length;

    // Over 3.5 analysis
    const predO35 = allMatches.map(m => {
      // Calculate O3.5 from xG using Poisson
      const totalXG = m.predictedHomeXG + m.predictedAwayXG;
      const u35 = AdvancedPredictionEngine.poissonCumulativeBelow(4, totalXG);
      const predOver35 = (1 - u35) * 100 > 50;
      const actualOver35 = m.actualTotalGoals > 3.5;
      return predOver35 === actualOver35;
    });
    const correctO35 = predO35.filter(Boolean).length;

    // ── CALIBRATION ANALYSIS (Brier Score + Bins) ──
    const calibBins: Record<string, { predicted: number; actual: number; count: number }> = {};
    const binSize = 10;
    let brierSum = 0;

    for (const m of allMatches) {
      // For 1X2 calibration: use the predicted probability of the chosen outcome
      const predProb = m.predictedResult === '1' ? m.predictedHomeProb :
                       m.predictedResult === '2' ? m.predictedAwayProb : m.predictedDrawProb;
      const actual = m.isCorrect ? 1 : 0;

      // Brier score component
      brierSum += Math.pow((predProb / 100) - actual, 2);

      // Calibration bin
      const binKey = `${Math.floor(predProb / binSize) * binSize}-${Math.floor(predProb / binSize) * binSize + binSize}`;
      if (!calibBins[binKey]) calibBins[binKey] = { predicted: 0, actual: 0, count: 0 };
      calibBins[binKey].predicted += predProb;
      calibBins[binKey].actual += actual;
      calibBins[binKey].count++;
    }

    const brierScore = total > 0 ? brierSum / total : 1;

    // Build calibration table
    const calibrationTable = Object.entries(calibBins)
      .sort(([a], [b]) => parseInt(a) - parseInt(b))
      .map(([bin, data]) => ({
        bin,
        count: data.count,
        avgPredicted: Math.round((data.predicted / data.count) * 100) / 100,
        actualRate: Math.round((data.actual / data.count) * 10000) / 100,
        calibrationError: Math.round(Math.abs((data.predicted / data.count) - (data.actual / data.count * 100)) * 100) / 100,
      }));

    // ── CONFIDENCE TIERS ──
    const highConf = allMatches.filter(m => m.confidence > 55);
    const medConf = allMatches.filter(m => m.confidence > 40 && m.confidence <= 55);
    const lowConf = allMatches.filter(m => m.confidence <= 40);
    const veryHighConf = allMatches.filter(m => m.confidence > 65);

    // ── HOME/DRAW/AWAY BREAKDOWN ──
    const homePreds = allMatches.filter(m => m.predictedResult === '1');
    const drawPreds = allMatches.filter(m => m.predictedResult === 'X');
    const awayPreds = allMatches.filter(m => m.predictedResult === '2');

    // ── ROI SIMULATION ──
    // Flat bet: 1 unit on predicted result at model-implied odds
    let flatProfit = 0;
    let confidenceProfit = 0; // Only bet when confidence > 55%

    for (const m of allMatches) {
      const impliedOdds = 100 / m.confidence;
      if (m.isCorrect) {
        flatProfit += (impliedOdds - 1);
      } else {
        flatProfit -= 1;
      }

      // Confidence-filtered betting
      if (m.confidence > 55) {
        if (m.isCorrect) {
          confidenceProfit += (impliedOdds - 1);
        } else {
          confidenceProfit -= 1;
        }
      }
    }

    const result: MassiveBacktestResult = {
      summary: {
        totalMatches: total,
        leagueSeasons: successCount,
        failedLeagueSeasons: failCount,
        seasonsUsed: seasons,
        leaguesUsed: leagues.map(l => l.name),
      },
      accuracy: {
        matchResult1X2: pct(correct1X2, total),
        over15: pct(correctO15, total),
        over25: pct(correctO25, total),
        over35: pct(correctO35, total),
        btts: pct(correctBTTS, total),
        htResult: pct(correctHT, htMatches.length),
        htft: pct(correctHTFT, htftMatches.length),
        firstHalfOver05: pct(correctFH05, fhMatches.length),
        exactScore: pct(correctES, esMatches.length),
      },
      breakdown1X2: {
        homeWin: {
          predicted: homePreds.length,
          correct: homePreds.filter(m => m.isCorrect).length,
          accuracy: pct(homePreds.filter(m => m.isCorrect).length, homePreds.length),
        },
        draw: {
          predicted: drawPreds.length,
          correct: drawPreds.filter(m => m.isCorrect).length,
          accuracy: pct(drawPreds.filter(m => m.isCorrect).length, drawPreds.length),
        },
        awayWin: {
          predicted: awayPreds.length,
          correct: awayPreds.filter(m => m.isCorrect).length,
          accuracy: pct(awayPreds.filter(m => m.isCorrect).length, awayPreds.length),
        },
      },
      confidenceTiers: {
        veryHigh_65plus: { total: veryHighConf.length, correct: veryHighConf.filter(m => m.isCorrect).length, accuracy: pct(veryHighConf.filter(m => m.isCorrect).length, veryHighConf.length) },
        high_55_65: { total: highConf.length - veryHighConf.length, correct: highConf.filter(m => m.isCorrect && m.confidence <= 65).length, accuracy: pct(highConf.filter(m => m.isCorrect && m.confidence <= 65).length, highConf.length - veryHighConf.length) },
        medium_40_55: { total: medConf.length, correct: medConf.filter(m => m.isCorrect).length, accuracy: pct(medConf.filter(m => m.isCorrect).length, medConf.length) },
        low_below_40: { total: lowConf.length, correct: lowConf.filter(m => m.isCorrect).length, accuracy: pct(lowConf.filter(m => m.isCorrect).length, lowConf.length) },
      },
      calibration: {
        brierScore: Math.round(brierScore * 10000) / 10000,
        // Perfect calibration = 0, pure random = 0.25 for 1X2
        calibrationTable,
      },
      roi: {
        flatBet: { profit: Math.round(flatProfit * 100) / 100, staked: total, roi: pct(flatProfit, total) },
        confidenceFiltered: {
          profit: Math.round(confidenceProfit * 100) / 100,
          staked: highConf.length,
          roi: pct(confidenceProfit, highConf.length),
        },
      },
      perLeague: leagueResults,
    };

    // Print massive summary
    console.log(`\n${'█'.repeat(70)}`);
    console.log(`  MASSIVE BACKTEST COMPLETE`);
    console.log(`${'█'.repeat(70)}`);
    console.log(`  Total: ${total} matches across ${successCount} league-seasons`);
    console.log(`  ─── ACCURACY ───`);
    console.log(`  1X2:     ${result.accuracy.matchResult1X2}%`);
    console.log(`  Over 1.5: ${result.accuracy.over15}%`);
    console.log(`  Over 2.5: ${result.accuracy.over25}%`);
    console.log(`  Over 3.5: ${result.accuracy.over35}%`);
    console.log(`  BTTS:    ${result.accuracy.btts}%`);
    console.log(`  HT Result: ${result.accuracy.htResult}% (${correctHT}/${htMatches.length})`);
    console.log(`  HT/FT:   ${result.accuracy.htft}% (${correctHTFT}/${htftMatches.length})`);
    console.log(`  1H O0.5: ${result.accuracy.firstHalfOver05}% (${correctFH05}/${fhMatches.length})`);
    console.log(`  Exact:   ${result.accuracy.exactScore}% (${correctES}/${esMatches.length})`);
    console.log(`  ���── CALIBRATION ───`);
    console.log(`  Brier Score: ${result.calibration.brierScore} (lower is better, random=0.25)`);
    console.log(`  ─── ROI ───`);
    console.log(`  Flat Bet: ${result.roi.flatBet.roi}% ROI (${result.roi.flatBet.profit} units / ${total} bets)`);
    console.log(`  Conf>55%: ${result.roi.confidenceFiltered.roi}% ROI (${result.roi.confidenceFiltered.profit} units / ${highConf.length} bets)`);
    console.log(`${'█'.repeat(70)}\n`);

    return result;
  }
}

// ═══════════════════════════════════════
// TYPES FOR MASSIVE BACKTEST
// ═══════════════════════════════════════

export interface MassiveBacktestResult {
  summary: {
    totalMatches: number;
    leagueSeasons: number;
    failedLeagueSeasons: number;
    seasonsUsed: number[];
    leaguesUsed: string[];
  };
  accuracy: {
    matchResult1X2: number;
    over15: number;
    over25: number;
    over35: number;
    btts: number;
    htResult: number;
    htft: number;
    firstHalfOver05: number;
    exactScore: number;
  };
  breakdown1X2: {
    homeWin: { predicted: number; correct: number; accuracy: number };
    draw: { predicted: number; correct: number; accuracy: number };
    awayWin: { predicted: number; correct: number; accuracy: number };
  };
  confidenceTiers: {
    veryHigh_65plus: { total: number; correct: number; accuracy: number };
    high_55_65: { total: number; correct: number; accuracy: number };
    medium_40_55: { total: number; correct: number; accuracy: number };
    low_below_40: { total: number; correct: number; accuracy: number };
  };
  calibration: {
    brierScore: number;
    calibrationTable: Array<{
      bin: string;
      count: number;
      avgPredicted: number;
      actualRate: number;
      calibrationError: number;
    }>;
  };
  roi: {
    flatBet: { profit: number; staked: number; roi: number };
    confidenceFiltered: { profit: number; staked: number; roi: number };
  };
  perLeague: Array<{
    league: string;
    season: number;
    accuracy1x2: number;
    matches: number;
    over25: number;
    btts: number;
  }>;
}

function pct(correct: number, total: number): number {
  return total > 0 ? Math.round((correct / total) * 10000) / 100 : 0;
}
