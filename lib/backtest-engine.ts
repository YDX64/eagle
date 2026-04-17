import { prisma } from '@/lib/db';
import { ApiFootballService } from '@/lib/api-football';

export interface BacktestOptions {
  leagueId?: number;
  teamId?: number;
  dateFrom: Date;
  dateTo: Date;
  predictionType?: string;
  algorithmVersion?: string;
  progressive?: boolean; // Enable progressive daily backtest
}

export interface BacktestResult {
  totalPredictions: number;
  correctPredictions: number;
  successRate: number;
  detailedMetrics: {
    homeWin: { count: number; correct: number; rate: number };
    awayWin: { count: number; correct: number; rate: number };
    draw: { count: number; correct: number; rate: number };
  };
  predictionTypeMetrics?: {
    matchWinner: { count: number; correct: number; rate: number };
    bothTeamsScore: { count: number; correct: number; rate: number };
    overUnderGoals: { count: number; correct: number; rate: number };
    btsYes: { count: number; correct: number; rate: number };
    btsNo: { count: number; correct: number; rate: number };
    goalsOver: { count: number; correct: number; rate: number };
    goalsUnder: { count: number; correct: number; rate: number };
  };
  confidenceMetrics: {
    high: { count: number; correct: number; rate: number };
    medium: { count: number; correct: number; rate: number };
    low: { count: number; correct: number; rate: number };
  };
  roiMetrics?: {
    totalStake: number;
    totalReturn: number;
    roiPercentage: number;
  };
}

export class BacktestEngine {
  static async runBacktest(options: BacktestOptions): Promise<BacktestResult> {
    console.log('[BACKTEST ENGINE] Starting backtest with options:', options);

    // If progressive mode is enabled, run daily progressive backtest
    if (options.progressive) {
      return this.runProgressiveBacktest(options);
    }

    try {
      // Get historical predictions
      console.log('[BACKTEST ENGINE] Fetching predictions from database...');
      const predictions = await prisma.prediction.findMany({
        where: {
          createdAt: {
            gte: options.dateFrom,
            lte: options.dateTo,
          },
          ...(options.predictionType && { prediction_type: options.predictionType }),
          ...(options.algorithmVersion && { algorithm_version: options.algorithmVersion }),
          match: {
            ...(options.leagueId && { league_id: options.leagueId }),
            ...(options.teamId && {
              OR: [
                { home_team_id: options.teamId },
                { away_team_id: options.teamId },
              ],
            }),
          },
        },
        include: {
          match: true,
        },
      });

      console.log(`[BACKTEST ENGINE] Found ${predictions.length} predictions to analyze`);

      if (predictions.length === 0) {
        console.log('[BACKTEST ENGINE] No predictions found for the given criteria');
        return {
          totalPredictions: 0,
          correctPredictions: 0,
          successRate: 0,
          detailedMetrics: {
            homeWin: { count: 0, correct: 0, rate: 0 },
            awayWin: { count: 0, correct: 0, rate: 0 },
            draw: { count: 0, correct: 0, rate: 0 },
          },
          confidenceMetrics: {
            high: { count: 0, correct: 0, rate: 0 },
            medium: { count: 0, correct: 0, rate: 0 },
            low: { count: 0, correct: 0, rate: 0 },
          },
          roiMetrics: {
            totalStake: 0,
            totalReturn: 0,
            roiPercentage: 0,
          },
        };
      }

      // Update predictions with actual results
      console.log('[BACKTEST ENGINE] Updating predictions with actual results...');
      const updatedPredictions = await this.updatePredictionsWithResults(predictions);

      // Calculate metrics
      console.log('[BACKTEST ENGINE] Calculating metrics...');
      const result = this.calculateBacktestMetrics(updatedPredictions);

      // Save backtest result to database
      console.log('[BACKTEST ENGINE] Saving results to database...');
      await this.saveBacktestResult(result, options);

      console.log('[BACKTEST ENGINE] Backtest completed successfully');
      return result;
    } catch (error) {
      console.error('[BACKTEST ENGINE] Error:', error);
      throw error;
    }
  }

