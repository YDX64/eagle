import { ApiFootballService } from './api-football';
import { prisma } from './db';

interface ComprehensivePrediction {
  matchId: number;
  date: Date;
  homeTeam: string;
  awayTeam: string;
  league: string;

  // Match Result Predictions
  matchResult: {
    prediction: 'home' | 'draw' | 'away';
    confidence: number;
    actual?: 'home' | 'draw' | 'away';
    correct?: boolean;
  };

  // Goals Predictions
  goals: {
    over15: { prediction: boolean; confidence: number; actual?: boolean; correct?: boolean };
    over25: { prediction: boolean; confidence: number; actual?: boolean; correct?: boolean };
    over35: { prediction: boolean; confidence: number; actual?: boolean; correct?: boolean };
    bothTeamsScore: { prediction: boolean; confidence: number; actual?: boolean; correct?: boolean };
    exactGoals: { home: number; away: number; confidence: number; actualHome?: number; actualAway?: number; correct?: boolean };
  };

  // Corners Predictions
  corners: {
    over85: { prediction: boolean; confidence: number; actual?: boolean; correct?: boolean };
    over95: { prediction: boolean; confidence: number; actual?: boolean; correct?: boolean };
    over105: { prediction: boolean; confidence: number; actual?: boolean; correct?: boolean };
    totalCorners: { prediction: number; confidence: number; actual?: number; difference?: number };
  };

  // Cards Predictions
  cards: {
    over25Cards: { prediction: boolean; confidence: number; actual?: boolean; correct?: boolean };
    over35Cards: { prediction: boolean; confidence: number; actual?: boolean; correct?: boolean };
    bothTeamsCards: { prediction: boolean; confidence: number; actual?: boolean; correct?: boolean };
    redCard: { prediction: boolean; confidence: number; actual?: boolean; correct?: boolean };
  };

  // Half Time Predictions
  halfTime: {
    result: { prediction: 'home' | 'draw' | 'away'; confidence: number; actual?: string; correct?: boolean };
    over05Goals: { prediction: boolean; confidence: number; actual?: boolean; correct?: boolean };
    bothTeamsScoreHT: { prediction: boolean; confidence: number; actual?: boolean; correct?: boolean };
  };
}

interface BacktestResults {
  period: { from: Date; to: Date };
  totalMatches: number;

  // Results by Prediction Type
  matchResult: {
    total: number;
    correct: number;
    accuracy: number;
    byConfidence: {
      high: { total: number; correct: number; accuracy: number };
      medium: { total: number; correct: number; accuracy: number };
      low: { total: number; correct: number; accuracy: number };
    };
  };

  goals: {
    over15: { total: number; correct: number; accuracy: number };
    over25: { total: number; correct: number; accuracy: number };
    over35: { total: number; correct: number; accuracy: number };
    bothTeamsScore: { total: number; correct: number; accuracy: number };
  };

  corners: {
    over85: { total: number; correct: number; accuracy: number };
    over95: { total: number; correct: number; accuracy: number };
    over105: { total: number; correct: number; accuracy: number };
    averageDifference: number;
  };

  cards: {
    over25: { total: number; correct: number; accuracy: number };
    over35: { total: number; correct: number; accuracy: number };
    bothTeamsCards: { total: number; correct: number; accuracy: number };
    redCard: { total: number; correct: number; accuracy: number };
  };

  halfTime: {
    result: { total: number; correct: number; accuracy: number };
    over05Goals: { total: number; correct: number; accuracy: number };
  };

  // Best Performing Markets
  bestMarkets: Array<{
    market: string;
    accuracy: number;
    totalBets: number;
    profit: number;
  }>;

  // Algorithm Performance
  algorithmComparison: {
    basic: { accuracy: number; markets: string[] };
    advanced: { accuracy: number; markets: string[] };
    poisson: { accuracy: number; markets: string[] };
    momentum: { accuracy: number; markets: string[] };
  };
}

export class ComprehensiveBacktest {

