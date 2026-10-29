/* Favordex rating model. Classic script: sets globalThis.Favordex. Node: module.exports. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  root.Favordex = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
"use strict";

/* src/model/math.ts */
/** Stable logistic σ(x). */
function sigmoid(x) {
    if (x >= 0) {
        const z = Math.exp(-x);
        return 1 / (1 + z);
    }
    const z = Math.exp(x);
    return z / (1 + z);
}
/** log(1 + e^x), stable. */
function softplus(x) {
    if (x > 0)
        return x + Math.log1p(Math.exp(-x));
    return Math.log1p(Math.exp(x));
}
/** Binary entropy in nats. h(0) = h(1) = 0. */
function binaryEntropy(p) {
    if (p <= 1e-12 || p >= 1 - 1e-12)
        return 0;
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
function expectedInformationGain(mu, variance) {
    const v = Math.max(0, variance);
    if (v < 1e-12)
        return 0;
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
function log2Factorial(n) {
    if (n < 2)
        return 0;
    let sum = 0;
    for (let k = 2; k <= n; k++)
        sum += Math.log2(k);
    return sum;
}
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function dot(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++)
        s += a[i] * b[i];
    return s;
}
/**
 * Invert a symmetric positive definite matrix given in row-major order.
 * Returns the inverse and the lower Cholesky factor L (L Lᵀ = A), or null
 * if A is not positive definite.
 */
function invertSPD(matrix, n) {
    const L = matrix.slice();
    for (let i = 0; i < n; i++) {
        for (let j = 0; j <= i; j++) {
            let sum = L[i * n + j];
            for (let k = 0; k < j; k++)
                sum -= L[i * n + k] * L[j * n + k];
            if (i === j) {
                if (sum <= 1e-14)
                    return null;
                L[i * n + j] = Math.sqrt(sum);
            }
            else {
                L[i * n + j] = sum / L[j * n + j];
            }
        }
        for (let j = i + 1; j < n; j++)
            L[i * n + j] = 0;
    }
    const inverse = new Float64Array(n * n);
    const y = new Float64Array(n);
    const e = new Float64Array(n);
    for (let col = 0; col < n; col++) {
        e.fill(0);
        e[col] = 1;
        for (let i = 0; i < n; i++) {
            let sum = e[i];
            for (let k = 0; k < i; k++)
                sum -= L[i * n + k] * y[k];
            y[i] = sum / L[i * n + i];
        }
        for (let i = n - 1; i >= 0; i--) {
            let sum = y[i];
            for (let k = i + 1; k < n; k++)
                sum -= L[k * n + i] * inverse[k * n + col];
            inverse[i * n + col] = sum / L[i * n + i];
        }
    }
    return { inverse, chol: L };
}
/** Solve L out = x for a lower-triangular row-major L. */
function solveLower(L, n, x, out) {
    for (let i = 0; i < n; i++) {
        let sum = x[i];
        for (let k = 0; k < i; k++)
            sum -= L[i * n + k] * out[k];
        out[i] = sum / L[i * n + i];
    }
}


/* src/model/features.ts */
/**
 * Trait features for the hierarchical Bradley–Terry model.
 *
 * Each extractor emits a sparse map of feature name → value. The design
 * matrix is the union of those names, so a new trait is a new extractor:
 * no other fitting code changes. Binary flags, one-hots, and real-valued
 * traits are all just columns.
 *
 * The app turns on `extendedExtractors` (types and generation, the games a
 * species appears in, plus color, shape, habitat, egg group, legendary /
 * mythical / baby, evolution stage, and starter). A species in n games
 * puts 1/n on each of those columns. Evolution-score columns are appended
 * after the matrix is built. Each fit step copies tanh of a compared
 * relative's strength with those columns removed, so a line cannot amplify
 * itself. Tests can pass a smaller list.
 */
function flag(name, on) {
    return on ? { [name]: 1 } : {};
}
function oneHot(prefix, value) {
    if (!value)
        return {};
    return { [`${prefix}:${value}`]: 1 };
}
const typeExtractor = {
    id: "type",
    extract: (p) => Object.fromEntries(p.types.map((t) => [`type:${t}`, 1])),
};
const generationExtractor = {
    id: "generation",
    extract: (p) => ({ [`gen:${p.generation}`]: 1 }),
};
const colorExtractor = {
    id: "color",
    extract: (p) => oneHot("color", p.color),
};
const shapeExtractor = {
    id: "shape",
    extract: (p) => oneHot("shape", p.shape),
};
const habitatExtractor = {
    id: "habitat",
    extract: (p) => oneHot("habitat", p.habitat),
};
const eggGroupExtractor = {
    id: "egg",
    extract: (p) => Object.fromEntries((p.eggGroups ?? []).map((g) => [`egg:${g}`, 1])),
};
const legendaryExtractor = {
    id: "legendary",
    extract: (p) => flag("legendary", p.isLegendary),
};
const mythicalExtractor = {
    id: "mythical",
    extract: (p) => flag("mythical", p.isMythical),
};
const babyExtractor = {
    id: "baby",
    extract: (p) => flag("baby", p.isBaby),
};
const stageExtractor = {
    id: "stage",
    extract: (p) => {
        if (!p.evolutionStage)
            return {};
        const fate = p.evolves ? "evolves" : "final";
        return { [`stage:${p.evolutionStage}-${fate}`]: 1 };
    },
};
const starterExtractor = {
    id: "starter",
    extract: (p) => flag("starter", p.isStarter),
};
function statScale(value, center, spread) {
    if (value == null || !Number.isFinite(Number(value)))
        return null;
    return (Number(value) - center) / spread;
}
function scaledColumn(name, value, center, spread) {
    const scaled = statScale(value, center, spread);
    return scaled == null ? {} : { [name]: scaled };
}
/** tanh(ln(meters)): 0 at 1 m, in (-1, 1). Omit missing or non-positive. */
function squashedHeight(heightM) {
    const meters = Number(heightM);
    if (!Number.isFinite(meters) || meters <= 0)
        return null;
    return Math.tanh(Math.log(meters));
}
/** tanh(log10(kg) - 1.4): 0 near 25 kg, in (-1, 1). Omit missing or non-positive. */
function squashedWeight(weightKg) {
    const kilograms = Number(weightKg);
    if (!Number.isFinite(kilograms) || kilograms <= 0)
        return null;
    return Math.tanh(Math.log10(kilograms) - 1.4);
}
const statsExtractor = {
    id: "stats",
    extract: (p) => ({
        ...scaledColumn("stat:hp", p.hp, 70, 40),
        ...scaledColumn("stat:attack", p.attack, 75, 35),
        ...scaledColumn("stat:defense", p.defense, 70, 35),
        ...scaledColumn("stat:special-attack", p.specialAttack, 70, 35),
        ...scaledColumn("stat:special-defense", p.specialDefense, 70, 35),
        ...scaledColumn("stat:speed", p.speed, 70, 35),
        ...scaledColumn("stat:bst", p.hp != null && p.attack != null && p.defense != null && p.specialAttack != null && p.specialDefense != null && p.speed != null
            ? p.hp + p.attack + p.defense + p.specialAttack + p.specialDefense + p.speed
            : null, 420, 120),
    }),
};
const bodyExtractor = {
    id: "body",
    extract: (p) => {
        const height = squashedHeight(p.heightM);
        const weight = squashedWeight(p.weightKg);
        return {
            ...(height == null ? {} : { "size:height": height }),
            ...(weight == null ? {} : { "size:weight": weight }),
        };
    },
};
const ecologyExtractor = {
    id: "ecology",
    extract: (p) => ({
        ...scaledColumn("eco:capture", p.captureRate, 75, 80),
        ...scaledColumn("eco:happiness", p.happiness, 70, 50),
        ...scaledColumn("eco:hatch", p.hatch, 20, 15),
    }),
};
const growthExtractor = {
    id: "growth",
    extract: (p) => oneHot("growth", p.growth),
};
const genderExtractor = {
    id: "gender",
    extract: (p) => {
        if (p.genderRate == null)
            return {};
        if (p.genderRate < 0)
            return { "gender:genderless": 1 };
        if (p.genderRate === 0)
            return { "gender:male-only": 1 };
        if (p.genderRate === 8)
            return { "gender:female-only": 1 };
        return {};
    },
};
const SKIPPED_GAMES = new Set(["colosseum", "xd", "red-green-japan", "blue-japan"]);
const gamesExtractor = {
    id: "games",
    extract: (p) => {
        if (!Array.isArray(p.games))
            return {};
        const present = [];
        const seen = new Set();
        for (const game of p.games) {
            if (!game || SKIPPED_GAMES.has(game) || seen.has(game))
                continue;
            seen.add(game);
            present.push(game);
        }
        if (present.length === 0)
            return {};
        const share = 1 / present.length;
        const out = {};
        for (const game of present)
            out[`game:${game}`] = share;
        return out;
    },
};
/**
 * Filled later from lagged strengths of relatives that have actually been
 * compared. Emitting zeros here would drop the columns. The copied value is
 * tanh of that relative's strength with these columns removed, so it stays
 * in (-1, 1) and cannot feed back into itself.
 */
const EVO_COLUMNS = ["evo:from", "evo:into-mean", "evo:into-max"];
const evolutionExtractor = {
    id: "evolution",
    extract: () => ({}),
};
/** Inputs to the hidden layer. BST is the sum of the six stats, so it is not also a linear column. */
const CONTINUOUS_NAMES = ["HP", "Attack", "Defense", "Sp. Atk", "Sp. Def", "Speed", "BST", "Height", "Weight", "Catch rate"];
const HIDDEN = [8, 4];
function continuousFeatures(p) {
    if (p.hp == null || p.attack == null || p.defense == null || p.specialAttack == null || p.specialDefense == null || p.speed == null)
        return null;
    const bst = p.hp + p.attack + p.defense + p.specialAttack + p.specialDefense + p.speed;
    return [
        statScale(p.hp, 70, 40),
        statScale(p.attack, 75, 35),
        statScale(p.defense, 70, 35),
        statScale(p.specialAttack, 70, 35),
        statScale(p.specialDefense, 70, 35),
        statScale(p.speed, 70, 35),
        statScale(bst, 420, 120),
        squashedHeight(p.heightM) ?? 0,
        squashedWeight(p.weightKg) ?? 0,
        statScale(p.captureRate, 75, 80) ?? 0,
    ];
}
/** The two traits the model is specified around. */
const coreExtractors = [typeExtractor, generationExtractor];
/** Core traits plus the rest of the bundled PokéAPI fields. */
const extendedExtractors = [
    ...coreExtractors,
    gamesExtractor,
    colorExtractor,
    shapeExtractor,
    habitatExtractor,
    eggGroupExtractor,
    legendaryExtractor,
    mythicalExtractor,
    babyExtractor,
    stageExtractor,
    evolutionExtractor,
    starterExtractor,
    statsExtractor,
    bodyExtractor,
    ecologyExtractor,
    growthExtractor,
    genderExtractor,
];
function buildDesignMatrix(pokemon, extractors) {
    const sparse = pokemon.map((p) => {
        const acc = {};
        for (const extractor of extractors) {
            const part = extractor.extract(p);
            for (const [key, value] of Object.entries(part)) {
                if (value !== 0)
                    acc[key] = (acc[key] ?? 0) + value;
            }
        }
        return acc;
    });
    const names = [...new Set(sparse.flatMap((row) => Object.keys(row)))].sort();
    const index = new Map(names.map((name, i) => [name, i]));
    const cols = names.length;
    const values = new Float64Array(pokemon.length * cols);
    sparse.forEach((row, r) => {
        const base = r * cols;
        for (const [key, value] of Object.entries(row)) {
            const c = index.get(key);
            if (c !== undefined)
                values[base + c] = value;
        }
    });
    return {
        ids: pokemon.map((p) => p.id),
        names,
        values,
        rows: pokemon.length,
        cols,
    };
}
function appendColumns(design, extraNames) {
    const adding = extraNames.filter((name) => !design.names.includes(name));
    if (adding.length === 0)
        return design;
    const oldCols = design.cols;
    const cols = oldCols + adding.length;
    const values = new Float64Array(design.rows * cols);
    for (let r = 0; r < design.rows; r++)
        values.set(design.values.subarray(r * oldCols, (r + 1) * oldCols), r * cols);
    return {
        ids: design.ids,
        names: design.names.concat(adding),
        values,
        rows: design.rows,
        cols,
    };
}
function evolutionGraph(pokemon) {
    const rows = pokemon.length;
    const index = new Map();
    for (let i = 0; i < rows; i++)
        index.set(pokemon[i].id, i);
    const parent = new Int32Array(rows);
    parent.fill(-1);
    const children = Array.from({ length: rows }, () => []);
    for (let i = 0; i < rows; i++) {
        const from = pokemon[i].evolvesFrom;
        if (from == null)
            continue;
        const at = index.get(from);
        if (at == null || at === i)
            continue;
        parent[i] = at;
        children[at].push(i);
    }
    const descendants = Array.from({ length: rows }, () => []);
    for (let i = 0; i < rows; i++) {
        const seen = new Set([i]);
        const stack = children[i].slice();
        while (stack.length) {
            const next = stack.pop();
            if (seen.has(next))
                continue;
            seen.add(next);
            descendants[i].push(next);
            const further = children[next];
            for (let t = 0; t < further.length; t++)
                stack.push(further[t]);
        }
    }
    return { parent, children, descendants };
}
/** tanh(s − evolution columns), and 0 for a species that has never been compared. */
function evolutionSignal(X, rows, cols, w, s, evo, seen) {
    const out = new Float64Array(rows);
    const fromCol = evo.from;
    const meanCol = evo.intoMean;
    const maxCol = evo.intoMax;
    for (let i = 0; i < rows; i++) {
        if (seen && !seen[i])
            continue;
        let stripped = s[i];
        const base = i * cols;
        if (fromCol >= 0)
            stripped -= X[base + fromCol] * w[fromCol];
        if (meanCol >= 0)
            stripped -= X[base + meanCol] * w[meanCol];
        if (maxCol >= 0)
            stripped -= X[base + maxCol] * w[maxCol];
        out[i] = Math.tanh(stripped);
    }
    return out;
}
function writeEvolutionScores(X, rows, cols, signal, seen, evo) {
    const fromCol = evo.from;
    const meanCol = evo.intoMean;
    const maxCol = evo.intoMax;
    if (fromCol < 0 || meanCol < 0 || maxCol < 0)
        return;
    for (let i = 0; i < rows; i++) {
        const base = i * cols;
        const elder = evo.parent[i];
        X[base + fromCol] = elder >= 0 && (!seen || seen[elder]) ? signal[elder] : 0;
        const kids = evo.descendants[i];
        if (!kids || kids.length === 0) {
            X[base + meanCol] = 0;
            X[base + maxCol] = 0;
            continue;
        }
        let sum = 0;
        let max = -Infinity;
        let count = 0;
        for (let k = 0; k < kids.length; k++) {
            const child = kids[k];
            if (seen && !seen[child])
                continue;
            const score = signal[child];
            sum += score;
            if (score > max)
                max = score;
            count++;
        }
        if (count === 0) {
            X[base + meanCol] = 0;
            X[base + maxCol] = 0;
            continue;
        }
        X[base + meanCol] = sum / count;
        X[base + maxCol] = max;
    }
}


/* src/model/fit.ts */

const DEFAULTS = {
    sigmaW: 0.7,
    sigmaB: 1,
    maxIter: 24,
    tol: 1e-4,
    sweeps: 4,
};
function encode(ids, comparisons) {
    const index = new Map(ids.map((id, i) => [id, i]));
    const pairs = [];
    for (const c of comparisons) {
        if (c.a === c.b)
            continue;
        const ai = index.get(c.a);
        const bi = index.get(c.b);
        if (ai === undefined || bi === undefined)
            continue;
        const outcome = c.outcome === "a" ? 1 : c.outcome === "b" ? -1 : 0;
        pairs.push({ a: ai, b: bi, outcome });
    }
    const a = new Int32Array(pairs.length);
    const b = new Int32Array(pairs.length);
    const outcome = new Int8Array(pairs.length);
    const adj = ids.map(() => []);
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
function gradD(outcome, p) {
    if (outcome === 0)
        return p - 0.5;
    if (outcome === 1)
        return p - 1;
    return p;
}
function comparisonNll(d, outcome) {
    if (outcome === 1)
        return softplus(-d);
    if (outcome === -1)
        return softplus(d);
    return 0.5 * (softplus(-d) + softplus(d));
}
function recomputeStrengths(X, rows, cols, w, b, s, net) {
    for (let i = 0; i < rows; i++) {
        let acc = b[i] + (net ? net[i] : 0);
        const base = i * cols;
        for (let k = 0; k < cols; k++)
            acc += X[base + k] * w[k];
        s[i] = acc;
    }
}
function negativeLogPosterior(X, rows, cols, w, b, encoded, sigmaW, sigmaB) {
    const s = new Float64Array(rows);
    recomputeStrengths(X, rows, cols, w, b, s);
    let nll = 0;
    const precW = 1 / (sigmaW * sigmaW);
    const precB = 1 / (sigmaB * sigmaB);
    for (let k = 0; k < cols; k++)
        nll += 0.5 * precW * w[k] * w[k];
    for (let i = 0; i < rows; i++)
        nll += 0.5 * precB * b[i] * b[i];
    for (let c = 0; c < encoded.a.length; c++) {
        nll += comparisonNll(s[encoded.a[c]] - s[encoded.b[c]], encoded.outcome[c]);
    }
    return nll;
}
function tanhOf(pre) {
    const h = Math.tanh(pre);
    return { h, sech2: 1 - h * h };
}
function mlpForward(X, rows, cols, H1, H2, W1, c1, W2, c2, v, h1, h2, ev) {
    for (let i = 0; i < rows; i++) {
        const x = i * cols;
        for (let a = 0; a < H1; a++) {
            let pre = c1[a];
            const base = a * cols;
            for (let j = 0; j < cols; j++)
                pre += W1[base + j] * X[x + j];
            h1[i * H1 + a] = Math.tanh(pre);
        }
        let total = 0;
        for (let b = 0; b < H2; b++) {
            let pre = c2[b];
            const base = b * H1;
            for (let a = 0; a < H1; a++)
                pre += W2[base + a] * h1[i * H1 + a];
            const activated = Math.tanh(pre);
            h2[i * H2 + b] = activated;
            total += v[b] * activated;
        }
        ev[i] = total;
    }
}
function adamStep(param, grad, moment, second, t, lr) {
    const b1 = 0.9;
    const b2 = 0.999;
    const corr1 = 1 - Math.pow(b1, t);
    const corr2 = 1 - Math.pow(b2, t);
    let maxStep = 0;
    for (let i = 0; i < param.length; i++) {
        moment[i] = b1 * moment[i] + (1 - b1) * grad[i];
        second[i] = b2 * second[i] + (1 - b2) * grad[i] * grad[i];
        const step = lr * (moment[i] / corr1) / (Math.sqrt(second[i] / corr2) + 1e-8);
        const clipped = Math.max(-0.4, Math.min(0.4, step));
        param[i] -= clipped;
        if (Math.abs(clipped) > maxStep)
            maxStep = Math.abs(clipped);
    }
    return maxStep;
}
function scoreGradient(s, encoded) {
    const dS = new Float64Array(s.length);
    for (let c = 0; c < encoded.a.length; c++) {
        const ai = encoded.a[c];
        const bi = encoded.b[c];
        const gp = gradD(encoded.outcome[c], sigmoid(s[ai] - s[bi]));
        dS[ai] += gp;
        dS[bi] -= gp;
    }
    return dS;
}
/**
 * Two tanh hidden layers. Every column of x is an input.
 * h1 = tanh(W1 x + c1), h2 = tanh(W2 h1 + c2), EV = v · h2.
 */
function adamNetwork(X, rows, cols, H1, H2, W1, c1, W2, c2, v, s, baked, encoded, precW, steps, moments) {
    const h1 = new Float64Array(rows * H1);
    const h2 = new Float64Array(rows * H2);
    const ev = new Float64Array(rows);
    const prev = Float64Array.from(baked);
    const gW1 = new Float64Array(W1.length);
    const gc1 = new Float64Array(H1);
    const gW2 = new Float64Array(W2.length);
    const gc2 = new Float64Array(H2);
    const gv = new Float64Array(H2);
    let maxStep = 0;
    let t = moments.t;
    for (let step = 0; step < steps; step++) {
        mlpForward(X, rows, cols, H1, H2, W1, c1, W2, c2, v, h1, h2, ev);
        for (let i = 0; i < rows; i++)
            s[i] += ev[i] - prev[i];
        prev.set(ev);
        t += 1;
        gW1.fill(0);
        gc1.fill(0);
        gW2.fill(0);
        gc2.fill(0);
        gv.fill(0);
        const dS = scoreGradient(s, encoded);
        for (let i = 0; i < rows; i++) {
            const dEv = dS[i];
            if (dEv === 0)
                continue;
            const h1Base = i * H1;
            const h2Base = i * H2;
            const dPre2 = new Float64Array(H2);
            for (let b = 0; b < H2; b++) {
                gv[b] += dEv * h2[h2Base + b];
                const hidden = h2[h2Base + b];
                dPre2[b] = dEv * v[b] * (1 - hidden * hidden);
                gc2[b] += dPre2[b];
            }
            const dPre1 = new Float64Array(H1);
            for (let b = 0; b < H2; b++) {
                const base = b * H1;
                for (let a = 0; a < H1; a++) {
                    gW2[base + a] += dPre2[b] * h1[h1Base + a];
                    dPre1[a] += W2[base + a] * dPre2[b];
                }
            }
            const x = i * cols;
            for (let a = 0; a < H1; a++) {
                const hidden = h1[h1Base + a];
                dPre1[a] *= 1 - hidden * hidden;
                gc1[a] += dPre1[a];
                const base = a * cols;
                for (let j = 0; j < cols; j++)
                    gW1[base + j] += dPre1[a] * X[x + j];
            }
        }
        for (let i = 0; i < W1.length; i++)
            gW1[i] += precW * W1[i];
        for (let i = 0; i < H1; i++)
            gc1[i] += precW * c1[i];
        for (let i = 0; i < W2.length; i++)
            gW2[i] += precW * W2[i];
        for (let i = 0; i < H2; i++)
            gc2[i] += precW * c2[i];
        for (let i = 0; i < H2; i++)
            gv[i] += precW * v[i];
        const lr = 0.08;
        maxStep = Math.max(maxStep, adamStep(W1, gW1, moments.mW1, moments.vW1, t, lr));
        maxStep = Math.max(maxStep, adamStep(c1, gc1, moments.mc1, moments.vc1, t, lr));
        maxStep = Math.max(maxStep, adamStep(W2, gW2, moments.mW2, moments.vW2, t, lr));
        maxStep = Math.max(maxStep, adamStep(c2, gc2, moments.mc2, moments.vc2, t, lr));
        maxStep = Math.max(maxStep, adamStep(v, gv, moments.mv, moments.vv, t, lr));
        mlpForward(X, rows, cols, H1, H2, W1, c1, W2, c2, v, h1, h2, ev);
    }
    moments.t = t;
    return { out: ev, maxStep, h1, h2 };
}
function networkReport(names, H1, H2, W1, c1, W2, c2, v, precW) {
    const sd = 1 / Math.sqrt(precW);
    const topIncoming = (weights, labels, limit) => {
        const rows = labels.map((name, index) => ({ name, weight: weights[index], sd }));
        rows.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight) || a.name.localeCompare(b.name));
        return rows.slice(0, limit);
    };
    const hidden1 = [];
    for (let a = 0; a < H1; a++) {
        hidden1.push({
            bias: c1[a],
            biasSd: sd,
            weights: topIncoming(W1.subarray(a * names.length, (a + 1) * names.length), names, 6),
            fanIn: names.length,
        });
    }
    const hidden2 = [];
    const h1Names = hidden1.map((_, index) => "Hidden 1 · " + (index + 1));
    for (let b = 0; b < H2; b++) {
        hidden2.push({
            bias: c2[b],
            biasSd: sd,
            weights: topIncoming(W2.subarray(b * H1, (b + 1) * H1), h1Names, H1),
            fanIn: H1,
        });
    }
    const h2Names = hidden2.map((_, index) => "Hidden 2 · " + (index + 1));
    return {
        inputCount: names.length,
        inputs: names.slice(),
        hidden: [H1, H2],
        layers: [
            { name: "Hidden 1", activation: "tanh", units: hidden1 },
            { name: "Hidden 2", activation: "tanh", units: hidden2 },
        ],
        output: {
            name: "EV",
            weights: topIncoming(v, h2Names, H2),
        },
        W1: Float64Array.from(W1),
        c1: Float64Array.from(c1),
        W2: Float64Array.from(W2),
        c2: Float64Array.from(c2),
        v: Float64Array.from(v),
    };
}
function fitBradleyTerry(design, comparisons, config = {}) {
    const sigmaW = config.sigmaW ?? DEFAULTS.sigmaW;
    const sigmaB = config.sigmaB ?? DEFAULTS.sigmaB;
    const maxIter = config.maxIter ?? DEFAULTS.maxIter;
    const tol = config.tol ?? DEFAULTS.tol;
    const sweeps = config.sweeps ?? DEFAULTS.sweeps;
    const { ids, names, values: X, rows, cols } = design;
    const encoded = encode(ids, comparisons);
    const w = new Float64Array(cols);
    const b = new Float64Array(rows);
    const useMlp = config.mlp === true && cols > 0;
    const H1 = useMlp ? HIDDEN[0] : 0;
    const H2 = useMlp ? HIDDEN[1] : 0;
    const W1 = new Float64Array(H1 * cols);
    const c1 = new Float64Array(H1);
    const W2 = new Float64Array(H2 * H1);
    const c2 = new Float64Array(H2);
    const v = new Float64Array(H2);
    const netOut = new Float64Array(rows);
    const moments = useMlp ? {
        t: 0,
        mW1: new Float64Array(W1.length), vW1: new Float64Array(W1.length),
        mc1: new Float64Array(H1), vc1: new Float64Array(H1),
        mW2: new Float64Array(W2.length), vW2: new Float64Array(W2.length),
        mc2: new Float64Array(H2), vc2: new Float64Array(H2),
        mv: new Float64Array(H2), vv: new Float64Array(H2),
    } : null;
    if (config.warm && config.warm.w.length === cols && config.warm.b.length === rows) {
        w.set(config.warm.w);
        b.set(config.warm.b);
    }
    const warmNet = config.warm && config.warm.net;
    if (useMlp && warmNet && warmNet.W1.length === W1.length && warmNet.W2.length === W2.length && warmNet.v.length === H2) {
        W1.set(warmNet.W1);
        c1.set(warmNet.c1);
        W2.set(warmNet.W2);
        c2.set(warmNet.c2);
        v.set(warmNet.v);
        const h1 = new Float64Array(rows * H1);
        const h2 = new Float64Array(rows * H2);
        mlpForward(X, rows, cols, H1, H2, W1, c1, W2, c2, v, h1, h2, netOut);
    }
    for (let i = 0; i < rows; i++) {
        if (!encoded.involved[i])
            b[i] = 0;
    }
    const s = new Float64Array(rows);
    recomputeStrengths(X, rows, cols, w, b, s, useMlp ? netOut : undefined);
    const precW = 1 / (sigmaW * sigmaW);
    const precB = 1 / (sigmaB * sigmaB);
    let iterations = 0;
    let converged = false;
    const gW = new Float64Array(cols);
    const H = new Float64Array(cols * cols);
    const step = new Float64Array(cols);
    const h1Buf = useMlp ? new Float64Array(rows * H1) : null;
    const h2Buf = useMlp ? new Float64Array(rows * H2) : null;
    for (let iter = 0; iter < maxIter; iter++) {
        iterations = iter + 1;
        if (config.evolution) {
            const signal = evolutionSignal(X, rows, cols, w, s, config.evolution, encoded.involved);
            writeEvolutionScores(X, rows, cols, signal, encoded.involved, config.evolution);
            if (useMlp)
                mlpForward(X, rows, cols, H1, H2, W1, c1, W2, c2, v, h1Buf, h2Buf, netOut);
            recomputeStrengths(X, rows, cols, w, b, s, useMlp ? netOut : undefined);
        }
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
                if (dxk === 0)
                    continue;
                gW[k] += gp * dxk;
                const hk = weight * dxk;
                for (let j = 0; j < cols; j++) {
                    const dxj = X[aBase + j] - X[bBase + j];
                    if (dxj !== 0)
                        H[k * cols + j] += hk * dxj;
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
        }
        else {
            for (let k = 0; k < cols; k++) {
                const dk = Math.max(-0.25, Math.min(0.25, 0.05 * gW[k]));
                w[k] -= dk;
                maxStep = Math.max(maxStep, Math.abs(dk));
            }
        }
        recomputeStrengths(X, rows, cols, w, b, s, useMlp ? netOut : undefined);
        if (useMlp) {
            const stepped = adamNetwork(X, rows, cols, H1, H2, W1, c1, W2, c2, v, s, netOut, encoded, precW, 4, moments);
            netOut.set(stepped.out);
            maxStep = Math.max(maxStep, stepped.maxStep);
            recomputeStrengths(X, rows, cols, w, b, s, netOut);
        }
        for (let sweep = 0; sweep < sweeps; sweep++) {
            for (let i = 0; i < rows; i++) {
                if (!encoded.involved[i])
                    continue;
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
    const network = useMlp ? networkReport(names, H1, H2, W1, c1, W2, c2, v, precW) : null;
    return {
        ids,
        featureNames: names,
        strength: s,
        sd: laplace.sd,
        weights: w,
        weightSd: laplace.weightSd.subarray(0, cols),
        offset: b,
        offsetVar: laplace.offsetVar,
        traitCoords: laplace.traitCoords,
        comparisons: encoded.a.length,
        iterations,
        converged,
        sigmaW,
        sigmaB,
        network,
    };
}
function solveInto(H, g, n, out) {
    if (n === 0)
        return true;
    const factor = invertSPD(H, n);
    if (!factor)
        return false;
    const { chol: L } = factor;
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        let sum = g[i];
        for (let k = 0; k < i; k++)
            sum -= L[i * n + k] * y[k];
        y[i] = sum / L[i * n + i];
    }
    for (let i = n - 1; i >= 0; i--) {
        let sum = y[i];
        for (let k = i + 1; k < n; k++)
            sum -= L[k * n + i] * out[k];
        out[i] = sum / L[i * n + i];
    }
    return true;
}
function laplaceUncertainty(X, rows, cols, s, encoded, precW, precB) {
    const Hww = new Float64Array(cols * cols);
    const hB = new Float64Array(rows);
    const G = new Float64Array(rows * cols);
    for (let k = 0; k < cols; k++)
        Hww[k * cols + k] = precW;
    for (let i = 0; i < rows; i++)
        hB[i] = precB;
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
            if (dxk === 0)
                continue;
            G[ai * cols + k] += weight * dxk;
            G[bi * cols + k] -= weight * dxk;
            for (let j = 0; j < cols; j++) {
                const dxj = X[aBase + j] - X[bBase + j];
                if (dxj !== 0)
                    Hww[k * cols + j] += weight * dxk * dxj;
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
        if (!any)
            continue;
        for (let k = 0; k < cols; k++) {
            const gk = G[base + k];
            if (gk === 0)
                continue;
            const row = k * cols;
            for (let j = 0; j < cols; j++)
                S[row + j] -= scale * gk * G[base + j];
        }
    }
    for (let k = 0; k < cols; k++)
        S[k * cols + k] += 1e-8;
    let factor = cols === 0 ? { inverse: new Float64Array(0), chol: new Float64Array(0) } : invertSPD(S, cols);
    if (!factor && cols > 0)
        factor = invertSPD(Hww, cols);
    const sd = new Float64Array(rows);
    const weightSd = new Float64Array(cols);
    const offsetVar = new Float64Array(rows);
    const traitCoords = new Array(rows);
    const y = new Float64Array(cols);
    const gScaled = new Float64Array(cols);
    if (factor) {
        for (let k = 0; k < cols; k++)
            weightSd[k] = Math.sqrt(Math.max(factor.inverse[k * cols + k], 0));
    }
    for (let i = 0; i < rows; i++) {
        offsetVar[i] = 1 / hB[i];
        const coords = new Float64Array(cols);
        if (factor && cols > 0) {
            // z = L⁻¹ x, so ‖z‖² = xᵀ S⁻¹ x = xᵀ Σ_w x.
            solveLower(factor.chol, cols, X.subarray(i * cols, (i + 1) * cols), y);
            coords.set(y);
            const h = hB[i];
            for (let k = 0; k < cols; k++)
                gScaled[k] = G[i * cols + k] / h;
            solveLower(factor.chol, cols, gScaled, y);
            // Var(s_i) = 1/h_i + ‖L⁻¹ x_i − L⁻¹ (G_i / h_i)‖²
            let quad = 0;
            for (let k = 0; k < cols; k++) {
                const diff = coords[k] - y[k];
                quad += diff * diff;
            }
            sd[i] = Math.sqrt(Math.max(offsetVar[i] + quad, 1e-10));
        }
        else {
            sd[i] = Math.sqrt(offsetVar[i]);
        }
        traitCoords[i] = coords;
    }
    return { sd, weightSd, offsetVar, traitCoords };
}
/** Exposed for the gradient check in tests. */
function posteriorNll(design, comparisons, w, b, sigmaW = DEFAULTS.sigmaW, sigmaB = DEFAULTS.sigmaB) {
    return negativeLogPosterior(design.values, design.rows, design.cols, w, b, encode(design.ids, comparisons), sigmaW, sigmaB);
}


/* src/model/history.ts */
const EXPORT_VERSION = 1;
const OUTCOMES = new Set(["a", "b", "tie", "skip"]);
/** Comparisons that enter the Bradley–Terry fit. Skips record nothing. */
function ratedComparisons(history) {
    const rated = [];
    for (const answer of history) {
        if (answer.outcome === "skip" || answer.a === answer.b)
            continue;
        rated.push({ a: answer.a, b: answer.b, outcome: answer.outcome });
    }
    return rated;
}
function undo(history) {
    return history.slice(0, -1);
}
function comparisonCounts(history, ids) {
    const index = new Map(ids.map((id, i) => [id, i]));
    const counts = new Int32Array(ids.length);
    for (const answer of history) {
        if (answer.outcome === "skip")
            continue;
        const ai = index.get(answer.a);
        const bi = index.get(answer.b);
        if (ai !== undefined)
            counts[ai] += 1;
        if (bi !== undefined)
            counts[bi] += 1;
    }
    return counts;
}
function serializeHistory(history, now = new Date()) {
    const payload = {
        version: EXPORT_VERSION,
        exportedAt: now.toISOString(),
        history: history.map((answer) => ({
            a: answer.a,
            b: answer.b,
            outcome: answer.outcome,
            at: answer.at,
        })),
    };
    return JSON.stringify(payload, null, 2);
}
function parseHistory(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw new Error("History file is not valid JSON.");
    }
    const records = extractRecords(parsed);
    return records.map((record, index) => {
        if (!record || typeof record !== "object") {
            throw new Error(`History entry ${index + 1} is not an object.`);
        }
        const row = record;
        const a = row.a;
        const b = row.b;
        const outcome = row.outcome;
        const at = row.at;
        if (typeof a !== "number" || !Number.isInteger(a) || typeof b !== "number" || !Number.isInteger(b)) {
            throw new Error(`History entry ${index + 1} needs integer species ids.`);
        }
        if (a === b)
            throw new Error(`History entry ${index + 1} compares a species with itself.`);
        if (typeof outcome !== "string" || !OUTCOMES.has(outcome)) {
            throw new Error(`History entry ${index + 1} has an unknown outcome.`);
        }
        const stamp = typeof at === "number" && Number.isFinite(at) ? at : Date.now();
        return { a, b, outcome: outcome, at: stamp };
    });
}
function extractRecords(parsed) {
    if (Array.isArray(parsed))
        return parsed;
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.history)) {
        const version = parsed.version;
        if (version !== undefined && version !== EXPORT_VERSION) {
            throw new Error(`Unsupported history version ${String(version)}.`);
        }
        return parsed.history;
    }
    throw new Error("History file needs a history array.");
}


