/**
 * Match Context Engine v1.0 — Deep Integration Foundation
 *
 * Tüm tahmin motorlarının paylaştığı ortak "maç bağlamı".
 * Bir kez hesaplanır, TÜM marketler buradan beslenir.
 *
 * Context katmanları:
 * 1. xG Layer        — Dixon-Coles expected goals (home/away/total/1H/2H)
 * 2. Intensity Layer  — Maç gerginliği (form gap, position gap, derby)
 * 3. Tempo Layer      — Maç temposu (goals, shots, possession)
 * 4. Defense Layer    — Savunma profili (high-press / low-block / balanced)
 * 5. Referee Layer    — Hakem profili (kart/faul ortalamaları)
 * 6. Odds Layer       — Piyasa sinyalleri (steam moves, RLM, consensus)
 * 7. Form Layer       — Takım formları (son 5/10 maç, ev/deplasman)
 * 8. H2H Layer        — Tarihsel karşılaşma verisi
 */

import { ApiFootballService, type Standing } from './api-football';
import { AdvancedPredictionEngine } from './advanced-prediction-engine';

// ═══════════════════════════════════════
// TYPES
// ═══════════════════════════════════════

export type DefenseStyle = 'high-press' | 'low-block' | 'balanced';

export interface MatchContext {
  // ── xG Layer ──
  xg: {
    home: number;
    away: number;
    total: number;
    firstHalfHome: number;
    firstHalfAway: number;
    firstHalfTotal: number;
    secondHalfHome: number;
    secondHalfAway: number;
    secondHalfTotal: number;
  };

  // ── 1X2 Probabilities (Dixon-Coles) ──
  matchResult: {
    homeProb: number;
    drawProb: number;
    awayProb: number;
  };

  // ── Intensity Layer ──
  intensity: {
    score: number;        // 0-1, higher = more intense
    formGap: number;      // Points difference in form
    positionGap: number;  // League position difference
    isDerby: boolean;     // Same city / historic rivalry
    isRelegationBattle: boolean;
    isTitleClash: boolean;
    multiplier: number;   // Final multiplier for cards/corners
  };

  // ── Tempo Layer ──
  tempo: {
    score: number;        // 0-1, higher = faster pace
    combinedGoalsPerGame: number;
    possessionDiff: number; // Positive = home dominates
    multiplier: number;
  };

  // ── Defense Layer ──
  defense: {
    homeStyle: DefenseStyle;
    awayStyle: DefenseStyle;
    homeConcedingRate: number;
    awayConcedingRate: number;
    homeCleanSheetPct: number;
    awayCleanSheetPct: number;
  };

  // ── Referee Layer ──
  referee: {
    name: string | null;
    avgCardsPerGame: number | null;
    avgFoulsPerGame: number | null;
    strictness: number;   // 0-2, 1.0 = league average
  };

  // ── Odds Layer ──
  odds: {
    available: boolean;
    consensus: {
      home: number; draw: number; away: number;
      over25: number; under25: number;
      bttsYes: number; bttsNo: number;
    } | null;
    steamMoves: Array<{
      market: string;
      direction: string;
      magnitude: number;
      signal: string;
    }>;
    reverseLineMovement: boolean;
    // CLV: Closing Line Value = our model vs market
    clv: { home: number; draw: number; away: number } | null;
    // Adjustments to apply to all markets
    xgAdjust: number;    // +/- xG based on odds movement
    intensityAdjust: number; // +/- intensity based on odds
  };

  // ── Form Layer ──
  form: {
    homeLast5: string;
    awayLast5: string;
    homeLast5Points: number;
    awayLast5Points: number;
    homePosition: number;
    awayPosition: number;
    homePoints: number;
    awayPoints: number;
    homeGoalDiff: number;
    awayGoalDiff: number;
  };

  // ── H2H Layer ──
  h2h: {
    totalMatches: number;
    homeWins: number;
    awayWins: number;
    draws: number;
    avgGoals: number;
    homeAvgGoals: number;
    awayAvgGoals: number;
  };

  // ── Team Stats ──
  homeTeam: {
    id: number;
    name: string;
    goalsPerGameHome: number;
    goalsConcededPerGameHome: number;
    cardsPerGame: number;
    cornersPerGame: number;
    cleanSheetPct: number;
    bttsPercentage: number;
  };
  awayTeam: {
    id: number;
    name: string;
    goalsPerGameAway: number;
    goalsConcededPerGameAway: number;
    cardsPerGame: number;
    cornersPerGame: number;
    cleanSheetPct: number;
    bttsPercentage: number;
  };