  private static async updatePredictionsWithResults(predictions: any[]): Promise<any[]> {
    const updatedPredictions = [];

    for (const prediction of predictions) {
      const match = prediction.match;

      // Only process finished matches
      if (match.status_short !== 'FT') continue;

      const homeGoals = match.home_goals || 0;
      const awayGoals = match.away_goals || 0;
      const totalGoals = homeGoals + awayGoals;

      // Determine actual match result (home/away/draw)
      let matchActualResult = 'draw';
      if (homeGoals > awayGoals) matchActualResult = 'home';
      else if (awayGoals > homeGoals) matchActualResult = 'away';

      // Evaluate correctness based on prediction type
      let isCorrect: boolean;
      let actualResult: string;

      switch (prediction.prediction_type) {
        case 'match_winner':
        case 'ensemble':
          actualResult = matchActualResult;
          isCorrect = prediction.predicted_value === matchActualResult;
          break;

        case 'both_teams_score':
          actualResult = (homeGoals > 0 && awayGoals > 0) ? 'yes' : 'no';
          isCorrect = prediction.predicted_value === actualResult;
          break;

        case 'over_under_goals':
          // Default threshold 2.5; system stores 'over'/'under' as predicted_value
          actualResult = totalGoals > 2.5 ? 'over' : 'under';
          isCorrect = prediction.predicted_value === actualResult;
          break;

        default:
          // Generic fallback: compare against match result
          actualResult = matchActualResult;
          isCorrect = prediction.predicted_value === matchActualResult;
      }

      // Update prediction in database
      await prisma.prediction.update({
        where: { id: prediction.id },
        data: {
          is_correct: isCorrect,
          actual_result: actualResult,
        },
      });

      updatedPredictions.push({
        ...prediction,
        is_correct: isCorrect,
        actual_result: actualResult,
      });
    }

    return updatedPredictions;
  }

  private static calculateBacktestMetrics(predictions: any[]): BacktestResult {
    const totalPredictions = predictions.length;
    const correctPredictions = predictions.filter(p => p.is_correct).length;
    const successRate = totalPredictions > 0 ? (correctPredictions / totalPredictions) * 100 : 0;

    // Calculate detailed metrics by match_winner sub-types
    const homeWinPredictions = predictions.filter(p => p.prediction_type === 'match_winner' && p.predicted_value === 'home');
    const awayWinPredictions = predictions.filter(p => p.prediction_type === 'match_winner' && p.predicted_value === 'away');
    const drawPredictions = predictions.filter(p => p.prediction_type === 'match_winner' && p.predicted_value === 'draw');

    // Calculate metrics by prediction type
    const matchWinnerPreds = predictions.filter(p => p.prediction_type === 'match_winner' || p.prediction_type === 'ensemble');
    const btsPreds = predictions.filter(p => p.prediction_type === 'both_teams_score');
    const ouPreds = predictions.filter(p => p.prediction_type === 'over_under_goals');
    const btsYesPreds = btsPreds.filter(p => p.predicted_value === 'yes');
    const btsNoPreds = btsPreds.filter(p => p.predicted_value === 'no');
    const goalsOverPreds = ouPreds.filter(p => p.predicted_value === 'over');
    const goalsUnderPreds = ouPreds.filter(p => p.predicted_value === 'under');

    const calcRate = (arr: any[]) =>
      arr.length > 0 ? (arr.filter(p => p.is_correct).length / arr.length) * 100 : 0;

    // Calculate confidence metrics
    const highConfidence = predictions.filter(p => p.confidence_score >= 0.7);
    const mediumConfidence = predictions.filter(p => p.confidence_score >= 0.5 && p.confidence_score < 0.7);
    const lowConfidence = predictions.filter(p => p.confidence_score < 0.5);

    return {
      totalPredictions,
      correctPredictions,
      successRate,
      detailedMetrics: {
        homeWin: {
          count: homeWinPredictions.length,
          correct: homeWinPredictions.filter(p => p.is_correct).length,
          rate: calcRate(homeWinPredictions),
        },
        awayWin: {
          count: awayWinPredictions.length,
          correct: awayWinPredictions.filter(p => p.is_correct).length,
          rate: calcRate(awayWinPredictions),
        },
        draw: {
          count: drawPredictions.length,
          correct: drawPredictions.filter(p => p.is_correct).length,
          rate: calcRate(drawPredictions),
        },
      },
      predictionTypeMetrics: {
        matchWinner: {
          count: matchWinnerPreds.length,
          correct: matchWinnerPreds.filter(p => p.is_correct).length,
          rate: calcRate(matchWinnerPreds),
        },
        bothTeamsScore: {
          count: btsPreds.length,
          correct: btsPreds.filter(p => p.is_correct).length,
          rate: calcRate(btsPreds),
        },
        overUnderGoals: {
          count: ouPreds.length,
          correct: ouPreds.filter(p => p.is_correct).length,
          rate: calcRate(ouPreds),
        },
        btsYes: {
          count: btsYesPreds.length,
          correct: btsYesPreds.filter(p => p.is_correct).length,
          rate: calcRate(btsYesPreds),
        },
        btsNo: {
          count: btsNoPreds.length,
          correct: btsNoPreds.filter(p => p.is_correct).length,
          rate: calcRate(btsNoPreds),
        },
        goalsOver: {
          count: goalsOverPreds.length,
          correct: goalsOverPreds.filter(p => p.is_correct).length,
          rate: calcRate(goalsOverPreds),
        },
        goalsUnder: {
          count: goalsUnderPreds.length,
          correct: goalsUnderPreds.filter(p => p.is_correct).length,
          rate: calcRate(goalsUnderPreds),
        },
      },
      confidenceMetrics: {
        high: {
          count: highConfidence.length,
          correct: highConfidence.filter(p => p.is_correct).length,
          rate: calcRate(highConfidence),
        },
        medium: {
          count: mediumConfidence.length,
          correct: mediumConfidence.filter(p => p.is_correct).length,
          rate: calcRate(mediumConfidence),
        },
        low: {
          count: lowConfidence.length,
          correct: lowConfidence.filter(p => p.is_correct).length,
          rate: calcRate(lowConfidence),
        },
      },
      roiMetrics: this.calculateROI(predictions),
    };
  }

