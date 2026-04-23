/**
 * ProBet Feature Engineering
 *
 * Port of ProphitBet's StatisticsEngine to TypeScript.
 * Computes rolling-window features over the last N matches.
 *
 * CRITICAL: Each row's features are calculated using ONLY past matches
 * (shift by 1) to avoid data leakage.
 *
 * Reference:
 *   ProphitBet/src/preprocessing/statistics.py
 *
 * Feature columns produced (per home/away team for each match):
 *  - HW / AW   : home/away wins  (last N)
 *  - HL / AL   : home/away losses (last N)
 *  - HGF / AGF : goals scored (last N)
 *  - HGA / AGA : goals conceded (last N)
 *  - HGD / AGD : goal differential (last N)
 *  - HW% / AW% : cumulative win rate (since season start)
 *  - HL% / AL% : cumulative loss rate
 *  - HAGF / HAGA / HAGD : differential vs opponent
 *  - HWGD / AWGD : wins-by-margin (margin >= goal_diff_margin)
 *  - HLGD / ALGD : losses-by-margin
 */

import type { Fixture } from '../api-football';

export type MatchResult = 'H' | 'D' | 'A';

export interface HistoricalMatch {
  fixtureId: number;
  date: Date;
  homeTeamId: number;
  awayTeamId: number;
  homeGoals: number;
  awayGoals: number;
  result: MatchResult;
}

export interface ProBetFeatures {
  // Home team rolling stats
  HW: number;
  HL: number;
  HGF: number;
  HGA: number;
  HGD: number;

  // Away team rolling stats
  AW: number;
  AL: number;
  AGF: number;
  AGA: number;
  AGD: number;

  // Diff stats (home vs away)
  HAGF: number;
  HAGA: number;
  HAGD: number;
  HAWGD: number;
  HALGD: number;

  // Margin-of-victory stats
  HWGD: number;
  AWGD: number;
  HLGD: number;
  ALGD: number;

  // Cumulative season-long rates
  HWP: number; // HW%
  HLP: number; // HL%
  AWP: number; // AW%
  ALP: number; // AL%

  // Form score (weighted: recent matches matter more)
  homeFormScore: number;
  awayFormScore: number;

  // xG-style metrics (derived from goal averages)
  homeXG: number;
  awayXG: number;
  homeXGA: number;
  awayXGA: number;

  // Strength ratios
  homeAttackStrength: number;
  homeDefenseStrength: number;
  awayAttackStrength: number;
  awayDefenseStrength: number;

  // League context
  leagueAvgHomeGoals: number;
  leagueAvgAwayGoals: number;
}

/**
 * Convert API-Football fixtures into HistoricalMatch entries.
 * Filters out matches that haven't finished yet.
 */
export function toHistoricalMatches(fixtures: Fixture[]): HistoricalMatch[] {
  const out: HistoricalMatch[] = [];
  for (const f of fixtures) {
    if (!f?.fixture?.status || f.fixture.status.short !== 'FT') continue;
    if (f.goals?.home == null || f.goals?.away == null) continue;
    const home = f.goals.home;
    const away = f.goals.away;
    let result: MatchResult = 'D';
    if (home > away) result = 'H';
    else if (home < away) result = 'A';

    out.push({
      fixtureId: f.fixture.id,
      date: new Date(f.fixture.date),
      homeTeamId: f.teams.home.id,
      awayTeamId: f.teams.away.id,
      homeGoals: home,
      awayGoals: away,
      result,
    });
  }
  // Ascending date order — required for rolling stats
  out.sort((a, b) => a.date.getTime() - b.date.getTime());
  return out;
}

/**
 * Get the last N matches for a team that occurred BEFORE a given date.
 * This implements the shift(1) behavior from ProphitBet — current match is excluded.
 */
