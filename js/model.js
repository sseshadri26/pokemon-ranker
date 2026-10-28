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
 * The app turns on `extendedExtractors` (types and generation, plus color,
 * shape, habitat, egg group, legendary / mythical / baby, evolution stage,
 * and starter). Tests can pass a smaller list.
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
    extract: (p) => (p.evolutionStage ? { [`stage:${p.evolutionStage}`]: 1 } : {}),
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
const statsExtractor = {
    id: "stats",
    extract: (p) => ({
        ...scaledColumn("stat:hp", p.hp, 70, 40),
        ...scaledColumn("stat:attack", p.attack, 75, 35),
        ...scaledColumn("stat:defense", p.defense, 70, 35),
        ...scaledColumn("stat:special-attack", p.specialAttack, 70, 35),
        ...scaledColumn("stat:special-defense", p.specialDefense, 70, 35),
        ...scaledColumn("stat:speed", p.speed, 70, 35),
    }),
};
const bodyExtractor = {
    id: "body",
    extract: (p) => ({
        ...scaledColumn("size:height", p.heightM, 1, 0.8),
        ...(p.weightKg > 0 ? { "size:weight": Math.log10(p.weightKg) - 1.4 } : {}),
    }),
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
/** Inputs to the hidden layer. BST is the sum of the six stats, so it is not also a linear column. */
const CONTINUOUS_NAMES = ["HP", "Attack", "Defense", "Sp. Atk", "Sp. Def", "Speed", "BST", "Height", "Weight", "Catch rate"];
const HIDDEN = 4;
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
        statScale(p.heightM, 1, 0.8) ?? 0,
        p.weightKg > 0 ? Math.log10(p.weightKg) - 1.4 : 0,
        statScale(p.captureRate, 75, 80) ?? 0,
    ];
}
/** The two traits the model is specified around. */
const coreExtractors = [typeExtractor, generationExtractor];
/** Core traits plus the rest of the bundled PokéAPI fields. */
const extendedExtractors = [
    ...coreExtractors,
    colorExtractor,
    shapeExtractor,
    habitatExtractor,
    eggGroupExtractor,
    legendaryExtractor,
    mythicalExtractor,
    babyExtractor,
    stageExtractor,
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
function netParamCount(Z, H) {
    return H + H + H * Z;
}
function fillNetwork(z, rows, Z, H, v, c, U, out, jacobian) {
    const nParam = netParamCount(Z, H);
    for (let i = 0; i < rows; i++) {
        const zBase = i * Z;
        let acc = 0;
        const jBase = jacobian ? i * nParam : 0;
        for (let k = 0; k < H; k++) {
            let pre = c[k];
            const uBase = k * Z;
            for (let j = 0; j < Z; j++)
                pre += U[uBase + j] * z[zBase + j];
            const h = Math.tanh(pre);
            const sech2 = 1 - h * h;
            acc += v[k] * h;
            if (jacobian) {
                jacobian[jBase + k] = h;
                jacobian[jBase + H + k] = v[k] * sech2;
                const uOff = jBase + 2 * H + k * Z;
                for (let j = 0; j < Z; j++)
                    jacobian[uOff + j] = v[k] * sech2 * z[zBase + j];
            }
        }
        out[i] = acc;
    }
}
function newtonNetwork(z, rows, Z, H, v, c, U, s, encoded, precW) {
    const nParam = netParamCount(Z, H);
    const J = new Float64Array(rows * nParam);
    const out = new Float64Array(rows);
    fillNetwork(z, rows, Z, H, v, c, U, out, J);
    const g = new Float64Array(nParam);
    const Hess = new Float64Array(nParam * nParam);
    const thetaAt = (p) => (p < H ? v[p] : p < 2 * H ? c[p - H] : U[p - 2 * H]);
    for (let p = 0; p < nParam; p++) {
        g[p] = precW * thetaAt(p);
        Hess[p * nParam + p] = precW;
    }
    for (let cidx = 0; cidx < encoded.a.length; cidx++) {
        const ai = encoded.a[cidx];
        const bi = encoded.b[cidx];
        const prob = sigmoid(s[ai] - s[bi]);
        const curve = prob * (1 - prob);
        const gp = gradD(encoded.outcome[cidx], prob);
        const aJ = ai * nParam;
        const bJ = bi * nParam;
        for (let k = 0; k < nParam; k++) {
            const dk = J[aJ + k] - J[bJ + k];
            if (dk === 0)
                continue;
            g[k] += gp * dk;
            const hk = curve * dk;
            for (let j = 0; j < nParam; j++) {
                const dj = J[aJ + j] - J[bJ + j];
                if (dj !== 0)
                    Hess[k * nParam + j] += hk * dj;
            }
        }
    }
    const step = new Float64Array(nParam);
    const solved = solveInto(Hess, g, nParam, step);
    let maxStep = 0;
    for (let p = 0; p < nParam; p++) {
        let dk = solved ? step[p] : 0.05 * g[p];
        dk = Math.max(-1, Math.min(1, dk));
        if (p < H)
            v[p] -= dk;
        else if (p < 2 * H)
            c[p - H] -= dk;
        else
            U[p - 2 * H] -= dk;
        maxStep = Math.max(maxStep, Math.abs(dk));
    }
    fillNetwork(z, rows, Z, H, v, c, U, out, null);
    return { out, maxStep };
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
    const continuous = config.continuous;
    const Z = continuous && continuous.cols > 0 ? continuous.cols : 0;
    const hidden = Z > 0 ? HIDDEN : 0;
    const v = new Float64Array(hidden);
    const c = new Float64Array(hidden);
    const U = new Float64Array(hidden * Z);
    const netOut = new Float64Array(rows);
    if (config.warm && config.warm.w.length === cols && config.warm.b.length === rows) {
        w.set(config.warm.w);
        b.set(config.warm.b);
    }
    if (Z > 0 && config.warm && config.warm.net
        && config.warm.net.v.length === hidden
        && config.warm.net.U.length === hidden * Z) {
        v.set(config.warm.net.v);
        c.set(config.warm.net.c);
        U.set(config.warm.net.U);
        fillNetwork(continuous.values, rows, Z, hidden, v, c, U, netOut, null);
    }
    for (let i = 0; i < rows; i++) {
        if (!encoded.involved[i])
            b[i] = 0;
    }
    const s = new Float64Array(rows);
    recomputeStrengths(X, rows, cols, w, b, s, Z ? netOut : undefined);
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
        recomputeStrengths(X, rows, cols, w, b, s, Z ? netOut : undefined);
        if (Z > 0) {
            const stepped = newtonNetwork(continuous.values, rows, Z, hidden, v, c, U, s, encoded, precW);
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
    let laplaceX = X;
    let laplaceCols = cols;
    if (Z > 0) {
        const nParam = netParamCount(Z, hidden);
        const jacobian = new Float64Array(rows * nParam);
        fillNetwork(continuous.values, rows, Z, hidden, v, c, U, netOut, jacobian);
        laplaceCols = cols + nParam;
        laplaceX = new Float64Array(rows * laplaceCols);
        for (let i = 0; i < rows; i++) {
            laplaceX.set(X.subarray(i * cols, (i + 1) * cols), i * laplaceCols);
            laplaceX.set(jacobian.subarray(i * nParam, (i + 1) * nParam), i * laplaceCols + cols);
        }
    }
    const laplace = laplaceUncertainty(laplaceX, rows, laplaceCols, s, encoded, precW, precB);
    let network = null;
    if (Z > 0) {
        const units = [];
        for (let k = 0; k < hidden; k++) {
            units.push({
                output: v[k],
                outputSd: laplace.weightSd[cols + k],
                bias: c[k],
                biasSd: laplace.weightSd[cols + hidden + k],
                weights: continuous.names.map((name, j) => ({
                    name,
                    weight: U[k * Z + j],
                    sd: laplace.weightSd[cols + 2 * hidden + k * Z + j],
                })),
            });
        }
        network = {
            hidden,
            inputs: continuous.names.slice(),
            v: Float64Array.from(v),
            c: Float64Array.from(c),
            U: Float64Array.from(U),
            units,
        };
    }
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
    if (exploreDraw) {
        const picked = explorePair(model, options.games, rng, avoid);
        if (picked)
            return picked;
    }
    const order = orderByStrength(model.strength, n);
    const candidates = collectCandidates(model, order, window, rng);
    let best = [];
    for (const [i, j] of candidates) {
        const mu = model.strength[i] - model.strength[j];
        const gain = expectedInformationGain(mu, differenceVariance(model, i, j));
        best.push({ i, j, gain });
    }
    if (best.length === 0)
        return null;
    best.sort((p, q) => q.gain - p.gain);
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
    continuousFeatures: continuousFeatures,
    CONTINUOUS_NAMES: CONTINUOUS_NAMES,
    HIDDEN: HIDDEN,
    coreExtractors: coreExtractors,
    extendedExtractors: extendedExtractors,
    buildDesignMatrix: buildDesignMatrix,
    fitBradleyTerry: fitBradleyTerry,
    posteriorNll: posteriorNll,
    EXPORT_VERSION: EXPORT_VERSION,
    ratedComparisons: ratedComparisons,
    undo: undo,
    comparisonCounts: comparisonCounts,
    serializeHistory: serializeHistory,
    parseHistory: parseHistory,
    rankingSummary: rankingSummary,
    differenceVariance: differenceVariance,
    selectNextPair: selectNextPair,
  };
});