  // ── Metadata ──
  fixtureId: number;
  leagueId: number;
  season: number;
}

// ═══════════════════════════════════════
// MATCH CONTEXT BUILDER
// ═══════════════════════════════════════

export class MatchContextBuilder {

  /**
   * Build full match context — called ONCE, used by ALL markets
   */
  static async build(
    homeTeamId: number,
    awayTeamId: number,
    leagueId: number,
    season: number,
    fixtureId: number,
    refereeName?: string | null
  ): Promise<MatchContext> {

    // ── Parallel data fetch ──
    const [homeStats, awayStats, h2hData, standings] = await Promise.all([
      AdvancedPredictionEngine.getAdvancedTeamStats(homeTeamId, leagueId, season),
      AdvancedPredictionEngine.getAdvancedTeamStats(awayTeamId, leagueId, season),
      ApiFootballService.getHeadToHead(`${homeTeamId}-${awayTeamId}`).catch(() => []),
      ApiFootballService.getStandings(leagueId, season).catch(() => []),
    ]);

    const homeStanding = standings.find(s => s.team.id === homeTeamId);
    const awayStanding = standings.find(s => s.team.id === awayTeamId);

    // ════════════════════════════════════
    // XG LAYER
    // ════════════════════════════════════

    // Data-driven home advantage from actual home/away records in standings
    let homeAdvFactor = 0.0;
    if (homeStanding && awayStanding) {
      const totalPlayed = standings.reduce((s, st) => s + (st.home.played || 0), 0);
      const totalHomeWins = standings.reduce((s, st) => s + (st.home.win || 0), 0);
      const totalAwayWins = standings.reduce((s, st) => s + (st.away.win || 0), 0);
      if (totalPlayed > 0) {
        const leagueHomeWinRate = totalHomeWins / totalPlayed;
        const leagueAwayWinRate = totalAwayWins / totalPlayed;
        // homeAdvFactor: differential in win rate; typical range 0.04 - 0.15
        homeAdvFactor = Math.max(0.02, Math.min(0.20, leagueHomeWinRate - leagueAwayWinRate));
      } else {
        homeAdvFactor = 0.08; // Fallback if no data
      }
    } else {
      homeAdvFactor = 0.08; // Fallback
    }

    let homeXG = Math.max(0.4, Math.min(4.0,
      (homeStats.goals_per_game.home + awayStats.goals_against_per_game.away) / 2 + homeAdvFactor * 0.3
    ));
    let awayXG = Math.max(0.3, Math.min(3.5,
      (awayStats.goals_per_game.away + homeStats.goals_against_per_game.home) / 2 - homeAdvFactor * 0.15
    ));

    // H2H xG adjustment — blended toward league averages based on sample size
    if (h2hData.length > 0) {
      const recent = h2hData.slice(0, 8);
      let hGoals = 0, aGoals = 0;
      // Exponentially weight H2H matches (most recent = highest weight)
      let totalWeight = 0;
      recent.forEach((m, idx) => {
        const w = Math.pow(0.84, idx); // Recency weight
        totalWeight += w;
        if (m.teams.home.id === homeTeamId) {
          hGoals += (m.goals.home || 0) * w;
          aGoals += (m.goals.away || 0) * w;
        } else {
          hGoals += (m.goals.away || 0) * w;
          aGoals += (m.goals.home || 0) * w;
        }
      });
      const h2hHomeAvg = hGoals / totalWeight;
      const h2hAwayAvg = aGoals / totalWeight;
      // Blend factor: <3 matches -> 30% H2H / 70% league, 5+ -> 50/50
      const h2hBlend = h2hData.length < 3 ? 0.30 : h2hData.length < 5 ? 0.35 + (h2hData.length - 3) * 0.075 : 0.50;
      homeXG = homeXG * (1 - h2hBlend * 0.3) + h2hHomeAvg * (h2hBlend * 0.3);
      awayXG = awayXG * (1 - h2hBlend * 0.3) + h2hAwayAvg * (h2hBlend * 0.3);
    }

    // Form adjustment — exponentially weighted recent matches
    // Weight formula: w = 0.84^(games_ago), so most recent ~ 2x weight of 5th game
    const formString5Home = homeStats.form_last_5.form_string || '';
    const formString5Away = awayStats.form_last_5.form_string || '';
    const calcWeightedFormScore = (form: string): number => {
      let weightedPts = 0, totalW = 0;
      const chars = form.split('').reverse(); // Most recent first
      for (let i = 0; i < chars.length; i++) {
        const w = Math.pow(0.84, i);
        totalW += w;
        if (chars[i] === 'W') weightedPts += 3 * w;
        else if (chars[i] === 'D') weightedPts += 1 * w;
      }
      return totalW > 0 ? weightedPts / (totalW * 3) : 0.5; // 0-1 scale
    };
    const homeWeightedForm = calcWeightedFormScore(formString5Home);
    const awayWeightedForm = calcWeightedFormScore(formString5Away);
    const formDiff = homeWeightedForm - awayWeightedForm; // Range: -1 to 1
    homeXG += Math.max(-0.15, Math.min(0.15, formDiff * 0.2));
    awayXG -= Math.max(-0.15, Math.min(0.15, formDiff * 0.15));

    homeXG = Math.max(0.4, Math.min(4.0, homeXG));
    awayXG = Math.max(0.3, Math.min(3.5, awayXG));
    const totalXG = homeXG + awayXG;

    // Time-split xG (1st half is typically 43-45% of goals)
    const FIRST_HALF_RATIO = 0.43;
    const xg = {
      home: homeXG, away: awayXG, total: totalXG,
      firstHalfHome: homeXG * FIRST_HALF_RATIO,
      firstHalfAway: awayXG * (FIRST_HALF_RATIO - 0.01),
      firstHalfTotal: totalXG * FIRST_HALF_RATIO,
      secondHalfHome: homeXG * (1 - FIRST_HALF_RATIO),
      secondHalfAway: awayXG * (1 - FIRST_HALF_RATIO + 0.01),
      secondHalfTotal: totalXG * (1 - FIRST_HALF_RATIO),
    };

    // ════════════════════════════════════
    // 1X2 (Dixon-Coles)
    // ════════════════════════════════════
    const DC_RHO = -0.04;
    const DC_MAX = 8;
    let rawH = 0, rawD = 0, rawA = 0;

    for (let h = 0; h <= DC_MAX; h++) {
      for (let a = 0; a <= DC_MAX; a++) {
        let prob = AdvancedPredictionEngine.poissonProbability(h, homeXG) *
                   AdvancedPredictionEngine.poissonProbability(a, awayXG);
        if (h === 0 && a === 0) prob *= (1 - homeXG * awayXG * DC_RHO);
        else if (h === 1 && a === 0) prob *= (1 + awayXG * DC_RHO);
        else if (h === 0 && a === 1) prob *= (1 + homeXG * DC_RHO);
        else if (h === 1 && a === 1) prob *= (1 - DC_RHO);
        prob = Math.max(0, prob);
        if (h > a) rawH += prob;
        else if (h === a) rawD += prob;
        else rawA += prob;
      }
    }
    const t = rawH + rawD + rawA;

    // League position adjustment based on points-per-game differential, not raw position
    const homePPG = homeStanding ? homeStanding.points / Math.max(1, homeStanding.all.played) : 0;
    const awayPPG = awayStanding ? awayStanding.points / Math.max(1, awayStanding.all.played) : 0;
    const ppgDiff = homePPG - awayPPG; // Positive = home stronger
    // Scale: 1 PPG difference ~ 0.025 adjustment, capped
    const posAdj = Math.max(-0.035, Math.min(0.035, ppgDiff * 0.025));
    let hP = rawH / t + posAdj, dP = rawD / t, aP = rawA / t - posAdj;
    const nt = hP + dP + aP;

    // ════════════════════════════════════
    // INTENSITY LAYER
    // ════════════════════════════════════
    const positionGap = Math.abs(homeStats.league_position - awayStats.league_position);
    const formGapRaw = Math.abs(homeStats.form_last_5.points - awayStats.form_last_5.points);
    const maxTeams = standings.length || 20;

    // Derby detection (same city — approximate by both being top/bottom together)
    const isDerby = false; // Would need external data
    const isRelegation = homeStats.league_position > maxTeams - 4 || awayStats.league_position > maxTeams - 4;
    const isTitle = homeStats.league_position <= 3 && awayStats.league_position <= 3;

    let intensityScore = 0.5; // Base
    intensityScore += positionGap < 5 ? 0.15 : -0.05; // Close teams = more intense
    intensityScore += formGapRaw > 8 ? -0.05 : 0.05; // Uneven form = less intense
    if (isRelegation) intensityScore += 0.15;
    if (isTitle) intensityScore += 0.12;
    if (isDerby) intensityScore += 0.2;
    intensityScore = Math.max(0.1, Math.min(1.0, intensityScore));

    const intensityMultiplier = 0.85 + intensityScore * 0.35; // Range: 0.85 - 1.20

    // Motivation factor: derby, relegation, title race widen prediction intervals
    // by pulling probabilities slightly toward the draw (increased uncertainty)
    let motivationUncertainty = 0;
    if (isDerby) motivationUncertainty += 0.03;
    if (isRelegation) motivationUncertainty += 0.02;
    if (isTitle) motivationUncertainty += 0.02;
    // Apply: increase draw probability, decrease the stronger side proportionally
    // This is applied when building matchResult below

    // ════════════════════════════════════
    // TEMPO LAYER
    // ════════════════════════════════════
    const combinedGoals = homeStats.goals_per_game.total + awayStats.goals_per_game.total +
                          homeStats.goals_against_per_game.total + awayStats.goals_against_per_game.total;
    const tempoScore = Math.max(0, Math.min(1.0, (combinedGoals / 4 - 0.8) / 0.8));
    const tempoMultiplier = 0.85 + tempoScore * 0.3;

    // ════════════════════════════════════
    // DEFENSE LAYER
    // ════════════════════════════════════
    const classifyDefense = (goalsAgainst: number, cleanSheetPct: number): DefenseStyle => {
      if (cleanSheetPct > 35 && goalsAgainst < 1.1) return 'low-block';
      if (goalsAgainst > 1.5 && cleanSheetPct < 20) return 'high-press';
      return 'balanced';
    };

    // ════════════════════════════════════
    // REFEREE LAYER
    // ════════════════════════════════════
    // Basic referee strictness from name (would need API data for full profile)
    const refereeStrictness = 1.0; // Default = league average

    // ════════════════════════════════════
    // ODDS LAYER (placeholder - populated by OddsEngine when available)
    // ════════════════════════════════════

    // ════════════════════════════════════
    // H2H LAYER
    // ════════════════════════════════════
    let hWins = 0, aWins = 0, draws = 0, h2hGoals = 0, hGoals = 0, aGoals = 0;
    const recentH2H = h2hData.slice(0, 10);
    recentH2H.forEach(m => {
      const homeG = m.teams.home.id === homeTeamId ? m.goals.home : m.goals.away;
      const awayG = m.teams.home.id === homeTeamId ? m.goals.away : m.goals.home;
      hGoals += homeG || 0;
      aGoals += awayG || 0;
      h2hGoals += (m.goals.home || 0) + (m.goals.away || 0);
      if (homeG > awayG) hWins++;
      else if (awayG > homeG) aWins++;
      else draws++;
    });

    // ════════════════════════════════════
    // FORM LAYER
    // ════════════════════════════════════
    const parseFormPoints = (f: string) => {
      let pts = 0;
      for (const c of f.slice(-5)) { if (c === 'W') pts += 3; else if (c === 'D') pts += 1; }
      return pts;
    };

    // Apply motivation uncertainty: widen intervals by pulling toward draw
    let finalHP = hP / nt;
    let finalDP = dP / nt;
    let finalAP = aP / nt;
    if (motivationUncertainty > 0) {
      // Pull both home and away proportionally toward draw
      const hShare = finalHP / (finalHP + finalAP + 0.001);
      finalHP -= motivationUncertainty * hShare;
      finalAP -= motivationUncertainty * (1 - hShare);
      finalDP += motivationUncertainty;
      // Re-normalize
      const motTotal = finalHP + finalDP + finalAP;
      finalHP /= motTotal;
      finalDP /= motTotal;
      finalAP /= motTotal;
    }

    return {
      xg,
      matchResult: {
        homeProb: finalHP * 100,
        drawProb: finalDP * 100,
        awayProb: finalAP * 100,
      },
      intensity: {
        score: intensityScore,
        formGap: formGapRaw,
        positionGap,
        isDerby, isRelegationBattle: isRelegation, isTitleClash: isTitle,
        multiplier: intensityMultiplier,
      },
      tempo: {
        score: tempoScore,
        combinedGoalsPerGame: combinedGoals / 2,
        possessionDiff: homeStats.possession_average - awayStats.possession_average,
        multiplier: tempoMultiplier,
      },
      defense: {
        homeStyle: classifyDefense(homeStats.goals_against_per_game.home, homeStats.clean_sheets_percentage.home),
        awayStyle: classifyDefense(awayStats.goals_against_per_game.away, awayStats.clean_sheets_percentage.away),
        homeConcedingRate: homeStats.goals_against_per_game.home,
        awayConcedingRate: awayStats.goals_against_per_game.away,
        homeCleanSheetPct: homeStats.clean_sheets_percentage.home,
        awayCleanSheetPct: awayStats.clean_sheets_percentage.away,
      },
      referee: {
        name: refereeName || null,
        avgCardsPerGame: null,
        avgFoulsPerGame: null,
        strictness: refereeStrictness,
      },
      odds: {
        available: false,
        consensus: null,
        steamMoves: [],
        reverseLineMovement: false,
        clv: null,
        xgAdjust: 0,
        intensityAdjust: 0,
      },
      form: {
        homeLast5: homeStats.form_last_5.form_string,
        awayLast5: awayStats.form_last_5.form_string,
        homeLast5Points: homeStats.form_last_5.points,
        awayLast5Points: awayStats.form_last_5.points,
        homePosition: homeStats.league_position,
        awayPosition: awayStats.league_position,
        homePoints: homeStanding?.points || 0,
        awayPoints: awayStanding?.points || 0,
        homeGoalDiff: homeStats.goal_difference,
        awayGoalDiff: awayStats.goal_difference,
      },
      h2h: {
        totalMatches: recentH2H.length,
        homeWins: hWins, awayWins: aWins, draws,
        avgGoals: recentH2H.length > 0 ? h2hGoals / recentH2H.length : 2.5,
        homeAvgGoals: recentH2H.length > 0 ? hGoals / recentH2H.length : 1.3,
        awayAvgGoals: recentH2H.length > 0 ? aGoals / recentH2H.length : 1.0,
      },
      homeTeam: {
        id: homeTeamId,
        name: homeStanding?.team?.name || `Team ${homeTeamId}`,
        goalsPerGameHome: homeStats.goals_per_game.home,
        goalsConcededPerGameHome: homeStats.goals_against_per_game.home,
        cardsPerGame: homeStats.cards_per_game.yellow + homeStats.cards_per_game.red,
        cornersPerGame: homeStats.corners_per_game,
        cleanSheetPct: homeStats.clean_sheets_percentage.total,
        bttsPercentage: homeStats.both_teams_score_percentage,
      },
      awayTeam: {
        id: awayTeamId,
        name: awayStanding?.team?.name || `Team ${awayTeamId}`,
        goalsPerGameAway: awayStats.goals_per_game.away,
        goalsConcededPerGameAway: awayStats.goals_against_per_game.away,
        cardsPerGame: awayStats.cards_per_game.yellow + awayStats.cards_per_game.red,
        cornersPerGame: awayStats.corners_per_game,
        cleanSheetPct: awayStats.clean_sheets_percentage.total,
        bttsPercentage: awayStats.both_teams_score_percentage,
      },
      fixtureId, leagueId, season,
    };
  }