function lastNMatchesBefore(
  history: HistoricalMatch[],
  teamId: number,
  beforeDate: Date,
  n: number,
  homeOnly = false,
  awayOnly = false
): HistoricalMatch[] {
  const cutoff = beforeDate.getTime();
  const filtered: HistoricalMatch[] = [];
  // Iterate from newest to oldest to grab the most recent N
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.date.getTime() >= cutoff) continue;
    if (homeOnly && m.homeTeamId !== teamId) continue;
    if (awayOnly && m.awayTeamId !== teamId) continue;
    if (!homeOnly && !awayOnly && m.homeTeamId !== teamId && m.awayTeamId !== teamId) continue;
    filtered.push(m);
    if (filtered.length >= n) break;
  }
  return filtered;
}

interface TeamRollingStats {
  wins: number;
  losses: number;
  draws: number;
  goalsFor: number;
  goalsAgainst: number;
  marginWins: number; // wins by >= margin
  marginLosses: number;
  matchesPlayed: number;
  formScore: number; // 0..1 weighted (newer matches have more weight)
}

/**
 * Compute rolling stats for a team over its last N matches (home, away, or both).
 */
function computeRollingStats(
  matches: HistoricalMatch[],
  teamId: number,
  goalDiffMargin: number
): TeamRollingStats {
  const stats: TeamRollingStats = {
    wins: 0,
    losses: 0,
    draws: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    marginWins: 0,
    marginLosses: 0,
    matchesPlayed: matches.length,
    formScore: 0,
  };

  let weightSum = 0;
  let weightedPoints = 0;

  matches.forEach((m, idx) => {
    const isHome = m.homeTeamId === teamId;
    const teamGoals = isHome ? m.homeGoals : m.awayGoals;
    const oppGoals = isHome ? m.awayGoals : m.homeGoals;
    const diff = teamGoals - oppGoals;

    stats.goalsFor += teamGoals;
    stats.goalsAgainst += oppGoals;

    let pts = 0;
    if (diff > 0) {
      stats.wins++;
      pts = 3;
      if (diff >= goalDiffMargin) stats.marginWins++;
    } else if (diff === 0) {
      stats.draws++;
      pts = 1;
    } else {
      stats.losses++;
      pts = 0;
      if (-diff >= goalDiffMargin) stats.marginLosses++;
    }

    // Newer matches (higher idx in newest-first array → lower idx) carry more weight.
    // matches array here is ordered newest → oldest, so weight idx 0 highest.
    const w = matches.length - idx;
    weightSum += w * 3; // max points = 3
    weightedPoints += w * pts;
  });

  stats.formScore = weightSum > 0 ? weightedPoints / weightSum : 0.5;
  return stats;
}

/**
 * Compute cumulative season-long win/loss rate for a team UP TO (excluding) the given date.
 */
function computeCumulativeRates(
  history: HistoricalMatch[],
  teamId: number,
  beforeDate: Date
): { winRate: number; lossRate: number; played: number } {
  const cutoff = beforeDate.getTime();
  let wins = 0;
  let losses = 0;
  let played = 0;
  for (const m of history) {
    if (m.date.getTime() >= cutoff) break;
    if (m.homeTeamId !== teamId && m.awayTeamId !== teamId) continue;
    played++;
    const isHome = m.homeTeamId === teamId;
    const teamGoals = isHome ? m.homeGoals : m.awayGoals;
    const oppGoals = isHome ? m.awayGoals : m.homeGoals;
    if (teamGoals > oppGoals) wins++;
    else if (teamGoals < oppGoals) losses++;
  }
  return {
    winRate: played > 0 ? wins / played : 0.5,
    lossRate: played > 0 ? losses / played : 0.3,
    played,
  };
}

/**
 * Compute league-wide averages for home/away goals (for normalization).
 */
function computeLeagueAverages(history: HistoricalMatch[]): {
  avgHomeGoals: number;
  avgAwayGoals: number;
} {
  if (history.length === 0) return { avgHomeGoals: 1.4, avgAwayGoals: 1.1 };
  let totalHome = 0;
  let totalAway = 0;
  for (const m of history) {
    totalHome += m.homeGoals;
    totalAway += m.awayGoals;
  }
  return {
    avgHomeGoals: totalHome / history.length,
    avgAwayGoals: totalAway / history.length,
  };
}

