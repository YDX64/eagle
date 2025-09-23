
import { Match, Team, Standing, MatchStatistic, HeadToHead } from '@prisma/client';

export interface TeamForm {
  recent_matches: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  form_score: number; // 0-1 scale
}

export interface PredictionFactors {
  home_form: TeamForm;
  away_form: TeamForm;
  head_to_head: {
    total_matches: number;
    home_team_wins: number;
    away_team_wins: number;
    draws: number;
    home_advantage_score: number; // 0-1 scale
  };
  league_standings: {
    home_position: number;
    away_position: number;
    points_difference: number;
    position_score: number; // 0-1 scale
  };
  goal_analysis: {
    home_avg_goals_for: number;
    home_avg_goals_against: number;
    away_avg_goals_for: number;
    away_avg_goals_against: number;
    expected_goals_score: number; // 0-1 scale
  };
}

export interface MatchPrediction {
  match_winner: {
    prediction: 'home' | 'away' | 'draw';
    confidence: number;
    home_probability: number;
    away_probability: number;
    draw_probability: number;
  };
  both_teams_score: {
    prediction: 'yes' | 'no';
    confidence: number;
  };
  over_under_goals: {
    prediction: 'over' | 'under';
    threshold: number;
    confidence: number;
  };
  first_half_goals: {
    prediction: 'yes' | 'no';
    confidence: number;
    home_first_half_probability: number;
    away_first_half_probability: number;
    over_0_5_probability: number;
    over_1_5_probability: number;
  };
  factors: PredictionFactors;
}

export class PredictionEngine {
  /**
   * Calculate team form based on recent matches
   */
  static calculateTeamForm(recentMatches: Match[], teamId: number): TeamForm {
    let wins = 0, draws = 0, losses = 0, goals_for = 0, goals_against = 0;
    
    recentMatches.forEach(match => {
      const isHome = match.home_team_id === teamId;
      const teamGoals = isHome ? (match.home_goals || 0) : (match.away_goals || 0);
      const opponentGoals = isHome ? (match.away_goals || 0) : (match.home_goals || 0);
      
      goals_for += teamGoals;
      goals_against += opponentGoals;
      
      if (teamGoals > opponentGoals) wins++;
      else if (teamGoals === opponentGoals) draws++;
      else losses++;
    });
    
    const total_matches = recentMatches.length;
    const points = (wins * 3) + draws;
    const max_points = total_matches * 3;
    const form_score = max_points > 0 ? points / max_points : 0.5;
    
    return {
      recent_matches: total_matches,
      wins,
      draws,
      losses,
      goals_for,
      goals_against,
      form_score
    };
  }

  /**
   * Calculate home advantage score based on head-to-head records
   */
  static calculateHomeAdvantage(h2hRecord: HeadToHead | null): number {
    if (!h2hRecord || h2hRecord.total_matches < 3) {
      return 0.55; // Default slight home advantage
    }
    
    const homeWinRate = h2hRecord.team1_wins / h2hRecord.total_matches;
    const awayWinRate = h2hRecord.team2_wins / h2hRecord.total_matches;
    
    // Adjust for general home advantage (typically 5-10% boost)
    const homeAdvantageBoost = 0.07;
    return Math.min(0.8, Math.max(0.2, homeWinRate + homeAdvantageBoost));
  }

  /**
   * Calculate position-based score from league standings
   */
  static calculatePositionScore(homeRank: number, awayRank: number, totalTeams: number = 20): number {
    const homeStrength = (totalTeams - homeRank + 1) / totalTeams;
    const awayStrength = (totalTeams - awayRank + 1) / totalTeams;
    
    // Return relative strength (0.5 = equal, >0.5 = home stronger)
    return homeStrength / (homeStrength + awayStrength);
  }

