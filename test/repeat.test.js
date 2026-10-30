const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const F = require("../js/model.js");
const { createRanker } = require("../js/ranker.js");

function lcg(seed) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

function worstWindow(seq, size) {
  let worst = 0;
  let who = null;
  for (let s = 0; s + size <= seq.length; s++) {
    const counts = new Map();
    for (const [a, b] of seq.slice(s, s + size)) {
      counts.set(a, (counts.get(a) || 0) + 1);
      counts.set(b, (counts.get(b) || 0) + 1);
    }
    for (const [id, n] of counts) if (n > worst) { worst = n; who = id; }
  }
  return { worst, who };
}

describe("pair selector repeats", () => {
  it("keeps one outlier species out of most consecutive pairs over 200 draws", () => {
    const n = 60;
    const cols = 4;
    const rng = lcg(5);
    const model = {
      ids: Array.from({ length: n }, (_, i) => i + 1),
      strength: Float64Array.from({ length: n }, (_, i) => (i - n / 2) / 10),
      offsetVar: new Float64Array(n).fill(0.3),
      traitCoords: Array.from({ length: n }, () => Float64Array.from({ length: cols }, () => (rng() - 0.5) * 0.4)),
    };
    // Species 7 looks wildly uncertain: the shape of the old Cursola bug.
    model.traitCoords[6] = Float64Array.from([3, -3, 3, -3]);
    model.offsetVar[6] = 2;
    const seq = [];
    let last;
    for (let k = 0; k < 200; k++) {
      const recent = seq.slice(-10).flat();
      const pair = F.selectNextPair(model, { rng, explore: 0.12, avoid: last, recent });
      seq.push([pair.a, pair.b]);
      last = [pair.a, pair.b];
    }
    const { worst, who } = worstWindow(seq, 10);
    assert.ok(worst <= 3, `species ${who} was in ${worst} of 10 consecutive pairs`);
    assert.ok(seq.filter((p) => p.includes(7)).length <= 200 * 0.3);
  });

  it("uses the offset-corrected trait coordinates, so they match the reported sd", () => {
    const P = require("../data/pokemon.json").pokemon.slice(0, 40);
    const design = F.buildDesignMatrix(P, [F.typeExtractor]);
    const comps = [];
    for (let k = 0; k < 60; k++) comps.push({ a: P[0].id, b: P[1 + (k % 20)].id, outcome: k % 3 ? "b" : "a" });
    const fit = F.fitBradleyTerry(design, comps, { mlp: false });
    for (let i = 0; i < fit.ids.length; i++) {
      const c = fit.traitCoords[i];
      let q = 0;
      for (let k = 0; k < c.length; k++) q += c[k] * c[k];
      assert.ok(Math.abs(fit.offsetVar[i] + q - fit.sd[i] * fit.sd[i]) < 1e-6);
    }
  });

  it("does not keep drawing Cursola from the real history", () => {
    const file = path.join(__dirname, "..", "favordex-history.json");
    if (!fs.existsSync(file)) return;
    const { pokemon } = require("../data/pokemon.json");
    const history = JSON.parse(fs.readFileSync(file, "utf8")).history;
    const rng = lcg(11);
    const ranker = createRanker(pokemon, {
      storage: { load: () => JSON.stringify(history), save() {} },
      rng,
      mlp: false,
      maxIter: 6,
    });
    const truth = new Map(ranker.getState().rows.map((row) => [row.pokemon.id, row.score]));
    const seq = [];
    for (let k = 0; k < 20; k++) {
      const { a, b } = ranker.getState().pair;
      seq.push([a, b]);
      const d = truth.get(a) - truth.get(b) + (rng() - 0.5) * 2;
      ranker.answer(Math.abs(d) < 0.15 ? "tie" : d > 0 ? "a" : "b");
    }
    const { worst } = worstWindow(seq, 10);
    assert.ok(worst <= 3);
    assert.ok(seq.filter((p) => p.includes(864)).length <= 3);
  });
});

describe("uncertainty breakdown", () => {
  it("splits the ± into trait and own parts with their covariance", () => {
    const P = require("../data/pokemon.json").pokemon.slice(0, 40);
    const design = F.buildDesignMatrix(P, [F.typeExtractor]);
    const comps = [];
    for (let k = 0; k < 60; k++) comps.push({ a: P[0].id, b: P[1 + (k % 20)].id, outcome: k % 3 ? "b" : "a" });
    const fit = F.fitBradleyTerry(design, comps, { mlp: false });
    let sawNegative = false;
    for (let i = 0; i < fit.ids.length; i++) {
      const u = F.uncertaintyBreakdown(fit, i);
      assert.ok(Math.abs(u.corrected ** 2 - (u.trait ** 2 + u.own ** 2 + 2 * u.cov)) < 1e-6);
      if (u.cov < 0) {
        sawNegative = true;
        assert.ok(u.naive >= u.corrected - 1e-12);
      }
    }
    assert.ok(sawNegative);
  });
});