/* src/model/summary.ts */

/**
 * Confidence is how much the Laplace posterior has shrunk versus the prior.
 * 0 means every species is still at its prior width. It climbs as answers
 * pin strengths down. It is not a fraction of the 8,800-bit sorting bound:
 * noisy preferences make each answer worth less than one bit, so a full
 * personal ranking takes more comparisons than log2(n!).
 */
function rankingSummary(fit, design) {
    const n = fit.ids.length;
    let meanVar = 0;
    let meanPrior = 0;
    const sigmaW2 = fit.sigmaW * fit.sigmaW;
    const sigmaB2 = fit.sigmaB * fit.sigmaB;
    for (let i = 0; i < n; i++) {
        let norm = 0;
        const base = i * design.cols;
        for (let k = 0; k < design.cols; k++) {
            const x = design.values[base + k];
            norm += x * x;
        }
        meanVar += fit.sd[i] * fit.sd[i];
        meanPrior += sigmaB2 + sigmaW2 * norm;
    }
    meanVar = n === 0 ? 0 : meanVar / n;
    meanPrior = n === 0 ? 1 : meanPrior / n;
    const confidence = meanPrior <= 0 ? 0 : Math.min(1, Math.max(0, 1 - meanVar / meanPrior));
    let meanSd = 0;
    for (let i = 0; i < n; i++)
        meanSd += fit.sd[i];
    meanSd = n === 0 ? 0 : meanSd / n;
    return {
        matchups: fit.comparisons,
        species: n,
        lowerBoundBits: log2Factorial(n),
        confidence,
        meanSd,
    };
}