  static async generateAllPredictions(matchId: number): Promise<ComprehensivePrediction> {
    // Mock match data for now
    const match: any = null; // await ApiFootballService.getFixture(matchId);
    if (!match) throw new Error('Match not found');

    const homeTeamId = match.teams.home.id;
    const awayTeamId = match.teams.away.id;
    const leagueId = match.league.id;
    const season = match.league.season;

    // Get historical data for predictions
    const homeStats = await this.getTeamStats(homeTeamId, leagueId, season);
    const awayStats = await this.getTeamStats(awayTeamId, leagueId, season);

    // Generate comprehensive predictions
    const prediction: ComprehensivePrediction = {
      matchId,
      date: new Date(match.fixture.date),
      homeTeam: match.teams.home.name,
      awayTeam: match.teams.away.name,
      league: match.league.name,

      // Match Result (using existing algorithms)
      matchResult: this.predictMatchResult(homeStats, awayStats),

      // Goals Predictions
      goals: {
        over15: this.predictOverGoals(homeStats, awayStats, 1.5),
        over25: this.predictOverGoals(homeStats, awayStats, 2.5),
        over35: this.predictOverGoals(homeStats, awayStats, 3.5),
        bothTeamsScore: this.predictBothTeamsScore(homeStats, awayStats),
        exactGoals: this.predictExactScore(homeStats, awayStats)
      },

      // Corners Predictions
      corners: {
        over85: this.predictOverCorners(homeStats, awayStats, 8.5),
        over95: this.predictOverCorners(homeStats, awayStats, 9.5),
        over105: this.predictOverCorners(homeStats, awayStats, 10.5),
        totalCorners: this.predictTotalCorners(homeStats, awayStats)
      },

      // Cards Predictions
      cards: {
        over25Cards: this.predictOverCards(homeStats, awayStats, 2.5),
        over35Cards: this.predictOverCards(homeStats, awayStats, 3.5),
        bothTeamsCards: this.predictBothTeamsCards(homeStats, awayStats),
        redCard: this.predictRedCard(homeStats, awayStats)
      },

      // Half Time Predictions
      halfTime: {
        result: this.predictHalfTimeResult(homeStats, awayStats),
        over05Goals: this.predictHalfTimeGoals(homeStats, awayStats, 0.5),
        bothTeamsScoreHT: this.predictBothTeamsScoreHT(homeStats, awayStats)
      }
    };

    return prediction;
  }

  private static async getTeamStats(teamId: number, leagueId: number, season: number) {
    // Get last 10 matches - Mock for now
    const matches: any[] = [];

    // Calculate statistics
    let totalGoalsFor = 0;
    let totalGoalsAgainst = 0;
    let totalCorners = 0;
    let totalCards = 0;
    let wins = 0;
    let draws = 0;
    let losses = 0;

    for (const match of matches) {
      const isHome = match.teams.home.id === teamId;
      totalGoalsFor += isHome ? match.goals.home : match.goals.away;
      totalGoalsAgainst += isHome ? match.goals.away : match.goals.home;

      // Get match statistics if available - Mock for now
      // const stats = await ApiFootballService.getFixtureStatistics(match.fixture.id);
      // if (stats) {
      //   const teamStats = stats.find(s => s.team.id === teamId);
      //   if (teamStats) {
      //     totalCorners += teamStats.statistics.find(s => s.type === 'Corner Kicks')?.value || 0;
      //     totalCards += (teamStats.statistics.find(s => s.type === 'Yellow Cards')?.value || 0) +
      //                  (teamStats.statistics.find(s => s.type === 'Red Cards')?.value || 0);
      //   }
      // }

      if (match.goals.home > match.goals.away) {
        isHome ? wins++ : losses++;
      } else if (match.goals.home < match.goals.away) {
        isHome ? losses++ : wins++;
      } else {
        draws++;
      }
    }

    return {
      avgGoalsFor: totalGoalsFor / matches.length,
      avgGoalsAgainst: totalGoalsAgainst / matches.length,
      avgCorners: totalCorners / matches.length,
      avgCards: totalCards / matches.length,
      winRate: wins / matches.length,
      drawRate: draws / matches.length,
      lossRate: losses / matches.length,
      formScore: (wins * 3 + draws) / (matches.length * 3)
    };
  }

  private static predictMatchResult(homeStats: any, awayStats: any) {
    const homeAdvantage = 1.15;
    const homeScore = homeStats.formScore * homeAdvantage;
    const awayScore = awayStats.formScore;

    const total = homeScore + awayScore + 0.3; // 0.3 for draw probability

    const homeProb = homeScore / total;
    const drawProb = 0.3 / total;
    const awayProb = awayScore / total;

    let prediction: 'home' | 'draw' | 'away';
    if (homeProb > awayProb && homeProb > drawProb) prediction = 'home';
    else if (awayProb > drawProb) prediction = 'away';
    else prediction = 'draw';

    return {
      prediction,
      confidence: Math.max(homeProb, drawProb, awayProb)
    };
  }

