import type { DesignMatrix } from "./features";
import { invertSPD, sigmoid, softplus, solveLower } from "./math";

/**
 * Hierarchical Bradley–Terry model.
 *
 * Each species has a strength
 *   s_i = x_i · w + b_i
 * where x_i are trait features, w is a weight vector learned from the
 * user's answers, and b_i is that species' own offset.
 *
 * Priors (partial pooling):
 *   w ~ N(0, σ_w² I)
 *   b_i ~ N(0, σ_b²)
 * The Gaussian prior on b pulls thinly-rated species back to their trait
 * prediction. Heavily-rated species overcome it. w is only identified up to
 * the prior, which also breaks the additive invariance of Bradley–Terry
 * (strengths are pinned near zero instead of drifting by a constant).
 *
 * A decisive win for A over B contributes log σ(s_A − s_B).
 * A tie is a half-win for each side:
 *   ½ log σ(s_A − s_B) + ½ log σ(s_B − s_A)
 * which is symmetric in A and B, does not crown a winner, and is maximized
 * when the two strengths are equal. Skips are not comparisons and never
 * reach this function.
 *
 * The negative log posterior is convex. We maximize it with alternating
 * Newton steps: an exact Newton update on w (F is small), then
 * Gauss–Seidel Newton sweeps on each offset. Uncertainty is a Laplace
 * approximation. The individual-offset block of the Hessian is treated as
 * diagonal (mean-field); trait-weight covariance is the corresponding Schur
 * complement, inverted exactly. Marginal variance of s_i includes the
 * cross-term between w and b_i.
 */

export type Outcome = "a" | "b" | "tie";

export type Comparison = {
  a: number;
  b: number;
  outcome: Outcome;
};

export type FitConfig = {
  /** Prior sd of each trait weight. */
  sigmaW?: number;
  /** Prior sd of each individual offset. */
  sigmaB?: number;
  maxIter?: number;
  /** Stop when the largest parameter step drops below this. */
  tol?: number;
  sweeps?: number;
  /** Warm start from a previous MAP. Same species order and features. */
  warm?: { w: Float64Array; b: Float64Array };
};

export type Fit = {
  ids: number[];
  featureNames: string[];
  /** s_i = x_i·w + b_i */
  strength: Float64Array;
  /** Laplace sd of s_i. */
  sd: Float64Array;
  weights: Float64Array;
  /** Laplace sd of each trait weight. */
  weightSd: Float64Array;
  offset: Float64Array;
  /** Diagonal Laplace variance of b_i (prior precision + direct comparisons). */
  offsetVar: Float64Array;
  /**
   * Trait coordinates z_i = L⁻¹ x_i, where the weight-precision Schur
   * complement is S = L Lᵀ and Σ_w = S⁻¹. Then
   * Var(s_i − s_j) ≈ ‖z_i − z_j‖² + offsetVar_i + offsetVar_j.
   */
  traitCoords: Float64Array[];
  comparisons: number;
  iterations: number;
  converged: boolean;
  sigmaW: number;
  sigmaB: number;
};

const DEFAULTS = {
  sigmaW: 0.7,
  sigmaB: 1,
  maxIter: 24,
  tol: 1e-4,
  sweeps: 4,
};

type Encoded = {
  a: Int32Array;
  b: Int32Array;
  outcome: Int8Array;
  adj: number[][];
  involved: Uint8Array;
};

