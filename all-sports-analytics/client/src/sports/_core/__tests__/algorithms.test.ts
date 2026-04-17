/**
 * Critical algorithm validation tests
 * REAL MONEY SAFETY - bu testler geçmeli
 */

import { describe, it, expect } from 'vitest';
import { poissonProb, deriveOutcomes, splitHandicapProb } from '../poisson';
import { normalCdf, normalSurvival, deriveNormalOutcomes } from '../normal';
import { kellyStake, calculateEdge, rateValueBet } from '../kelly';
import { calculateFormScore } from '../form';

describe('Poisson Distribution', () => {
  it('probability sums to ~1 for reasonable lambda', () => {
    let total = 0;
    for (let k = 0; k <= 30; k++) total += poissonProb(3, k);
    expect(total).toBeCloseTo(1, 6);
  });

  it('zero lambda edge case', () => {
    expect(poissonProb(0, 0)).toBe(1);
    expect(poissonProb(0, 1)).toBe(0);
  });

  it('known values', () => {
    // P(X=2 | λ=3) = (3^2 * e^-3) / 2! = 4.5 * 0.04979 = 0.2240
    expect(poissonProb(3, 2)).toBeCloseTo(0.2240, 3);
  });
});

describe('Derive Outcomes (joint Poisson)', () => {
  it('home/draw/away sum to 1', () => {
    const o = deriveOutcomes(1.5, 1.2, { maxGoals: 10 });
    expect(o.homeWin + o.draw + o.awayWin).toBeCloseTo(1, 4);
  });

  it('higher lambda home leads to higher home win prob', () => {
    const o1 = deriveOutcomes(2.0, 1.0);
    const o2 = deriveOutcomes(1.0, 2.0);
    expect(o1.homeWin).toBeGreaterThan(o1.awayWin);
    expect(o2.awayWin).toBeGreaterThan(o2.homeWin);
  });

  it('over/under sum to 1', () => {
    const o = deriveOutcomes(1.5, 1.2);
    const ou = o.overUnder[2.5];
    expect(ou.over + ou.under).toBeCloseTo(1, 4);
  });

  it('handicap home + away + push should sum to 1', () => {
    const o = deriveOutcomes(1.5, 1.2);
    Object.values(o.handicaps).forEach(h => {
      expect(h.home + h.away + h.push).toBeCloseTo(1, 4);
    });
  });

  it('BTTS probabilities complement to 1', () => {
    const o = deriveOutcomes(1.5, 1.2);
    expect(o.btts.yes + o.btts.no).toBeCloseTo(1, 4);
  });

  it('odd/even sum to 1', () => {
    const o = deriveOutcomes(1.5, 1.2);
    expect(o.oddEven.odd + o.oddEven.even).toBeCloseTo(1, 4);
  });
});

describe('Split Handicap (Iddaa Kırık)', () => {
  it('split (-0.5, -1) is between single -0.5 and -1', () => {
    const lambda_h = 1.8;
    const lambda_a = 1.2;

    // Calculate -0.5 win prob directly
    const oHc = deriveOutcomes(lambda_h, lambda_a, { handicapLines: [-0.5, -1, -0.75] });
    const single_05 = oHc.handicaps[-0.5].home / (oHc.handicaps[-0.5].home + oHc.handicaps[-0.5].away);
    const single_1 = oHc.handicaps[-1].home / (oHc.handicaps[-1].home + oHc.handicaps[-1].away + oHc.handicaps[-1].push);

    const split = splitHandicapProb(lambda_h, lambda_a, -0.5, -1, true);
    // Should be between the two single lines
    expect(split).toBeLessThanOrEqual(single_05 + 0.05);
    expect(split).toBeGreaterThanOrEqual(single_1 - 0.05);
  });
});

describe('Normal Distribution', () => {
  it('CDF of 0 at standard normal is 0.5', () => {
    expect(normalCdf(0, 0, 1)).toBeCloseTo(0.5, 3);
  });

  it('CDF symmetry', () => {
    expect(normalCdf(-1.96, 0, 1)).toBeCloseTo(0.025, 2);
    expect(normalCdf(1.96, 0, 1)).toBeCloseTo(0.975, 2);
  });

  it('survival + cdf = 1', () => {
    const x = 2.5;
    expect(normalCdf(x, 0, 1) + normalSurvival(x, 0, 1)).toBeCloseTo(1, 6);
  });
});

