
import { Match, Team, MatchStatistic, HeadToHead } from '@prisma/client';
import type { Standing } from '@/lib/api-football';

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
   * Poisson probability P(X=k) for given lambda
   */
  static poissonProbability(k: number, lambda: number): number {
    if (lambda <= 0) return k === 0 ? 1 : 0;
    let logP = -lambda + k * Math.log(lambda);
    for (let i = 2; i <= k; i++) logP -= Math.log(i);
    return Math.exp(logP);
  }

  /**
   * Calculate team form based on recent matches
   * Uses exponential weighting: weight = 0.84^(games_ago)
   * Most recent match has ~2x the weight of the 5th most recent
   */
  static calculateTeamForm(recentMatches: Match[], teamId: number): TeamForm {
    let wins = 0, draws = 0, losses = 0, goals_for = 0, goals_against = 0;
    let weightedPoints = 0, totalWeight = 0;

    // Matches should be sorted most recent first
    recentMatches.forEach((match, idx) => {
      const isHome = match.home_team_id === teamId;
      const teamGoals = isHome ? (match.home_goals || 0) : (match.away_goals || 0);
      const opponentGoals = isHome ? (match.away_goals || 0) : (match.home_goals || 0);

      goals_for += teamGoals;
      goals_against += opponentGoals;

      // Exponential weight: 0.84^idx => game 0=1.0, game 4=0.498 (~2x ratio)
      const weight = Math.pow(0.84, idx);
      totalWeight += weight;

      if (teamGoals > opponentGoals) {
        wins++;
        weightedPoints += 3 * weight;
      } else if (teamGoals === opponentGoals) {
        draws++;
        weightedPoints += 1 * weight;
      } else {
        losses++;
        // 0 points
      }
    });

    const total_matches = recentMatches.length;
    // Weighted form score: normalize to 0-1 (max possible = 3 * totalWeight)
    const maxWeightedPoints = totalWeight * 3;
    const form_score = maxWeightedPoints > 0 ? weightedPoints / maxWeightedPoints : 0.5;

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
   * Calculate home advantage score based on head-to-head records and standings
   * Uses actual home/away win rates when available, not flat multipliers
   * Typical home win rate in most leagues: 45-50%
   */
  static calculateHomeAdvantage(
    h2hRecord: HeadToHead | null,
    homeStanding?: Standing,
    awayStanding?: Standing
  ): number {
    // Data-driven: use actual home/away win rates from standings
    let dataHomeAdvantage = 0.47; // League-typical default (~47% home win rate)
    if (homeStanding && awayStanding) {
      const hPlayed = homeStanding.home?.played || 0;
      const aPlayed = awayStanding.away?.played || 0;
      if (hPlayed > 0 && aPlayed > 0) {
        const homeWinRateAtHome = homeStanding.home.win / hPlayed;
        const awayWinRateAway = awayStanding.away.win / aPlayed;
        // Blend: how strong this home team is at home vs how weak the away team is away
        dataHomeAdvantage = (homeWinRateAtHome + (1 - awayWinRateAway)) / 2;
      }
    }

    // H2H adjustment with sample-size-dependent blending
    if (h2hRecord && h2hRecord.total_matches > 0) {
      const h2hHomeRate = h2hRecord.team1_wins / h2hRecord.total_matches;
      // Blend: <3 matches -> 30% H2H / 70% data, 5+ -> 50/50
      const h2hBlend = h2hRecord.total_matches < 3 ? 0.30
        : h2hRecord.total_matches < 5 ? 0.30 + (h2hRecord.total_matches - 2) * 0.067
        : 0.50;
      dataHomeAdvantage = dataHomeAdvantage * (1 - h2hBlend) + h2hHomeRate * h2hBlend;
    }

    return Math.min(0.75, Math.max(0.25, dataHomeAdvantage));
  }

  /**
   * Calculate position-based score from league standings
   * Uses points-per-game rather than raw position for accuracy
   * (3rd place with 2.1 PPG is very different from 3rd with 1.5 PPG)
   */
  static calculatePositionScore(
    homeRank: number,
    awayRank: number,
    totalTeams: number = 20,
    homeStanding?: Standing,
    awayStanding?: Standing
  ): number {
    // Prefer PPG-based calculation when standings data is available
    if (homeStanding && awayStanding) {
      const homePPG = homeStanding.all.played > 0
        ? homeStanding.points / homeStanding.all.played : 1.0;
      const awayPPG = awayStanding.all.played > 0
        ? awayStanding.points / awayStanding.all.played : 1.0;
      // Convert PPG to relative strength (0-1, 0.5 = equal)
      // Max PPG is 3.0, typical range 0.5-2.5
      const homeStrength = homePPG / 3.0;
      const awayStrength = awayPPG / 3.0;
      const total = homeStrength + awayStrength;
      return total > 0 ? homeStrength / total : 0.5;
    }

    // Fallback: rank-based
    const homeStrength = (totalTeams - homeRank + 1) / totalTeams;
    const awayStrength = (totalTeams - awayRank + 1) / totalTeams;
    return homeStrength / (homeStrength + awayStrength);
  }

  /**
   * Calculate expected goals using actual team data and Poisson probabilities
   * Goal expectations derived from attack/defense interaction, not hardcoded averages
   */
  static calculateGoalsAnalysis(
    homeAvgFor: number, homeAvgAgainst: number,
    awayAvgFor: number, awayAvgAgainst: number,
    leagueAvgGoals: number = 2.65 // Will be computed from data when available
  ) {
    // Attack-defense interaction model
    // Home xG = (home attack strength * away defense weakness) adjusted to league mean
    const leagueAvgPerTeam = leagueAvgGoals / 2;
    const homeAttackStrength = leagueAvgPerTeam > 0 ? homeAvgFor / leagueAvgPerTeam : 1.0;
    const awayDefenseWeakness = leagueAvgPerTeam > 0 ? awayAvgAgainst / leagueAvgPerTeam : 1.0;
    const awayAttackStrength = leagueAvgPerTeam > 0 ? awayAvgFor / leagueAvgPerTeam : 1.0;
    const homeDefenseWeakness = leagueAvgPerTeam > 0 ? homeAvgAgainst / leagueAvgPerTeam : 1.0;

    const homeExpectedGoals = Math.max(0.2, homeAttackStrength * awayDefenseWeakness * leagueAvgPerTeam);
    const awayExpectedGoals = Math.max(0.15, awayAttackStrength * homeDefenseWeakness * leagueAvgPerTeam);
    const totalExpectedGoals = homeExpectedGoals + awayExpectedGoals;

    // Poisson-based probabilities for over/under thresholds
    const MAX_GOALS = 8;
    let overProbs: Record<string, number> = {};
    let bttsProbability = 0;

    // Build goal probability matrix
    for (let h = 0; h <= MAX_GOALS; h++) {
      for (let a = 0; a <= MAX_GOALS; a++) {
        const prob = this.poissonProbability(h, homeExpectedGoals) *
                     this.poissonProbability(a, awayExpectedGoals);
        const total = h + a;
        for (const threshold of [0.5, 1.5, 2.5, 3.5]) {
          if (total > threshold) {
            overProbs[`over_${threshold}`] = (overProbs[`over_${threshold}`] || 0) + prob;
          }
        }
        if (h > 0 && a > 0) bttsProbability += prob;
      }
    }

    return {
      home_expected_goals: homeExpectedGoals,
      away_expected_goals: awayExpectedGoals,
      total_expected_goals: totalExpectedGoals,
      expected_goals_score: homeExpectedGoals / (homeExpectedGoals + awayExpectedGoals),
      over_0_5: overProbs['over_0.5'] || 0,
      over_1_5: overProbs['over_1.5'] || 0,
      over_2_5: overProbs['over_2.5'] || 0,
      over_3_5: overProbs['over_3.5'] || 0,
      btts_probability: bttsProbability,
    };
  }

  /**
   * Calculate first half goals prediction using proper Poisson distribution
   * First half typically sees ~43% of total goals (not 60%)
   */
  static calculateFirstHalfGoals(
    homeExpectedGoals: number,
    awayExpectedGoals: number,
    homeForm: TeamForm,
    awayForm: TeamForm
  ) {
    // First half typically sees ~43% of full game goals (empirical across top leagues)
    const firstHalfFactor = 0.43;
    const homeFirstHalfExpected = homeExpectedGoals * firstHalfFactor;
    const awayFirstHalfExpected = awayExpectedGoals * firstHalfFactor;
    const totalFirstHalfExpected = homeFirstHalfExpected + awayFirstHalfExpected;

    // Proper Poisson-based probability calculations
    // P(total >= 1) = 1 - P(total = 0)
    const p0 = this.poissonProbability(0, totalFirstHalfExpected);
    const p1 = this.poissonProbability(1, totalFirstHalfExpected);
    const over_0_5_probability = 1 - p0;
    const over_1_5_probability = 1 - p0 - p1;

    // Individual team first half goal probabilities (P(team scores >= 1))
    const homeFirstHalfProb = 1 - this.poissonProbability(0, homeFirstHalfExpected);
    const awayFirstHalfProb = 1 - this.poissonProbability(0, awayFirstHalfExpected);

    // Confidence based on how far the probability is from 50/50
    // Strong signal (e.g., 80% over) = high confidence; 50/50 = low confidence
    const signalStrength = Math.abs(over_0_5_probability - 0.5) * 2;
    // Also factor in form data availability
    const dataQuality = Math.min(1, (homeForm.recent_matches + awayForm.recent_matches) / 10);
    const confidence = Math.max(0.35, Math.min(0.90, 0.4 + signalStrength * 0.3 + dataQuality * 0.2));

    return {
      prediction: over_0_5_probability > 0.55 ? 'yes' as const : 'no' as const,
      confidence,
      home_first_half_probability: homeFirstHalfProb,
      away_first_half_probability: awayFirstHalfProb,
      over_0_5_probability,
      over_1_5_probability
    };
  }

  /**
   * Main prediction function
   * Uses proper Poisson distribution for 1X2, BTTS, and Over/Under
   * All probabilities are data-driven from actual team statistics
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

    // Calculate individual factor scores — now data-driven
    const homeAdvantageScore = this.calculateHomeAdvantage(h2hRecord, homeStanding, awayStanding);
    const formDifference = homeForm.form_score - awayForm.form_score;

    let positionScore = 0.5;
    if (homeStanding && awayStanding) {
      positionScore = this.calculatePositionScore(
        homeStanding.rank, awayStanding.rank, 20, homeStanding, awayStanding
      );
    }

    // Goal analysis from actual data
    const homeAvgFor = homeForm.recent_matches > 0 ? homeForm.goals_for / homeForm.recent_matches : 1.3;
    const homeAvgAgainst = homeForm.recent_matches > 0 ? homeForm.goals_against / homeForm.recent_matches : 1.2;
    const awayAvgFor = awayForm.recent_matches > 0 ? awayForm.goals_for / awayForm.recent_matches : 1.1;
    const awayAvgAgainst = awayForm.recent_matches > 0 ? awayForm.goals_against / awayForm.recent_matches : 1.4;

    // Compute league average goals from standings if available
    let leagueAvgGoals = 2.65;
    if (homeStanding && awayStanding) {
      const hPlayed = homeStanding.all.played || 1;
      const aPlayed = awayStanding.all.played || 1;
      const avgFor = ((homeStanding.all.goals.for / hPlayed) + (awayStanding.all.goals.for / aPlayed)) / 2;
      const avgAg = ((homeStanding.all.goals.against / hPlayed) + (awayStanding.all.goals.against / aPlayed)) / 2;
      leagueAvgGoals = avgFor + avgAg;
      if (leagueAvgGoals < 1.5 || leagueAvgGoals > 4.0) leagueAvgGoals = 2.65; // Sanity
    }

    const goalsAnalysis = this.calculateGoalsAnalysis(
      homeAvgFor, homeAvgAgainst, awayAvgFor, awayAvgAgainst, leagueAvgGoals
    );

    // ── Poisson-based 1X2 probabilities ──
    // Adjust expected goals for home advantage and form
    const homeAdvXGBoost = (homeAdvantageScore - 0.5) * 0.3; // Positive if home is favored
    const formXGBoost = formDifference * 0.15; // Form impact on xG
    const homeXG = Math.max(0.3, goalsAnalysis.home_expected_goals + homeAdvXGBoost + formXGBoost);
    const awayXG = Math.max(0.2, goalsAnalysis.away_expected_goals - homeAdvXGBoost * 0.5 - formXGBoost * 0.5);

    const MAX_GOALS = 8;
    let rawHome = 0, rawDraw = 0, rawAway = 0;
    for (let h = 0; h <= MAX_GOALS; h++) {
      for (let a = 0; a <= MAX_GOALS; a++) {
        const prob = this.poissonProbability(h, homeXG) * this.poissonProbability(a, awayXG);
        if (h > a) rawHome += prob;
        else if (h === a) rawDraw += prob;
        else rawAway += prob;
      }
    }
    // Normalize to ensure probabilities sum to exactly 100%
    const totalProb = rawHome + rawDraw + rawAway;
    let homeProbability = rawHome / totalProb;
    let drawProbability = rawDraw / totalProb;
    let awayProbability = rawAway / totalProb;

    // Position score fine-tuning (small adjustment, not dominant)
    const posAdj = (positionScore - 0.5) * 0.04; // Max +/- 2% shift
    homeProbability += posAdj;
    awayProbability -= posAdj;
    // Re-normalize
    const reTotal = homeProbability + drawProbability + awayProbability;
    homeProbability /= reTotal;
    drawProbability /= reTotal;
    awayProbability /= reTotal;

    // Determine winner prediction
    const maxProb = Math.max(homeProbability, drawProbability, awayProbability);
    let winner: 'home' | 'away' | 'draw' = 'draw';
    if (homeProbability === maxProb) winner = 'home';
    else if (awayProbability === maxProb) winner = 'away';

    // Both teams to score — Poisson-derived (already computed in goalsAnalysis)
    const bothTeamsScoreProb = goalsAnalysis.btts_probability;

    // Over/Under 2.5 — Poisson-derived
    const overUnderThreshold = 2.5;
    const overProbability = goalsAnalysis.over_2_5;

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