  /**
   * Enrich context with odds data (call after build if odds available)
   */
  static async enrichWithOdds(ctx: MatchContext): Promise<MatchContext> {
    try {
      const oddsData = await ApiFootballService.getOdds(ctx.fixtureId);
      if (!oddsData || oddsData.length === 0) return ctx;

      // Aggregate bookmaker odds
      let homeOdds: number[] = [], drawOdds: number[] = [], awayOdds: number[] = [];
      let o25: number[] = [], u25: number[] = [], bttsY: number[] = [], bttsN: number[] = [];

      oddsData.forEach(entry => {
        entry.bookmakers.forEach(bk => {
          bk.bets.forEach(bet => {
            if (bet.name === 'Match Winner' || bet.id === 1) {
              bet.values.forEach(v => {
                const o = parseFloat(v.odd);
                if (v.value === 'Home') homeOdds.push(o);
                if (v.value === 'Draw') drawOdds.push(o);
                if (v.value === 'Away') awayOdds.push(o);
              });
            }
            if (bet.name === 'Goals Over/Under' || bet.id === 5) {
              bet.values.forEach(v => {
                const o = parseFloat(v.odd);
                if (v.value === 'Over 2.5') o25.push(o);
                if (v.value === 'Under 2.5') u25.push(o);
              });
            }
            if (bet.name === 'Both Teams Score' || bet.id === 8) {
              bet.values.forEach(v => {
                const o = parseFloat(v.odd);
                if (v.value === 'Yes') bttsY.push(o);
                if (v.value === 'No') bttsN.push(o);
              });
            }
          });
        });
      });

      const avg = (a: number[]) => a.length > 0 ? a.reduce((s, v) => s + v, 0) / a.length : 0;
      const toProb = (o: number) => o > 1 ? (1 / o) * 100 : 0;

      const hAvg = avg(homeOdds), dAvg = avg(drawOdds), aAvg = avg(awayOdds);
      const totalImpl = toProb(hAvg) + toProb(dAvg) + toProb(aAvg);
      const overround = totalImpl - 100;

      // Fair probabilities
      const fair = (o: number) => overround > 0 ? toProb(o) / totalImpl * 100 : toProb(o);

      ctx.odds.available = true;
      ctx.odds.consensus = {
        home: fair(hAvg), draw: fair(dAvg), away: fair(aAvg),
        over25: toProb(avg(o25)), under25: toProb(avg(u25)),
        bttsYes: toProb(avg(bttsY)), bttsNo: toProb(avg(bttsN)),
      };

      // CLV: Our model vs market
      if (ctx.odds.consensus) {
        ctx.odds.clv = {
          home: ctx.matchResult.homeProb - ctx.odds.consensus.home,
          draw: ctx.matchResult.drawProb - ctx.odds.consensus.draw,
          away: ctx.matchResult.awayProb - ctx.odds.consensus.away,
        };
      }

      // Odds-based xG adjustment
      // If market strongly favors over goals, boost our xG
      if (ctx.odds.consensus.over25 > 60 && (1 - AdvancedPredictionEngine.poissonCumulativeBelow(3, ctx.xg.total)) * 100 < 50) {
        ctx.odds.xgAdjust = 0.1; // Market thinks more goals than us
      } else if (ctx.odds.consensus.under25 > 60 && (1 - AdvancedPredictionEngine.poissonCumulativeBelow(3, ctx.xg.total)) * 100 > 60) {
        ctx.odds.xgAdjust = -0.1; // Market thinks fewer goals
      }

      // Steam move detection
      if (homeOdds.length >= 3) {
        const sorted = [...homeOdds].sort((a, b) => a - b);
        const drift = sorted[sorted.length - 1] - sorted[0];
        if (Math.abs(drift) > 0.2) {
          ctx.odds.steamMoves.push({
            market: '1X2',
            direction: drift > 0 ? 'away' : 'home',
            magnitude: drift,
            signal: Math.abs(drift) > 0.3 ? 'steam_move' : 'public_money',
          });
        }
      }

    } catch {
      // Odds not available — context remains without odds
    }

    return ctx;
  }