describe('Normal-derived basketball outcomes', () => {
  it('80 vs 78 mean + 12 stddev - home favored', () => {
    const o = deriveNormalOutcomes(80, 78, 12, 12, {
      ouLines: [155.5, 160.5, 165.5],
      drawBuffer: 0.5,
    });
    expect(o.homeWin).toBeGreaterThan(o.awayWin);
    expect(o.homeWin + o.awayWin).toBeGreaterThan(0.95); // Nearly 100% (no draw in basketball)
    expect(o.overUnder[158.5 > 0 ? 160.5 : 0]).toBeDefined();
  });

  it('symmetric teams = ~50/50', () => {
    const o = deriveNormalOutcomes(100, 100, 10, 10, { drawBuffer: 0.5 });
    expect(Math.abs(o.homeWin - o.awayWin)).toBeLessThan(0.1);
  });
});

describe('Kelly Criterion', () => {
  it('positive edge = positive stake', () => {
    // 60% prob at 2.00 odds = (1 * 0.6 - 0.4) / 1 = 0.2 Kelly
    // Fractional (25%) = 0.05
    expect(kellyStake(0.6, 2.0, 0.25)).toBeCloseTo(0.05, 3);
  });

  it('negative edge = 0 stake', () => {
    expect(kellyStake(0.4, 2.0, 0.25)).toBe(0);
  });

  it('no edge = 0 stake', () => {
    expect(kellyStake(0.5, 2.0, 0.25)).toBe(0);
  });

  it('extreme probability clamped', () => {
    expect(kellyStake(0, 2.0)).toBe(0);
    expect(kellyStake(1, 2.0)).toBe(0);
  });
});

describe('Edge Calculation', () => {
  it('calculates edge correctly', () => {
    // True prob 60%, odds 2.00 (implied 50%)
    // Edge = (0.6 - 0.5) / 0.5 = 0.20 (20%)
    expect(calculateEdge(0.6, 2.0)).toBeCloseTo(0.20, 4);
  });

  it('negative edge', () => {
    // True prob 40%, odds 2.00
    expect(calculateEdge(0.4, 2.0)).toBeCloseTo(-0.20, 4);
  });
});

describe('Rating Value Bets', () => {
  it('excellent at 26% edge', () => expect(rateValueBet(0.26)).toBe('excellent'));
  it('good at 16% edge', () => expect(rateValueBet(0.16)).toBe('good'));
  it('moderate at 9% edge', () => expect(rateValueBet(0.09)).toBe('moderate'));
  it('low at 4% edge', () => expect(rateValueBet(0.04)).toBe('low'));
});

describe('Form Score', () => {
  it('all wins = 100', () => {
    expect(calculateFormScore('WWWWW')).toBeCloseTo(100, 1);
  });

  it('all losses = 0', () => {
    expect(calculateFormScore('LLLLL')).toBeCloseTo(0, 1);
  });

  it('null form defaults to 50', () => {
    expect(calculateFormScore(null)).toBe(50);
    expect(calculateFormScore('')).toBe(50);
  });

  it('recent weighted more', () => {
    // WLLLL should be lower than LLLLW (recent loss vs recent win)
    const recentLoss = calculateFormScore('WLLLL'); // Very recent loss
    const recentWin = calculateFormScore('LLLLW'); // Most recent win
    expect(recentWin).toBeGreaterThan(recentLoss);
  });
});

describe('System Coupon Probability', () => {
  it('dp-based probability sanity check', async () => {
    const { calculateSystemProbability } = await import('../../../lib/couponEngine');
    // 3 bets at 70% each, need all 3 to win = 0.7^3 = 0.343
    const p = calculateSystemProbability([0.7, 0.7, 0.7], 3);
    expect(p).toBeCloseTo(0.343, 4);

    // 3 bets at 70% each, need at least 2 = C(3,2)*0.7^2*0.3 + 0.7^3 = 0.441 + 0.343 = 0.784
    const p2 = calculateSystemProbability([0.7, 0.7, 0.7], 2);
    expect(p2).toBeCloseTo(0.784, 3);

    // 5 bets at 80%, need 3 of 5
    const p3 = calculateSystemProbability([0.8, 0.8, 0.8, 0.8, 0.8], 3);
    expect(p3).toBeGreaterThan(0.9); // Very likely with 80% each
  });
});