  private static calculateROI(predictions: any[]): { totalStake: number; totalReturn: number; roiPercentage: number } {
    // Assuming 1 unit stake per bet and average odds
    const totalStake = predictions.length;

    // Simplified ROI calculation (would need actual odds for real calculation)
    const avgOdds = {
      home: 2.5,
      away: 3.0,
      draw: 3.2,
    };

    let totalReturn = 0;
    predictions.forEach(p => {
      if (p.is_correct) {
        const odds = avgOdds[p.predicted_value as keyof typeof avgOdds] || 2.5;
        totalReturn += odds;
      }
    });

    const profit = totalReturn - totalStake;
    const roiPercentage = totalStake > 0 ? (profit / totalStake) * 100 : 0;

    return {
      totalStake,
      totalReturn,
      roiPercentage,
    };
  }

  private static async saveBacktestResult(result: BacktestResult, options: BacktestOptions): Promise<void> {
    await prisma.backtestResult.create({
      data: {
        league_id: options.leagueId,
        team_id: options.teamId,
        prediction_type: options.predictionType,
        date_from: options.dateFrom,
        date_to: options.dateTo,
        total_predictions: result.totalPredictions,
        correct_predictions: result.correctPredictions,
        success_rate: result.successRate,
        home_win_count: result.detailedMetrics.homeWin.count,
        home_win_correct: result.detailedMetrics.homeWin.correct,
        away_win_count: result.detailedMetrics.awayWin.count,
        away_win_correct: result.detailedMetrics.awayWin.correct,
        draw_count: result.detailedMetrics.draw.count,
        draw_correct: result.detailedMetrics.draw.correct,
        high_confidence_count: result.confidenceMetrics.high.count,
        high_confidence_correct: result.confidenceMetrics.high.correct,
        medium_confidence_count: result.confidenceMetrics.medium.count,
        medium_confidence_correct: result.confidenceMetrics.medium.correct,
        low_confidence_count: result.confidenceMetrics.low.count,
        low_confidence_correct: result.confidenceMetrics.low.correct,
        total_stake: result.roiMetrics?.totalStake,
        total_return: result.roiMetrics?.totalReturn,
        roi_percentage: result.roiMetrics?.roiPercentage,
        algorithm_version: options.algorithmVersion || '2.0',
        metadata: result as any,
      },
    });
  }

