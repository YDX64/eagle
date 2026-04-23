
import { ApiFootballService } from './api-football';

export interface AdvancedTeamStats {
  // Form Analysis
  form_last_5: { wins: number; draws: number; losses: number; points: number; form_string: string };
  form_last_10: { wins: number; draws: number; losses: number; points: number; form_string: string };
  form_home_last_5: { wins: number; draws: number; losses: number; points: number };
  form_away_last_5: { wins: number; draws: number; losses: number; points: number };
  
  // Goal Statistics
  goals_per_game: { total: number; home: number; away: number };
  goals_against_per_game: { total: number; home: number; away: number };
  clean_sheets_percentage: { total: number; home: number; away: number };
  both_teams_score_percentage: number;
  
  // Performance Metrics
  shot_accuracy: number;
  possession_average: number;
  passes_accuracy: number;
  corners_per_game: number;
  cards_per_game: { yellow: number; red: number };
  
  // League Performance
  league_position: number;
  points_per_game: number;
  goal_difference: number;
  
  // Advanced Metrics
  expected_goals_for: number;
  expected_goals_against: number;
  big_chances_created: number;
  big_chances_missed: number;
}

export interface WeatherData {
  temperature: number;
  wind_speed: number;
  precipitation: number;
  humidity: number;
  conditions: string;
}

export interface AdvancedMatchPrediction {
  // Basic Predictions
  match_result: {
    home_win: { probability: number; odds: number };
    draw: { probability: number; odds: number };
    away_win: { probability: number; odds: number };
    confidence: number;
  };
  
  // Goal Predictions
  total_goals: {
    under_0_5: { probability: number; odds: number };
    under_1_5: { probability: number; odds: number };
    under_2_5: { probability: number; odds: number };
    under_3_5: { probability: number; odds: number };
    over_0_5: { probability: number; odds: number };
    over_1_5: { probability: number; odds: number };
    over_2_5: { probability: number; odds: number };
    over_3_5: { probability: number; odds: number };
  };
  
  // Exact Score Predictions
  exact_scores: Array<{
    score: string;
    probability: number;
    odds: number;
  }>;
  
  // Team-specific Predictions
  both_teams_score: { probability: number; odds: number };
  home_team_goals: {
    under_0_5: number; under_1_5: number; under_2_5: number;
    over_0_5: number; over_1_5: number; over_2_5: number;
  };
  away_team_goals: {
    under_0_5: number; under_1_5: number; under_2_5: number;
    over_0_5: number; over_1_5: number; over_2_5: number;
  };
  
  // Asian Handicap
  asian_handicap: Array<{
    handicap: number;
    home_probability: number;
    away_probability: number;
    odds: { home: number; away: number };
  }>;
  
  // Corner & Cards
  corners: {
    total_under_8_5: number;
    total_under_9_5: number;
    total_over_8_5: number;
    total_over_9_5: number;
  };
  
  cards: {
    total_under_3_5: number;
    total_under_4_5: number;
    total_over_3_5: number;
    total_over_4_5: number;
  };


  
  // Timing Predictions
  first_goal: {
    home_team: number;
    away_team: number;
    no_goal: number;
  };
  
  halftime_result: {
    home_win: number;
    draw: number;
    away_win: number;
  };

  first_half_goals: {
    over_0_5: { probability: number; odds: number };
    over_1_5: { probability: number; odds: number };
    home_team_score: { probability: number; odds: number };
    away_team_score: { probability: number; odds: number };
    both_teams_score: { probability: number; odds: number };
  };
  
  // Confidence & Risk Analysis
  prediction_confidence: number;
  risk_analysis: {
    high_confidence_bets: Array<{
      title: string;
      description: string;
      confidence: number;
      reason: string;
      recommendation: string;
    }>;
    medium_risk_bets: Array<{
      title: string;
      description: string;
      confidence: number;
      reason: string;
      recommendation: string;
    }>;
    high_risk_bets: Array<{
      title: string;
      description: string;
      confidence: number;
      reason: string;
      recommendation: string;
    }>;
  };
  
