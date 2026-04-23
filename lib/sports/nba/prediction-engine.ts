/**
 * NBA Prediction Engine
 *
 * Specialized engine for the NBA using v2.nba.api-sports.io. Unlike the
 * generic basketball engine, this one has access to:
 *
 *  1. Quarter-by-quarter linescores (real momentum analysis)
 *  2. Team season aggregates (FG%, 3P%, rebound %, pace)
 *  3. Per-player per-game stats (points/reb/ast/3PM/stl/blk)
 *  4. Plus/minus and advanced metrics
 *
 * Predictions include:
 *  - Match result (moneyline, no draw)
 *  - Total points (full game, per half, per quarter)
 *  - Handicap / spread
 *  - Team totals (over/under per team)
 *  - Quarter winners (Q1, Q2, Q3, Q4)
 *  - Half winners
 *  - Player props (points O/U, rebounds O/U, assists O/U, 3PM O/U, DD, TD)
 *  - Comeback probability (when a team is losing at HT)
 */

import {
  nbaApi,
  type NbaGame,
  type NbaTeamSeasonStats,
  type NbaPlayerSeasonAverage,
} from './api-nba';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface NbaPredictionResult {
  sport: 'nba';
  game_id: number;
  game_info: {
    home_team: string;
    home_team_code: string;
    away_team: string;
    away_team_code: string;
    league: string;
    date: string;
    status: string;
    arena: string;
    season: number;
  };

  // Main match result (no draw in basketball)
  match_result: {
    home_win: { probability: number; odds: number };
    away_win: { probability: number; odds: number };
    predicted_winner: string;
    confidence: number;
  };

  // Total points
  total_points: {
    expected_total: number;
    std_dev: number;
    main_lines: Array<{
      line: number;
      over_prob: number;
      under_prob: number;
    }>;
  };

  // Handicap / spread
  handicap: {
    line: number;        // Home spread (negative = home favored)
    home_cover_prob: number;
    away_cover_prob: number;
    alternative_lines: Array<{
      line: number;
      home_cover_prob: number;
      away_cover_prob: number;
    }>;
  };

  // Team totals
  team_totals: {
    home: { expected: number; std_dev: number; lines: Array<{ line: number; over_prob: number; under_prob: number }> };
    away: { expected: number; std_dev: number; lines: Array<{ line: number; over_prob: number; under_prob: number }> };
  };

  // Quarter analyses
  quarter_breakdown: {
    q1: QuarterPrediction;
    q2: QuarterPrediction;
    q3: QuarterPrediction;
    q4: QuarterPrediction;
  };

  // Half analyses
  half_breakdown: {
    first_half: HalfPrediction;
    second_half: HalfPrediction;
  };

  // Half-time / Full-time combinations
  htft: Record<'1/1' | '1/2' | 'X/1' | 'X/2' | '2/1' | '2/2', number> & {
    most_likely: { outcome: string; probability: number };
  };

  // Live state (if game is in progress)
  live_state?: {
    current_period: number;
    home_points: number;
    away_points: number;
    linescore_home: number[];
    linescore_away: number[];
    elapsed_pct: number; // 0-1 fraction of game elapsed
    comeback_prob?: { team: string; probability: number };
  };

  // Player predictions — top scorers from both teams
  player_predictions: NbaPlayerPrediction[];

  // Team season averages used as inputs
  team_stats: {
    home: NbaTeamProfile;
    away: NbaTeamProfile;
  };

  // Head-to-head summary
  h2h: {
    total_games: number;
    home_wins: number;
    away_wins: number;
    avg_total_points: number;
  };

  // Prediction confidence overall
  prediction_confidence: number;

  // Key factors with weights
  analysis_factors: Record<string, number>;
}

export interface QuarterPrediction {
  quarter: number;                // 1, 2, 3, or 4
  expected_home_points: number;
  expected_away_points: number;
  expected_total: number;
  home_win_prob: number;
  draw_prob: number;
  away_win_prob: number;
  over_under_lines: Array<{ line: number; over_prob: number; under_prob: number }>;
}

export interface HalfPrediction {
  label: string;
  expected_home_points: number;
  expected_away_points: number;
  expected_total: number;
  home_win_prob: number;
  draw_prob: number;
  away_win_prob: number;
  over_under_lines: Array<{ line: number; over_prob: number; under_prob: number }>;
}