  static async runProgressiveBacktest(fromDate: Date, toDate: Date): Promise<BacktestResult>;
  static async runProgressiveBacktest(options: BacktestOptions): Promise<BacktestResult>;
  static async runProgressiveBacktest(fromDateOrOptions: Date | BacktestOptions, toDate?: Date): Promise<BacktestResult> {
    let options: BacktestOptions;

    if (fromDateOrOptions instanceof Date && toDate) {
      // Called with two Date parameters
      options = {
        dateFrom: fromDateOrOptions,
        dateTo: toDate,
      };
    } else {
      // Called with BacktestOptions
      options = fromDateOrOptions as BacktestOptions;
    }

    console.log('[BACKTEST ENGINE] Starting PROGRESSIVE backtest from', options.dateFrom, 'to', options.dateTo);

    const startDate = new Date(options.dateFrom);
    const endDate = new Date(options.dateTo);
    const dayInMs = 24 * 60 * 60 * 1000;

    let totalPredictions = 0;
    let correctPredictions = 0;
    const detailedMetrics = {
      homeWin: { count: 0, correct: 0, rate: 0 },
      awayWin: { count: 0, correct: 0, rate: 0 },
      draw: { count: 0, correct: 0, rate: 0 },
    };
    const confidenceMetrics = {
      high: { count: 0, correct: 0, rate: 0 },
      medium: { count: 0, correct: 0, rate: 0 },
      low: { count: 0, correct: 0, rate: 0 },
    };
    let totalStake = 0;
    let totalReturn = 0;

    // Process each day progressively
    for (let currentDate = new Date(startDate); currentDate <= endDate; currentDate = new Date(currentDate.getTime() + dayInMs)) {
      const nextDate = new Date(currentDate.getTime() + dayInMs);

      console.log(`[PROGRESSIVE] Processing ${currentDate.toISOString().split('T')[0]}`);

      // Get matches for current day
      const matches = await prisma.match.findMany({
        where: {
          timestamp: {
            gte: Math.floor(currentDate.getTime() / 1000),
            lt: Math.floor(nextDate.getTime() / 1000),
          },
          ...(options.leagueId && { league_id: options.leagueId }),
          ...(options.teamId && {
            OR: [
              { home_team_id: options.teamId },
              { away_team_id: options.teamId },
            ],
          }),
        },
      });

      console.log(`[PROGRESSIVE] Found ${matches.length} matches for ${currentDate.toISOString().split('T')[0]}`);

      // Generate predictions for each match (simulating real-time prediction)
      for (const match of matches) {
        // Here we would normally generate a new prediction using the algorithm
        // For now, we'll check if a prediction exists in the database
        const existingPrediction = await prisma.prediction.findFirst({
          where: {
            match_id: match.id,
            ...(options.predictionType && { prediction_type: options.predictionType }),
            ...(options.algorithmVersion && { algorithm_version: options.algorithmVersion }),
          },
        });

        if (existingPrediction) {
          totalPredictions++;

          // Wait for match to finish (in real scenario, this would be actual waiting)
          // For backtest, we check if match is finished and has results
          if (match.status_short === 'FT') {
            const homeGoals = match.home_goals || 0;
            const awayGoals = match.away_goals || 0;

            let actualResult = 'draw';
            if (homeGoals > awayGoals) actualResult = 'home';
            else if (awayGoals > homeGoals) actualResult = 'away';

            const isCorrect = existingPrediction.predicted_value === actualResult;
            if (isCorrect) correctPredictions++;

            // Update detailed metrics
            if (existingPrediction.predicted_value === 'home') {
              detailedMetrics.homeWin.count++;
              if (isCorrect) detailedMetrics.homeWin.correct++;
            } else if (existingPrediction.predicted_value === 'away') {
              detailedMetrics.awayWin.count++;
              if (isCorrect) detailedMetrics.awayWin.correct++;
            } else if (existingPrediction.predicted_value === 'draw') {
              detailedMetrics.draw.count++;
              if (isCorrect) detailedMetrics.draw.correct++;
            }

            // Update confidence metrics
            const confidence = existingPrediction.confidence_score || 0;
            if (confidence >= 0.7) {
              confidenceMetrics.high.count++;
              if (isCorrect) confidenceMetrics.high.correct++;
            } else if (confidence >= 0.5) {
              confidenceMetrics.medium.count++;
              if (isCorrect) confidenceMetrics.medium.correct++;
            } else {
              confidenceMetrics.low.count++;
              if (isCorrect) confidenceMetrics.low.correct++;
            }

            // Calculate ROI (simplified)
            totalStake++;
            if (isCorrect) {
              const avgOdds = { home: 2.5, away: 3.0, draw: 3.2 };
              const odds = avgOdds[existingPrediction.predicted_value as keyof typeof avgOdds] || 2.5;
              totalReturn += odds;
            }

            console.log(`[PROGRESSIVE] Match ${match.id}: Predicted ${existingPrediction.predicted_value}, Actual ${actualResult}, Correct: ${isCorrect}`);
          }
        }
      }
    }

    // Calculate final rates
    detailedMetrics.homeWin.rate = detailedMetrics.homeWin.count > 0
      ? (detailedMetrics.homeWin.correct / detailedMetrics.homeWin.count) * 100 : 0;
    detailedMetrics.awayWin.rate = detailedMetrics.awayWin.count > 0
      ? (detailedMetrics.awayWin.correct / detailedMetrics.awayWin.count) * 100 : 0;
    detailedMetrics.draw.rate = detailedMetrics.draw.count > 0
      ? (detailedMetrics.draw.correct / detailedMetrics.draw.count) * 100 : 0;

    confidenceMetrics.high.rate = confidenceMetrics.high.count > 0
      ? (confidenceMetrics.high.correct / confidenceMetrics.high.count) * 100 : 0;
    confidenceMetrics.medium.rate = confidenceMetrics.medium.count > 0
      ? (confidenceMetrics.medium.correct / confidenceMetrics.medium.count) * 100 : 0;
    confidenceMetrics.low.rate = confidenceMetrics.low.count > 0
      ? (confidenceMetrics.low.correct / confidenceMetrics.low.count) * 100 : 0;

    const profit = totalReturn - totalStake;
    const roiPercentage = totalStake > 0 ? (profit / totalStake) * 100 : 0;

    const result: BacktestResult = {
      totalPredictions,
      correctPredictions,
      successRate: totalPredictions > 0 ? (correctPredictions / totalPredictions) * 100 : 0,
      detailedMetrics,
      confidenceMetrics,
      roiMetrics: {
        totalStake,
        totalReturn,
        roiPercentage,
      },
    };

    // Save result to database
    await this.saveBacktestResult(result, options);

    console.log('[PROGRESSIVE BACKTEST] Completed successfully');
    console.log('[PROGRESSIVE BACKTEST] Results:', result);

    return result;
  }

