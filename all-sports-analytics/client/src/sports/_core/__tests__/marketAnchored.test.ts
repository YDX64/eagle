/**
 * Market-Anchored Bayesian algoritmanın validasyonu
 * CRITICAL: Screenshot'taki %16 tutma senaryosunu önlemeli
 */

import { describe, it, expect } from 'vitest';
import {
  removeOverround,
  calculateMarketConsensus,
  calculateUncertaintyFactor,
  marketAnchoredPosterior,
  qualifyBet,
  QUALITY_FIRST_DEFAULTS,
} from '../marketAnchored';

describe('Overround Removal', () => {
  it('2-way market overround correction', () => {
    // H/A: 2.00/2.00 → implied 0.50/0.50 = 100% sum (no overround)
    const fair = removeOverround([2.0, 2.0]);
    expect(fair[0]).toBeCloseTo(0.5, 4);
    expect(fair[1]).toBeCloseTo(0.5, 4);
  });

  it('real bookmaker overround', () => {
    // H/D/A: 2.00/3.50/4.00
    // Implied: 0.50/0.286/0.25 = 1.036 total
    // Fair: 0.483/0.276/0.241
    const fair = removeOverround([2.0, 3.5, 4.0]);
    expect(fair[0]).toBeCloseTo(0.483, 2);
    expect(fair[1]).toBeCloseTo(0.276, 2);
    expect(fair[2]).toBeCloseTo(0.241, 2);
    expect(fair.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4);
  });

  it('sums to exactly 1', () => {
    const fair = removeOverround([1.50, 3.80, 6.50]);
    expect(fair.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });
});

describe('Market Consensus', () => {
  it('single bookmaker', () => {
    const c = calculateMarketConsensus([
      { selectionOdds: 2.0, allMarketOdds: [2.0, 2.0] },
    ]);
    expect(c.fairProb).toBeCloseTo(0.5, 3);
    expect(c.bookmakerCount).toBe(1);
    expect(c.spread).toBe(0);
  });

  it('multiple bookmakers, high consensus', () => {
    const c = calculateMarketConsensus([
      { selectionOdds: 2.0, allMarketOdds: [2.0, 2.0] },
      { selectionOdds: 2.05, allMarketOdds: [2.05, 1.95] },
      { selectionOdds: 1.98, allMarketOdds: [1.98, 2.02] },
    ]);
    expect(c.bookmakerCount).toBe(3);
    expect(c.fairProb).toBeCloseTo(0.5, 1);
    expect(c.spread).toBeLessThan(0.03);
    expect(c.highConsensus).toBe(true);
  });

  it('bookmakers disagree = low consensus', () => {
    const c = calculateMarketConsensus([
      { selectionOdds: 1.80, allMarketOdds: [1.80, 2.00] },
      { selectionOdds: 2.50, allMarketOdds: [2.50, 1.50] },
      { selectionOdds: 3.00, allMarketOdds: [3.00, 1.40] },
    ]);
    expect(c.spread).toBeGreaterThan(0.05);
    expect(c.highConsensus).toBe(false);
  });
});

describe('Uncertainty Factor', () => {
  it('perfect conditions = 1.0', () => {
    const f = calculateUncertaintyFactor({
      sampleSize: 30,
      marketSpread: 0.01,
      bookmakerCount: 5,
      dataFreshness: 1,
      leagueTier: 'top',
      modelDisagreement: 0.01,
    });
    expect(f).toBe(1);
  });

  it('few bookmakers reduces confidence', () => {
    const f = calculateUncertaintyFactor({ bookmakerCount: 2 });
    expect(f).toBeLessThan(1);
  });

  it('small sample reduces confidence', () => {
    const f = calculateUncertaintyFactor({ sampleSize: 3 });
    expect(f).toBeLessThan(0.6);
  });

  it('model disagreement reduces confidence', () => {
    const f = calculateUncertaintyFactor({ modelDisagreement: 0.15 });
    expect(f).toBeLessThan(0.7);
  });
});

describe('Market-Anchored Posterior', () => {
  it('model agrees with market = posterior = market', () => {
    const r = marketAnchoredPosterior({
      marketPrior: 0.55,
      modelProb: 0.55,
      uncertaintyFactor: 1,
    });
    expect(r.posterior).toBeCloseTo(0.55, 3);
  });

  it('model much higher = clamped to +5% max', () => {
    const r = marketAnchoredPosterior({
      marketPrior: 0.40,
      modelProb: 0.90,  // absurd model claim
      uncertaintyFactor: 1,
    });
    expect(r.posterior).toBeCloseTo(0.45, 3);  // 0.40 + 0.05 cap
  });

  it('model much lower = clamped to -5% max', () => {
    const r = marketAnchoredPosterior({
      marketPrior: 0.55,
      modelProb: 0.10,
      uncertaintyFactor: 1,
    });
    expect(r.posterior).toBeCloseTo(0.50, 3);  // 0.55 - 0.05
  });

  it('low confidence = posterior shrinks to market', () => {
    const r = marketAnchoredPosterior({
      marketPrior: 0.50,
      modelProb: 0.70,
      uncertaintyFactor: 0.2,  // very low confidence
    });
    // With low confidence, adjustment is scaled down
    // Raw clamped: 0.05, scaled by 0.2: 0.01
    expect(r.posterior).toBeCloseTo(0.51, 3);
  });
});

describe('qualifyBet - SCREENSHOT SCENARIO', () => {
  // Screenshotta %16 tutan tipik bet'ler: 2.60+ odds, algoritma %70+ diyordu
  const highConsensus = {
    fairProb: 0.35,         // Piyasa doğru: favorit değil bu bet
    bookmakerCount: 5,
    spread: 0.02,
    minFair: 0.34,
    maxFair: 0.36,
    median: 0.35,
    highConsensus: true,
  };

  it('REJECTS screenshot-style bet: market says 35%, model says 70%, odds 2.60', () => {
    const r = qualifyBet({
      odds: 2.60,
      modelProb: 0.70,  // old algorithm overconfidence
      consensus: highConsensus,
      uncertainty: {
        sampleSize: 15,
        marketSpread: 0.02,
        bookmakerCount: 5,
      },
    });
    expect(r.qualified).toBe(false);
    // Market prior 35% < 55% threshold
  });

  it('REJECTS: odds too high (>2.20)', () => {
    const r = qualifyBet({
      odds: 3.00,
      modelProb: 0.50,
      consensus: {
        ...highConsensus,
        fairProb: 0.33,
      },
      uncertainty: { sampleSize: 20, marketSpread: 0.02, bookmakerCount: 5 },
    });
    expect(r.qualified).toBe(false);
  });

  it('ACCEPTS: quality bet — favorit, küçük edge', () => {
    const r = qualifyBet({
      odds: 1.75,
      modelProb: 0.595,  // slightly bullish, safe below 5% edge
      consensus: {
        fairProb: 0.58,
        bookmakerCount: 5,
        spread: 0.01,
        minFair: 0.57,
        maxFair: 0.59,
        median: 0.58,
        highConsensus: true,
      },
      uncertainty: {
        sampleSize: 25,
        marketSpread: 0.01,
        bookmakerCount: 5,
      },
    });
    expect(r.qualified).toBe(true);
    expect(r.breakdown.posterior).toBeGreaterThan(0.58);
    expect(r.breakdown.posterior).toBeLessThanOrEqual(0.63);
    expect(r.breakdown.edge).toBeGreaterThan(0);
    expect(r.breakdown.edge).toBeLessThanOrEqual(0.05);
  });

  it('REJECTS: negative edge (posterior < implied)', () => {
    const r = qualifyBet({
      odds: 1.50,
      modelProb: 0.60,
      consensus: {
        fairProb: 0.60,  // market says 60%, implied 66%
        bookmakerCount: 5,
        spread: 0.01,
        minFair: 0.59,
        maxFair: 0.61,
        median: 0.60,
        highConsensus: true,
      },
      uncertainty: { sampleSize: 20, marketSpread: 0.01, bookmakerCount: 5 },
    });
    expect(r.qualified).toBe(false);
    // implied = 0.667, posterior = 0.60 → edge negative
  });

  it('REJECTS: bookmaker disagreement too high', () => {
    const r = qualifyBet({
      odds: 1.80,
      modelProb: 0.58,
      consensus: {
        fairProb: 0.56,
        bookmakerCount: 3,
        spread: 0.08,  // high disagreement
        minFair: 0.48,
        maxFair: 0.64,
        median: 0.56,
        highConsensus: false,
      },
      uncertainty: { sampleSize: 20, marketSpread: 0.08, bookmakerCount: 3 },
    });
    expect(r.qualified).toBe(false);
  });

  it('REJECTS: too few bookmakers', () => {
    const r = qualifyBet({
      odds: 1.70,
      modelProb: 0.60,
      consensus: {
        fairProb: 0.59,
        bookmakerCount: 2,
        spread: 0.01,
        minFair: 0.58,
        maxFair: 0.60,
        median: 0.59,
        highConsensus: true,
      },
      uncertainty: { sampleSize: 20, marketSpread: 0.01, bookmakerCount: 2 },
    });
    expect(r.qualified).toBe(false);
  });

  it('REJECTS: insufficient sample size', () => {
    const r = qualifyBet({
      odds: 1.75,
      modelProb: 0.60,
      consensus: {
        fairProb: 0.57,
        bookmakerCount: 5,
        spread: 0.01,
        minFair: 0.56,
        maxFair: 0.58,
        median: 0.57,
        highConsensus: true,
      },
      uncertainty: {
        sampleSize: 3,  // too few games
        marketSpread: 0.01,
        bookmakerCount: 5,
      },
    });
    expect(r.qualified).toBe(false);
  });
});

describe('Expected System Behavior', () => {
  it('Quality filter is strict: model says 80%, market says 40% → REJECT', () => {
    // Scenario: algorithm thinks 80% prob at odds 2.00 (within range)
    // Market thinks 40% (screenshotta bu tür %40 gerçek prob'lu bet'ler %70 etiketliydi)
    // Model's 80% claim is absurd → should reject via market prior filter
    const r = qualifyBet({
      odds: 2.00,  // Within 1.60-2.20 range
      modelProb: 0.80,
      consensus: {
        fairProb: 0.48,  // Market says 48% — below minMarketPrior 55%
        bookmakerCount: 5,
        spread: 0.015,
        minFair: 0.46,
        maxFair: 0.50,
        median: 0.48,
        highConsensus: true,
      },
      uncertainty: { sampleSize: 20, marketSpread: 0.015, bookmakerCount: 5 },
    });
    expect(r.qualified).toBe(false);
    expect(r.reason).toMatch(/below|too high|prior|posterior/i);
  });
});