  /**
   * Build lightweight context from standings data only (for backtest)
   * NO API calls — uses pre-fetched data
   */
  static buildFromStandings(
    homeStanding: Standing,
    awayStanding: Standing,
    leagueId: number,
    season: number,
    fixtureId: number
  ): MatchContext {
    const hp = homeStanding.home.played || 1;
    const ap = awayStanding.away.played || 1;
    const homeGoalsHome = homeStanding.home.goals.for / hp;
    const homeConcededHome = homeStanding.home.goals.against / hp;
    const awayGoalsAway = awayStanding.away.goals.for / ap;
    const awayConcededAway = awayStanding.away.goals.against / ap;

    // Data-driven home advantage from standings home/away win rates
    const hWinRate = homeStanding.home.played > 0 ? homeStanding.home.win / homeStanding.home.played : 0.45;
    const aWinRate = awayStanding.away.played > 0 ? awayStanding.away.win / awayStanding.away.played : 0.30;
    const standingsHomeAdv = Math.max(0.02, Math.min(0.20, hWinRate - aWinRate));
    let homeXG = Math.max(0.4, Math.min(4.0, (homeGoalsHome + awayConcededAway) / 2 + standingsHomeAdv * 0.3));
    let awayXG = Math.max(0.3, Math.min(3.5, (awayGoalsAway + homeConcededHome) / 2 - standingsHomeAdv * 0.15));

    // Form — exponentially weighted (w = 0.84^games_ago)
    const calcWeightedFormPts = (f: string): number => {
      let wPts = 0, totalW = 0;
      const chars = (f || '').slice(-5).split('').reverse(); // Most recent first
      for (let i = 0; i < chars.length; i++) {
        const w = Math.pow(0.84, i);
        totalW += w;
        if (chars[i] === 'W') wPts += 3 * w;
        else if (chars[i] === 'D') wPts += 1 * w;
      }
      return totalW > 0 ? wPts / (totalW * 3) : 0.5; // 0-1 scale
    };
    const hFormW = calcWeightedFormPts(homeStanding.form);
    const aFormW = calcWeightedFormPts(awayStanding.form);
    const fd = hFormW - aFormW; // Range: -1 to 1
    homeXG += Math.max(-0.15, Math.min(0.15, fd * 0.2));
    awayXG -= Math.max(-0.15, Math.min(0.15, fd * 0.15));
    homeXG = Math.max(0.4, homeXG);
    awayXG = Math.max(0.3, awayXG);

    // Flat form points for display
    const parsePoints = (f: string) => {
      let pts = 0;
      for (const c of (f || '').slice(-5)) { if (c === 'W') pts += 3; else if (c === 'D') pts += 1; }
      return pts;
    };
    const hPts = parsePoints(homeStanding.form);
    const aPts = parsePoints(awayStanding.form);

    const totalXG = homeXG + awayXG;
    const FHR = 0.43;

    // Dixon-Coles 1X2
    const RHO = -0.04;
    let rawH = 0, rawD = 0, rawA = 0;
    for (let h = 0; h <= 8; h++) {
      for (let a = 0; a <= 8; a++) {
        let p = AdvancedPredictionEngine.poissonProbability(h, homeXG) *
                AdvancedPredictionEngine.poissonProbability(a, awayXG);
        if (h === 0 && a === 0) p *= (1 - homeXG * awayXG * RHO);
        else if (h === 1 && a === 0) p *= (1 + awayXG * RHO);
        else if (h === 0 && a === 1) p *= (1 + homeXG * RHO);
        else if (h === 1 && a === 1) p *= (1 - RHO);
        p = Math.max(0, p);
        if (h > a) rawH += p; else if (h === a) rawD += p; else rawA += p;
      }
    }
    const tot = rawH + rawD + rawA;

    // PPG-based position adjustment instead of raw rank
    const homePPGStd = homeStanding.points / Math.max(1, homeStanding.all.played);
    const awayPPGStd = awayStanding.points / Math.max(1, awayStanding.all.played);
    const ppgDiffStd = homePPGStd - awayPPGStd;
    const posA = Math.max(-0.035, Math.min(0.035, ppgDiffStd * 0.025));

    // Intensity
    const posGap = Math.abs(homeStanding.rank - awayStanding.rank);
    let intScore = 0.5;
    if (posGap < 5) intScore += 0.15;
    const maxT = 20;
    const isRelStd = homeStanding.rank > maxT - 4 || awayStanding.rank > maxT - 4;
    const isTitleStd = homeStanding.rank <= 3 && awayStanding.rank <= 3;
    if (isRelStd) intScore += 0.15;
    if (isTitleStd) intScore += 0.12;
    intScore = Math.max(0.1, Math.min(1.0, intScore));

    // Motivation uncertainty for relegation/title
    let motUncert = 0;
    if (isRelStd) motUncert += 0.02;
    if (isTitleStd) motUncert += 0.02;

    // Apply Dixon-Coles + PPG adjustment + motivation uncertainty
    let finalHPStd = rawH / tot + posA;
    let finalDPStd = rawD / tot;
    let finalAPStd = rawA / tot - posA;
    if (motUncert > 0) {
      const hSh = finalHPStd / (finalHPStd + finalAPStd + 0.001);
      finalHPStd -= motUncert * hSh;
      finalAPStd -= motUncert * (1 - hSh);
      finalDPStd += motUncert;
      const mT = finalHPStd + finalDPStd + finalAPStd;
      finalHPStd /= mT; finalDPStd /= mT; finalAPStd /= mT;
    } else {
      const mT = finalHPStd + finalDPStd + finalAPStd;
      finalHPStd /= mT; finalDPStd /= mT; finalAPStd /= mT;
    }

    // Cards estimate
    const hPlayed = homeStanding.all.played || 1;
    const aPlayed = awayStanding.all.played || 1;
    const hCardsEst = 2.0; // Default when no card data available
    const aCardsEst = 2.0;

    // Corners estimate from goal rates
    const hCornersEst = Math.max(3.5, Math.min(7.5, 4.5 + (homeGoalsHome - 1.3) * 0.8 + (homeConcededHome - 1.3) * 0.4));
    const aCornersEst = Math.max(3.5, Math.min(7.5, 4.5 + (awayGoalsAway - 1.3) * 0.8 + (awayConcededAway - 1.3) * 0.4));

    const csH = (homeStanding.all.played - Math.ceil(homeStanding.all.goals.against * 0.6)) / hPlayed * 100;
    const csA = (awayStanding.all.played - Math.ceil(awayStanding.all.goals.against * 0.6)) / aPlayed * 100;

    return {
      xg: {
        home: homeXG, away: awayXG, total: totalXG,
        firstHalfHome: homeXG * FHR, firstHalfAway: awayXG * (FHR - 0.01),
        firstHalfTotal: totalXG * FHR,
        secondHalfHome: homeXG * (1 - FHR), secondHalfAway: awayXG * (1 - FHR + 0.01),
        secondHalfTotal: totalXG * (1 - FHR),
      },
      matchResult: {
        homeProb: finalHPStd * 100,
        drawProb: finalDPStd * 100,
        awayProb: finalAPStd * 100,
      },
      intensity: {
        score: intScore, formGap: Math.abs(hPts - aPts), positionGap: posGap,
        isDerby: false, isRelegationBattle: isRelStd,
        isTitleClash: isTitleStd,
        multiplier: 0.85 + intScore * 0.35,
      },
      tempo: {
        score: Math.max(0, Math.min(1, (totalXG - 1.6) / 2)),
        combinedGoalsPerGame: totalXG,
        possessionDiff: 0,
        multiplier: 0.85 + Math.max(0, Math.min(1, (totalXG - 1.6) / 2)) * 0.3,
      },
      defense: {
        homeStyle: homeConcededHome < 1.0 ? 'low-block' : homeConcededHome > 1.5 ? 'high-press' : 'balanced',
        awayStyle: awayConcededAway < 1.0 ? 'low-block' : awayConcededAway > 1.5 ? 'high-press' : 'balanced',
        homeConcedingRate: homeConcededHome,
        awayConcedingRate: awayConcededAway,
        homeCleanSheetPct: Math.max(0, csH),
        awayCleanSheetPct: Math.max(0, csA),
      },
      referee: { name: null, avgCardsPerGame: null, avgFoulsPerGame: null, strictness: 1.0 },
      odds: { available: false, consensus: null, steamMoves: [], reverseLineMovement: false, clv: null, xgAdjust: 0, intensityAdjust: 0 },
      form: {
        homeLast5: (homeStanding.form || '').slice(-5), awayLast5: (awayStanding.form || '').slice(-5),
        homeLast5Points: hPts, awayLast5Points: aPts,
        homePosition: homeStanding.rank, awayPosition: awayStanding.rank,
        homePoints: homeStanding.points, awayPoints: awayStanding.points,
        homeGoalDiff: homeStanding.goalsDiff, awayGoalDiff: awayStanding.goalsDiff,
      },
      h2h: { totalMatches: 0, homeWins: 0, awayWins: 0, draws: 0, avgGoals: 2.5, homeAvgGoals: 1.3, awayAvgGoals: 1.0 },
      homeTeam: {
        id: homeStanding.team.id, name: homeStanding.team.name,
        goalsPerGameHome: homeGoalsHome, goalsConcededPerGameHome: homeConcededHome,
        cardsPerGame: hCardsEst, cornersPerGame: hCornersEst,
        cleanSheetPct: Math.max(0, csH), bttsPercentage: 50,
      },
      awayTeam: {
        id: awayStanding.team.id, name: awayStanding.team.name,
        goalsPerGameAway: awayGoalsAway, goalsConcededPerGameAway: awayConcededAway,
        cardsPerGame: aCardsEst, cornersPerGame: aCornersEst,
        cleanSheetPct: Math.max(0, csA), bttsPercentage: 50,
      },
      fixtureId, leagueId, season,
    };
  }
}