  private static predictOverGoals(homeStats: any, awayStats: any, threshold: number) {
    const expectedGoals = homeStats.avgGoalsFor + awayStats.avgGoalsFor;
    const probability = 1 - this.poissonCDF(threshold, expectedGoals);

    return {
      prediction: probability > 0.5,
      confidence: probability
    };
  }

  private static predictBothTeamsScore(homeStats: any, awayStats: any) {
    const homeScoringProb = 1 - Math.exp(-homeStats.avgGoalsFor);
    const awayScoringProb = 1 - Math.exp(-awayStats.avgGoalsFor);
    const probability = homeScoringProb * awayScoringProb;

    return {
      prediction: probability > 0.5,
      confidence: probability
    };
  }

  private static predictExactScore(homeStats: any, awayStats: any) {
    const homeGoals = Math.round(homeStats.avgGoalsFor * 1.1); // Home advantage
    const awayGoals = Math.round(awayStats.avgGoalsFor * 0.9);

    return {
      home: homeGoals,
      away: awayGoals,
      confidence: 0.15 // Exact score predictions are low confidence
    };
  }

  private static predictOverCorners(homeStats: any, awayStats: any, threshold: number) {
    const expectedCorners = homeStats.avgCorners + awayStats.avgCorners;
    const probability = expectedCorners > threshold ? 0.6 + (expectedCorners - threshold) * 0.1 : 0.4;

    return {
      prediction: probability > 0.5,
      confidence: Math.min(probability, 0.8)
    };
  }

  private static predictTotalCorners(homeStats: any, awayStats: any) {
    const prediction = Math.round(homeStats.avgCorners + awayStats.avgCorners);

    return {
      prediction,
      confidence: 0.45 // Corner predictions are moderate confidence
    };
  }

  private static predictOverCards(homeStats: any, awayStats: any, threshold: number) {
    const expectedCards = homeStats.avgCards + awayStats.avgCards;
    const probability = expectedCards > threshold ? 0.55 + (expectedCards - threshold) * 0.15 : 0.45;

    return {
      prediction: probability > 0.5,
      confidence: Math.min(probability, 0.75)
    };
  }

  private static predictBothTeamsCards(homeStats: any, awayStats: any) {
    const homeCardProb = Math.min(homeStats.avgCards / 2, 0.8);
    const awayCardProb = Math.min(awayStats.avgCards / 2, 0.8);
    const probability = homeCardProb * awayCardProb;

    return {
      prediction: probability > 0.5,
      confidence: probability
    };
  }

  private static predictRedCard(homeStats: any, awayStats: any) {
    // Red cards are rare, base on high card average
    const totalCards = homeStats.avgCards + awayStats.avgCards;
    const probability = totalCards > 4 ? 0.25 : 0.1;

    return {
      prediction: probability > 0.2,
      confidence: probability
    };
  }

  private static predictHalfTimeResult(homeStats: any, awayStats: any) {
    // Half time results are less predictable
    const result = this.predictMatchResult(homeStats, awayStats);
    return {
      prediction: result.prediction,
      confidence: result.confidence * 0.7
    };
  }

  private static predictHalfTimeGoals(homeStats: any, awayStats: any, threshold: number) {
    const htGoals = (homeStats.avgGoalsFor + awayStats.avgGoalsFor) * 0.4; // 40% of goals in first half
    const probability = htGoals > threshold ? 0.6 : 0.4;

    return {
      prediction: probability > 0.5,
      confidence: probability
    };
  }

  private static predictBothTeamsScoreHT(homeStats: any, awayStats: any) {
    const btts = this.predictBothTeamsScore(homeStats, awayStats);
    return {
      prediction: btts.prediction,
      confidence: btts.confidence * 0.3 // Much less likely in first half
    };
  }

  private static poissonCDF(k: number, lambda: number): number {
    let sum = 0;
    for (let i = 0; i <= Math.floor(k); i++) {
      sum += (Math.pow(lambda, i) * Math.exp(-lambda)) / this.factorial(i);
    }
    return sum;
  }

  private static factorial(n: number): number {
    if (n <= 1) return 1;
    return n * this.factorial(n - 1);
  }

