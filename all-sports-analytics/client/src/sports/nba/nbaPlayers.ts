/**
 * NBA Player & Team Deep Analysis
 *
 * NBA'ye özgü sinyal katmanları:
 *   - Pace factor (tempo: possession per 48 min)
 *   - Offensive/Defensive Rating proxy
 *   - Rest days / back-to-back penalty
 *   - Player prop analysis (PTS, AST, REB, 3PM)
 */

import type { NormalizedGame, NormalizedOdds } from '../_core/types';
import {
  analyzePlayerProps,
  computePlayerHistory,
  type PlayerPropPrediction,
  type PlayerEventRecord,
} from '../_core/playerProps';

// ===== PACE & EFFICIENCY =====
export interface NbaPaceAnalysis {
  estimatedPace: number;          // Possessions per 48 min
  offensiveRating: number;        // Points per 100 possessions
  defensiveRating: number;
  netRating: number;
  paceAdjustment: number;         // Beklenen toplam skora eklenir/çıkar
}

/**
 * NBA takım istatistiklerinden pace + efficiency hesaplar.
 * Gerçek pace verisi yoksa gol ortalamasından proxy üretilir.
 *
 * NBA ortalama pace ~100 possession/48min, ortalama skor ~115 puan.
 * Yüksek pace → yüksek toplam skor.
 */
export function analyzePace(teamStats: any, avgScore: number): NbaPaceAnalysis {
  const gamesPlayed = teamStats?.games?.played?.total ?? teamStats?.games ?? 1;
  const totalFor = parseFloat(teamStats?.points?.for?.total?.all ?? '0') ||
                   parseFloat(teamStats?.points?.for?.total ?? '0') ||
                   avgScore * gamesPlayed;
  const totalAgainst = parseFloat(teamStats?.points?.against?.total?.all ?? '0') ||
                       parseFloat(teamStats?.points?.against?.total ?? '0') ||
                       avgScore * gamesPlayed;

  const ppg = totalFor / Math.max(1, gamesPlayed);
  const oppg = totalAgainst / Math.max(1, gamesPlayed);

  // Pace proxy: (ppg + oppg) / 2 / avgLeagueScore * 100
  const leagueAvgPPG = 115;
  const estimatedPace = ((ppg + oppg) / 2) / leagueAvgPPG * 100;

  // Efficiency proxy
  const offensiveRating = (ppg / estimatedPace) * 100;
  const defensiveRating = (oppg / estimatedPace) * 100;
  const netRating = offensiveRating - defensiveRating;

  // Pace adjustment: yüksek pace → toplam skor yukarı
  const paceAdjustment = (estimatedPace - 100) * 0.15;

  return {
    estimatedPace,
    offensiveRating,
    defensiveRating,
    netRating,
    paceAdjustment,
  };
}

// ===== REST DAYS / BACK-TO-BACK =====
export interface RestDaysInfo {
  daysRest: number;                // 0 = same day (impossible), 1 = back-to-back, 2+ = rested
  isBackToBack: boolean;
  penaltyFactor: number;           // 0.90-1.0
  adjustmentPoints: number;        // Beklenen skordan düşülecek puan
}

export function analyzeRestDays(
  game: NormalizedGame,
  recentGames: NormalizedGame[],
  teamId: number
): RestDaysInfo {
  if (recentGames.length === 0) {
    return { daysRest: 3, isBackToBack: false, penaltyFactor: 1.0, adjustmentPoints: 0 };
  }

  const gameDate = new Date(game.date);
  let minDays = 99;

  for (const g of recentGames) {
    const involved = g.teams.home.id === teamId || g.teams.away.id === teamId;
    if (!involved) continue;
    const gDate = new Date(g.date);
    const diff = Math.abs(gameDate.getTime() - gDate.getTime()) / (1000 * 60 * 60 * 24);
    if (diff > 0 && diff < minDays) minDays = Math.round(diff);
  }

  const daysRest = minDays === 99 ? 3 : minDays;
  const isBackToBack = daysRest <= 1;

  // NBA B2B cezası: ~3-5 puan düşüş, %4-6 win rate düşüşü
  let penaltyFactor = 1.0;
  let adjustmentPoints = 0;
  if (daysRest <= 1) {
    penaltyFactor = 0.92;
    adjustmentPoints = -4;
  } else if (daysRest === 2) {
    penaltyFactor = 0.97;
    adjustmentPoints = -1.5;
  }

  return { daysRest, isBackToBack, penaltyFactor, adjustmentPoints };
}

// ===== COMBINED NBA DEEP ANALYSIS =====
export interface NbaDeepAnalysis {
  pace: NbaPaceAnalysis | null;
  restDays: RestDaysInfo;
  totalScoreAdjustment: number;    // Beklenen toplam skora eklenir
}

export function analyzeNbaDeep(params: {
  teamStats: any;
  avgScore: number;
  game: NormalizedGame;
  recentGames: NormalizedGame[];
  teamId: number;
}): NbaDeepAnalysis {
  const pace = params.teamStats ? analyzePace(params.teamStats, params.avgScore) : null;
  const restDays = analyzeRestDays(params.game, params.recentGames, params.teamId);

  let totalScoreAdjustment = 0;
  if (pace) totalScoreAdjustment += pace.paceAdjustment;
  totalScoreAdjustment += restDays.adjustmentPoints;

  return { pace, restDays, totalScoreAdjustment };
}

// ===== NBA PLAYER PROPS =====
export function analyzeNbaPlayerProps(params: {
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
    sport: 'nba',
    game: params.game,
    odds: params.odds,
    playerHistory: history,
    minEdge: 0.05,
    maxRisk: 'medium',
  });
}
