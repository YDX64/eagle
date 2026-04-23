/**
 * Pace-Adjusted Ratings (Dean Oliver methodology)
 *
 * Basketball has widely varying pace — a "high scoring" team may just play
 * fast while having poor efficiency. Pace-adjusted ratings normalize to a
 * per-100-possession basis so teams can be compared apples-to-apples.
 *
 * Key formulas:
 *   Possessions = FGA - OREB + TO + 0.44 * FTA
 *   Offensive Rating = (Points / Possessions) * 100
 *   Defensive Rating = (Points Allowed / Opponent Possessions) * 100
 *   Net Rating = Off Rating - Def Rating
 *
 * Projected game outcome:
 *   Expected pace = (home_pace + away_pace) / 2  (not mean — it's a rate)
 *   Expected home points = home_off_rating * expected_pace / 100 * (adjust for opp defense)
 */

export interface PaceRatingInputs {
  fga: number;
  offReb: number;
  turnovers: number;
  fta: number;
  points: number;
  pointsAllowed: number;
  games: number;
}

export interface PaceRating {
  possessionsPerGame: number;
  offensiveRating: number;
  defensiveRating: number;
  netRating: number;
}

/**
 * Compute pace-adjusted ratings from raw season totals.
 */
export function computePaceRating(input: PaceRatingInputs): PaceRating | null {
  if (input.games <= 0 || input.fga <= 0) return null;

  const possessions = input.fga - input.offReb + input.turnovers + 0.44 * input.fta;
  const possessionsPerGame = possessions / input.games;

  const ppg = input.points / input.games;
  const oppPpg = input.pointsAllowed / input.games;

  const offensiveRating = possessionsPerGame > 0 ? (ppg / possessionsPerGame) * 100 : 0;
  const defensiveRating = possessionsPerGame > 0 ? (oppPpg / possessionsPerGame) * 100 : 0;
  const netRating = offensiveRating - defensiveRating;

  return { possessionsPerGame, offensiveRating, defensiveRating, netRating };
}

/**
 * Project expected points for an upcoming game given both teams' ratings.
 *
 * Formula:
 *   expected_home = avg(home_ORtg, away_DRtg) * expected_pace / 100
 *   expected_away = avg(away_ORtg, home_DRtg) * expected_pace / 100
 *
 * expected_pace = average of both teams' paces (the rate adjusts to average)
 */
export function projectGamePoints(
  homeOrtg: number,
  homeDrtg: number,
  homePace: number,
  awayOrtg: number,
  awayDrtg: number,
  awayPace: number,
  homeCourtAdv: number = 3.0
): {
  expectedHome: number;
  expectedAway: number;
  expectedTotal: number;
  expectedPace: number;
} {
  // Pace is a two-way interaction: high-pace team vs low-pace team lands in
  // between. Using the harmonic mean would be more rigorous in possession
  // theory, but arithmetic mean is close enough and more intuitive.
  const expectedPace = (homePace + awayPace) / 2;

  // Team's "true offense rating" in this matchup = avg(own offense, opp defense)
  const homeMatchupOrtg = (homeOrtg + awayDrtg) / 2;
  const awayMatchupOrtg = (awayOrtg + homeDrtg) / 2;

  // Points = matchup rating * pace / 100
  // Plus home court adjustment split asymmetrically (+adv/2 to home, -adv/2 to away)
  let expectedHome = (homeMatchupOrtg * expectedPace) / 100 + homeCourtAdv / 2;
  let expectedAway = (awayMatchupOrtg * expectedPace) / 100 - homeCourtAdv / 2;

  // Ensure positive
  expectedHome = Math.max(0, expectedHome);
  expectedAway = Math.max(0, expectedAway);

  return {
    expectedHome,
    expectedAway,
    expectedTotal: expectedHome + expectedAway,
    expectedPace,
  };
}
