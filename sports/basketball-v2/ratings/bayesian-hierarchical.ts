/**
 * Bayesian Hierarchical Team Ratings
 *
 * Models each team's offensive and defensive skill as a latent variable
 * with normal-gamma conjugate prior. Updates posterior after each observed
 * game using Kalman-filter-like recursion.
 *
 * Why hierarchical? The "league prior" is a hyper-distribution over team
 * skills. Individual team posteriors are pulled toward the league mean
 * (shrinkage), preventing wild values for new/small-sample teams.
 *
 * Math:
 *   prior:     team_offense ~ N(μ₀, σ₀²)
 *   league:    μ₀ ~ N(0, τ²)  (hyperprior)
 *   likelihood: observed_offense ~ N(team_offense, σ_obs²)
 *   posterior: team_offense | data ~ N(μ_n, σ_n²)
 *     where σ_n² = 1 / (1/σ₀² + n/σ_obs²)
 *           μ_n = σ_n² * (μ₀/σ₀² + Σx/σ_obs²)
 *
 * Output is offense_mean, offense_var, defense_mean, defense_var per team.
 * These can be used directly OR sampled in Monte Carlo for full uncertainty.
 */

import type { CanonicalGame } from '../warehouse/games-repo';

export interface BayesianTeamRating {
  teamId: number;
  offMean: number;       // Posterior mean of offensive skill (points per game over league avg)
  offVar: number;        // Posterior variance
  defMean: number;       // Posterior mean of defensive skill (points allowed under league avg)
  defVar: number;        // Posterior variance
  observations: number;
}

export interface BayesianHyperPriors {
  offPriorMean: number;     // League average offensive deviation (typically 0)
  offPriorVar: number;      // Initial uncertainty about a team's offense
  defPriorMean: number;
  defPriorVar: number;
  obsVar: number;           // Variance of single-game observation
}

const DEFAULT_HYPERPRIORS: BayesianHyperPriors = {
  offPriorMean: 0,
  offPriorVar: 100,    // Wide prior — team could be ±10 ppg from league avg
  defPriorMean: 0,
  defPriorVar: 100,
  obsVar: 144,         // ~12 points stddev per game
};

/**
 * Conjugate normal-normal update.
 * Given a prior N(μ_pre, σ²_pre) and a single observation x with variance σ²_obs,
 * the posterior is N(μ_post, σ²_post).
 */
function bayesUpdate(
  priorMean: number,
  priorVar: number,
  obs: number,
  obsVar: number
): { mean: number; variance: number } {
  // Precision = 1/variance
  const priorPrecision = 1 / priorVar;
  const obsPrecision = 1 / obsVar;
  const postPrecision = priorPrecision + obsPrecision;
  const postVar = 1 / postPrecision;
  const postMean = postVar * (priorMean * priorPrecision + obs * obsPrecision);
  return { mean: postMean, variance: postVar };
}

/**
 * Run Bayesian hierarchical updates over a chronological game sequence.
 * For each game we observe BOTH teams' offensive output and update both
 * teams' posteriors.
 */
export function runBayesianHistory(
  games: CanonicalGame[],
  priors: BayesianHyperPriors = DEFAULT_HYPERPRIORS
): Map<number, BayesianTeamRating> {
  // Compute league average ppg from all games
  let totalPoints = 0;
  let totalCount = 0;
  for (const g of games) {
    if (g.homeScore !== null && g.awayScore !== null) {
      totalPoints += g.homeScore + g.awayScore;
      totalCount += 2;
    }
  }
  const leagueAvgPpg = totalCount > 0 ? totalPoints / totalCount : 110;

  // Initialize all teams to prior
  const ratings = new Map<number, BayesianTeamRating>();

  const sorted = [...games].sort(
    (a, b) => new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime()
  );

  for (const g of sorted) {
    if (g.homeScore === null || g.awayScore === null) continue;

    // Get or initialize ratings
    const home = ratings.get(g.homeTeamId) ?? {
      teamId: g.homeTeamId,
      offMean: priors.offPriorMean,
      offVar: priors.offPriorVar,
      defMean: priors.defPriorMean,
      defVar: priors.defPriorVar,
      observations: 0,
    };
    const away = ratings.get(g.awayTeamId) ?? {
      teamId: g.awayTeamId,
      offMean: priors.offPriorMean,
      offVar: priors.offPriorVar,
      defMean: priors.defPriorMean,
      defVar: priors.defPriorVar,
      observations: 0,
    };

    // Observed: home_off_dev = home_score - leagueAvg
    // Observed: away_off_dev = away_score - leagueAvg
    // home_off + away_def = home_off_dev (sum-of-effects model)
    // For simplicity (and avoiding identifiability issues), we update offense
    // directly and use the COMPLEMENT of opponent score for defense.
    const homeOffObs = g.homeScore - leagueAvgPpg;
    const awayOffObs = g.awayScore - leagueAvgPpg;
    // Defense observation: how much LESS than league avg the OPPONENT scored
    // = -(opponent_score - league_avg)
    const homeDefObs = -(g.awayScore - leagueAvgPpg);
    const awayDefObs = -(g.homeScore - leagueAvgPpg);

    const homeOffPost = bayesUpdate(home.offMean, home.offVar, homeOffObs, priors.obsVar);
    const homeDefPost = bayesUpdate(home.defMean, home.defVar, homeDefObs, priors.obsVar);
    const awayOffPost = bayesUpdate(away.offMean, away.offVar, awayOffObs, priors.obsVar);
    const awayDefPost = bayesUpdate(away.defMean, away.defVar, awayDefObs, priors.obsVar);

    ratings.set(g.homeTeamId, {
      teamId: g.homeTeamId,
      offMean: homeOffPost.mean,
      offVar: homeOffPost.variance,
      defMean: homeDefPost.mean,
      defVar: homeDefPost.variance,
      observations: home.observations + 1,
    });
    ratings.set(g.awayTeamId, {
      teamId: g.awayTeamId,
      offMean: awayOffPost.mean,
      offVar: awayOffPost.variance,
      defMean: awayDefPost.mean,
      defVar: awayDefPost.variance,
      observations: away.observations + 1,
    });
  }

  return ratings;
}

/**
 * Predict expected points using Bayesian posteriors.
 * expected_home = league_avg + home_off_skill - away_def_skill
 * expected_away = league_avg + away_off_skill - home_def_skill
 *
 * This is the "matchup" calculation: home's offense vs away's defense.
 */
export function bayesianExpectedPoints(
  home: BayesianTeamRating,
  away: BayesianTeamRating,
  leagueAvgPpg: number,
  homeCourtAdv: number = 3.0
): {
  expectedHome: number;
  expectedAway: number;
  expectedHomeVar: number;
  expectedAwayVar: number;
} {
  return {
    expectedHome: leagueAvgPpg + home.offMean - away.defMean + homeCourtAdv / 2,
    expectedAway: leagueAvgPpg + away.offMean - home.defMean - homeCourtAdv / 2,
    // Combined variance from both teams' uncertainty + observation noise
    expectedHomeVar: home.offVar + away.defVar + 144, // 12² per-game noise
    expectedAwayVar: away.offVar + home.defVar + 144,
  };
}