  // Factors Used
  analysis_factors: {
    form_weight: number;
    head_to_head_weight: number;
    home_advantage_weight: number;
    league_position_weight: number;
    recent_performance_weight: number;
    injuries_weight: number;
    weather_weight: number;
  };
}

export class AdvancedPredictionEngine {
  
  /**
   * Get comprehensive team statistics
   */
  static async getAdvancedTeamStats(teamId: number, leagueId: number, season: number): Promise<AdvancedTeamStats> {
    try {
      // Get team statistics from API
      const teamStats = await ApiFootballService.getTeamStatistics(leagueId, season, teamId);
      const fixtures = await ApiFootballService.getFixturesByLeague(leagueId, season, 'FT');
      const standings = await ApiFootballService.getStandings(leagueId, season);
      
      // Filter team's matches
      const teamMatches = fixtures
        .filter(f => f.teams.home.id === teamId || f.teams.away.id === teamId)
        .sort((a, b) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime());
      
      const homeMatches = teamMatches.filter(f => f.teams.home.id === teamId);
      const awayMatches = teamMatches.filter(f => f.teams.away.id === teamId);
      
      // Calculate form
      const last5Matches = teamMatches.slice(0, 5);
      const last10Matches = teamMatches.slice(0, 10);
      const homeLast5 = homeMatches.slice(0, 5);
      const awayLast5 = awayMatches.slice(0, 5);
      
      const calculateForm = (matches: any[], teamId: number) => {
        let wins = 0, draws = 0, losses = 0;
        let formString = '';
        
        matches.forEach(match => {
          const isHome = match.teams.home.id === teamId;
          const teamGoals = isHome ? match.goals.home : match.goals.away;
          const oppGoals = isHome ? match.goals.away : match.goals.home;
          
          if (teamGoals > oppGoals) {
            wins++;
            formString += 'W';
          } else if (teamGoals === oppGoals) {
            draws++;
            formString += 'D';
          } else {
            losses++;
            formString += 'L';
          }
        });
        
        return {
          wins, draws, losses,
          points: wins * 3 + draws,
          form_string: formString
        };
      };
      
      // Calculate goals stats
      const calculateGoalStats = (matches: any[], teamId: number) => {
        let totalGoalsFor = 0, totalGoalsAgainst = 0;
        let homeGoalsFor = 0, homeGoalsAgainst = 0;
        let awayGoalsFor = 0, awayGoalsAgainst = 0;
        let cleanSheets = 0, cleanSheetsHome = 0, cleanSheetsAway = 0;
        let bothTeamsScore = 0;
        
        matches.forEach(match => {
          const isHome = match.teams.home.id === teamId;
          const teamGoals = isHome ? match.goals.home : match.goals.away;
          const oppGoals = isHome ? match.goals.away : match.goals.home;
          
          totalGoalsFor += teamGoals;
          totalGoalsAgainst += oppGoals;
          
          if (oppGoals === 0) cleanSheets++;
          if (teamGoals > 0 && oppGoals > 0) bothTeamsScore++;
          
          if (isHome) {
            homeGoalsFor += teamGoals;
            homeGoalsAgainst += oppGoals;
            if (oppGoals === 0) cleanSheetsHome++;
          } else {
            awayGoalsFor += teamGoals;
            awayGoalsAgainst += oppGoals;
            if (oppGoals === 0) cleanSheetsAway++;
          }
        });
        
        const totalMatches = matches.length;
        const homeMatchesCount = homeMatches.length;
        const awayMatchesCount = awayMatches.length;
        
        return {
          goals_per_game: {
            total: totalMatches > 0 ? totalGoalsFor / totalMatches : 0,
            home: homeMatchesCount > 0 ? homeGoalsFor / homeMatchesCount : 0,
            away: awayMatchesCount > 0 ? awayGoalsFor / awayMatchesCount : 0
          },
          goals_against_per_game: {
            total: totalMatches > 0 ? totalGoalsAgainst / totalMatches : 0,
            home: homeMatchesCount > 0 ? homeGoalsAgainst / homeMatchesCount : 0,
            away: awayMatchesCount > 0 ? awayGoalsAgainst / awayMatchesCount : 0
          },
          clean_sheets_percentage: {
            total: totalMatches > 0 ? (cleanSheets / totalMatches) * 100 : 0,
            home: homeMatchesCount > 0 ? (cleanSheetsHome / homeMatchesCount) * 100 : 0,
            away: awayMatchesCount > 0 ? (cleanSheetsAway / awayMatchesCount) * 100 : 0
          },
          both_teams_score_percentage: totalMatches > 0 ? (bothTeamsScore / totalMatches) * 100 : 0
        };
      };
      
      const goalStats = calculateGoalStats(teamMatches, teamId);
      const teamStanding = standings.find(s => s.team.id === teamId);
      
      return {
        form_last_5: calculateForm(last5Matches, teamId),
        form_last_10: calculateForm(last10Matches, teamId),
        form_home_last_5: calculateForm(homeLast5, teamId),
        form_away_last_5: calculateForm(awayLast5, teamId),
        ...goalStats,
        shot_accuracy: teamStats?.fixtures?.played?.total ? 
          (teamStats.goals.for.total.total / (teamStats.goals.for.total.total + teamStats.goals.against.total.total)) * 100 : 50,
        possession_average: 50, // Default - would need match statistics
        passes_accuracy: 75, // Default - would need match statistics  
        corners_per_game: 5, // Default - would need match statistics
        cards_per_game: { yellow: 2, red: 0.1 }, // Default values
        league_position: teamStanding?.rank || 10,
        points_per_game: teamStanding ? teamStanding.points / teamStanding.all.played : 1,
        goal_difference: teamStanding?.goalsDiff || 0,
        expected_goals_for: goalStats.goals_per_game.total,
        expected_goals_against: goalStats.goals_against_per_game.total,
        big_chances_created: goalStats.goals_per_game.total * 2,
        big_chances_missed: goalStats.goals_per_game.total * 0.5
      };
      
    } catch (error) {
      // Return default stats
      return {
        form_last_5: { wins: 2, draws: 2, losses: 1, points: 8, form_string: 'WWDDL' },
        form_last_10: { wins: 4, draws: 3, losses: 3, points: 15, form_string: 'WWDDLLWDWD' },
        form_home_last_5: { wins: 3, draws: 1, losses: 1, points: 10 },
        form_away_last_5: { wins: 1, draws: 2, losses: 2, points: 5 },
        goals_per_game: { total: 1.5, home: 1.8, away: 1.2 },
        goals_against_per_game: { total: 1.2, home: 1.0, away: 1.4 },
        clean_sheets_percentage: { total: 30, home: 40, away: 20 },
        both_teams_score_percentage: 55,
        shot_accuracy: 45,
        possession_average: 52,
        passes_accuracy: 78,
        corners_per_game: 5.2,
        cards_per_game: { yellow: 2.1, red: 0.1 },
        league_position: 10,
        points_per_game: 1.4,
        goal_difference: 3,
        expected_goals_for: 1.5,
        expected_goals_against: 1.2,
        big_chances_created: 3.0,
        big_chances_missed: 0.8
      };
    }
  }
  
