/**
 * Hockey Player & Team Deep Analysis
 *
 * hockey-analytics/lib/playerAnalysis.ts + analysis.ts portu.
 * Hokeye özgü sinyal katmanları:
 *   - Goalie form (save percentage, recent trends)
 *   - Power play efficiency (PP%)
 *   - Penalty kill strength (PK%)
 *   - Faceoff win rate
 *   - Back-to-back game penalty
 *   - Player prop analysis (goal, assist, point, SOG)
 */

import type { NormalizedGame, NormalizedOdds } from '../_core/types';
import { SportApiClient } from '../_core/apiClient';
import { hockeyConfig } from './config';
import {
  analyzePlayerProps,
  computePlayerHistory,
  type PlayerPropPrediction,
  type PlayerEventRecord,
  type PlayerPropAnalysisInput,
} from '../_core/playerProps';

// ===== HOKEYE ÖZGÜ İSTATİSTİK TİPLERİ =====

export interface GoalieForm {
  savePercentage: number;         // 0-1 (örn 0.920)
  goalsAgainstAvg: number;        // GAA
  shutouts: number;
  recentTrend: 'improving' | 'declining' | 'stable';
  gamesPlayed: number;
  adjustmentFactor: number;       // -0.3 to +0.3 (expected goals modifier)
}

export interface SpecialTeamsStats {
  powerPlayPercentage: number;    // 0-1
  penaltyKillPercentage: number;  // 0-1
  ppGoalsPerGame: number;
  pkGoalsAgainstPerGame: number;
  ppOpportunities: number;
  pkOpportunities: number;
  adjustmentFactor: number;       // Net effect on expected goals
}

export interface FaceoffStats {
  winPercentage: number;          // 0-1
  adjustmentFactor: number;       // Puck possession → goal probability
}

export interface BackToBackInfo {
  isBackToBack: boolean;
  penaltyFactor: number;          // 0.85-1.0 (back-to-back → fatigue penalty)
}

export interface HockeyTeamDeepAnalysis {
  goalie: GoalieForm | null;
  specialTeams: SpecialTeamsStats | null;
  faceoffs: FaceoffStats | null;
  backToBack: BackToBackInfo;
}

// ===== GOALIE FORM HESABI =====

/**
 * Goalie form analizi: takım istatistiklerinden save% ve GAA çeker.
 * API formatı: response.goals.against.average = GAA
 */
export function analyzeGoalieForm(teamStats: any): GoalieForm | null {
  if (!teamStats) return null;

  const goalsAgainst = teamStats?.goals?.against;
  if (!goalsAgainst) return null;

  const avgHome = parseFloat(goalsAgainst?.average?.home) || 0;
  const avgAway = parseFloat(goalsAgainst?.average?.away) || 0;
  const overallAvg = (avgHome + avgAway) / 2;

  // Liga ortalaması ~2.7 gol/maç; bunun altı iyi, üstü kötü
  const leagueAvg = hockeyConfig.avgScoreHome;
  const gaa = overallAvg;
  const savePercentage = Math.max(0.85, Math.min(0.95, 1 - (gaa / (gaa + 30))));

  // Trend: form dizisinden (W=iyi performans varsayımı)
  const form = teamStats?.form;
  let trend: GoalieForm['recentTrend'] = 'stable';
  if (typeof form === 'string' && form.length >= 5) {
    const recent3 = form.slice(-3).split('');
    const older3 = form.slice(-6, -3).split('');
    const recentWins = recent3.filter(c => c === 'W').length;
    const olderWins = older3.filter(c => c === 'W').length;
    if (recentWins > olderWins + 1) trend = 'improving';
    else if (recentWins < olderWins - 1) trend = 'declining';
  }

  // Adjustment: iyi goalie → rakibin beklenen golünü düşür
  // -0.3 (çok iyi) ile +0.3 (çok kötü) arası
  let adjustmentFactor = 0;
  if (gaa < leagueAvg * 0.8) adjustmentFactor = -0.25;
  else if (gaa < leagueAvg * 0.9) adjustmentFactor = -0.15;
  else if (gaa > leagueAvg * 1.2) adjustmentFactor = 0.20;
  else if (gaa > leagueAvg * 1.1) adjustmentFactor = 0.10;

  if (trend === 'improving') adjustmentFactor -= 0.05;
  else if (trend === 'declining') adjustmentFactor += 0.05;

  return {
    savePercentage,
    goalsAgainstAvg: gaa,
    shutouts: 0,
    recentTrend: trend,
    gamesPlayed: teamStats?.games?.played?.total ?? 0,
    adjustmentFactor,
  };
}

