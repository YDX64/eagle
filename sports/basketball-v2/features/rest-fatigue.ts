/**
 * Rest & Fatigue Adjustment
 *
 * NBA research shows rest days meaningfully affect performance:
 *   - 0 rest (back-to-back): -2 to -3 point penalty
 *   - 1 rest: baseline (typical)
 *   - 2 rest: +0.5 point bonus
 *   - 3+ rest: +1 to +2 point bonus (fresh legs but also "rust" at very long rest)
 *
 * A team on their 4th game in 5 nights is even worse than a simple B2B.
 * This module computes rest days from game dates and returns a point
 * adjustment to apply to expected points.
 */

import type { CanonicalGame } from '../warehouse/games-repo';

/**
 * Compute days since the team's last game.
 * Returns null if no recent game data available.
 */
export function daysSinceLastGame(
  teamId: number,
  currentGameDate: Date | string,
  recentGames: CanonicalGame[]
): number | null {
  const currentDate = typeof currentGameDate === 'string'
    ? new Date(currentGameDate)
    : currentGameDate;

  // Find most recent finished game for this team BEFORE current
  const before = recentGames
    .filter((g) => {
      if (g.homeScore === null || g.awayScore === null) return false;
      if (g.homeTeamId !== teamId && g.awayTeamId !== teamId) return false;
      return new Date(g.gameDate) < currentDate;
    })
    .sort((a, b) => new Date(b.gameDate).getTime() - new Date(a.gameDate).getTime());

  if (before.length === 0) return null;

  const lastGameDate = new Date(before[0].gameDate);
  const msDiff = currentDate.getTime() - lastGameDate.getTime();
  return Math.floor(msDiff / (24 * 60 * 60 * 1000));
}

/**
 * Count back-to-backs in a team's recent schedule (last 5 games).
 * A "3-in-4" or "4-in-5" situation is particularly fatiguing.
 */
export function countRecentB2Bs(
  teamId: number,
  currentGameDate: Date | string,
  recentGames: CanonicalGame[]
): { b2bCount: number; threeInFour: boolean; fourInFive: boolean } {
  const currentDate = typeof currentGameDate === 'string'
    ? new Date(currentGameDate)
    : currentGameDate;

  // Get team's last 5 games before current
  const before = recentGames
    .filter((g) => {
      if (g.homeTeamId !== teamId && g.awayTeamId !== teamId) return false;
      return new Date(g.gameDate) < currentDate;
    })
    .sort((a, b) => new Date(b.gameDate).getTime() - new Date(a.gameDate).getTime())
    .slice(0, 5);

  if (before.length < 2) {
    return { b2bCount: 0, threeInFour: false, fourInFive: false };
  }

  let b2bCount = 0;
  // Count adjacent B2Bs
  for (let i = 0; i < before.length - 1; i++) {
    const d1 = new Date(before[i].gameDate);
    const d2 = new Date(before[i + 1].gameDate);
    const daysDiff = Math.abs(
      Math.floor((d1.getTime() - d2.getTime()) / (24 * 60 * 60 * 1000))
    );
    if (daysDiff === 1) b2bCount++;
  }

  // 3 games in 4 days (including current)
  const last3 = [currentDate, ...before.slice(0, 2).map((g) => new Date(g.gameDate))];
  const threeInFourSpan =
    Math.abs(
      Math.floor(
        (last3[0].getTime() - last3[last3.length - 1].getTime()) / (24 * 60 * 60 * 1000)
      )
    ) <= 3 && last3.length === 3;

  // 4 games in 5 days
  const last4 = [currentDate, ...before.slice(0, 3).map((g) => new Date(g.gameDate))];
  const fourInFiveSpan =
    last4.length === 4 &&
    Math.abs(
      Math.floor(
        (last4[0].getTime() - last4[last4.length - 1].getTime()) / (24 * 60 * 60 * 1000)
      )
    ) <= 4;

  return { b2bCount, threeInFour: threeInFourSpan, fourInFive: fourInFiveSpan };
}

/**
 * Convert rest days + B2B history to a point adjustment.
 * Negative = penalty, positive = bonus.
 *
 * Based on NBA research (Swartz, Barrantes, et al., 2020):
 *   - B2B second game: -1.8 points
 *   - 3-in-4: -2.5 points total (cumulative fatigue)
 *   - 4-in-5: -3.5 points
 *   - 1 day rest (baseline): 0
 *   - 2 days rest: +0.4
 *   - 3+ days rest: +0.8
 *   - 7+ days rest: +0.2 (rust offsets bonus)
 */
export function restAdjustmentPoints(
  daysRest: number | null,
  b2bContext?: { threeInFour: boolean; fourInFive: boolean }
): number {
  if (daysRest === null) return 0;

  let adjustment = 0;

  if (daysRest === 0) adjustment = -1.8;
  else if (daysRest === 1) adjustment = 0;
  else if (daysRest === 2) adjustment = 0.4;
  else if (daysRest === 3) adjustment = 0.7;
  else if (daysRest >= 4 && daysRest <= 6) adjustment = 0.8;
  else if (daysRest >= 7) adjustment = 0.2; // rust

  // Apply additional cumulative fatigue penalties
  if (b2bContext?.threeInFour) adjustment -= 0.7;
  if (b2bContext?.fourInFive) adjustment -= 1.0;

  return adjustment;
}
