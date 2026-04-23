/**
 * Multivariate Normal Sampler via Cholesky Decomposition
 *
 * Used for correlated player stats (points, rebounds, assists are positively
 * correlated within a player's individual game). Independent normals would
 * underestimate combo probabilities like double-double.
 *
 * Algorithm:
 *   1. Compute covariance matrix Σ from std devs and correlations
 *   2. Cholesky decompose: Σ = L * L^T
 *   3. Sample z ~ N(0, I) (standard normals via Box-Muller)
 *   4. Output: x = μ + L * z  → x ~ N(μ, Σ)
 */

/**
 * Box-Muller transform: 2 uniforms → 2 standard normals.
 */
export function boxMuller(): [number, number] {
  let u1 = Math.random();
  let u2 = Math.random();
  if (u1 === 0) u1 = 1e-10;
  const r = Math.sqrt(-2 * Math.log(u1));
  const theta = 2 * Math.PI * u2;
  return [r * Math.cos(theta), r * Math.sin(theta)];
}

/**
 * Sample n standard normal values.
 */
export function sampleStandardNormals(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i += 2) {
    const [a, b] = boxMuller();
    out.push(a);
    if (i + 1 < n) out.push(b);
  }
  return out;
}

/**
 * Cholesky decomposition of a positive-definite matrix.
 * Returns L such that L * L^T = matrix.
 *
 * If matrix is not positive-definite (which can happen with bad correlation
 * estimates), we add a tiny regularizer ε * I.
 */
export function choleskyDecompose(matrix: number[][]): number[][] {
  const n = matrix.length;
  const L: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) {
        sum += L[i][k] * L[j][k];
      }
      if (i === j) {
        let val = matrix[i][i] - sum;
        if (val <= 0) val = 1e-6; // Regularize
        L[i][j] = Math.sqrt(val);
      } else {
        L[i][j] = (matrix[i][j] - sum) / (L[j][j] || 1e-10);
      }
    }
  }
  return L;
}

/**
 * Build covariance matrix from std devs and correlation matrix.
 *   Σ_ij = σ_i * σ_j * ρ_ij
 */
export function buildCovariance(
  stdDevs: number[],
  correlations: number[][]
): number[][] {
  const n = stdDevs.length;
  const cov: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      cov[i][j] = stdDevs[i] * stdDevs[j] * correlations[i][j];
    }
  }
  return cov;
}

/**
 * Sample from multivariate normal N(μ, Σ).
 */
export function sampleMultivariateNormal(
  means: number[],
  cholesky: number[][]
): number[] {
  const n = means.length;
  const z = sampleStandardNormals(n);
  const out: number[] = new Array(n);

  // x = μ + L * z
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k <= i; k++) {
      sum += cholesky[i][k] * z[k];
    }
    out[i] = means[i] + sum;
  }
  return out;
}

/**
 * Convenience: sample multiple draws.
 */
export function sampleMultivariateNormalBatch(
  means: number[],
  cholesky: number[][],
  numSamples: number
): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < numSamples; i++) {
    out.push(sampleMultivariateNormal(means, cholesky));
  }
  return out;
}