// ===== SPECIAL TEAMS (PP/PK) =====

/**
 * Power play ve penalty kill analizi.
 * API formatı spor sağlayıcısına bağlıdır; varsa kullan, yoksa ortalama.
 */
export function analyzeSpecialTeams(teamStats: any): SpecialTeamsStats | null {
  if (!teamStats) return null;

  // API sağlayıcısı PP/PK yüzdelerini doğrudan vermeyebilir;
  // gol verilerinden tahmin et:
  // PP% ≈ ekstra gol oranı, PK% ≈ 1 - ekstra kayıp oranı
  const goalsFor = teamStats?.goals?.for;
  const goalsAgainst = teamStats?.goals?.against;
  if (!goalsFor || !goalsAgainst) return null;

  const totalForHome = parseFloat(goalsFor?.total?.home) || 0;
  const totalForAway = parseFloat(goalsFor?.total?.away) || 0;
  const totalAgainstHome = parseFloat(goalsAgainst?.total?.home) || 0;
  const totalAgainstAway = parseFloat(goalsAgainst?.total?.away) || 0;
  const gamesPlayed = teamStats?.games?.played?.total ?? 1;

  const avgFor = (totalForHome + totalForAway) / gamesPlayed;
  const avgAgainst = (totalAgainstHome + totalAgainstAway) / gamesPlayed;

  // PP% league avg ~20%, PK% league avg ~80%
  // Tahmini: gol ortalaması yüksek → PP iyi, gol yemek düşük → PK iyi
  const estimatedPP = Math.min(0.35, Math.max(0.10, 0.20 + (avgFor - 3.0) * 0.05));
  const estimatedPK = Math.min(0.92, Math.max(0.70, 0.80 - (avgAgainst - 2.7) * 0.05));

  const ppGoalsPerGame = avgFor * estimatedPP;
  const pkGoalsAgainstPerGame = avgAgainst * (1 - estimatedPK);

  // Net special teams adjustment:
  // İyi PP = daha fazla gol, iyi PK = daha az gol yeme
  const netPPPK = (estimatedPP - 0.20) * 2 - ((1 - estimatedPK) - 0.20) * 2;
  const adjustmentFactor = Math.max(-0.3, Math.min(0.3, netPPPK));

  return {
    powerPlayPercentage: estimatedPP,
    penaltyKillPercentage: estimatedPK,
    ppGoalsPerGame,
    pkGoalsAgainstPerGame,
    ppOpportunities: Math.round(gamesPlayed * 3.5),
    pkOpportunities: Math.round(gamesPlayed * 3.2),
    adjustmentFactor,
  };
}

// ===== FACEOFF WIN RATE =====

export function analyzeFaceoffs(teamStats: any): FaceoffStats | null {
  if (!teamStats) return null;

  // Faceoff win% tahmini: possession proxy olarak gol oranı
  const goalsFor = teamStats?.goals?.for;
  const goalsAgainst = teamStats?.goals?.against;
  if (!goalsFor || !goalsAgainst) return null;

  const gamesPlayed = teamStats?.games?.played?.total ?? 1;
  const avgFor = (parseFloat(goalsFor?.total?.home || '0') + parseFloat(goalsFor?.total?.away || '0')) / gamesPlayed;
  const avgAgainst = (parseFloat(goalsAgainst?.total?.home || '0') + parseFloat(goalsAgainst?.total?.away || '0')) / gamesPlayed;

  // Proxy: gol oranı ~ faceoff dominance
  const total = avgFor + avgAgainst;
  const winPercentage = total > 0 ? Math.min(0.60, Math.max(0.40, avgFor / total)) : 0.50;

  // Faceoff'un gol etkisi küçük ama var (~%2-3 per %1 faceoff)
  const adjustmentFactor = (winPercentage - 0.50) * 0.5;

  return {
    winPercentage,
    adjustmentFactor: Math.max(-0.15, Math.min(0.15, adjustmentFactor)),
  };
}