export interface FeatureExtractionConfig {
  matchHistoryWindow: number; // N — number of past matches to roll over
  goalDiffMargin: number; // for HWGD/AWGD/etc.
}

const DEFAULT_CONFIG: FeatureExtractionConfig = {
  matchHistoryWindow: 6,
  goalDiffMargin: 2,
};

/**
 * Extract features for a single fixture given the team histories.
 */
export function extractFeaturesForMatch(
  homeTeamId: number,
  awayTeamId: number,
  matchDate: Date,
  history: HistoricalMatch[],
  config: Partial<FeatureExtractionConfig> = {}
): ProBetFeatures {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Last N home matches for the home team (only when playing AT home)
  const homeMatches = lastNMatchesBefore(history, homeTeamId, matchDate, cfg.matchHistoryWindow, true, false);
  // Last N away matches for the away team (only when playing AWAY)
  const awayMatches = lastNMatchesBefore(history, awayTeamId, matchDate, cfg.matchHistoryWindow, false, true);

  // Last N matches overall (any venue) for cumulative form
  const homeOverall = lastNMatchesBefore(history, homeTeamId, matchDate, cfg.matchHistoryWindow);
  const awayOverall = lastNMatchesBefore(history, awayTeamId, matchDate, cfg.matchHistoryWindow);

  const homeStats = computeRollingStats(homeMatches, homeTeamId, cfg.goalDiffMargin);
  const awayStats = computeRollingStats(awayMatches, awayTeamId, cfg.goalDiffMargin);
  const homeFormStats = computeRollingStats(homeOverall, homeTeamId, cfg.goalDiffMargin);
  const awayFormStats = computeRollingStats(awayOverall, awayTeamId, cfg.goalDiffMargin);

  const homeRates = computeCumulativeRates(history, homeTeamId, matchDate);
  const awayRates = computeCumulativeRates(history, awayTeamId, matchDate);

  const leagueAvg = computeLeagueAverages(
    history.filter((m) => m.date.getTime() < matchDate.getTime())
  );

  // xG estimates: a team's "expected goals" approximated by goals/match,
  // adjusted by opponent defensive strength.
  const homeMP = Math.max(homeStats.matchesPlayed, 1);
  const awayMP = Math.max(awayStats.matchesPlayed, 1);
  const homeXG = homeStats.goalsFor / homeMP;
  const awayXG = awayStats.goalsFor / awayMP;
  const homeXGA = homeStats.goalsAgainst / homeMP;
  const awayXGA = awayStats.goalsAgainst / awayMP;

  // Attack/defense strength relative to league average
  const homeAttackStrength = leagueAvg.avgHomeGoals > 0 ? homeXG / leagueAvg.avgHomeGoals : 1;
  const homeDefenseStrength = leagueAvg.avgAwayGoals > 0 ? homeXGA / leagueAvg.avgAwayGoals : 1;
  const awayAttackStrength = leagueAvg.avgAwayGoals > 0 ? awayXG / leagueAvg.avgAwayGoals : 1;
  const awayDefenseStrength = leagueAvg.avgHomeGoals > 0 ? awayXGA / leagueAvg.avgHomeGoals : 1;

  return {
    HW: homeStats.wins,
    HL: homeStats.losses,
    HGF: homeStats.goalsFor,
    HGA: homeStats.goalsAgainst,
    HGD: homeStats.goalsFor - homeStats.goalsAgainst,

    AW: awayStats.wins,
    AL: awayStats.losses,
    AGF: awayStats.goalsFor,
    AGA: awayStats.goalsAgainst,
    AGD: awayStats.goalsFor - awayStats.goalsAgainst,

    HAGF: homeStats.goalsFor - awayStats.goalsFor,
    HAGA: homeStats.goalsAgainst - awayStats.goalsAgainst,
    HAGD: homeStats.goalsFor - homeStats.goalsAgainst - (awayStats.goalsFor - awayStats.goalsAgainst),

    HWGD: homeStats.marginWins,
    AWGD: awayStats.marginWins,
    HAWGD: homeStats.marginWins - awayStats.marginWins,
    HLGD: homeStats.marginLosses,
    ALGD: awayStats.marginLosses,
    HALGD: homeStats.marginLosses - awayStats.marginLosses,

    HWP: homeRates.winRate,
    HLP: homeRates.lossRate,
    AWP: awayRates.winRate,
    ALP: awayRates.lossRate,

    homeFormScore: homeFormStats.formScore,
    awayFormScore: awayFormStats.formScore,

    homeXG,
    awayXG,
    homeXGA,
    awayXGA,

    homeAttackStrength,
    homeDefenseStrength,
    awayAttackStrength,
    awayDefenseStrength,

    leagueAvgHomeGoals: leagueAvg.avgHomeGoals,
    leagueAvgAwayGoals: leagueAvg.avgAwayGoals,
  };
}