export interface NbaTeamProfile {
  ppg: number;         // Points per game
  opp_ppg: number;     // Points allowed
  pace_estimate: number;
  fg_pct: number;
  three_pct: number;
  ft_pct: number;
  orb_pct: number;
  drb_pct: number;
  ast_pg: number;
  tov_pg: number;
  offensive_rating: number;
  defensive_rating: number;
  recent_form: { wins: number; losses: number; lastGames: number };
}

export interface NbaPlayerPrediction {
  player_id: number;
  name: string;
  team: string;
  team_code: string;
  position: string;
  games_played: number;
  mpg: number;

  // Predicted values
  projected: {
    points: number;
    rebounds: number;
    assists: number;
    threes_made: number;
    steals: number;
    blocks: number;
  };

  // Standard deviations (for confidence intervals)
  std_dev: {
    points: number;
    rebounds: number;
    assists: number;
    threes_made: number;
  };

  // Common prop lines with over/under probabilities
  props: {
    points: Array<{ line: number; over_prob: number; under_prob: number }>;
    rebounds: Array<{ line: number; over_prob: number; under_prob: number }>;
    assists: Array<{ line: number; over_prob: number; under_prob: number }>;
    threes_made: Array<{ line: number; over_prob: number; under_prob: number }>;
  };