function encode(ids: readonly number[], comparisons: readonly Comparison[]): Encoded {
  const index = new Map(ids.map((id, i) => [id, i]));
  const pairs: { a: number; b: number; outcome: number }[] = [];
  for (const c of comparisons) {
    if (c.a === c.b) continue;
    const ai = index.get(c.a);
    const bi = index.get(c.b);
    if (ai === undefined || bi === undefined) continue;
    const outcome = c.outcome === "a" ? 1 : c.outcome === "b" ? -1 : 0;
    pairs.push({ a: ai, b: bi, outcome });
  }
  const a = new Int32Array(pairs.length);
  const b = new Int32Array(pairs.length);
  const outcome = new Int8Array(pairs.length);
  const adj: number[][] = ids.map(() => []);
  const involved = new Uint8Array(ids.length);
  pairs.forEach((p, i) => {
    a[i] = p.a;
    b[i] = p.b;
    outcome[i] = p.outcome;
    adj[p.a].push(i);
    adj[p.b].push(i);
    involved[p.a] = 1;
    involved[p.b] = 1;
  });
  return { a, b, outcome, adj, involved };
}

/** Derivative of the comparison nll with respect to d = s_a − s_b. */
function gradD(outcome: number, p: number): number {
  if (outcome === 0) return p - 0.5;
  if (outcome === 1) return p - 1;
  return p;
}

function comparisonNll(d: number, outcome: number): number {
  if (outcome === 1) return softplus(-d);
  if (outcome === -1) return softplus(d);
  return 0.5 * (softplus(-d) + softplus(d));
}

function recomputeStrengths(
  X: Float64Array,
  rows: number,
  cols: number,
  w: Float64Array,
  b: Float64Array,
  s: Float64Array,
): void {
  for (let i = 0; i < rows; i++) {
    let acc = b[i];
    const base = i * cols;
    for (let k = 0; k < cols; k++) acc += X[base + k] * w[k];
    s[i] = acc;
  }
}

function negativeLogPosterior(
  X: Float64Array,
  rows: number,
  cols: number,
  w: Float64Array,
  b: Float64Array,
  encoded: Encoded,
  sigmaW: number,
  sigmaB: number,
): number {
  const s = new Float64Array(rows);
  recomputeStrengths(X, rows, cols, w, b, s);
  let nll = 0;
  const precW = 1 / (sigmaW * sigmaW);
  const precB = 1 / (sigmaB * sigmaB);
  for (let k = 0; k < cols; k++) nll += 0.5 * precW * w[k] * w[k];
  for (let i = 0; i < rows; i++) nll += 0.5 * precB * b[i] * b[i];
  for (let c = 0; c < encoded.a.length; c++) {
    nll += comparisonNll(s[encoded.a[c]] - s[encoded.b[c]], encoded.outcome[c]);
  }
  return nll;
}