/* src/model/select.ts */

const DEFAULT_RNG = Math.random;
function differenceVariance(model, i, j) {
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
/**
 * tail(p) = cos(π p)^2. p = 0 is the favorite, p = 1 the least favorite.
 * 1 at both ends, 0 at the median, smooth, and symmetric in p and 1 − p.
 */
function tailWeight(p) {
    const c = Math.cos(Math.PI * p);
    return c * c;
}
/** m = 0.2 + 0.8 * (tail_i + tail_j) / 2. The floor keeps a median pair alive. */
function pairTailMultiplier(tailA, tailB) {
    return 0.2 + 0.8 * ((tailA + tailB) / 2);
}
function tailsInOrder(order) {
    const n = order.length;
    const tails = new Float64Array(n);
    if (n <= 1)
        return tails;
    const span = n - 1;
    for (let place = 0; place < n; place++) {
        // order is weakest first, so place 0 is rank n and place n − 1 is rank 1.
        const rank = n - place;
        tails[order[place]] = tailWeight((rank - 1) / span);
    }
    return tails;
}
function selectNextPair(model, options = {}) {
    const n = model.ids.length;
    if (n < 2)
        return null;
    const rng = options.rng ?? DEFAULT_RNG;
    const explore = options.explore ?? 0.12;
    const window = options.window ?? 28;
    const topK = options.topK ?? 8;
    const avoid = options.avoid;
    const exploreDraw = rng() < explore;
    // Unweighted on purpose: a least-shown species is still drawn from the middle.
    if (exploreDraw) {
        const picked = explorePair(model, options.games, rng, avoid);
        if (picked)
            return picked;
    }
    const order = orderByStrength(model.strength, n);
    const tails = tailsInOrder(order);
    const candidates = collectCandidates(model, order, window, rng);
    let best = [];
    for (const [i, j] of candidates) {
        const mu = model.strength[i] - model.strength[j];
        const gain = expectedInformationGain(mu, differenceVariance(model, i, j));
        const score = gain * pairTailMultiplier(tails[i], tails[j]);
        best.push({ i, j, gain, score });
    }
    if (best.length === 0)
        return null;
    best.sort((p, q) => q.score - p.score || q.gain - p.gain);
    if (avoid) {
        const filtered = best.filter((p) => !samePair(model.ids[p.i], model.ids[p.j], avoid));
        if (filtered.length > 0)
            best = filtered;
    }
    const pool = best.slice(0, Math.max(1, topK));
    const choice = pool[Math.floor(rng() * pool.length)];
    return {
        a: model.ids[choice.i],
        b: model.ids[choice.j],
        infoGain: choice.gain,
    };
}
function samePair(a, b, avoid) {
    return (a === avoid[0] && b === avoid[1]) || (a === avoid[1] && b === avoid[0]);
}
function orderByStrength(strength, n) {
    const order = Array.from({ length: n }, (_, i) => i);
    order.sort((i, j) => strength[i] - strength[j] || i - j);
    return order;
}
function collectCandidates(model, order, window, rng) {
    const n = order.length;
    const seen = new Set();
    const pairs = [];
    const add = (i, j) => {
        if (i === j)
            return;
        const lo = i < j ? i : j;
        const hi = i < j ? j : i;
        const key = lo * n + hi;
        if (seen.has(key))
            return;
        seen.add(key);
        pairs.push([lo, hi]);
    };
    for (let r = 0; r < n; r++) {
        const last = Math.min(n - 1, r + window);
        for (let r2 = r + 1; r2 <= last; r2++)
            add(order[r], order[r2]);
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
            if (s < lo)
                lo = s;
            if (s > hi)
                hi = s;
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
        if (j >= i)
            j++;
        add(i, j);
    }
    return pairs;
}
function explorePair(model, games, rng, avoid) {
    const n = model.ids.length;
    const counts = games ?? new Float64Array(n);
    let min = Infinity;
    const least = [];
    for (let i = 0; i < n; i++) {
        const g = counts[i] ?? 0;
        if (g < min) {
            min = g;
            least.length = 0;
            least.push(i);
        }
        else if (g === min)
            least.push(i);
    }
    const i = least[Math.floor(rng() * least.length)];
    const options = [];
    for (let j = 0; j < n; j++) {
        if (j === i)
            continue;
        if (avoid && samePair(model.ids[i], model.ids[j], avoid))
            continue;
        options.push(j);
    }
    if (options.length === 0)
        return null;
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

/**
 * EV(x) for one design row. network is { W1, c1, W2, c2, v } from a fit.
 * Same two tanh layers as mlpForward: h1 = tanh(W1 x + c1), h2 = tanh(W2 h1 + c2), EV = v · h2.
 */
function networkValue(row, network) {
    if (!network || !network.c1 || !network.c2 || !network.W1 || !network.W2 || !network.v)
        return 0;
    const H1 = network.c1.length;
    const H2 = network.c2.length;
    const cols = row.length;
    if (H1 === 0 || H2 === 0)
        return 0;
    if (network.W1.length < H1 * cols || network.W2.length < H2 * H1 || network.v.length < H2)
        return 0;
    const h1 = new Float64Array(H1);
    for (let a = 0; a < H1; a++) {
        let pre = network.c1[a];
        const base = a * cols;
        for (let j = 0; j < cols; j++)
            pre += network.W1[base + j] * row[j];
        h1[a] = Math.tanh(pre);
    }
    let total = 0;
    for (let b = 0; b < H2; b++) {
        let pre = network.c2[b];
        const base = b * H1;
        for (let a = 0; a < H1; a++)
            pre += network.W2[base + a] * h1[a];
        total += network.v[b] * Math.tanh(pre);
    }
    return total;
}

function finiteAt(source, index) {
    if (!source)
        return 0;
    const value = source[index];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Linear contributions and EV(x) for one design row. Does not fit.
 * s = x·w + EV(x) + b. Columns with a zero input are still returned; callers hide them.
 */
function strengthBreakdown(row, weights, network, offset, names) {
    const cols = weights ? weights.length : 0;
    const values = new Float64Array(cols);
    const columns = [];
    let linear = 0;
    for (let k = 0; k < cols; k++) {
        const value = finiteAt(row, k);
        const weight = finiteAt(weights, k);
        const contribution = value === 0 || weight === 0 ? 0 : value * weight;
        values[k] = value;
        linear += contribution;
        columns.push({
            key: names && names[k] != null ? names[k] : String(k),
            value,
            weight,
            contribution,
        });
    }
    const ev = networkValue(values, network);
    const speciesOffset = typeof offset === "number" && Number.isFinite(offset) ? offset : 0;
    return {
        linear,
        ev,
        offset: speciesOffset,
        strength: linear + ev + speciesOffset,
        columns,
    };
}


  return {
    sigmoid: sigmoid,
    softplus: softplus,
    binaryEntropy: binaryEntropy,
    expectedInformationGain: expectedInformationGain,
    log2Factorial: log2Factorial,
    mulberry32: mulberry32,
    dot: dot,
    invertSPD: invertSPD,
    solveLower: solveLower,
    typeExtractor: typeExtractor,
    generationExtractor: generationExtractor,
    colorExtractor: colorExtractor,
    shapeExtractor: shapeExtractor,
    habitatExtractor: habitatExtractor,
    eggGroupExtractor: eggGroupExtractor,
    legendaryExtractor: legendaryExtractor,
    mythicalExtractor: mythicalExtractor,
    babyExtractor: babyExtractor,
    stageExtractor: stageExtractor,
    starterExtractor: starterExtractor,
    statsExtractor: statsExtractor,
    bodyExtractor: bodyExtractor,
    ecologyExtractor: ecologyExtractor,
    growthExtractor: growthExtractor,
    genderExtractor: genderExtractor,
    gamesExtractor: gamesExtractor,
    evolutionExtractor: evolutionExtractor,
    EVO_COLUMNS: EVO_COLUMNS,
    appendColumns: appendColumns,
    evolutionGraph: evolutionGraph,
    continuousFeatures: continuousFeatures,
    CONTINUOUS_NAMES: CONTINUOUS_NAMES,
    HIDDEN: HIDDEN,
    coreExtractors: coreExtractors,
    extendedExtractors: extendedExtractors,
    buildDesignMatrix: buildDesignMatrix,
    fitBradleyTerry: fitBradleyTerry,
    strengthBreakdown: strengthBreakdown,
    posteriorNll: posteriorNll,
    EXPORT_VERSION: EXPORT_VERSION,
    ratedComparisons: ratedComparisons,
    undo: undo,
    comparisonCounts: comparisonCounts,
    serializeHistory: serializeHistory,
    parseHistory: parseHistory,
    rankingSummary: rankingSummary,
    differenceVariance: differenceVariance,
    tailWeight: tailWeight,
    pairTailMultiplier: pairTailMultiplier,
    selectNextPair: selectNextPair,
  };
});