  static async getStatistics(type: 'league' | 'team' | 'prediction', options?: any) {
    switch (type) {
      case 'league':
        return this.getLeagueStatistics(options);
      case 'team':
        return this.getTeamStatistics(options);
      case 'prediction':
        return this.getPredictionStatistics(options);
      default:
        throw new Error('Invalid statistics type');
    }
  }

  private static async getLeagueStatistics(options?: any) {
    const stats = await prisma.prediction.groupBy({
      by: ['match_id'],
      where: {
        is_correct: { not: null },
        ...(options?.dateFrom && { createdAt: { gte: options.dateFrom } }),
        ...(options?.dateTo && { createdAt: { lte: options.dateTo } }),
      },
      _count: {
        id: true,
      },
    });

    // Get match details to extract league info
    const matchIds = stats.map(s => s.match_id);
    const matches = await prisma.match.findMany({
      where: { id: { in: matchIds } },
      include: { league: true },
    });

    // Group by league
    const leagueStats = new Map();
    for (const match of matches) {
      const leagueKey = `${match.league_id}-${match.league_season}`;
      if (!leagueStats.has(leagueKey)) {
        leagueStats.set(leagueKey, {
          league_id: match.league_id,
          league_name: match.league.name,
          season: match.league_season,
          total: 0,
          correct: 0,
        });
      }

      const predictions = await prisma.prediction.findMany({
        where: { match_id: match.id },
      });

      const stat = leagueStats.get(leagueKey);
      stat.total += predictions.length;
      stat.correct += predictions.filter(p => p.is_correct).length;
    }

    // Calculate success rates
    const results = Array.from(leagueStats.values()).map(stat => ({
      ...stat,
      success_rate: stat.total > 0 ? (stat.correct / stat.total) * 100 : 0,
    }));

    return results.sort((a, b) => b.success_rate - a.success_rate);
  }