export function fitBradleyTerry(
  design: DesignMatrix,
  comparisons: readonly Comparison[],
  config: FitConfig = {},
): Fit {
  const sigmaW = config.sigmaW ?? DEFAULTS.sigmaW;
  const sigmaB = config.sigmaB ?? DEFAULTS.sigmaB;
  const maxIter = config.maxIter ?? DEFAULTS.maxIter;
  const tol = config.tol ?? DEFAULTS.tol;
  const sweeps = config.sweeps ?? DEFAULTS.sweeps;
  const { ids, names, values: X, rows, cols } = design;
  const encoded = encode(ids, comparisons);

  const w = new Float64Array(cols);
  const b = new Float64Array(rows);
  if (config.warm && config.warm.w.length === cols && config.warm.b.length === rows) {
    w.set(config.warm.w);
    b.set(config.warm.b);
  }
  for (let i = 0; i < rows; i++) {
    if (!encoded.involved[i]) b[i] = 0;
  }

  const s = new Float64Array(rows);
  recomputeStrengths(X, rows, cols, w, b, s);

  const precW = 1 / (sigmaW * sigmaW);
  const precB = 1 / (sigmaB * sigmaB);
  let iterations = 0;
  let converged = false;

  const gW = new Float64Array(cols);
  const H = new Float64Array(cols * cols);
  const step = new Float64Array(cols);

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;
    gW.fill(0);
    H.fill(0);
    for (let k = 0; k < cols; k++) {
      gW[k] = precW * w[k];
      H[k * cols + k] = precW;
    }

    for (let c = 0; c < encoded.a.length; c++) {
      const ai = encoded.a[c];
      const bi = encoded.b[c];
      const d = s[ai] - s[bi];
      const p = sigmoid(d);
      const weight = p * (1 - p);
      const gp = gradD(encoded.outcome[c], p);
      const aBase = ai * cols;
      const bBase = bi * cols;
      for (let k = 0; k < cols; k++) {
        const dxk = X[aBase + k] - X[bBase + k];
        if (dxk === 0) continue;
        gW[k] += gp * dxk;
        const hk = weight * dxk;
        for (let j = 0; j < cols; j++) {
          const dxj = X[aBase + j] - X[bBase + j];
          if (dxj !== 0) H[k * cols + j] += hk * dxj;
        }
      }
    }

    const solved = solveInto(H, gW, cols, step);
    let maxStep = 0;
    if (solved) {
      for (let k = 0; k < cols; k++) {
        const dk = Math.max(-2, Math.min(2, step[k]));
        w[k] -= dk;
        maxStep = Math.max(maxStep, Math.abs(dk));
      }
    } else {
      for (let k = 0; k < cols; k++) {
        const dk = Math.max(-0.25, Math.min(0.25, 0.05 * gW[k]));
        w[k] -= dk;
        maxStep = Math.max(maxStep, Math.abs(dk));
      }
    }
    recomputeStrengths(X, rows, cols, w, b, s);

    for (let sweep = 0; sweep < sweeps; sweep++) {
      for (let i = 0; i < rows; i++) {
        if (!encoded.involved[i]) continue;
        let g = precB * b[i];
        let h = precB;
        const list = encoded.adj[i];
        for (let t = 0; t < list.length; t++) {
          const c = list[t];
          const ai = encoded.a[c];
          const bi = encoded.b[c];
          const p = sigmoid(s[ai] - s[bi]);
          const gp = gradD(encoded.outcome[c], p);
          g += i === ai ? gp : -gp;
          h += p * (1 - p);
        }
        const delta = Math.max(-2, Math.min(2, g / h));
        b[i] -= delta;
        s[i] -= delta;
        maxStep = Math.max(maxStep, Math.abs(delta));
      }
    }

    if (maxStep < tol) {
      converged = true;
      break;
    }
  }

  const laplace = laplaceUncertainty(X, rows, cols, s, encoded, precW, precB);

  return {
    ids,
    featureNames: names,
    strength: s,
    sd: laplace.sd,
    weights: w,
    weightSd: laplace.weightSd,
    offset: b,
    offsetVar: laplace.offsetVar,
    traitCoords: laplace.traitCoords,
    comparisons: encoded.a.length,
    iterations,
    converged,
    sigmaW,
    sigmaB,
  };
}

function solveInto(H: Float64Array, g: Float64Array, n: number, out: Float64Array): boolean {
  if (n === 0) return true;
  const factor = invertSPD(H, n);
  if (!factor) return false;
  const { chol: L } = factor;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = g[i];
    for (let k = 0; k < i; k++) sum -= L[i * n + k] * y[k];
    y[i] = sum / L[i * n + i];
  }
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i];
    for (let k = i + 1; k < n; k++) sum -= L[k * n + i] * out[k];
    out[i] = sum / L[i * n + i];
  }
  return true;
}