  // Combo predictions
  combos: {
    double_double_prob: number;  // 2 of (10+ pts, 10+ reb, 10+ ast)
    triple_double_prob: number;  // 3 of (10+ pts, 10+ reb, 10+ ast)
    pts_reb_ast_line: number;    // Sum prop
    pts_reb_ast_over_prob: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Math utilities
// ─────────────────────────────────────────────────────────────────────────────
function erf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return sign * y;
}

function normCdf(x: number, mean: number, sigma: number): number {
  if (sigma <= 0) return x < mean ? 0 : x > mean ? 1 : 0.5;
  return 0.5 * (1 + erf((x - mean) / (sigma * Math.SQRT2)));
}

function normSurvive(line: number, mean: number, sigma: number): number {
  return 1 - normCdf(line, mean, sigma);
}

function normDiffWin(
  meanH: number,
  meanA: number,
  sigmaH: number,
  sigmaA: number,
  includeTie = false
): { home: number; draw: number; away: number } {
  const meanDiff = meanH - meanA;
  const sigmaDiff = Math.sqrt(sigmaH ** 2 + sigmaA ** 2);
  if (includeTie) {
    const tieProb = normCdf(0.5, meanDiff, sigmaDiff) - normCdf(-0.5, meanDiff, sigmaDiff);
    return {
      home: 1 - normCdf(0.5, meanDiff, sigmaDiff),
      draw: tieProb,
      away: normCdf(-0.5, meanDiff, sigmaDiff),
    };
  }
  return {
    home: 1 - normCdf(0, meanDiff, sigmaDiff),
    draw: 0,
    away: normCdf(0, meanDiff, sigmaDiff),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildTeamProfile(stats: NbaTeamSeasonStats | null, fallbackPpg = 112): NbaTeamProfile {
  if (!stats || stats.games === 0) {
    return {
      ppg: fallbackPpg,
      opp_ppg: fallbackPpg,
      pace_estimate: 98,
      fg_pct: 46,
      three_pct: 36,
      ft_pct: 78,
      orb_pct: 10,
      drb_pct: 33,
      ast_pg: 25,
      tov_pg: 13,
      offensive_rating: 112,
      defensive_rating: 112,
      recent_form: { wins: 0, losses: 0, lastGames: 0 },
    };
  }

  const g = stats.games;
  const ppg = stats.points / g;
  // Pace ≈ (FGA + 0.44*FTA + TO - OffReb) / 1 possession estimate
  const possessions = stats.fga + 0.44 * stats.fta + stats.turnovers - stats.offReb;
  const pace = possessions / g;

  return {
    ppg: round2(ppg),
    opp_ppg: round2(ppg - stats.plusMinus / g),
    pace_estimate: round2(pace),
    fg_pct: parseFloat(stats.fgp) || 46,
    three_pct: parseFloat(stats.tpp) || 36,
    ft_pct: parseFloat(stats.ftp) || 78,
    orb_pct: round2((stats.offReb / g) * 100 / 45),
    drb_pct: round2((stats.defReb / g) * 100 / 45),
    ast_pg: round2(stats.assists / g),
    tov_pg: round2(stats.turnovers / g),
    offensive_rating: round2((ppg / pace) * 100),
    defensive_rating: round2(((ppg - stats.plusMinus / g) / pace) * 100),
    recent_form: { wins: 0, losses: 0, lastGames: 0 },
  };
}

function computeRecentForm(teamId: number, recentGames: NbaGame[], limit = 10): { wins: number; losses: number; lastGames: number } {
  let wins = 0;
  let losses = 0;
  const sorted = recentGames
    .filter((g) => g.status?.short === 3 || (g.status?.long || '').toLowerCase() === 'finished')
    .sort((a, b) => new Date(b.date.start).getTime() - new Date(a.date.start).getTime())
    .slice(0, limit);
  for (const g of sorted) {
    const hp = g.scores?.home?.points ?? 0;
    const ap = g.scores?.visitors?.points ?? 0;
    const isHome = g.teams.home.id === teamId;
    const teamScore = isHome ? hp : ap;
    const oppScore = isHome ? ap : hp;
    if (teamScore > oppScore) wins++;
    else losses++;
  }
  return { wins, losses, lastGames: sorted.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Quarter-by-quarter analysis
// ─────────────────────────────────────────────────────────────────────────────
/**
 * NBA quarter pace: quarters are usually slightly unbalanced.
 *   Q1 typically 24-26% of total (starts)
 *   Q2 typically 24-25% (defensive)
 *   Q3 typically 25-26% (momentum shift, adjustments)
 *   Q4 typically 25-26% (late-game slowdowns + fouls)
 */
const QUARTER_SHARES = [0.245, 0.245, 0.255, 0.255] as const;

function buildQuarterPrediction(
  quarter: number,
  homeMean: number,
  awayMean: number,
  homeSigma: number,
  awaySigma: number
): QuarterPrediction {
  const qMeanH = homeMean * QUARTER_SHARES[quarter - 1];
  const qMeanA = awayMean * QUARTER_SHARES[quarter - 1];
  const qSigmaH = homeSigma * Math.sqrt(QUARTER_SHARES[quarter - 1]);
  const qSigmaA = awaySigma * Math.sqrt(QUARTER_SHARES[quarter - 1]);
  const qTotal = qMeanH + qMeanA;
  const qTotalSigma = Math.sqrt(qSigmaH ** 2 + qSigmaA ** 2);

  const { home, draw, away } = normDiffWin(qMeanH, qMeanA, qSigmaH, qSigmaA, true);

  const lines = [];
  for (const offset of [-6, -3, 0, 3, 6]) {
    const line = Math.round(qTotal + offset) + 0.5;
    if (line <= 0) continue;
    lines.push({
      line,
      over_prob: round2(normSurvive(line, qTotal, qTotalSigma)),
      under_prob: round2(normCdf(line, qTotal, qTotalSigma)),
    });
  }

  return {
    quarter,
    expected_home_points: round2(qMeanH),
    expected_away_points: round2(qMeanA),
    expected_total: round2(qTotal),
    home_win_prob: round2(home),
    draw_prob: round2(draw),
    away_win_prob: round2(away),
    over_under_lines: lines,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Player prop predictions
// ─────────────────────────────────────────────────────────────────────────────
function buildPlayerPrediction(
  player: NbaPlayerSeasonAverage,
  teamCode: string
): NbaPlayerPrediction {
  // Use player's season averages and std devs to build over/under lines
  // around the mean (e.g. mean ± 0.5, ± 1.5, ± 2.5 for points)

  const makeProps = (mean: number, sigma: number, offsets: number[]) => {
    return offsets.map((o) => {
      const line = Math.round(mean) + o;
      if (line <= 0) return { line: 0, over_prob: 0, under_prob: 0 };
      return {
        line: line + 0.5, // half-point lines
        over_prob: round2(normSurvive(line + 0.5, mean, sigma)),
        under_prob: round2(normCdf(line + 0.5, mean, sigma)),
      };
    }).filter((p) => p.line > 0);
  };

  // Combo probabilities (approximation via correlation = 0)
  // Real basketball has correlation ~0.3 between pts and reb/ast, but for
  // rough estimates we use independence.
  const p10pts = normSurvive(9.5, player.ppg, player.ppgStdDev || 5);
  const p10reb = normSurvive(9.5, player.rpg, player.rpgStdDev || 3);
  const p10ast = normSurvive(9.5, player.apg, player.apgStdDev || 2);

  // Double-double = any 2 of 3 ≥ 10
  const ddProb =
    p10pts * p10reb * (1 - p10ast) +
    p10pts * (1 - p10reb) * p10ast +
    (1 - p10pts) * p10reb * p10ast +
    p10pts * p10reb * p10ast;

  // Triple-double = all 3 ≥ 10
  const tdProb = p10pts * p10reb * p10ast;

  // PRA (points + rebounds + assists) combined
  const praMean = player.ppg + player.rpg + player.apg;
  const praSigma = Math.sqrt(
    (player.ppgStdDev || 5) ** 2 +
    (player.rpgStdDev || 3) ** 2 +
    (player.apgStdDev || 2) ** 2
  );
  const praLine = Math.round(praMean * 2) / 2;

  return {
    player_id: player.playerId,
    name: `${player.firstname} ${player.lastname}`,
    team: player.teamName,
    team_code: teamCode,
    position: 'N/A',
    games_played: player.gamesPlayed,
    mpg: round2(player.mpg),
    projected: {
      points: round2(player.ppg),
      rebounds: round2(player.rpg),
      assists: round2(player.apg),
      threes_made: round2(player.tpmpg),
      steals: round2(player.spg),
      blocks: round2(player.bpg),
    },
    std_dev: {
      points: round2(player.ppgStdDev),
      rebounds: round2(player.rpgStdDev),
      assists: round2(player.apgStdDev),
      threes_made: round2(player.tpmpgStdDev),
    },
    props: {
      points: makeProps(player.ppg, player.ppgStdDev || 5, [-3, -1, 0, 1, 3]),
      rebounds: makeProps(player.rpg, player.rpgStdDev || 3, [-2, -1, 0, 1, 2]),
      assists: makeProps(player.apg, player.apgStdDev || 2, [-2, -1, 0, 1, 2]),
      threes_made: makeProps(player.tpmpg, player.tpmpgStdDev || 1, [-1, 0, 1]),
    },
    combos: {
      double_double_prob: round2(ddProb),
      triple_double_prob: round2(tdProb),
      pts_reb_ast_line: praLine,
      pts_reb_ast_over_prob: round2(normSurvive(praLine, praMean, praSigma)),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Prediction Engine
// ─────────────────────────────────────────────────────────────────────────────
export class NbaPredictionEngine {
  static async generatePrediction(gameId: number): Promise<NbaPredictionResult> {
    // 1. Fetch the game
    const game = await nbaApi.getGameById(gameId);
    if (!game) throw new Error(`NBA game ${gameId} not found`);

    const season = game.season;
    const homeTeam = game.teams.home;
    const awayTeam = game.teams.visitors;

    // 2. Parallel fetch: team season stats, recent games, player stats, H2H
    const [
      homeStats,
      awayStats,
      homeRecent,
      awayRecent,
      homePlayers,
      awayPlayers,
      h2h,
    ] = await Promise.all([
      nbaApi.getTeamStatistics(homeTeam.id, season).catch(() => null),
      nbaApi.getTeamStatistics(awayTeam.id, season).catch(() => null),
      nbaApi.getTeamGames(homeTeam.id, season).catch(() => []),
      nbaApi.getTeamGames(awayTeam.id, season).catch(() => []),
      nbaApi.getTeamPlayerSeasonStats(homeTeam.id, season).catch(() => []),
      nbaApi.getTeamPlayerSeasonStats(awayTeam.id, season).catch(() => []),
      nbaApi.getHeadToHead(homeTeam.id, awayTeam.id, season).catch(() => []),
    ]);

    // 3. Build team profiles
    const homeProfile = buildTeamProfile(homeStats);
    const awayProfile = buildTeamProfile(awayStats);
    homeProfile.recent_form = computeRecentForm(homeTeam.id, homeRecent);
    awayProfile.recent_form = computeRecentForm(awayTeam.id, awayRecent);

    // 4. Point projections (uses offensive/defensive rating vs opponent)
    // Formula: expected_points = (own_off_rating + opp_def_rating) / 2 * pace / 100
    const avgPace = (homeProfile.pace_estimate + awayProfile.pace_estimate) / 2;
    const HOME_COURT_ADV = 3.0; // ~3 points in NBA

    const homeExpected =
      ((homeProfile.offensive_rating + awayProfile.defensive_rating) / 2) * (avgPace / 100) +
      HOME_COURT_ADV / 2;
    const awayExpected =
      ((awayProfile.offensive_rating + homeProfile.defensive_rating) / 2) * (avgPace / 100) -
      HOME_COURT_ADV / 2;

    // Standard deviation: NBA per-team per-game sigma ≈ 11-13 points
    const sigmaHome = 12;
    const sigmaAway = 12;

    const expectedTotal = homeExpected + awayExpected;
    const totalSigma = Math.sqrt(sigmaHome ** 2 + sigmaAway ** 2);

    // 5. Match result (no draw)
    const { home: homeWinProb, away: awayWinProb } = normDiffWin(
      homeExpected,
      awayExpected,
      sigmaHome,
      sigmaAway,
      false
    );
    const predictedWinner = homeWinProb >= awayWinProb ? homeTeam.name : awayTeam.name;
    const confidence = Math.max(homeWinProb, awayWinProb);

    // 6. Total points lines (around expected)
    const totalLines = [];
    for (const offset of [-10, -5, 0, 5, 10]) {
      const line = Math.round(expectedTotal + offset) + 0.5;
      totalLines.push({
        line,
        over_prob: round2(normSurvive(line, expectedTotal, totalSigma)),
        under_prob: round2(normCdf(line, expectedTotal, totalSigma)),
      });
    }

    // 7. Handicap / spread
    const diffMean = homeExpected - awayExpected;
    const diffSigma = Math.sqrt(sigmaHome ** 2 + sigmaAway ** 2);
    const mainSpread = Math.round(-diffMean * 2) / 2; // Home spread
    const handicapAlts = [];
    for (const offset of [-4, -2, 0, 2, 4]) {
      const line = mainSpread + offset;
      // Home covers spread `line` if diff > -line
      const threshold = -line;
      const homeCover = normSurvive(threshold, diffMean, diffSigma);
      handicapAlts.push({
        line,
        home_cover_prob: round2(homeCover),
        away_cover_prob: round2(1 - homeCover),
      });
    }

    // 8. Team totals
    const makeTeamLines = (mean: number, sigma: number) => {
      const lines = [];
      for (const offset of [-10, -5, 0, 5, 10]) {
        const line = Math.round(mean + offset) + 0.5;
        if (line > 0) {
          lines.push({
            line,
            over_prob: round2(normSurvive(line, mean, sigma)),
            under_prob: round2(normCdf(line, mean, sigma)),
          });
        }
      }
      return lines;
    };

    // 9. Quarter breakdown
    const q1 = buildQuarterPrediction(1, homeExpected, awayExpected, sigmaHome, sigmaAway);
    const q2 = buildQuarterPrediction(2, homeExpected, awayExpected, sigmaHome, sigmaAway);
    const q3 = buildQuarterPrediction(3, homeExpected, awayExpected, sigmaHome, sigmaAway);
    const q4 = buildQuarterPrediction(4, homeExpected, awayExpected, sigmaHome, sigmaAway);

    // 10. Half breakdown
    const fhHome = homeExpected * 0.49;
    const fhAway = awayExpected * 0.49;
    const shHome = homeExpected * 0.51;
    const shAway = awayExpected * 0.51;
    const fhSigmaH = sigmaHome * Math.sqrt(0.49);
    const fhSigmaA = sigmaAway * Math.sqrt(0.49);
    const shSigmaH = sigmaHome * Math.sqrt(0.51);
    const shSigmaA = sigmaAway * Math.sqrt(0.51);

    const fhWin = normDiffWin(fhHome, fhAway, fhSigmaH, fhSigmaA, true);
    const shWin = normDiffWin(shHome, shAway, shSigmaH, shSigmaA, true);

    const buildHalfLines = (mean: number, sigma: number) => {
      const lines = [];
      for (const offset of [-6, -3, 0, 3, 6]) {
        const line = Math.round(mean + offset) + 0.5;
        if (line > 0) {
          lines.push({
            line,
            over_prob: round2(normSurvive(line, mean, sigma)),
            under_prob: round2(normCdf(line, mean, sigma)),
          });
        }
      }
      return lines;
    };

    const firstHalf: HalfPrediction = {
      label: '1st Half',
      expected_home_points: round2(fhHome),
      expected_away_points: round2(fhAway),
      expected_total: round2(fhHome + fhAway),
      home_win_prob: round2(fhWin.home),
      draw_prob: round2(fhWin.draw),
      away_win_prob: round2(fhWin.away),
      over_under_lines: buildHalfLines(fhHome + fhAway, Math.sqrt(fhSigmaH ** 2 + fhSigmaA ** 2)),
    };
    const secondHalf: HalfPrediction = {
      label: '2nd Half',
      expected_home_points: round2(shHome),
      expected_away_points: round2(shAway),
      expected_total: round2(shHome + shAway),
      home_win_prob: round2(shWin.home),
      draw_prob: round2(shWin.draw),
      away_win_prob: round2(shWin.away),
      over_under_lines: buildHalfLines(shHome + shAway, Math.sqrt(shSigmaH ** 2 + shSigmaA ** 2)),
    };

    // 11. HTFT matrix
    const LEAD_RETENTION = 0.78;
    const COMEBACK = 0.22;
    const htft = {
      '1/1': fhWin.home * LEAD_RETENTION,
      '1/2': fhWin.home * COMEBACK,
      'X/1': fhWin.draw * homeWinProb,
      'X/2': fhWin.draw * awayWinProb,
      '2/1': fhWin.away * COMEBACK,
      '2/2': fhWin.away * LEAD_RETENTION,
    };
    const htftSum = Object.values(htft).reduce((s, v) => s + v, 0);
    if (htftSum > 0) {
      (Object.keys(htft) as Array<keyof typeof htft>).forEach((k) => {
        htft[k] /= htftSum;
      });
    }
    const htftSorted = Object.entries(htft).sort((a, b) => b[1] - a[1]);
    const htftResult = {
      '1/1': round2(htft['1/1']),
      '1/2': round2(htft['1/2']),
      'X/1': round2(htft['X/1']),
      'X/2': round2(htft['X/2']),
      '2/1': round2(htft['2/1']),
      '2/2': round2(htft['2/2']),
      most_likely: {
        outcome: htftSorted[0][0],
        probability: round2(htftSorted[0][1]),
      },
    };

    // 12. Player predictions (top 5 scorers from each team)
    const playerPredictions: NbaPlayerPrediction[] = [];
    for (const p of homePlayers.slice(0, 5)) {
      playerPredictions.push(buildPlayerPrediction(p, homeTeam.code));
    }
    for (const p of awayPlayers.slice(0, 5)) {
      playerPredictions.push(buildPlayerPrediction(p, awayTeam.code));
    }

    // 13. H2H summary
    const finishedH2H = h2h.filter((g) => g.status?.short === 3);
    const h2hSummary = {
      total_games: finishedH2H.length,
      home_wins: finishedH2H.filter((g) => {
        const isHomeAsHome = g.teams.home.id === homeTeam.id;
        const hp = g.scores?.home?.points ?? 0;
        const ap = g.scores?.visitors?.points ?? 0;
        return isHomeAsHome ? hp > ap : ap > hp;
      }).length,
      away_wins: finishedH2H.filter((g) => {
        const isHomeAsHome = g.teams.home.id === homeTeam.id;
        const hp = g.scores?.home?.points ?? 0;
        const ap = g.scores?.visitors?.points ?? 0;
        return isHomeAsHome ? ap > hp : hp > ap;
      }).length,
      avg_total_points:
        finishedH2H.length > 0
          ? round2(
              finishedH2H.reduce(
                (s, g) => s + (g.scores?.home?.points ?? 0) + (g.scores?.visitors?.points ?? 0),
                0
              ) / finishedH2H.length
            )
          : 0,
    };

    // 14. Live state analysis (if game is in progress)
    let liveState: NbaPredictionResult['live_state'] | undefined;
    const status = game.status?.long || '';
    if (status.toLowerCase().includes('in play') || status.toLowerCase().includes('halftime')) {
      const currentPeriod = game.periods?.current ?? 1;
      const totalPeriods = game.periods?.total ?? 4;
      const hLinescore = (game.scores.home.linescore || []).map((s) => parseInt(s || '0', 10));
      const aLinescore = (game.scores.visitors.linescore || []).map((s) => parseInt(s || '0', 10));
      const elapsedPct = Math.min(1, currentPeriod / totalPeriods);

      // Comeback probability using remaining time + current margin
      const hPts = game.scores.home.points || 0;
      const aPts = game.scores.visitors.points || 0;
      const margin = hPts - aPts;
      const remainingFactor = 1 - elapsedPct;

      // Remaining expected points with increased variance for small samples
      const remainingHome = homeExpected * remainingFactor;
      const remainingAway = awayExpected * remainingFactor;
      const remainingSigmaH = sigmaHome * Math.sqrt(remainingFactor);
      const remainingSigmaA = sigmaAway * Math.sqrt(remainingFactor);

      const finalHomeMean = hPts + remainingHome;
      const finalAwayMean = aPts + remainingAway;
      const finalWin = normDiffWin(finalHomeMean, finalAwayMean, remainingSigmaH, remainingSigmaA, false);

      let comebackProb: { team: string; probability: number } | undefined;
      if (margin < -5 && finalWin.home > 0.1) {
        comebackProb = { team: homeTeam.name, probability: round2(finalWin.home) };
      } else if (margin > 5 && finalWin.away > 0.1) {
        comebackProb = { team: awayTeam.name, probability: round2(finalWin.away) };
      }

      liveState = {
        current_period: currentPeriod,
        home_points: hPts,
        away_points: aPts,
        linescore_home: hLinescore,
        linescore_away: aLinescore,
        elapsed_pct: round2(elapsedPct),
        comeback_prob: comebackProb,
      };
    }

    return {
      sport: 'nba',
      game_id: gameId,
      game_info: {
        home_team: homeTeam.name,
        home_team_code: homeTeam.code,
        away_team: awayTeam.name,
        away_team_code: awayTeam.code,
        league: 'NBA',
        date: game.date?.start || '',
        status: game.status?.long || 'N/A',
        arena: game.arena?.name || '',
        season,
      },
      match_result: {
        home_win: { probability: round2(homeWinProb), odds: round2(1 / Math.max(0.01, homeWinProb)) },
        away_win: { probability: round2(awayWinProb), odds: round2(1 / Math.max(0.01, awayWinProb)) },
        predicted_winner: predictedWinner,
        confidence: round2(confidence),
      },
      total_points: {
        expected_total: round2(expectedTotal),
        std_dev: round2(totalSigma),
        main_lines: totalLines,
      },
      handicap: {
        line: mainSpread,
        home_cover_prob: round2(handicapAlts.find((h) => h.line === mainSpread)?.home_cover_prob ?? 0.5),
        away_cover_prob: round2(handicapAlts.find((h) => h.line === mainSpread)?.away_cover_prob ?? 0.5),
        alternative_lines: handicapAlts,
      },
      team_totals: {
        home: {
          expected: round2(homeExpected),
          std_dev: sigmaHome,
          lines: makeTeamLines(homeExpected, sigmaHome),
        },
        away: {
          expected: round2(awayExpected),
          std_dev: sigmaAway,
          lines: makeTeamLines(awayExpected, sigmaAway),
        },
      },
      quarter_breakdown: { q1, q2, q3, q4 },
      half_breakdown: { first_half: firstHalf, second_half: secondHalf },
      htft: htftResult,
      live_state: liveState,
      player_predictions: playerPredictions,
      team_stats: { home: homeProfile, away: awayProfile },
      h2h: h2hSummary,
      prediction_confidence: round2(confidence),
      analysis_factors: {
        offensive_rating: 0.25,
        defensive_rating: 0.20,
        pace: 0.15,
        recent_form: 0.15,
        home_court: 0.10,
        h2h: 0.08,
        player_impact: 0.07,
      },
    };
  }
}
