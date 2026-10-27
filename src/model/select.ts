import { expectedInformationGain } from "./math";

/**
 * Active pair selection.
 *
 * The next duel maximizes the expected information gain of a decisive
 * comparison under the Laplace posterior, approximated on a candidate set
 * that stays small enough to score in well under 100ms at National Dex size:
 *   - a window of neighbors in the current strength order (close means),
 *   - extra pairs among the least-certain species,
 *   - a handful of random pairs, and a wider random set while the ranking
 *     is still flat.
 * An ε-greedy exploration draw, biased to species with the fewest answers,
 * keeps every Pokémon from being starved by the greedy rule.
 */

export type PairModel = {
  ids: readonly number[];
  strength: ArrayLike<number>;
  /** Individual-offset variance, aligned with `ids`. */
  offsetVar: ArrayLike<number>;
  /** Optional z_i from the trait covariance. See `Fit.traitCoords`. */
  traitCoords?: ArrayLike<ArrayLike<number>>;
};

export type SelectOptions = {
  rng?: () => number;
  /** Probability of ignoring the info-gain ranking and exploring. */
  explore?: number;
  /** How many strength-neighbors to consider on each side of the order. */
  window?: number;
  /** Uniform draw among this many best candidates. */
  topK?: number;
  /** Answers so far, aligned with `ids`. */
  games?: ArrayLike<number>;
  /** Unordered pair of species ids to avoid repeating immediately. */
  avoid?: readonly [number, number];
};

export type SelectedPair = {
  a: number;
  b: number;
  infoGain: number;
};

const DEFAULT_RNG = Math.random;

export function differenceVariance(model: PairModel, i: number, j: number): number {
  let v = model.offsetVar[i] + model.offsetVar[j];
  const left = model.traitCoords?.[i];
  const right = model.traitCoords?.[j];
  if (left && right) {
    const n = left.length;
    for (let k = 0; k < n; k++) {
      const d = left[k] - right[k];
      v += d * d;
    }
  }
  return Math.max(v, 1e-8);
}

export function selectNextPair(model: PairModel, options: SelectOptions = {}): SelectedPair | null {
  const n = model.ids.length;
  if (n < 2) return null;
  const rng = options.rng ?? DEFAULT_RNG;
  const explore = options.explore ?? 0.12;
  const window = options.window ?? 28;
  const topK = options.topK ?? 8;
  const avoid = options.avoid;

  const exploreDraw = rng() < explore;
  if (exploreDraw) {
    const picked = explorePair(model, options.games, rng, avoid);
    if (picked) return picked;
  }

  const order = orderByStrength(model.strength, n);
  const candidates = collectCandidates(model, order, window, rng);
  let best: { i: number; j: number; gain: number }[] = [];
  for (const [i, j] of candidates) {
    const mu = model.strength[i] - model.strength[j];
    const gain = expectedInformationGain(mu, differenceVariance(model, i, j));
    best.push({ i, j, gain });
  }
  if (best.length === 0) return null;

  best.sort((p, q) => q.gain - p.gain);
  if (avoid) {
    const filtered = best.filter((p) => !samePair(model.ids[p.i], model.ids[p.j], avoid));
    if (filtered.length > 0) best = filtered;
  }

  const pool = best.slice(0, Math.max(1, topK));
  const choice = pool[Math.floor(rng() * pool.length)];
  return {
    a: model.ids[choice.i],
    b: model.ids[choice.j],
    infoGain: choice.gain,
  };
}

function samePair(a: number, b: number, avoid: readonly [number, number]): boolean {
  return (a === avoid[0] && b === avoid[1]) || (a === avoid[1] && b === avoid[0]);
}

function orderByStrength(strength: ArrayLike<number>, n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  order.sort((i, j) => strength[i] - strength[j] || i - j);
  return order;
}

function collectCandidates(
  model: PairModel,
  order: readonly number[],
  window: number,
  rng: () => number,
): Array<[number, number]> {
  const n = order.length;
  const seen = new Set<number>();
  const pairs: Array<[number, number]> = [];
  const add = (i: number, j: number) => {
    if (i === j) return;
    const lo = i < j ? i : j;
    const hi = i < j ? j : i;
    const key = lo * n + hi;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push([lo, hi]);
  };

  for (let r = 0; r < n; r++) {
    const last = Math.min(n - 1, r + window);
    for (let r2 = r + 1; r2 <= last; r2++) add(order[r], order[r2]);
  }

  // Least-certain species, paired with a few other uncertain ones.
  const byVar = Array.from({ length: n }, (_, i) => i);
  byVar.sort((i, j) => model.offsetVar[j] - model.offsetVar[i]);
  const uncertain = byVar.slice(0, Math.min(80, n));
  for (let u = 0; u < uncertain.length; u++) {
    for (let v = u + 1; v < Math.min(u + 6, uncertain.length); v++) {
      add(uncertain[u], uncertain[v]);
    }
  }

  let spread = 0;
  if (n > 0) {
    let lo = model.strength[0];
    let hi = lo;
    for (let i = 1; i < n; i++) {
      const s = model.strength[i];
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
    spread = hi - lo;
  }
  const randomCount = spread < 0.2 ? Math.min(2000, (n * (n - 1)) / 2) : 400;
  const cap = Math.min(randomCount, (n * (n - 1)) / 2);
  const target = pairs.length + cap;
  let guard = 0;
  while (pairs.length < target && guard < cap * 8) {
    guard++;
    const i = Math.floor(rng() * n);
    let j = Math.floor(rng() * (n - 1));
    if (j >= i) j++;
    add(i, j);
  }
  return pairs;
}

function explorePair(
  model: PairModel,
  games: ArrayLike<number> | undefined,
  rng: () => number,
  avoid: readonly [number, number] | undefined,
): SelectedPair | null {
  const n = model.ids.length;
  const counts = games ?? new Float64Array(n);
  let min = Infinity;
  const least: number[] = [];
  for (let i = 0; i < n; i++) {
    const g = counts[i] ?? 0;
    if (g < min) {
      min = g;
      least.length = 0;
      least.push(i);
    } else if (g === min) least.push(i);
  }
  const i = least[Math.floor(rng() * least.length)];
  const options: number[] = [];
  for (let j = 0; j < n; j++) {
    if (j === i) continue;
    if (avoid && samePair(model.ids[i], model.ids[j], avoid)) continue;
    options.push(j);
  }
  if (options.length === 0) return null;
  // Prefer uncertain partners, with a uniform fallback.
  let j = options[Math.floor(rng() * options.length)];
  if (rng() < 0.7 && options.length > 1) {
    let best = options[0];
    let bestV = -1;
    const sample = Math.min(12, options.length);
    for (let s = 0; s < sample; s++) {
      const cand = options[Math.floor(rng() * options.length)];
      const v = model.offsetVar[cand];
      if (v > bestV) {
        bestV = v;
        best = cand;
      }
    }
    j = best;
  }
  const mu = model.strength[i] - model.strength[j];
  return {
    a: model.ids[i],
    b: model.ids[j],
    infoGain: expectedInformationGain(mu, differenceVariance(model, i, j)),
  };
}
