/**
 * ProBet Odds-Based k-Nearest-Neighbor Lookup
 *
 * At runtime, we receive live bookmaker odds from API-Football for each
 * fixture. We convert those odds into a bucket key and look up the empirical
 * outcome distribution from 700,000+ historical Pinnacle closing odds.
 *
 * Bucket scheme (14 levels per dimension):
 *   A: <1.30    B: 1.30-1.45  C: 1.45-1.60  D: 1.60-1.75
 *   E: 1.75-1.90  F: 1.90-2.05  G: 2.05-2.25  H: 2.25-2.50
 *   I: 2.50-2.85  J: 2.85-3.30  K: 3.30-4.00  L: 4.00-5.00
 *   M: 5.00-7.00  N: >=7.00
 *
 * Indexes:
 *   1. index_1x2_ou25: {home_bucket}-{draw_bucket}-{over25_bucket}  (most specific)
 *   2. index_home_ou25: {home_bucket}-{over25_bucket}               (medium)
 *   3. index_1x2_pure: {home_bucket}-{draw_bucket}-{away_bucket}    (pure 1X2)
 *
 * At query time we try the most specific index first, fall back to less specific
 * ones if no match. Minimum 50 samples required for reliable lookup.
 */

import knnIndexData from './odds-knn-index.json';

interface BucketStats {
  n: number;
  home_win_rate: number;
  draw_rate: number;
  away_win_rate: number;
  over_15_rate: number;
  over_25_rate: number;
  over_35_rate: number;
  btts_rate: number;
  avg_goals: number;
}

interface KnnIndex {
  total_matches_used: number;
  index_1x2_ou25: Record<string, BucketStats>;
  index_home_ou25: Record<string, BucketStats>;
  index_1x2_pure: Record<string, BucketStats>;
}

const INDEX = knnIndexData as unknown as KnnIndex;

/**
 * Convert decimal odds to a bucket letter (A-N).
 * Matches the Python scripts/build-knn-lookup.py bucketing exactly.
 */
export function oddsBucket(odds: number): string {
  if (odds < 1.30) return 'A';
  if (odds < 1.45) return 'B';
  if (odds < 1.60) return 'C';
  if (odds < 1.75) return 'D';
  if (odds < 1.90) return 'E';
  if (odds < 2.05) return 'F';
  if (odds < 2.25) return 'G';
  if (odds < 2.50) return 'H';
  if (odds < 2.85) return 'I';
  if (odds < 3.30) return 'J';
  if (odds < 4.00) return 'K';
  if (odds < 5.00) return 'L';
  if (odds < 7.00) return 'M';
  return 'N';
}

/**
 * Convert fair probability (overround-removed) to decimal odds.
 */
function probToOdds(prob: number): number {
  if (prob <= 0) return 999;
  return 1 / prob;
}

/**
 * Get neighbor buckets for fallback (adjacent letters in the bucket order).
 * E.g. neighbors('E') = ['D', 'E', 'F'].
 */
function neighborBuckets(b: string): string[] {
  const ORDER = 'ABCDEFGHIJKLMN';
  const idx = ORDER.indexOf(b);
  if (idx < 0) return [b];
  const result: string[] = [b];
  if (idx > 0) result.push(ORDER[idx - 1]);
  if (idx < ORDER.length - 1) result.push(ORDER[idx + 1]);
  return result;
}

export interface KnnMatchInput {
  /** Home win probability (0..1) — fair, overround-removed */
  homeProb: number;
  /** Draw probability */
  drawProb: number;
  /** Away win probability */
  awayProb: number;
  /** Over 2.5 probability (optional but recommended) */
  over25Prob?: number;
}

export interface KnnMatchResult {
  /** Empirical home/draw/away win rates from similar past matches */
  homeWinRate: number;
  drawRate: number;
  awayWinRate: number;
  /** Empirical goal market rates */
  over15Rate: number;
  over25Rate: number;
  over35Rate: number;
  bttsRate: number;
  /** Average total goals in similar matches */
  avgGoals: number;
  /** Number of historical matches matched */
  sampleSize: number;
  /** Which bucket was used (for debugging) */
  bucketKey: string;
  /** Which index was hit */
  indexUsed: '1x2_ou25' | '1x2_pure' | 'home_ou25' | 'fallback_neighbor';
  /** Whether we got a solid match (>=50 samples) */
  reliable: boolean;
}

