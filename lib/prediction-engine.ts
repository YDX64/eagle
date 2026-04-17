
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
  data_quality?: DataQuality;
}

// --- GoalFlux helpers (shared between basic + advanced engines) ---
const MAX_POISSON_K = 10;

function factorial(n: number): number {
  if (n <= 1) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

export function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

/** P(X <= k) under GoalFlux lambda */
export function poissonCdf(lambda: number, k: number): number {
  if (lambda <= 0) return 1;
  let acc = 0;
  const upper = Math.min(k, MAX_POISSON_K);
  for (let i = 0; i <= upper; i++) acc += poissonPmf(lambda, i);
  return Math.min(1, acc);
}

/** P(total goals > threshold) for two independent GoalFlux teams */
export function poissonOverProbability(lambdaHome: number, lambdaAway: number, threshold: number): number {
  const floor = Math.floor(threshold);
  const total = Math.max(0, lambdaHome) + Math.max(0, lambdaAway);
  return 1 - poissonCdf(total, floor);
}

/** BTTS = (1 - P(home=0)) * (1 - P(away=0)) assuming independence */
export function poissonBtts(lambdaHome: number, lambdaAway: number): number {
  const homeScores = 1 - Math.exp(-Math.max(0, lambdaHome));
  const awayScores = 1 - Math.exp(-Math.max(0, lambdaAway));
  return Math.max(0, Math.min(1, homeScores * awayScores));
}

export interface DataQuality {
  score: number;            // 0-1, overall data reliability
  form_samples: number;     // total last-N matches available (home+away)
  h2h_samples: number;
  used_fallback: boolean;   // true when any default stat filled in
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
    // Simple GoalFlux-based BGS calculation
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
    // Empirical: first halves produce ~42-45% of full-match goals.
    const firstHalfFactor = 0.43;
    const homeFirstHalfExpected = homeExpectedGoals * firstHalfFactor;
    const awayFirstHalfExpected = awayExpectedGoals * firstHalfFactor;
    const totalFirstHalfExpected = homeFirstHalfExpected + awayFirstHalfExpected;

    // GoalFlux CDF-based probabilities
    const over_0_5_probability = 1 - poissonCdf(totalFirstHalfExpected, 0);
    const over_1_5_probability = 1 - poissonCdf(totalFirstHalfExpected, 1);

    const homeFirstHalfProb = 1 - Math.exp(-Math.max(0, homeFirstHalfExpected));
    const awayFirstHalfProb = 1 - Math.exp(-Math.max(0, awayFirstHalfExpected));

    // Confidence = gap-from-coinflip; no artificial boost.
    const sampleSize = homeForm.recent_matches + awayForm.recent_matches;
    const sampleWeight = Math.min(1, sampleSize / 10);
    const edge = Math.abs(over_0_5_probability - 0.5) * 2;
    const confidence = Math.max(0, Math.min(1, edge * sampleWeight));

    return {
      prediction: over_0_5_probability > 0.5 ? 'yes' as const : 'no' as const,
      confidence,
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

    // Weight factors for final prediction (must sum to 1.0)
    const weights = {
      form: 0.30,
      home_advantage: 0.20,
      position: 0.25,
      goals: 0.25
    };

    // Composite score in [0,1] — 0.5 is neutral
    const compositeScore =
      (0.5 + formDifference * 0.5) * weights.form +
      homeAdvantageScore * weights.home_advantage +
      positionScore * weights.position +
      goalsAnalysis.expected_goals_score * weights.goals;

    // Data-quality driven confidence of the composite signal.
    const formSamples = homeForm.recent_matches + awayForm.recent_matches;
    const h2hSamples = h2hRecord?.total_matches ?? 0;
    const usedFallback =
      homeForm.recent_matches === 0 ||
      awayForm.recent_matches === 0 ||
      !h2hRecord ||
      h2hRecord.total_matches < 3 ||
      !homeStanding ||
      !awayStanding;
    const dataQualityScore = Math.max(
      0,
      Math.min(
        1,
        Math.min(1, formSamples / 10) * 0.5 +
        Math.min(1, h2hSamples / 5) * 0.2 +
        (homeStanding && awayStanding ? 0.3 : 0)
      )
    );

    // Derive 1X2 probabilities from composite + expected-goal gap.
    // "edge" ∈ [-1,1] where 1 means strong home bias.
    const edge = Math.max(-1, Math.min(1, (compositeScore - 0.5) * 2));
    const sigma = 0.9; // spread — larger = fatter draw tail
    const homeRaw = Math.exp(edge / sigma);
    const awayRaw = Math.exp(-edge / sigma);
    // Draw probability higher when teams are balanced AND BGS is low.
    const totalXg = goalsAnalysis.total_expected_goals;
    const drawBase = 0.28 + 0.20 * Math.exp(-Math.pow(edge * 2.2, 2));
    const drawRaw = drawBase * Math.exp(-Math.max(0, totalXg - 2.3) * 0.35);

    const sum1x2 = homeRaw + awayRaw + drawRaw;
    let homeProbability = homeRaw / sum1x2;
    let drawProbability = drawRaw / sum1x2;
    let awayProbability = awayRaw / sum1x2;

    // Determine winner prediction
    const maxProb = Math.max(homeProbability, drawProbability, awayProbability);
    let winner: 'home' | 'away' | 'draw' = 'draw';
    if (homeProbability === maxProb) winner = 'home';
    else if (awayProbability === maxProb) winner = 'away';

    // Both teams to score — proper independent-GoalFlux approximation.
    const bothTeamsScoreProb = poissonBtts(
      goalsAnalysis.home_expected_goals,
      goalsAnalysis.away_expected_goals
    );

    // Over/Under 2.5 — GoalFlux CDF over total BGS.
    const overUnderThreshold = 2.5;
    const overProbability = poissonOverProbability(
      goalsAnalysis.home_expected_goals,
      goalsAnalysis.away_expected_goals,
      overUnderThreshold
    );

    // First half goals prediction
    const firstHalfGoals = this.calculateFirstHalfGoals(
      goalsAnalysis.home_expected_goals,
      goalsAnalysis.away_expected_goals,
      homeForm,
      awayForm
    );

    // Confidence of each market = edge-from-coinflip × data-quality multiplier.
    // Prevents showing "85%" tier when all inputs were fallback defaults.
    const matchWinnerConfidence = maxProb * Math.max(0.3, dataQualityScore);
    const bttsConfidence = Math.abs(bothTeamsScoreProb - 0.5) * 2 * Math.max(0.3, dataQualityScore);
    const overConfidence = Math.abs(overProbability - 0.5) * 2 * Math.max(0.3, dataQualityScore);

    return {
      match_winner: {
        prediction: winner,
        confidence: matchWinnerConfidence,
        home_probability: homeProbability,
        away_probability: awayProbability,
        draw_probability: drawProbability
      },
      both_teams_score: {
        prediction: bothTeamsScoreProb > 0.5 ? 'yes' : 'no',
        confidence: bttsConfidence
      },
      over_under_goals: {
        prediction: overProbability > 0.5 ? 'over' : 'under',
        threshold: overUnderThreshold,
        confidence: overConfidence
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
      },
      data_quality: {
        score: dataQualityScore,
        form_samples: formSamples,
        h2h_samples: h2hSamples,
        used_fallback: usedFallback
      }
    };
  }
}
