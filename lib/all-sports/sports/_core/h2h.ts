/**
 * Head-to-Head Analizi
 */
import type { NormalizedGame } from './types';

export interface H2HAnalysis {
  totalGames: number;
  homeWins: number;
  draws: number;
  awayWins: number;
  homeWinRate: number;
  drawRate: number;
  awayWinRate: number;
  avgHomeScore: number;
  avgAwayScore: number;
  avgTotalScore: number;
  over25Rate: number;
  bttsRate: number;
  recentResults: {
    date: string;
    homeTeam: string;
    awayTeam: string;
    score: string;
    winner: string;
  }[];
}

export function analyzeH2H(games: NormalizedGame[], focalTeamId: number): H2HAnalysis {
  if (games.length === 0) {
    return {
      totalGames: 0, homeWins: 0, draws: 0, awayWins: 0,
      homeWinRate: 0, drawRate: 0, awayWinRate: 0,
      avgHomeScore: 0, avgAwayScore: 0, avgTotalScore: 0,
      over25Rate: 0, bttsRate: 0, recentResults: [],
    };
  }

  let homeWins = 0, draws = 0, awayWins = 0;
  let totalHome = 0, totalAway = 0;
  let over25 = 0, btts = 0;

  const recentResults = games.slice(0, 10).map(g => {
    const isFocalHome = g.teams.home.id === focalTeamId;
    const hS = g.scores.home ?? 0;
    const aS = g.scores.away ?? 0;

    if (isFocalHome) {
      totalHome += hS;
      totalAway += aS;
      if (hS > aS) homeWins++;
      else if (hS === aS) draws++;
      else awayWins++;
    } else {
      totalHome += aS;
      totalAway += hS;
      if (aS > hS) homeWins++;
      else if (aS === hS) draws++;
      else awayWins++;
    }

    if (hS + aS > 2.5) over25++;
    if (hS > 0 && aS > 0) btts++;

    return {
      date: g.date,
      homeTeam: g.teams.home.name,
      awayTeam: g.teams.away.name,
      score: `${hS}-${aS}`,
      winner: hS > aS ? g.teams.home.name : hS < aS ? g.teams.away.name : 'Draw',
    };
  });

  const total = games.length;

  return {
    totalGames: total,
    homeWins,
    draws,
    awayWins,
    homeWinRate: homeWins / total,
    drawRate: draws / total,
    awayWinRate: awayWins / total,
    avgHomeScore: totalHome / total,
    avgAwayScore: totalAway / total,
    avgTotalScore: (totalHome + totalAway) / total,
    over25Rate: over25 / total,
    bttsRate: btts / total,
    recentResults,
  };
}