/**
 * Look up empirical outcome rates for an odds profile.
 * Tries indexes in order of specificity, falls back to neighbors.
 *
 * Returns null if NO bucket has enough samples (very rare odds profile).
 */
export function lookupKnnMatch(input: KnnMatchInput): KnnMatchResult | null {
  const homeOdds = probToOdds(input.homeProb);
  const drawOdds = probToOdds(input.drawProb);
  const awayOdds = probToOdds(input.awayProb);

  const hB = oddsBucket(homeOdds);
  const dB = oddsBucket(drawOdds);
  const aB = oddsBucket(awayOdds);
  const o25B = input.over25Prob != null ? oddsBucket(probToOdds(input.over25Prob)) : null;

  // Try most specific index: 1X2 + O/U 2.5
  if (o25B !== null) {
    const key = `${hB}-${dB}-${o25B}`;
    const b = INDEX.index_1x2_ou25[key];
    if (b && b.n >= 50) {
      return buildResult(b, key, '1x2_ou25', b.n >= 100);
    }
  }

  // Try pure 1X2
  const key1x2 = `${hB}-${dB}-${aB}`;
  const b1x2 = INDEX.index_1x2_pure[key1x2];
  if (b1x2 && b1x2.n >= 50) {
    return buildResult(b1x2, key1x2, '1x2_pure', b1x2.n >= 100);
  }

  // Try home × O/U 2.5
  if (o25B !== null) {
    const keyHO = `${hB}-${o25B}`;
    const bHO = INDEX.index_home_ou25[keyHO];
    if (bHO && bHO.n >= 50) {
      return buildResult(bHO, keyHO, 'home_ou25', bHO.n >= 100);
    }
  }

  // Fallback: try neighbor buckets for the 1X2 pure index
  for (const nH of neighborBuckets(hB)) {
    for (const nD of neighborBuckets(dB)) {
      for (const nA of neighborBuckets(aB)) {
        const neighborKey = `${nH}-${nD}-${nA}`;
        const bn = INDEX.index_1x2_pure[neighborKey];
        if (bn && bn.n >= 50) {
          return buildResult(bn, neighborKey, 'fallback_neighbor', false);
        }
      }
    }
  }

  return null;
}

function buildResult(
  b: BucketStats,
  key: string,
  indexUsed: KnnMatchResult['indexUsed'],
  reliable: boolean
): KnnMatchResult {
  return {
    homeWinRate: b.home_win_rate,
    drawRate: b.draw_rate,
    awayWinRate: b.away_win_rate,
    over15Rate: b.over_15_rate,
    over25Rate: b.over_25_rate,
    over35Rate: b.over_35_rate,
    bttsRate: b.btts_rate,
    avgGoals: b.avg_goals,
    sampleSize: b.n,
    bucketKey: key,
    indexUsed,
    reliable,
  };
}

/**
 * Apply k-NN lookup as a soft prior to blend into model probabilities.
 * Uses a weight based on sample size: more samples → stronger prior.
 *
 * Returns blended probabilities. If no k-NN match found, returns the
 * original model probabilities unchanged.
 *
 * @param model  Model probabilities (0..1)
 * @param knn    k-NN result from lookupKnnMatch()
 * @param weight Blend weight (0..1, default 0.35)
 */
export function blendWithKnn(
  model: { home: number; draw: number; away: number },
  knn: KnnMatchResult | null,
  weight: number = 0.35
): { home: number; draw: number; away: number } {
  if (!knn || !knn.reliable) return model;

  // Scale weight by sample size (more samples → more trust)
  // 50 samples → 0.5 × weight, 500+ samples → 1.0 × weight
  const sampleFactor = Math.min(1, knn.sampleSize / 500);
  const effectiveWeight = weight * sampleFactor;

  const m = 1 - effectiveWeight;
  const k = effectiveWeight;

  const home = model.home * m + knn.homeWinRate * k;
  const draw = model.draw * m + knn.drawRate * k;
  const away = model.away * m + knn.awayWinRate * k;

  // Re-normalize
  const total = home + draw + away;
  return {
    home: home / total,
    draw: draw / total,
    away: away / total,
  };
}