// ===== BACK-TO-BACK DETECTION =====

/**
 * Son 2 gün içinde oynanan maç varsa back-to-back cezası.
 * B2B'de takımlar genelde %5-15 daha kötü performans gösterir.
 */
export function detectBackToBack(
  game: NormalizedGame,
  recentGames: NormalizedGame[],
  teamId: number
): BackToBackInfo {
  if (recentGames.length === 0) return { isBackToBack: false, penaltyFactor: 1.0 };

  const gameDate = new Date(game.date);
  const yesterday = new Date(gameDate);
  yesterday.setDate(yesterday.getDate() - 1);
  const dayBefore = new Date(gameDate);
  dayBefore.setDate(dayBefore.getDate() - 2);

  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  const dayBeforeStr = dayBefore.toISOString().slice(0, 10);

  const playedYesterday = recentGames.some(g => {
    const gDate = g.date.slice(0, 10);
    const involved = g.teams.home.id === teamId || g.teams.away.id === teamId;
    return involved && (gDate === yesterdayStr);
  });

  const played2DaysAgo = recentGames.some(g => {
    const gDate = g.date.slice(0, 10);
    const involved = g.teams.home.id === teamId || g.teams.away.id === teamId;
    return involved && (gDate === dayBeforeStr);
  });

  if (playedYesterday) {
    return { isBackToBack: true, penaltyFactor: 0.88 };
  }
  if (played2DaysAgo) {
    return { isBackToBack: true, penaltyFactor: 0.94 };
  }

  return { isBackToBack: false, penaltyFactor: 1.0 };
}

// ===== TOPLU DERİN ANALİZ =====

/**
 * Bir takımın tüm hokeye özgü sinyallerini birleştirir.
 * Sonuç: predict() fonksiyonundaki expectedGoals'a uygulanacak adjustmentlar.
 */
export function analyzeHockeyTeamDeep(params: {
  teamStats: any;
  game: NormalizedGame;
  recentGames: NormalizedGame[];
  teamId: number;
}): HockeyTeamDeepAnalysis {
  return {
    goalie: analyzeGoalieForm(params.teamStats),
    specialTeams: analyzeSpecialTeams(params.teamStats),
    faceoffs: analyzeFaceoffs(params.teamStats),
    backToBack: detectBackToBack(params.game, params.recentGames, params.teamId),
  };
}

/**
 * Deep analysis'ten toplam expected goal adjustment çıkar.
 * Pozitif = daha fazla gol atar, negatif = daha az.
 */
export function totalGoalAdjustment(analysis: HockeyTeamDeepAnalysis): {
  attackAdjust: number;
  defenseAdjust: number;
} {
  let attackAdj = 0;
  let defenseAdj = 0;

  // Special teams → atak
  if (analysis.specialTeams) {
    attackAdj += analysis.specialTeams.adjustmentFactor;
  }

  // Faceoffs → atak
  if (analysis.faceoffs) {
    attackAdj += analysis.faceoffs.adjustmentFactor;
  }

  // Goalie form → savunma (karşı takımın golünü etkiler)
  if (analysis.goalie) {
    defenseAdj += analysis.goalie.adjustmentFactor;
  }

  // Back-to-back → hem atak hem savunma
  if (analysis.backToBack.isBackToBack) {
    const penalty = 1 - analysis.backToBack.penaltyFactor;
    attackAdj -= penalty * 0.3;
    defenseAdj += penalty * 0.3;
  }

  return {
    attackAdjust: Math.max(-0.5, Math.min(0.5, attackAdj)),
    defenseAdjust: Math.max(-0.5, Math.min(0.5, defenseAdj)),
  };
}

// ===== HOCKEY PLAYER PROP ANALYSIS =====

/**
 * Hockey-analytics playerAnalysis portu — _core/playerProps.ts generic'ini
 * hockey-spesifik event mapping'iyle kullanır.
 *
 * Hockey event tipleri: goal, assist, shot_on_goal, point (gol+asist)
 */
export function analyzeHockeyPlayerProps(params: {
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
    sport: 'hockey',
    game: params.game,
    odds: params.odds,
    playerHistory: history,
    minEdge: 0.05,
    maxRisk: 'medium',
  });
}