  /**
   * Calculate Poisson probability for exact scores
   */
  /**
   * Cumulative Poisson CDF: P(X < k | lambda). Used by over/under models.
   * e.g. `poissonCumulativeBelow(4, 2.8)` gives P(≤3 goals) for a match with
   * expected total 2.8 goals. Range of k clamped to [0, 15] for speed.
   */
  static poissonCumulativeBelow(k: number, lambda: number): number {
    const max = Math.min(Math.max(0, Math.floor(k)), 15);
    let sum = 0;
    for (let i = 0; i < max; i++) sum += this.poissonProbability(i, lambda);
    return sum;
  }

  static poissonProbability(k: number, lambda: number): number {
    const e = Math.E;
    return (Math.pow(lambda, k) * Math.pow(e, -lambda)) / this.factorial(k);
  }
  
  static factorial(n: number): number {
    if (n <= 1) return 1;
    return n * this.factorial(n - 1);
  }
  
  /**
   * Generate exact score predictions using Poisson distribution
   */
  static generateExactScores(homeExpectedGoals: number, awayExpectedGoals: number): Array<{score: string, probability: number, odds: number}> {
    const scores = [];
    const maxGoals = 5;
    
    for (let homeGoals = 0; homeGoals <= maxGoals; homeGoals++) {
      for (let awayGoals = 0; awayGoals <= maxGoals; awayGoals++) {
        const homeProb = this.poissonProbability(homeGoals, homeExpectedGoals);
        const awayProb = this.poissonProbability(awayGoals, awayExpectedGoals);
        const probability = homeProb * awayProb;
        
        if (probability > 0.01) { // Only include scores with >1% probability
          scores.push({
            score: `${homeGoals}-${awayGoals}`,
            probability: Math.round(probability * 10000) / 100,
            odds: Math.round((1 / probability) * 100) / 100
          });
        }
      }
    }
    
    return scores
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 15); // Top 15 most likely scores
  }
  


  /**
   * Calculate Asian Handicap probabilities
   */
  static calculateAsianHandicap(homeStrength: number, awayStrength: number): Array<{handicap: number, home_probability: number, away_probability: number, odds: {home: number, away: number}}> {
    const handicaps = [-2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5];
    const results: Array<{handicap: number, home_probability: number, away_probability: number, odds: {home: number, away: number}}> = [];
    
    handicaps.forEach(handicap => {
      // Adjust probabilities based on handicap
      let adjustedHomeProb = homeStrength + (handicap * 0.1);
      let adjustedAwayProb = 1 - adjustedHomeProb;
      
      // Ensure probabilities are within valid range
      adjustedHomeProb = Math.max(0.1, Math.min(0.9, adjustedHomeProb));
      adjustedAwayProb = 1 - adjustedHomeProb;
      
      results.push({
        handicap,
        home_probability: Math.round(adjustedHomeProb * 10000) / 100,
        away_probability: Math.round(adjustedAwayProb * 10000) / 100,
        odds: {
          home: Math.round((1 / adjustedHomeProb) * 100) / 100,
          away: Math.round((1 / adjustedAwayProb) * 100) / 100
        }
      });
    });
    
    return results;
  }
  
  /**
   * Main advanced prediction function
   */
  static async generateAdvancedPrediction(
    homeTeamId: number,
    awayTeamId: number,
    leagueId: number,
    season: number,
    matchId?: number
  ): Promise<AdvancedMatchPrediction> {
    
    // Get comprehensive team statistics
    const [homeStats, awayStats] = await Promise.all([
      this.getAdvancedTeamStats(homeTeamId, leagueId, season),
      this.getAdvancedTeamStats(awayTeamId, leagueId, season)
    ]);
    
    // Get head-to-head data
    let h2hData: any[] = [];
    try {
      h2hData = await ApiFootballService.getHeadToHead(`${homeTeamId}-${awayTeamId}`);
    } catch (error) {
    }
    
    // Calculate base probabilities using multiple factors
    const formFactor = (homeStats.form_last_5.points - awayStats.form_last_5.points) / 15; // Normalized
    const homeFactor = 0.15; // Standard home advantage
    const leagueFactor = (awayStats.league_position - homeStats.league_position) / 20; // Normalized
    const goalsFactor = (homeStats.goals_per_game.total - awayStats.goals_per_game.total) / 3;
    const defenseFactor = (awayStats.goals_against_per_game.total - homeStats.goals_against_per_game.total) / 3;
    
    // Head-to-head factor
    let h2hFactor = 0;
    if (h2hData.length >= 3) {
      let homeWins = 0;
      h2hData.slice(0, 5).forEach(match => {
        if ((match.teams.home.id === homeTeamId && match.goals.home > match.goals.away) ||
            (match.teams.away.id === homeTeamId && match.goals.away > match.goals.home)) {
          homeWins++;
        }
      });
      h2hFactor = (homeWins / Math.min(h2hData.length, 5)) - 0.5;
    }
    
    // Combine factors with weights
    const weights = {
      form: 0.25,
      home: 0.20,
      league: 0.20,
      goals: 0.15,
      defense: 0.10,
      h2h: 0.10
    };
    
    const combinedFactor = 
      formFactor * weights.form +
      homeFactor * weights.home +
      leagueFactor * weights.league +
      goalsFactor * weights.goals +
      defenseFactor * weights.defense +
      h2hFactor * weights.h2h;
    
    // Convert to probabilities
    const baseHomeProb = 0.4 + combinedFactor;
    let homeProbability = Math.max(0.15, Math.min(0.75, baseHomeProb));
    let drawProbability = Math.max(0.15, 0.35 - Math.abs(combinedFactor) * 0.3);
    let awayProbability = 1 - homeProbability - drawProbability;
    
    // Normalize probabilities
    const total = homeProbability + drawProbability + awayProbability;
    homeProbability /= total;
    drawProbability /= total;
    awayProbability /= total;
    
    // Expected goals calculation
    const homeExpectedGoals = Math.max(0.5, Math.min(3.8, 
      (homeStats.goals_per_game.home * 0.55 + awayStats.goals_against_per_game.away * 0.45) +
      (combinedFactor > 0 ? combinedFactor * 0.6 : combinedFactor * 0.3)
    ));

    const awayExpectedGoals = Math.max(0.5, Math.min(3.5,
      (awayStats.goals_per_game.away * 0.55 + homeStats.goals_against_per_game.home * 0.45) -
      (combinedFactor > 0 ? combinedFactor * 0.25 : combinedFactor * 0.5)
    ));
    
    const totalExpectedGoals = homeExpectedGoals + awayExpectedGoals;
    
    // Generate exact scores
    const exactScores = this.generateExactScores(homeExpectedGoals, awayExpectedGoals);
    
    // Calculate over/under probabilities
    const under_0_5 = this.poissonProbability(0, totalExpectedGoals);
    const under_1_5 = under_0_5 + this.poissonProbability(1, totalExpectedGoals);
    const under_2_5 = under_1_5 + this.poissonProbability(2, totalExpectedGoals);
    const under_3_5 = under_2_5 + this.poissonProbability(3, totalExpectedGoals);
    
    // Both teams to score probability
    const homeNoGoal = this.poissonProbability(0, homeExpectedGoals);
    const awayNoGoal = this.poissonProbability(0, awayExpectedGoals);
    const btsProb = 1 - (homeNoGoal + awayNoGoal - homeNoGoal * awayNoGoal);
    
    // Asian Handicap
    const asianHandicap = this.calculateAsianHandicap(homeProbability, awayProbability);
    
    // Confidence calculation
    const confidence = Math.max(
      homeProbability, drawProbability, awayProbability
    );
    
    // Enhanced Risk Analysis with detailed recommendations
    const highConfidenceBets: Array<{
      title: string;
      description: string;
      confidence: number;
      reason: string;
      recommendation: string;
    }> = [];
    
    const mediumRiskBets: Array<{
      title: string;
      description: string;
      confidence: number;
      reason: string;
      recommendation: string;
    }> = [];
    
    const highRiskBets: Array<{
      title: string;
      description: string;
      confidence: number;
      reason: string;
      recommendation: string;
    }> = [];
    
    // Match Winner Analysis
    if (confidence > 0.7) {
      const winnerType = homeProbability > drawProbability && homeProbability > awayProbability ? 'Ev Sahibi' :
                        awayProbability > homeProbability && awayProbability > drawProbability ? 'Deplasman' : 'Beraberlik';
      const winnerProb = Math.max(homeProbability, drawProbability, awayProbability);
      
      highConfidenceBets.push({
        title: 'Maç Sonucu Tahmini',
        description: `${winnerType} kazanması bekleniyor`,
        confidence: Math.round(winnerProb * 100),
        reason: `Güçlü form analizi ve istatistiksel veriler bu sonucu destekliyor`,
        recommendation: `${winnerType} üzerine bahis düşünülebilir (Güven: %${Math.round(winnerProb * 100)})`
      });
    }
    
    // Both Teams Score Analysis  
    if (btsProb > 0.72) {
      highConfidenceBets.push({
        title: 'Her İki Takım Gol - EVET',
        description: 'Her iki takımın da gol atması çok muhtemel',
        confidence: Math.round(btsProb * 100),
        reason: `Her iki takım da ofansif güçlü, savunma zafiyetleri var`,
        recommendation: `'Her İki Takım Gol - EVET' güvenli seçim olabilir`
      });
    } else if (btsProb < 0.28) {
      highConfidenceBets.push({
        title: 'Her İki Takım Gol - HAYIR',
        description: 'En az bir takımın gol atmaması muhtemel',
        confidence: Math.round((1 - btsProb) * 100),
        reason: `Güçlü savunma performansları veya zayıf hücum performansı`,
        recommendation: `'Her İki Takım Gol - HAYIR' değerlendirilebilir`
      });
    }
    
    // Goals Over/Under Analysis
    if (under_2_5 > 0.68) {
      highConfidenceBets.push({
        title: 'Alt 2.5 Gol',
        description: 'Maçta 2 veya daha az gol bekleniyor',
        confidence: Math.round(under_2_5 * 100),
        reason: `Düşük gol ortalamaları ve güçlü savunma performansları`,
        recommendation: `Alt 2.5 gol güvenli bir seçim görünüyor`
      });
    } else if (under_2_5 < 0.32) {
      highConfidenceBets.push({
        title: 'Üst 2.5 Gol',
        description: 'Maçta 3 veya daha fazla gol bekleniyor',
        confidence: Math.round((1 - under_2_5) * 100),
        reason: `Yüksek gol ortalamaları ve ofansif oyun tarzları`,
        recommendation: `Üst 2.5 gol seçeneği değerlendirilebilir`
      });
    }
    
    // Medium Risk Bets
    if (totalExpectedGoals > 3.4) {
      mediumRiskBets.push({
        title: 'Üst 3.5 Gol',
        description: 'Yüksek gol potansiyeli var',
        confidence: 65,
        reason: `Yüksek beklenen gol sayısı (${totalExpectedGoals.toFixed(1)})`,
        recommendation: `Dikkatli değerlendirme gerekiyor, orta risk seviyesi`
      });
    }
    
    if (homeExpectedGoals > 2.2) {
      mediumRiskBets.push({
        title: 'Ev Sahibi Üst 1.5 Gol',
        description: 'Ev sahibi takımın 2+ gol atması',
        confidence: 60,
        reason: `Güçlü ev sahibi hücum performansı (Beklenen: ${homeExpectedGoals.toFixed(1)} gol)`,
        recommendation: `Ev avantajı dikkate alınarak değerlendirilebilir`
      });
    }
    
    if (awayExpectedGoals > 2.0) {
      mediumRiskBets.push({
        title: 'Deplasman Üst 1.5 Gol',
        description: 'Deplasman takımın 2+ gol atması',
        confidence: 58,
        reason: `İyi deplasman hücum performansı (Beklenen: ${awayExpectedGoals.toFixed(1)} gol)`,
        recommendation: `Deplasman gücü göz önünde bulundurularak değerlendirilebilir`
      });
    }
    
    // High Risk Bets
    exactScores.slice(3, 6).forEach(score => {
      if (score.probability < 8 && score.probability > 3) {
        highRiskBets.push({
          title: `Tam Skor ${score.score}`,
          description: `${score.score} skorunun çıkması`,
          confidence: Math.round(score.probability),
          reason: `Düşük olasılık ama istatistiksel olarak mümkün`,
          recommendation: `Yüksek risk - sadece küçük bahislerle değerlendirin`
        });
      }
    });
    
    // If no high confidence bets, add a medium confidence recommendation
    if (highConfidenceBets.length === 0) {
      const bestOption = Math.max(homeProbability, drawProbability, awayProbability);
      const bestResult = homeProbability === bestOption ? 'Ev Sahibi' :
                        drawProbability === bestOption ? 'Beraberlik' : 'Deplasman';
      
      mediumRiskBets.unshift({
        title: 'En Olası Sonuç',
        description: `${bestResult} en yüksek olasılığa sahip`,
        confidence: Math.round(bestOption * 100),
        reason: `Mevcut veriler bu sonucu destekliyor ancak kesin değil`,
        recommendation: `Orta güvenle değerlendirilebilir`
      });
    }
    
    return {
      match_result: {
        home_win: { 
          probability: Math.round(homeProbability * 10000) / 100, 
          odds: Math.round((1/homeProbability) * 100) / 100 
        },
        draw: { 
          probability: Math.round(drawProbability * 10000) / 100, 
          odds: Math.round((1/drawProbability) * 100) / 100 
        },
        away_win: { 
          probability: Math.round(awayProbability * 10000) / 100, 
          odds: Math.round((1/awayProbability) * 100) / 100 
        },
        confidence: Math.round(confidence * 10000) / 100
      },
      
      total_goals: {
        under_0_5: { probability: Math.round(under_0_5 * 10000) / 100, odds: Math.round((1/under_0_5) * 100) / 100 },
        under_1_5: { probability: Math.round(under_1_5 * 10000) / 100, odds: Math.round((1/under_1_5) * 100) / 100 },
        under_2_5: { probability: Math.round(under_2_5 * 10000) / 100, odds: Math.round((1/under_2_5) * 100) / 100 },
        under_3_5: { probability: Math.round(under_3_5 * 10000) / 100, odds: Math.round((1/under_3_5) * 100) / 100 },
        over_0_5: { probability: Math.round((1-under_0_5) * 10000) / 100, odds: Math.round((1/(1-under_0_5)) * 100) / 100 },
        over_1_5: { probability: Math.round((1-under_1_5) * 10000) / 100, odds: Math.round((1/(1-under_1_5)) * 100) / 100 },
        over_2_5: { probability: Math.round((1-under_2_5) * 10000) / 100, odds: Math.round((1/(1-under_2_5)) * 100) / 100 },
        over_3_5: { probability: Math.round((1-under_3_5) * 10000) / 100, odds: Math.round((1/(1-under_3_5)) * 100) / 100 }
      },
      
      exact_scores: exactScores,
      
      both_teams_score: { 
        probability: Math.round(btsProb * 10000) / 100, 
        odds: Math.round((1/btsProb) * 100) / 100 
      },
      
      home_team_goals: {
        under_0_5: Math.round(this.poissonProbability(0, homeExpectedGoals) * 10000) / 100,
        under_1_5: Math.round((this.poissonProbability(0, homeExpectedGoals) + this.poissonProbability(1, homeExpectedGoals)) * 10000) / 100,
        under_2_5: Math.round((this.poissonProbability(0, homeExpectedGoals) + this.poissonProbability(1, homeExpectedGoals) + this.poissonProbability(2, homeExpectedGoals)) * 10000) / 100,
        over_0_5: Math.round((1 - this.poissonProbability(0, homeExpectedGoals)) * 10000) / 100,
        over_1_5: Math.round((1 - this.poissonProbability(0, homeExpectedGoals) - this.poissonProbability(1, homeExpectedGoals)) * 10000) / 100,
        over_2_5: Math.round((1 - this.poissonProbability(0, homeExpectedGoals) - this.poissonProbability(1, homeExpectedGoals) - this.poissonProbability(2, homeExpectedGoals)) * 10000) / 100,
      },
      
      away_team_goals: {
        under_0_5: Math.round(this.poissonProbability(0, awayExpectedGoals) * 10000) / 100,
        under_1_5: Math.round((this.poissonProbability(0, awayExpectedGoals) + this.poissonProbability(1, awayExpectedGoals)) * 10000) / 100,
        under_2_5: Math.round((this.poissonProbability(0, awayExpectedGoals) + this.poissonProbability(1, awayExpectedGoals) + this.poissonProbability(2, awayExpectedGoals)) * 10000) / 100,
        over_0_5: Math.round((1 - this.poissonProbability(0, awayExpectedGoals)) * 10000) / 100,
        over_1_5: Math.round((1 - this.poissonProbability(0, awayExpectedGoals) - this.poissonProbability(1, awayExpectedGoals)) * 10000) / 100,
        over_2_5: Math.round((1 - this.poissonProbability(0, awayExpectedGoals) - this.poissonProbability(1, awayExpectedGoals) - this.poissonProbability(2, awayExpectedGoals)) * 10000) / 100,
      },
      
      asian_handicap: asianHandicap,
      
      corners: {
        total_under_8_5: 45,
        total_under_9_5: 60,
        total_over_8_5: 55,
        total_over_9_5: 40
      },
      
      cards: {
        total_under_3_5: 65,
        total_under_4_5: 80,
        total_over_3_5: 35,
        total_over_4_5: 20
      },
      
      first_goal: {
        home_team: Math.round((homeExpectedGoals / totalExpectedGoals) * 10000) / 100,
        away_team: Math.round((awayExpectedGoals / totalExpectedGoals) * 10000) / 100,
        no_goal: Math.round(under_0_5 * 10000) / 100
      },
      
      halftime_result: {
        home_win: Math.round(homeProbability * 0.7 * 10000) / 100,
        draw: Math.round((drawProbability + homeProbability * 0.3 + awayProbability * 0.3) * 10000) / 100,
        away_win: Math.round(awayProbability * 0.7 * 10000) / 100
      },

      first_half_goals: {
        over_0_5: { 
          probability: Math.round((1 - Math.exp(-totalExpectedGoals * 0.6)) * 10000) / 100,
          odds: 1 / (1 - Math.exp(-totalExpectedGoals * 0.6)) 
        },
        over_1_5: { 
          probability: Math.round((1 - Math.exp(-totalExpectedGoals * 0.6) * (1 + totalExpectedGoals * 0.6)) * 10000) / 100,
          odds: 1 / (1 - Math.exp(-totalExpectedGoals * 0.6) * (1 + totalExpectedGoals * 0.6))
        },
        home_team_score: { 
          probability: Math.round((1 - Math.exp(-homeExpectedGoals * 0.6)) * 10000) / 100,
          odds: 1 / (1 - Math.exp(-homeExpectedGoals * 0.6))
        },
        away_team_score: { 
          probability: Math.round((1 - Math.exp(-awayExpectedGoals * 0.6)) * 10000) / 100,
          odds: 1 / (1 - Math.exp(-awayExpectedGoals * 0.6))
        },
        both_teams_score: { 
          probability: Math.round(((1 - Math.exp(-homeExpectedGoals * 0.6)) * (1 - Math.exp(-awayExpectedGoals * 0.6))) * 10000) / 100,
          odds: 1 / ((1 - Math.exp(-homeExpectedGoals * 0.6)) * (1 - Math.exp(-awayExpectedGoals * 0.6)))
        }
      },
      
      prediction_confidence: Math.round(confidence * 10000) / 100,
      
      risk_analysis: {
        high_confidence_bets: highConfidenceBets,
        medium_risk_bets: mediumRiskBets,
        high_risk_bets: highRiskBets
      },
      
      analysis_factors: {
        form_weight: weights.form,
        head_to_head_weight: weights.h2h,
        home_advantage_weight: weights.home,
        league_position_weight: weights.league,
        recent_performance_weight: weights.goals + weights.defense,
        injuries_weight: 0, // Would need injury data
        weather_weight: 0 // Would need weather data
      }
    };
  }
}