  static async runComprehensiveBacktest(fromDate: Date, toDate: Date): Promise<BacktestResults> {
    // Initialize results structure
    const results: BacktestResults = {
      period: { from: fromDate, to: toDate },
      totalMatches: 0,
      matchResult: {
        total: 0,
        correct: 0,
        accuracy: 0,
        byConfidence: {
          high: { total: 0, correct: 0, accuracy: 0 },
          medium: { total: 0, correct: 0, accuracy: 0 },
          low: { total: 0, correct: 0, accuracy: 0 }
        }
      },
      goals: {
        over15: { total: 0, correct: 0, accuracy: 0 },
        over25: { total: 0, correct: 0, accuracy: 0 },
        over35: { total: 0, correct: 0, accuracy: 0 },
        bothTeamsScore: { total: 0, correct: 0, accuracy: 0 }
      },
      corners: {
        over85: { total: 0, correct: 0, accuracy: 0 },
        over95: { total: 0, correct: 0, accuracy: 0 },
        over105: { total: 0, correct: 0, accuracy: 0 },
        averageDifference: 0
      },
      cards: {
        over25: { total: 0, correct: 0, accuracy: 0 },
        over35: { total: 0, correct: 0, accuracy: 0 },
        bothTeamsCards: { total: 0, correct: 0, accuracy: 0 },
        redCard: { total: 0, correct: 0, accuracy: 0 }
      },
      halfTime: {
        result: { total: 0, correct: 0, accuracy: 0 },
        over05Goals: { total: 0, correct: 0, accuracy: 0 }
      },
      bestMarkets: [],
      algorithmComparison: {
        basic: { accuracy: 0, markets: [] },
        advanced: { accuracy: 0, markets: [] },
        poisson: { accuracy: 0, markets: [] },
        momentum: { accuracy: 0, markets: [] }
      }
    };

    // Get all matches in date range
    const currentDate = new Date(fromDate);
    while (currentDate <= toDate) {
      const dateStr = currentDate.toISOString().split('T')[0];

      try {
        // Mock matches for now
        const matches: any[] = []; // await ApiFootballService.getFixturesByDate(dateStr);

        for (const match of matches.slice(0, 5)) { // Process first 5 matches per day for testing
          if (match.fixture.status.short === 'FT') { // Only finished matches
            const prediction = await this.generateAllPredictions(match.fixture.id);

            // Update actual results
            this.updateActualResults(prediction, match);

            // Calculate accuracies
            this.calculateAccuracies(prediction, results);

            results.totalMatches++;
          }
        }
      } catch (error) {
        // Silent error handling
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Calculate final accuracies
    this.calculateFinalAccuracies(results);

    // Determine best markets
    results.bestMarkets = this.determineBestMarkets(results);

    return results;
  }

  private static updateActualResults(prediction: ComprehensivePrediction, match: any) {
    // Match result
    const homeGoals = match.goals.home || 0;
    const awayGoals = match.goals.away || 0;

    if (homeGoals > awayGoals) {
      prediction.matchResult.actual = 'home';
    } else if (awayGoals > homeGoals) {
      prediction.matchResult.actual = 'away';
    } else {
      prediction.matchResult.actual = 'draw';
    }
    prediction.matchResult.correct = prediction.matchResult.prediction === prediction.matchResult.actual;

    // Goals
    const totalGoals = homeGoals + awayGoals;
    prediction.goals.over15.actual = totalGoals > 1.5;
    prediction.goals.over15.correct = prediction.goals.over15.prediction === prediction.goals.over15.actual;

    prediction.goals.over25.actual = totalGoals > 2.5;
    prediction.goals.over25.correct = prediction.goals.over25.prediction === prediction.goals.over25.actual;

    prediction.goals.over35.actual = totalGoals > 3.5;
    prediction.goals.over35.correct = prediction.goals.over35.prediction === prediction.goals.over35.actual;

    prediction.goals.bothTeamsScore.actual = homeGoals > 0 && awayGoals > 0;
    prediction.goals.bothTeamsScore.correct = prediction.goals.bothTeamsScore.prediction === prediction.goals.bothTeamsScore.actual;

    // Half time
    const htHome = match.score.halftime?.home || 0;
    const htAway = match.score.halftime?.away || 0;
    prediction.halfTime.over05Goals.actual = (htHome + htAway) > 0.5;
    prediction.halfTime.over05Goals.correct = prediction.halfTime.over05Goals.prediction === prediction.halfTime.over05Goals.actual;
  }

  private static calculateAccuracies(prediction: ComprehensivePrediction, results: BacktestResults) {
    // Match result
    results.matchResult.total++;
    if (prediction.matchResult.correct) results.matchResult.correct++;

    const confidence = prediction.matchResult.confidence;
    if (confidence > 0.6) {
      results.matchResult.byConfidence.high.total++;
      if (prediction.matchResult.correct) results.matchResult.byConfidence.high.correct++;
    } else if (confidence > 0.4) {
      results.matchResult.byConfidence.medium.total++;
      if (prediction.matchResult.correct) results.matchResult.byConfidence.medium.correct++;
    } else {
      results.matchResult.byConfidence.low.total++;
      if (prediction.matchResult.correct) results.matchResult.byConfidence.low.correct++;
    }

    // Goals
    results.goals.over15.total++;
    if (prediction.goals.over15.correct) results.goals.over15.correct++;

    results.goals.over25.total++;
    if (prediction.goals.over25.correct) results.goals.over25.correct++;

    results.goals.over35.total++;
    if (prediction.goals.over35.correct) results.goals.over35.correct++;

    results.goals.bothTeamsScore.total++;
    if (prediction.goals.bothTeamsScore.correct) results.goals.bothTeamsScore.correct++;

    // Half time
    results.halfTime.over05Goals.total++;
    if (prediction.halfTime.over05Goals.correct) results.halfTime.over05Goals.correct++;
  }

  private static calculateFinalAccuracies(results: BacktestResults) {
    // Match result
    if (results.matchResult.total > 0) {
      results.matchResult.accuracy = (results.matchResult.correct / results.matchResult.total) * 100;

      if (results.matchResult.byConfidence.high.total > 0) {
        results.matchResult.byConfidence.high.accuracy =
          (results.matchResult.byConfidence.high.correct / results.matchResult.byConfidence.high.total) * 100;
      }
      if (results.matchResult.byConfidence.medium.total > 0) {
        results.matchResult.byConfidence.medium.accuracy =
          (results.matchResult.byConfidence.medium.correct / results.matchResult.byConfidence.medium.total) * 100;
      }
      if (results.matchResult.byConfidence.low.total > 0) {
        results.matchResult.byConfidence.low.accuracy =
          (results.matchResult.byConfidence.low.correct / results.matchResult.byConfidence.low.total) * 100;
      }
    }

    // Goals
    if (results.goals.over15.total > 0) {
      results.goals.over15.accuracy = (results.goals.over15.correct / results.goals.over15.total) * 100;
    }
    if (results.goals.over25.total > 0) {
      results.goals.over25.accuracy = (results.goals.over25.correct / results.goals.over25.total) * 100;
    }
    if (results.goals.over35.total > 0) {
      results.goals.over35.accuracy = (results.goals.over35.correct / results.goals.over35.total) * 100;
    }
    if (results.goals.bothTeamsScore.total > 0) {
      results.goals.bothTeamsScore.accuracy = (results.goals.bothTeamsScore.correct / results.goals.bothTeamsScore.total) * 100;
    }

    // Half time
    if (results.halfTime.over05Goals.total > 0) {
      results.halfTime.over05Goals.accuracy = (results.halfTime.over05Goals.correct / results.halfTime.over05Goals.total) * 100;
    }
  }

  private static determineBestMarkets(results: BacktestResults): Array<any> {
    const markets = [
      { market: 'Match Result', accuracy: results.matchResult.accuracy, totalBets: results.matchResult.total, profit: 0 },
      { market: 'Over 1.5 Goals', accuracy: results.goals.over15.accuracy, totalBets: results.goals.over15.total, profit: 0 },
      { market: 'Over 2.5 Goals', accuracy: results.goals.over25.accuracy, totalBets: results.goals.over25.total, profit: 0 },
      { market: 'Over 3.5 Goals', accuracy: results.goals.over35.accuracy, totalBets: results.goals.over35.total, profit: 0 },
      { market: 'Both Teams Score', accuracy: results.goals.bothTeamsScore.accuracy, totalBets: results.goals.bothTeamsScore.total, profit: 0 },
      { market: 'HT Over 0.5 Goals', accuracy: results.halfTime.over05Goals.accuracy, totalBets: results.halfTime.over05Goals.total, profit: 0 }
    ];

    // Sort by accuracy
    return markets.sort((a, b) => b.accuracy - a.accuracy).slice(0, 5);
  }
}