function laplaceUncertainty(
  X: Float64Array,
  rows: number,
  cols: number,
  s: Float64Array,
  encoded: Encoded,
  precW: number,
  precB: number,
): { sd: Float64Array; weightSd: Float64Array; offsetVar: Float64Array; traitCoords: Float64Array[] } {
  const Hww = new Float64Array(cols * cols);
  const hB = new Float64Array(rows);
  const G = new Float64Array(rows * cols);
  for (let k = 0; k < cols; k++) Hww[k * cols + k] = precW;
  for (let i = 0; i < rows; i++) hB[i] = precB;

  for (let c = 0; c < encoded.a.length; c++) {
    const ai = encoded.a[c];
    const bi = encoded.b[c];
    const p = sigmoid(s[ai] - s[bi]);
    const weight = Math.max(p * (1 - p), 1e-8);
    const aBase = ai * cols;
    const bBase = bi * cols;
    hB[ai] += weight;
    hB[bi] += weight;
    for (let k = 0; k < cols; k++) {
      const dxk = X[aBase + k] - X[bBase + k];
      if (dxk === 0) continue;
      G[ai * cols + k] += weight * dxk;
      G[bi * cols + k] -= weight * dxk;
      for (let j = 0; j < cols; j++) {
        const dxj = X[aBase + j] - X[bBase + j];
        if (dxj !== 0) Hww[k * cols + j] += weight * dxk * dxj;
      }
    }
  }

  // Schur complement of the diagonal offset block: S = Hww − Σ_i G_i G_iᵀ / h_i.
  const S = Hww.slice();
  for (let i = 0; i < rows; i++) {
    const scale = 1 / hB[i];
    const base = i * cols;
    let any = false;
    for (let k = 0; k < cols; k++) {
      if (G[base + k] !== 0) {
        any = true;
        break;
      }
    }
    if (!any) continue;
    for (let k = 0; k < cols; k++) {
      const gk = G[base + k];
      if (gk === 0) continue;
      const row = k * cols;
      for (let j = 0; j < cols; j++) S[row + j] -= scale * gk * G[base + j];
    }
  }
  for (let k = 0; k < cols; k++) S[k * cols + k] += 1e-8;

  let factor = cols === 0 ? { inverse: new Float64Array(0), chol: new Float64Array(0) } : invertSPD(S, cols);
  if (!factor && cols > 0) factor = invertSPD(Hww, cols);

  const sd = new Float64Array(rows);
  const weightSd = new Float64Array(cols);
  const offsetVar = new Float64Array(rows);
  const traitCoords: Float64Array[] = new Array(rows);
  const y = new Float64Array(cols);
  const gScaled = new Float64Array(cols);

  if (factor) {
    for (let k = 0; k < cols; k++) weightSd[k] = Math.sqrt(Math.max(factor.inverse[k * cols + k], 0));
  }

  for (let i = 0; i < rows; i++) {
    offsetVar[i] = 1 / hB[i];
    const coords = new Float64Array(cols);
    if (factor && cols > 0) {
      // z = L⁻¹ x, so ‖z‖² = xᵀ S⁻¹ x = xᵀ Σ_w x.
      solveLower(factor.chol, cols, X.subarray(i * cols, (i + 1) * cols), y);
      coords.set(y);
      const h = hB[i];
      for (let k = 0; k < cols; k++) gScaled[k] = G[i * cols + k] / h;
      solveLower(factor.chol, cols, gScaled, y);
      // Var(s_i) = 1/h_i + ‖L⁻¹ x_i − L⁻¹ (G_i / h_i)‖²
      let quad = 0;
      for (let k = 0; k < cols; k++) {
        const diff = coords[k] - y[k];
        quad += diff * diff;
      }
      sd[i] = Math.sqrt(Math.max(offsetVar[i] + quad, 1e-10));
    } else {
      sd[i] = Math.sqrt(offsetVar[i]);
    }
    traitCoords[i] = coords;
  }

  return { sd, weightSd, offsetVar, traitCoords };
}

/** Exposed for the gradient check in tests. */
export function posteriorNll(
  design: DesignMatrix,
  comparisons: readonly Comparison[],
  w: Float64Array,
  b: Float64Array,
  sigmaW = DEFAULTS.sigmaW,
  sigmaB = DEFAULTS.sigmaB,
): number {
  return negativeLogPosterior(
    design.values,
    design.rows,
    design.cols,
    w,
    b,
    encode(design.ids, comparisons),
    sigmaW,
    sigmaB,
  );
}
