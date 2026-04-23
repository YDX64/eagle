/**
 * Recent Form & Momentum
 *
 * "Last 10 games" is the standard NBA + sports betting metric. We compute:
 *   - W/L record over last N games
 *   - Average margin (points scored - points allowed)
 *   - Streak (current win/loss streak count)
 *   - Form rating (weighted recent vs older games)
 *
 * We use exponential decay so the most recent game weighs more than the
 * 10th game ago.
 */

import type { CanonicalGame } from '../warehouse/games-repo';

export interface TeamForm {
  teamId: number;
  lastGames: number;
  wins: number;
  losses: number;
  avgPointsFor: number;
  avgPointsAgainst: number;
  avgMargin: number;
  currentStreak: number;          // positive = win streak, negative = loss
  weightedFormScore: number;      // 0-1, exponentially weighted
}

/**
 * Compute team form from a list of recent finished games (sorted desc by date).
 */
export function computeTeamForm(
  teamId: number,
  recentGames: CanonicalGame[],
  limit: number = 10
): TeamForm {
  // Filter to this team's finished games, most recent first
  const teamGames = recentGames
    .filter((g) => {
      if (g.homeScore === null || g.awayScore === null) return false;
      return g.homeTeamId === teamId || g.awayTeamId === teamId;
    })
    .sort((a, b) => new Date(b.gameDate).getTime() - new Date(a.gameDate).getTime())
    .slice(0, limit);

  if (teamGames.length === 0) {
    return {
      teamId,
      lastGames: 0,
      wins: 0,
      losses: 0,
      avgPointsFor: 0,
      avgPointsAgainst: 0,
      avgMargin: 0,
      currentStreak: 0,
      weightedFormScore: 0.5,
    };
  }

  let wins = 0;
  let losses = 0;
  let totalFor = 0;
  let totalAgainst = 0;
  let weightedFor = 0;
  let weightedTotalWeight = 0;
  let streak = 0;
  let streakBroken = false;

  // Decay factor: 0.85 means each older game counts 85% of the next
  const decay = 0.85;

  for (let i = 0; i < teamGames.length; i++) {
    const g = teamGames[i];
    const isHome = g.homeTeamId === teamId;
    const teamPts = isHome ? g.homeScore! : g.awayScore!;
    const oppPts = isHome ? g.awayScore! : g.homeScore!;
    const won = teamPts > oppPts;

    if (won) wins++;
    else losses++;

    totalFor += teamPts;
    totalAgainst += oppPts;

    const weight = Math.pow(decay, i);
    weightedTotalWeight += weight;
    weightedFor += (won ? 1 : 0) * weight;

    // Update streak (only the most recent contiguous run)
    if (!streakBroken) {
      if (i === 0) {
        streak = won ? 1 : -1;
      } else {
        if ((streak > 0 && won) || (streak < 0 && !won)) {
          streak += won ? 1 : -1;
        } else {
          streakBroken = true;
        }
      }
    }
  }

  return {
    teamId,
    lastGames: teamGames.length,
    wins,
    losses,
    avgPointsFor: totalFor / teamGames.length,
    avgPointsAgainst: totalAgainst / teamGames.length,
    avgMargin: (totalFor - totalAgainst) / teamGames.length,
    currentStreak: streak,
    weightedFormScore: weightedTotalWeight > 0 ? weightedFor / weightedTotalWeight : 0.5,
  };
}
