/**
 * Player Props Builder
 *
 * Generates player prop lines (points, rebounds, assists, 3PM) + combo
 * predictions (DD, TD, PRA) using each player's season averages and the
 * empirical correlation matrix between stats.
 *
 * Critical insight: Points/Rebounds/Assists are positively correlated within
 * a player's individual game (~0.30 correlation). Independent normal models
 * UNDERESTIMATE double-double probability by 10-15% — a star averaging 25/8/5
 * gets DD ~28% if you assume independence, but actual rate is closer to 35%.
 *
 * Solution: Multivariate normal sampling with empirical correlations.
 */

import type { PlayerSeasonAverage } from '../warehouse/player-season-repo';
import {
  buildCovariance,
  choleskyDecompose,
  sampleMultivariateNormal,
} from '../simulation/multivariate-normal';

export interface PlayerPropPrediction {
  playerId: number;
  name: string;
  team: string;
  teamCode: string | null;
  position: string;
  gamesPlayed: number;
  mpg: number;

  projected: {
    points: number;
    rebounds: number;
    assists: number;
    threesMade: number;
    steals: number;
    blocks: number;
  };

  stdDev: {
    points: number;
    rebounds: number;
    assists: number;
    threesMade: number;
  };

  // Standard prop lines
  props: {
    points: PropLine[];
    rebounds: PropLine[];
    assists: PropLine[];
    threesMade: PropLine[];
  };

  // Combo predictions (using multivariate sampling)
  combos: {
    doubleDoubleProb: number;     // 2 of (10+ pts, 10+ reb, 10+ ast)
    tripleDoubleProb: number;     // 3 of all three
    praProjected: number;         // pts + reb + ast mean
    praStdDev: number;
    praLines: PropLine[];
    pointsAssistsProjected: number;
    pointsAssistsLines: PropLine[];
  };
}

export interface PropLine {
  line: number;
  overProb: number;
  underProb: number;
  overOdds: number;
  underOdds: number;
}

const DEFAULT_CORRELATIONS = {
  pts_reb: 0.20,
  pts_ast: 0.30,
  reb_ast: 0.10,
  pts_3pm: 0.45,
  ast_3pm: 0.15,
  reb_3pm: -0.10,
};

function impliedOdds(prob: number): number {
  if (prob <= 0) return 999;
  return Math.round((1 / prob) * 100) / 100;
}

function buildPropLines(mean: number, stdDev: number, offsets: number[]): PropLine[] {
  return offsets
    .map((offset) => {
      const line = Math.round(mean) + offset + 0.5;
      if (line <= 0) return null;
      // Normal CDF approximation
      const erf = (x: number): number => {
        const t = 1 / (1 + 0.3275911 * Math.abs(x));
        const y =
          1 -
          ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
            0.254829592) *
            t *
            Math.exp(-x * x);
        return x < 0 ? -y : y;
      };
      const cdf = (x: number) => 0.5 * (1 + erf((x - mean) / (Math.max(0.1, stdDev) * Math.SQRT2)));
      const overProb = 1 - cdf(line);
      const underProb = cdf(line);
      return {
        line,
        overProb: Math.round(overProb * 1000) / 1000,
        underProb: Math.round(underProb * 1000) / 1000,
        overOdds: impliedOdds(overProb),
        underOdds: impliedOdds(underProb),
      };
    })
    .filter((p): p is PropLine => p !== null);
}

/**
 * Build a 4x4 correlation matrix for [points, rebounds, assists, 3PM].
 */
function buildPlayerCorrelationMatrix(saved: Record<string, number> | null): number[][] {
  const c = saved ?? DEFAULT_CORRELATIONS;
  return [
    [1, c.pts_reb ?? 0.20, c.pts_ast ?? 0.30, c.pts_3pm ?? 0.45],
    [c.pts_reb ?? 0.20, 1, c.reb_ast ?? 0.10, c.reb_3pm ?? -0.10],
    [c.pts_ast ?? 0.30, c.reb_ast ?? 0.10, 1, c.ast_3pm ?? 0.15],
    [c.pts_3pm ?? 0.45, c.reb_3pm ?? -0.10, c.ast_3pm ?? 0.15, 1],
  ];
}

/**
 * Compute combo probabilities (DD, TD, PRA) via Monte Carlo with correlated
 * stats. Uses 5000 samples per player.
 */
