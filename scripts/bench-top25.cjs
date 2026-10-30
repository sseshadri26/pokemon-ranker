/* Benchmark: old vs top-25-focused pair selector on a synthetic voter.
 * Truth = trait effects (types, generation, colour, legendary, stage) + species noise, over the real
 * 1025-species Pokédex. The voter picks A with probability sigmoid(truthA - truthB) (noisy).
 * Usage: node scripts/bench-top25.cjs [runs=3] [votes=500]   (takes a few minutes)
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createRanker } = require("../js/ranker.js");

const box = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "data", "pokedex.js"), "utf8") + ";this.b=POKEDEX_BUNDLE;", box);
const pokemon = box.b.pokemon;
const RUNS = Number(process.argv[2] || 3);
const FIRST = Number(process.env.SEED || 1);
const VOTES = Number(process.argv[3] || 500);
const CHECKS = [200, 300, 500].filter((v) => v <= VOTES);

function mulberry(seed) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rng) {
  return Math.sqrt(-2 * Math.log(rng() + 1e-12)) * Math.cos(2 * Math.PI * rng());
}

function truthFor(seed) {
  const rng = mulberry(seed);
  const eff = new Map();
  const e = (key, sd) => {
    if (!eff.has(key)) eff.set(key, gauss(rng) * sd);
    return eff.get(key);
  };
  const truth = new Map();
  pokemon.forEach((p) => {
    let s = 0;
    p.types.forEach((t) => (s += e("type:" + t, 0.8)));
    s += e("gen:" + p.generation, 0.5) + e("color:" + p.color, 0.4) + e("stage:" + p.stage, 0.5);
    if (p.legendary) s += e("legendary", 0.8);
    s += gauss(rng) * 1.0;
    truth.set(p.id, s * 1.3);
  });
  return truth;
}

function ranksOf(ids, score) {
  const sorted = ids.slice().sort((a, b) => score(b) - score(a));
  const r = new Map();
  sorted.forEach((id, i) => r.set(id, i + 1));
  return r;
}
function spearman(xs, ys) {
  const n = xs.length;
  const rx = new Map(xs.slice().sort((a, b) => a.v - b.v).map((x, i) => [x.id, i]));
  const ry = new Map(ys.slice().sort((a, b) => a.v - b.v).map((x, i) => [x.id, i]));
  let d2 = 0;
  xs.forEach((x) => { const d = rx.get(x.id) - ry.get(x.id); d2 += d * d; });
  return 1 - (6 * d2) / (n * (n * n - 1));
}
function kendall(ids, a, b) {
  let c = 0, d = 0;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const s = Math.sign(a(ids[i]) - a(ids[j])) * Math.sign(b(ids[i]) - b(ids[j]));
    if (s > 0) c++; else if (s < 0) d++;
  }
  return (c - d) / (c + d || 1);
}

function metrics(state, truth) {
  const est = new Map(state.rows.map((row) => [row.pokemon.id, -row.rank]));
  const ids = pokemon.map((p) => p.id);
  const trueRank = ranksOf(ids, (id) => truth.get(id));
  const top = ids.filter((id) => trueRank.get(id) <= 25);
  const estTop = new Set(state.rows.slice(0, 25).map((row) => row.pokemon.id));
  return {
    tau: kendall(top, (id) => truth.get(id), (id) => est.get(id)),
    recall: top.filter((id) => estTop.has(id)).length / 25,
    rho: spearman(ids.map((id) => ({ id, v: truth.get(id) })), ids.map((id) => ({ id, v: est.get(id) }))),
  };
}

function run(seed, opts) {
  const truth = truthFor(seed);
  const voter = mulberry(seed * 7 + 1);
  const ranker = createRanker(pokemon, { storage: null, rng: mulberry(seed * 13 + 5), now: () => 0, ...opts });
  const out = {};
  for (let v = 1; v <= VOTES; v++) {
    const pair = ranker.getState().pair;
    const pa = 1 / (1 + Math.exp(-(truth.get(pair.a) - truth.get(pair.b))));
    ranker.answer(voter() < pa ? "a" : "b");
    if (CHECKS.includes(v)) {
      ranker.setBoardVisible && ranker.setBoardVisible(true);
      out[v] = metrics(ranker.getState(), truth);
    }
  }
  return out;
}

const totals = {};
for (let s = FIRST; s < FIRST + RUNS; s++) {
  const variants = process.env.VARIANTS ? JSON.parse(process.env.VARIANTS) : [["old", { topBoost: 0 }], ["new", {}]];
  for (const [label, opts] of variants) {
    const res = run(s, opts);
    CHECKS.forEach((v) => {
      const k = label + v;
      totals[k] = totals[k] || { tau: 0, recall: 0, rho: 0 };
      ["tau", "recall", "rho"].forEach((m) => (totals[k][m] += res[v][m] / RUNS));
    });
    process.stderr.write(`seed ${s} ${label} done\n`);
  }
}
console.log("votes | selector | top-25 Kendall tau | top-25 recall | overall Spearman");
const labels = (process.env.VARIANTS ? JSON.parse(process.env.VARIANTS) : [["old"], ["new"]]).map((v) => v[0]);
CHECKS.forEach((v) => labels.forEach((l) => {
  const t = totals[l + v];
  console.log(`${v} | ${l} | ${t.tau.toFixed(3)} | ${t.recall.toFixed(3)} | ${t.rho.toFixed(3)}`);
}));