  /**
   * Calculate expected goals and scoring probability
   */
  static calculateGoalsAnalysis(
    homeAvgFor: number, homeAvgAgainst: number,
    awayAvgFor: number, awayAvgAgainst: number
  ) {
    // Simple Poisson-based expected goals calculation
    const homeExpectedGoals = (homeAvgFor + awayAvgAgainst) / 2;
    const awayExpectedGoals = (awayAvgFor + homeAvgAgainst) / 2;
    
    const totalExpectedGoals = homeExpectedGoals + awayExpectedGoals;
    
    return {
      home_expected_goals: homeExpectedGoals,
      away_expected_goals: awayExpectedGoals,
      total_expected_goals: totalExpectedGoals,
      expected_goals_score: homeExpectedGoals / (homeExpectedGoals + awayExpectedGoals)
    };
  }

  /**
   * Calculate first half goals prediction
   */
  static calculateFirstHalfGoals(
    homeExpectedGoals: number,
    awayExpectedGoals: number,
    homeForm: TeamForm,
    awayForm: TeamForm
  ) {
    // First half typically sees ~60% of full game goals
    const firstHalfFactor = 0.6;
    const homeFirstHalfExpected = homeExpectedGoals * firstHalfFactor;
    const awayFirstHalfExpected = awayExpectedGoals * firstHalfFactor;
    const totalFirstHalfExpected = homeFirstHalfExpected + awayFirstHalfExpected;
    
    // Probability calculations using Poisson distribution approximation
    const over_0_5_probability = 1 - Math.exp(-totalFirstHalfExpected);
    const over_1_5_probability = 1 - Math.exp(-totalFirstHalfExpected) * (1 + totalFirstHalfExpected);
    
    // Individual team first half goal probabilities
    const homeFirstHalfProb = 1 - Math.exp(-homeFirstHalfExpected);
    const awayFirstHalfProb = 1 - Math.exp(-awayFirstHalfExpected);
    
    // Confidence based on form consistency
    const homeFormConsistency = homeForm.recent_matches > 0 ? 
      1 - (Math.abs(homeForm.wins + homeForm.draws - homeForm.recent_matches / 2) / homeForm.recent_matches) : 0.5;
    const awayFormConsistency = awayForm.recent_matches > 0 ? 
      1 - (Math.abs(awayForm.wins + awayForm.draws - awayForm.recent_matches / 2) / awayForm.recent_matches) : 0.5;
    const confidence = (homeFormConsistency + awayFormConsistency) / 2;
    
    return {
      prediction: over_0_5_probability > 0.6 ? 'yes' as const : 'no' as const,
      confidence: Math.max(0.5, Math.min(0.9, confidence + 0.3)),
      home_first_half_probability: homeFirstHalfProb,
      away_first_half_probability: awayFirstHalfProb,
      over_0_5_probability,
      over_1_5_probability
    };
  }

