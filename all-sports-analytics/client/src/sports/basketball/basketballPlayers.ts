/**
 * Basketball (EuroLeague/non-NBA) Player & Team Deep Analysis
 *
 * NBA'dan farklar:
 *   - 40 dk maç (NBA 48 dk)
 *   - Daha düşük skor (~80 vs ~115 per team)
 *   - Farklı pace karakteristikleri
 *   - EuroLeague-spesifik istatistik formatı
 */

import type { NormalizedGame, NormalizedOdds } from '../_core/types';
import {
  analyzePlayerProps,
  computePlayerHistory,
  type PlayerPropPrediction,
  type PlayerEventRecord,
} from '../_core/playerProps';

// ===== PACE ANALYSIS (EuroLeague adjusted) =====
export interface BasketballPaceAnalysis {
  estimatedPace: number;
  offensiveRating: number;
  defensiveRating: number;
  netRating: number;
  paceAdjustment: number;
}

export function analyzeBasketballPace(teamStats: any, avgScore: number): BasketballPaceAnalysis {
  const gamesPlayed = teamStats?.games?.played?.total ?? teamStats?.games ?? 1;
  const totalFor = parseFloat(teamStats?.points?.for?.total?.home ?? '0') +
                   parseFloat(teamStats?.points?.for?.total?.away ?? '0') ||
                   avgScore * gamesPlayed;
  const totalAgainst = parseFloat(teamStats?.points?.against?.total?.home ?? '0') +
                       parseFloat(teamStats?.points?.against?.total?.away ?? '0') ||
                       avgScore * gamesPlayed;

  const ppg = totalFor / Math.max(1, gamesPlayed);
  const oppg = totalAgainst / Math.max(1, gamesPlayed);

  // EuroLeague ortalama ~80 puan
  const leagueAvg = 80;
  const estimatedPace = ((ppg + oppg) / 2) / leagueAvg * 100;

  const offensiveRating = (ppg / estimatedPace) * 100;
  const defensiveRating = (oppg / estimatedPace) * 100;
  const netRating = offensiveRating - defensiveRating;

  const paceAdjustment = (estimatedPace - 100) * 0.12;

  return { estimatedPace, offensiveRating, defensiveRating, netRating, paceAdjustment };
}

// ===== REST DAYS =====
export interface BasketballRestInfo {
  daysRest: number;
  isBackToBack: boolean;
  adjustmentPoints: number;
}

export function analyzeBasketballRest(
  game: NormalizedGame,
  recentGames: NormalizedGame[],
  teamId: number
): BasketballRestInfo {
  if (recentGames.length === 0) {
    return { daysRest: 3, isBackToBack: false, adjustmentPoints: 0 };
  }

  const gameDate = new Date(game.date);
  let minDays = 99;
  for (const g of recentGames) {
    const involved = g.teams.home.id === teamId || g.teams.away.id === teamId;
    if (!involved) continue;
    const diff = Math.abs(gameDate.getTime() - new Date(g.date).getTime()) / (1000 * 60 * 60 * 24);
    if (diff > 0 && diff < minDays) minDays = Math.round(diff);
  }

  const daysRest = minDays === 99 ? 3 : minDays;
  const isBackToBack = daysRest <= 1;
  const adjustmentPoints = isBackToBack ? -3 : daysRest === 2 ? -1 : 0;

  return { daysRest, isBackToBack, adjustmentPoints };
}

// ===== COMBINED DEEP ANALYSIS =====
export interface BasketballDeepAnalysis {
  pace: BasketballPaceAnalysis | null;
  rest: BasketballRestInfo;
  totalScoreAdjustment: number;
}

export function analyzeBasketballDeep(params: {
  teamStats: any;
  avgScore: number;
  game: NormalizedGame;
  recentGames: NormalizedGame[];
  teamId: number;
}): BasketballDeepAnalysis {
  const pace = params.teamStats ? analyzeBasketballPace(params.teamStats, params.avgScore) : null;
  const rest = analyzeBasketballRest(params.game, params.recentGames, params.teamId);

  let totalScoreAdjustment = 0;
  if (pace) totalScoreAdjustment += pace.paceAdjustment;
  totalScoreAdjustment += rest.adjustmentPoints;

  return { pace, rest, totalScoreAdjustment };
}

// ===== BASKETBALL PLAYER PROPS =====
export function analyzeBasketballPlayerProps(params: {
  game: NormalizedGame;
  odds: NormalizedOdds | null;
  events?: Array<{ player: string; type: string; timestamp: number }>;
  gamesPlayed?: number;
}): PlayerPropPrediction[] {
  const eventRecords: PlayerEventRecord[] = (params.events ?? []).map(e => ({
    playerName: e.player,
    eventType: e.type,
    timestamp: e.timestamp,
  }));

  const history = computePlayerHistory(eventRecords, params.gamesPlayed ?? 10);

  return analyzePlayerProps({
    sport: 'basketball',
    game: params.game,
    odds: params.odds,
    playerHistory: history,
    minEdge: 0.05,
    maxRisk: 'medium',
  });
}