  private static async getTeamStatistics(options?: any) {
    const predictions = await prisma.prediction.findMany({
      where: {
        is_correct: { not: null },
        ...(options?.dateFrom && { createdAt: { gte: options.dateFrom } }),
        ...(options?.dateTo && { createdAt: { lte: options.dateTo } }),
      },
      include: {
        match: {
          include: {
            homeTeam: true,
            awayTeam: true,
          },
        },
      },
    });

    // Group by team
    const teamStats = new Map();

    for (const prediction of predictions) {
      const match = prediction.match;

      // Process home team
      if (!teamStats.has(match.home_team_id)) {
        teamStats.set(match.home_team_id, {
          team_id: match.home_team_id,
          team_name: match.homeTeam.name,
          total: 0,
          correct: 0,
        });
      }

      // Process away team
      if (!teamStats.has(match.away_team_id)) {
        teamStats.set(match.away_team_id, {
          team_id: match.away_team_id,
          team_name: match.awayTeam.name,
          total: 0,
          correct: 0,
        });
      }

      const homeStat = teamStats.get(match.home_team_id);
      const awayStat = teamStats.get(match.away_team_id);

      homeStat.total++;
      awayStat.total++;

      if (prediction.is_correct) {
        homeStat.correct++;
        awayStat.correct++;
      }
    }

    // Calculate success rates
    const results = Array.from(teamStats.values()).map(stat => ({
      ...stat,
      success_rate: stat.total > 0 ? (stat.correct / stat.total) * 100 : 0,
    }));

    return results.sort((a, b) => b.success_rate - a.success_rate);
  }

  private static async getPredictionStatistics(options?: any) {
    const stats = await prisma.prediction.groupBy({
      by: ['prediction_type', 'predicted_value'],
      where: {
        is_correct: { not: null },
        ...(options?.dateFrom && { createdAt: { gte: options.dateFrom } }),
        ...(options?.dateTo && { createdAt: { lte: options.dateTo } }),
      },
      _count: {
        id: true,
      },
      _sum: {
        confidence_score: true,
      },
    });

    const correctStats = await prisma.prediction.groupBy({
      by: ['prediction_type', 'predicted_value'],
      where: {
        is_correct: true,
        ...(options?.dateFrom && { createdAt: { gte: options.dateFrom } }),
        ...(options?.dateTo && { createdAt: { lte: options.dateTo } }),
      },
      _count: {
        id: true,
      },
    });

    // Merge stats
    const results = stats.map(stat => {
      const correct = correctStats.find(
        c => c.prediction_type === stat.prediction_type && c.predicted_value === stat.predicted_value
      );

      return {
        prediction_type: stat.prediction_type,
        predicted_value: stat.predicted_value,
        total: stat._count.id,
        correct: correct?._count.id || 0,
        success_rate: stat._count.id > 0 ? ((correct?._count.id || 0) / stat._count.id) * 100 : 0,
        avg_confidence: stat._count.id > 0 ? (stat._sum.confidence_score || 0) / stat._count.id : 0,
      };
    });

    return results.sort((a, b) => b.success_rate - a.success_rate);
  }
}