  /**
   * Main prediction function
   */
  static async predictMatch(
    homeTeam: Team,
    awayTeam: Team,
    homeForm: TeamForm,
    awayForm: TeamForm,
    h2hRecord: HeadToHead | null,
    homeStanding?: Standing,
    awayStanding?: Standing
  ): Promise<MatchPrediction> {
    
    // Calculate individual factor scores
    const homeAdvantageScore = this.calculateHomeAdvantage(h2hRecord);
    const formDifference = homeForm.form_score - awayForm.form_score;
    
    let positionScore = 0.5;
    if (homeStanding && awayStanding) {
      positionScore = this.calculatePositionScore(homeStanding.rank, awayStanding.rank);
    }
    
    // Goal analysis
    const homeAvgFor = homeForm.recent_matches > 0 ? homeForm.goals_for / homeForm.recent_matches : 1.5;
    const homeAvgAgainst = homeForm.recent_matches > 0 ? homeForm.goals_against / homeForm.recent_matches : 1.5;
    const awayAvgFor = awayForm.recent_matches > 0 ? awayForm.goals_for / awayForm.recent_matches : 1.5;
    const awayAvgAgainst = awayForm.recent_matches > 0 ? awayForm.goals_against / awayForm.recent_matches : 1.5;
    
    const goalsAnalysis = this.calculateGoalsAnalysis(
      homeAvgFor, homeAvgAgainst, awayAvgFor, awayAvgAgainst
    );

    // Weight factors for final prediction
    const weights = {
      form: 0.3,
      home_advantage: 0.2,
      position: 0.25,
      goals: 0.25
    };

    // Calculate composite score (0 = away strong, 0.5 = even, 1 = home strong)
    const compositeScore = 
      (0.5 + formDifference * 0.5) * weights.form +
      homeAdvantageScore * weights.home_advantage +
      positionScore * weights.position +
      goalsAnalysis.expected_goals_score * weights.goals;

    // Convert to probabilities
    let homeProbability = Math.max(0.15, Math.min(0.7, compositeScore));
    let drawProbability = Math.max(0.2, 1 - Math.abs(compositeScore - 0.5) * 1.6);
    let awayProbability = 1 - homeProbability - drawProbability;
    
    // Normalize probabilities
    const total = homeProbability + drawProbability + awayProbability;
    homeProbability /= total;
    drawProbability /= total;
    awayProbability /= total;

    // Determine winner prediction
    const maxProb = Math.max(homeProbability, drawProbability, awayProbability);
    let winner: 'home' | 'away' | 'draw' = 'draw';
    if (homeProbability === maxProb) winner = 'home';
    else if (awayProbability === maxProb) winner = 'away';

    // Both teams to score prediction
    const avgGoalsPerTeam = (goalsAnalysis.home_expected_goals + goalsAnalysis.away_expected_goals) / 2;
    const bothTeamsScoreProb = Math.min(0.8, avgGoalsPerTeam * 0.35 + 0.2);
    
    // Over/Under prediction (typically 2.5 goals)
    const overUnderThreshold = 2.5;
    const overProbability = goalsAnalysis.total_expected_goals > overUnderThreshold ? 0.6 : 0.4;

    // First half goals prediction
    const firstHalfGoals = this.calculateFirstHalfGoals(
      goalsAnalysis.home_expected_goals,
      goalsAnalysis.away_expected_goals,
      homeForm,
      awayForm
    );

    return {
      match_winner: {
        prediction: winner,
        confidence: maxProb,
        home_probability: homeProbability,
        away_probability: awayProbability,
        draw_probability: drawProbability
      },
      both_teams_score: {
        prediction: bothTeamsScoreProb > 0.5 ? 'yes' : 'no',
        confidence: Math.abs(bothTeamsScoreProb - 0.5) * 2
      },
      over_under_goals: {
        prediction: overProbability > 0.5 ? 'over' : 'under',
        threshold: overUnderThreshold,
        confidence: Math.abs(overProbability - 0.5) * 2
      },
      first_half_goals: firstHalfGoals,
      factors: {
        home_form: homeForm,
        away_form: awayForm,
        head_to_head: {
          total_matches: h2hRecord?.total_matches || 0,
          home_team_wins: h2hRecord?.team1_wins || 0,
          away_team_wins: h2hRecord?.team2_wins || 0,
          draws: h2hRecord?.draws || 0,
          home_advantage_score: homeAdvantageScore
        },
        league_standings: {
          home_position: homeStanding?.rank || 0,
          away_position: awayStanding?.rank || 0,
          points_difference: (homeStanding?.points || 0) - (awayStanding?.points || 0),
          position_score: positionScore
        },
        goal_analysis: {
          home_avg_goals_for: homeAvgFor,
          home_avg_goals_against: homeAvgAgainst,
          away_avg_goals_for: awayAvgFor,
          away_avg_goals_against: awayAvgAgainst,
          expected_goals_score: goalsAnalysis.expected_goals_score
        }
      }
    };
  }
}
