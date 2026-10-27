/** Stable logistic σ(x). */
export function sigmoid(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

/** log(1 + e^x), stable. */
export function softplus(x: number): number {
  if (x > 0) return x + Math.log1p(Math.exp(-x));
  return Math.log1p(Math.exp(x));
}

/** Binary entropy in nats. h(0) = h(1) = 0. */
export function binaryEntropy(p: number): number {
  if (p <= 1e-12 || p >= 1 - 1e-12) return 0;
  return -p * Math.log(p) - (1 - p) * Math.log(1 - p);
}

/**
 * 7-point Gauss–Hermite nodes for ∫ e^{-x^2} f(x) dx.
 * Weights sum to √π.
 */
const GH_X = [
  -2.651961356835233, -1.673551628767471, -0.8162878828589647, 0, 0.8162878828589647,
  1.673551628767471, 2.651961356835233,
];
const GH_W = [
  0.000971781245099519, 0.05451558281912703, 0.4256072526101278, 0.8102646175568073,
  0.4256072526101278, 0.05451558281912703, 0.000971781245099519,
];
const INV_SQRT_PI = 1 / Math.sqrt(Math.PI);

/**
 * Expected information gain (nats) of one decisive comparison whose
 * latent margin δ = s_i − s_j is approximately N(μ, v).
 *
 * I(θ; y) = H[y] − E[H[y | δ]], with y | δ ~ Bernoulli(σ(δ)).
 * The predictive probability integrates the logistic against the Gaussian
 * with the standard probit-scale approximation
 *   E[σ(δ)] ≈ σ(μ / √(1 + π v / 8)).
 * The conditional entropy is a 7-point Gauss–Hermite quadrature.
 */
export function expectedInformationGain(mu: number, variance: number): number {
  const v = Math.max(0, variance);
  if (v < 1e-12) return 0;
  const kappa = 1 / Math.sqrt(1 + (Math.PI * v) / 8);
  const predictive = sigmoid(kappa * mu);
  const hPred = binaryEntropy(predictive);
  const scale = Math.sqrt(2 * v);
  let expectedH = 0;
  for (let i = 0; i < GH_X.length; i++) {
    expectedH += GH_W[i] * binaryEntropy(sigmoid(mu + scale * GH_X[i]));
  }
  expectedH *= INV_SQRT_PI;
  return Math.max(0, hPred - expectedH);
}

/** Exact log2(n!) by summation. n = 1025 is about 8,779. */
export function log2Factorial(n: number): number {
  if (n < 2) return 0;
  let sum = 0;
  for (let k = 2; k <= n; k++) sum += Math.log2(k);
  return sum;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Invert a symmetric positive definite matrix given in row-major order.
 * Returns the inverse and the lower Cholesky factor L (L Lᵀ = A), or null
 * if A is not positive definite.
 */
export function invertSPD(
  matrix: Float64Array,
  n: number,
): { inverse: Float64Array; chol: Float64Array } | null {
  const L = matrix.slice();
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = L[i * n + j];
      for (let k = 0; k < j; k++) sum -= L[i * n + k] * L[j * n + k];
      if (i === j) {
        if (sum <= 1e-14) return null;
        L[i * n + j] = Math.sqrt(sum);
      } else {
        L[i * n + j] = sum / L[j * n + j];
      }
    }
    for (let j = i + 1; j < n; j++) L[i * n + j] = 0;
  }

  const inverse = new Float64Array(n * n);
  const y = new Float64Array(n);
  const e = new Float64Array(n);
  for (let col = 0; col < n; col++) {
    e.fill(0);
    e[col] = 1;
    for (let i = 0; i < n; i++) {
      let sum = e[i];
      for (let k = 0; k < i; k++) sum -= L[i * n + k] * y[k];
      y[i] = sum / L[i * n + i];
    }
    for (let i = n - 1; i >= 0; i--) {
      let sum = y[i];
      for (let k = i + 1; k < n; k++) sum -= L[k * n + i] * inverse[k * n + col];
      inverse[i * n + col] = sum / L[i * n + i];
    }
  }
  return { inverse, chol: L };
}

/** Solve L out = x for a lower-triangular row-major L. */
export function solveLower(
  L: Float64Array,
  n: number,
  x: ArrayLike<number>,
  out: Float64Array,
): void {
  for (let i = 0; i < n; i++) {
    let sum = x[i];
    for (let k = 0; k < i; k++) sum -= L[i * n + k] * out[k];
    out[i] = sum / L[i * n + i];
  }
}