/**
 * Build a feature matrix from a chronologically-ordered history.
 * Each row's features are computed from prior rows only (no leakage).
 *
 * @returns features and labels (0=Home win, 1=Draw, 2=Away win)
 */
export function buildTrainingMatrix(
  history: HistoricalMatch[],
  config: Partial<FeatureExtractionConfig> = {}
): { X: number[][]; y: number[]; featureNames: string[] } {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const X: number[][] = [];
  const y: number[] = [];

  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    // Use only matches strictly BEFORE m to compute features
    const priorHistory = history.slice(0, i);
    const features = extractFeaturesForMatch(
      m.homeTeamId,
      m.awayTeamId,
      m.date,
      priorHistory,
      cfg
    );

    // Skip very early-season rows where we don't have enough history yet
    const homeCount = lastNMatchesBefore(priorHistory, m.homeTeamId, m.date, cfg.matchHistoryWindow).length;
    const awayCount = lastNMatchesBefore(priorHistory, m.awayTeamId, m.date, cfg.matchHistoryWindow).length;
    if (homeCount < Math.ceil(cfg.matchHistoryWindow / 2)) continue;
    if (awayCount < Math.ceil(cfg.matchHistoryWindow / 2)) continue;

    X.push(featuresToVector(features));
    y.push(m.result === 'H' ? 0 : m.result === 'D' ? 1 : 2);
  }

  return { X, y, featureNames: getFeatureNames() };
}

export function getFeatureNames(): string[] {
  return [
    'HW', 'HL', 'HGF', 'HGA', 'HGD',
    'AW', 'AL', 'AGF', 'AGA', 'AGD',
    'HAGF', 'HAGA', 'HAGD',
    'HWGD', 'AWGD', 'HAWGD', 'HLGD', 'ALGD', 'HALGD',
    'HWP', 'HLP', 'AWP', 'ALP',
    'homeFormScore', 'awayFormScore',
    'homeXG', 'awayXG', 'homeXGA', 'awayXGA',
    'homeAttackStrength', 'homeDefenseStrength',
    'awayAttackStrength', 'awayDefenseStrength',
    'leagueAvgHomeGoals', 'leagueAvgAwayGoals',
  ];
}

export function featuresToVector(f: ProBetFeatures): number[] {
  return [
    f.HW, f.HL, f.HGF, f.HGA, f.HGD,
    f.AW, f.AL, f.AGF, f.AGA, f.AGD,
    f.HAGF, f.HAGA, f.HAGD,
    f.HWGD, f.AWGD, f.HAWGD, f.HLGD, f.ALGD, f.HALGD,
    f.HWP, f.HLP, f.AWP, f.ALP,
    f.homeFormScore, f.awayFormScore,
    f.homeXG, f.awayXG, f.homeXGA, f.awayXGA,
    f.homeAttackStrength, f.homeDefenseStrength,
    f.awayAttackStrength, f.awayDefenseStrength,
    f.leagueAvgHomeGoals, f.leagueAvgAwayGoals,
  ];
}
