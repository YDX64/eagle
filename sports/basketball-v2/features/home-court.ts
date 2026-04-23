/**
 * Home Court Advantage (per-team, learned from data)
 *
 * Generic NBA HCA ≈ 3 points. But some teams have massive HCAs (Denver +5.5 due
 * to altitude, Utah, Golden State historically), others barely any (Brooklyn,
 * LA Clippers). EuroLeague venues vary even more dramatically (Fenerbahçe Ülker,
 * Real Madrid Palacio).
 *
 * We compute per-team HCA from historical data:
 *   HCA_team = (home_ppg - home_opp_ppg) - (away_ppg - away_opp_ppg)
 *
 * This is the "excess margin" the team gets at home vs away.
 */

import type { CanonicalGame } from '../warehouse/games-repo';

export interface HomeCourtAdvantage {
  teamId: number;
  hca: number;              // Points
  homeSampleSize: number;
  awaySampleSize: number;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Compute team's home court advantage from their season game log.
 */
export function computeHomeCourtAdvantage(
  teamId: number,
  games: CanonicalGame[]
): HomeCourtAdvantage {
  let homeMargin = 0;
  let homeCount = 0;
  let awayMargin = 0;
  let awayCount = 0;

  for (const g of games) {
    if (g.homeScore === null || g.awayScore === null) continue;

    if (g.homeTeamId === teamId) {
      homeMargin += g.homeScore - g.awayScore;
      homeCount++;
    } else if (g.awayTeamId === teamId) {
      awayMargin += g.awayScore - g.homeScore;
      awayCount++;
    }
  }

  const homeAvg = homeCount > 0 ? homeMargin / homeCount : 0;
  const awayAvg = awayCount > 0 ? awayMargin / awayCount : 0;
  const hca = homeAvg - awayAvg;

  // Confidence depends on sample size
  const minSample = Math.min(homeCount, awayCount);
  let confidence: HomeCourtAdvantage['confidence'] = 'low';
  if (minSample >= 20) confidence = 'high';
  else if (minSample >= 10) confidence = 'medium';

  return {
    teamId,
    hca,
    homeSampleSize: homeCount,
    awaySampleSize: awayCount,
    confidence,
  };
}

/**
 * Blend learned per-team HCA with league default based on confidence.
 * Low-sample teams get mostly league average, high-sample teams get their own.
 */
export function blendedHomeCourtAdvantage(
  learnedHca: HomeCourtAdvantage,
  leagueDefaultHca: number
): number {
  if (learnedHca.confidence === 'high') {
    // 80% learned + 20% league default
    return 0.8 * learnedHca.hca + 0.2 * leagueDefaultHca;
  }
  if (learnedHca.confidence === 'medium') {
    return 0.5 * learnedHca.hca + 0.5 * leagueDefaultHca;
  }
  return 0.2 * learnedHca.hca + 0.8 * leagueDefaultHca;
}