function computeCombos(
  player: PlayerSeasonAverage
): {
  doubleDoubleProb: number;
  tripleDoubleProb: number;
  praProjected: number;
  praStdDev: number;
  praLines: PropLine[];
  pointsAssistsProjected: number;
  pointsAssistsLines: PropLine[];
} {
  // Build correlation matrix
  const corr = buildPlayerCorrelationMatrix(player.correlations);

  // Means and std devs for [pts, reb, ast, 3pm]
  const means = [player.ppg, player.rpg, player.apg, player.tpmpg];
  const stds = [
    Math.max(1, player.ppgStd || 5),
    Math.max(1, player.rpgStd || 3),
    Math.max(1, player.apgStd || 2),
    Math.max(0.5, player.tpmpgStd || 1),
  ];

  const cov = buildCovariance(stds, corr);
  const cholesky = choleskyDecompose(cov);

  const N = 5000;
  let dd = 0;
  let td = 0;
  let praSum = 0;
  let praSqSum = 0;
  let paSum = 0;
  const praSamples: number[] = [];
  const paSamples: number[] = [];

  for (let i = 0; i < N; i++) {
    const sample = sampleMultivariateNormal(means, cholesky);
    const pts = Math.max(0, sample[0]);
    const reb = Math.max(0, sample[1]);
    const ast = Math.max(0, sample[2]);

    const tens = (pts >= 10 ? 1 : 0) + (reb >= 10 ? 1 : 0) + (ast >= 10 ? 1 : 0);
    if (tens >= 2) dd++;
    if (tens >= 3) td++;

    const pra = pts + reb + ast;
    const pa = pts + ast;
    praSum += pra;
    praSqSum += pra * pra;
    paSum += pa;
    praSamples.push(pra);
    paSamples.push(pa);
  }

  const praMean = praSum / N;
  const praVar = praSqSum / N - praMean * praMean;
  const praStdDev = Math.sqrt(Math.max(0, praVar));
  const paMean = paSum / N;

  // PRA lines (5 around mean)
  const praLines = buildPropLines(praMean, praStdDev, [-5, -2, 0, 2, 5]);

  // PA lines (4 around mean)
  const paStdDev = Math.sqrt(stds[0] ** 2 + stds[2] ** 2 + 2 * stds[0] * stds[2] * (corr[0][2] ?? 0.3));
  const paLines = buildPropLines(paMean, paStdDev, [-4, -2, 0, 2, 4]);

  return {
    doubleDoubleProb: dd / N,
    tripleDoubleProb: td / N,
    praProjected: praMean,
    praStdDev,
    praLines,
    pointsAssistsProjected: paMean,
    pointsAssistsLines: paLines,
  };
}

/**
 * Build player prop predictions for a list of players.
 */
export function buildPlayerProps(
  players: PlayerSeasonAverage[]
): PlayerPropPrediction[] {
  return players.map((p) => {
    const pointsLines = buildPropLines(p.ppg, Math.max(1, p.ppgStd || 5), [-4, -2, 0, 2, 4]);
    const reboundsLines = buildPropLines(p.rpg, Math.max(1, p.rpgStd || 3), [-2, -1, 0, 1, 2]);
    const assistsLines = buildPropLines(p.apg, Math.max(1, p.apgStd || 2), [-2, -1, 0, 1, 2]);
    const threesLines = buildPropLines(p.tpmpg, Math.max(0.5, p.tpmpgStd || 1), [-1, 0, 1]);
    const combos = computeCombos(p);

    return {
      playerId: p.playerId,
      name: p.playerName ?? `Player ${p.playerId}`,
      team: p.teamName ?? '',
      teamCode: null,
      position: 'N/A',
      gamesPlayed: p.gamesPlayed,
      mpg: p.mpg,
      projected: {
        points: Math.round(p.ppg * 10) / 10,
        rebounds: Math.round(p.rpg * 10) / 10,
        assists: Math.round(p.apg * 10) / 10,
        threesMade: Math.round(p.tpmpg * 10) / 10,
        steals: Math.round(p.spg * 10) / 10,
        blocks: Math.round(p.bpg * 10) / 10,
      },
      stdDev: {
        points: Math.round(p.ppgStd * 10) / 10,
        rebounds: Math.round(p.rpgStd * 10) / 10,
        assists: Math.round(p.apgStd * 10) / 10,
        threesMade: Math.round(p.tpmpgStd * 10) / 10,
      },
      props: {
        points: pointsLines,
        rebounds: reboundsLines,
        assists: assistsLines,
        threesMade: threesLines,
      },
      combos: {
        doubleDoubleProb: Math.round(combos.doubleDoubleProb * 1000) / 1000,
        tripleDoubleProb: Math.round(combos.tripleDoubleProb * 1000) / 1000,
        praProjected: Math.round(combos.praProjected * 10) / 10,
        praStdDev: Math.round(combos.praStdDev * 10) / 10,
        praLines: combos.praLines,
        pointsAssistsProjected: Math.round(combos.pointsAssistsProjected * 10) / 10,
        pointsAssistsLines: combos.pointsAssistsLines,
      },
    };
  });
}
