const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const F = require("../js/model.js");

// Four species, columns: two exclusive one-hot gens, a multi-hot type pair, one continuous stat.
const names = ["gen:1", "gen:2", "type:fire", "type:water", "HP"];
const X = Float64Array.from([
  1, 0, 1, 0, 0.5,
  0, 1, 1, 1, -1,
  1, 0, 0, 1, 1.5,
  0, 1, 0, 0, -1,
]);
const w = Float64Array.from([0.3, -0.2, 0.5, 0.1, 0.8]);

describe("total effect", () => {
  it("equals the linear weight when the network is zero (w·SD for continuous)", () => {
    const zero = { hidden: [2, 1], W1: new Float64Array(10), c1: new Float64Array(2), W2: new Float64Array(2), c2: new Float64Array(1), v: new Float64Array(1) };
    for (const net of [null, zero]) {
      const out = F.totalEffects(X, 4, 5, names, w, net);
      assert.equal(out[0].kind, "one-hot");
      assert.equal(out[2].kind, "binary");
      assert.equal(out[4].kind, "continuous");
      for (let k = 0; k < 4; k++) {
        assert.ok(Math.abs(out[k].mean - w[k]) < 1e-12);
        assert.ok(out[k].sd < 1e-12);
      }
      const mean = (0.5 - 1 + 1.5 - 1) / 4;
      const sd = Math.sqrt([0.5, -1, 1.5, -1].reduce((a, x) => a + (x - mean) ** 2, 0) / 4);
      assert.ok(Math.abs(out[4].mean - 0.8 * sd) < 1e-12);
    }
  });

  it("matches a hand calculation with a tiny network", () => {
    // One hidden unit per layer: h1 = tanh(a·type:fire + c), h2 = tanh(h1), EV = v·h2.
    const a = 0.7, c = 0.1, v = 2;
    const W1 = Float64Array.from([0, 0, a, 0, 0]);
    const net = { hidden: [1, 1], W1, c1: Float64Array.from([c]), W2: Float64Array.from([1]), c2: Float64Array.from([0]), v: Float64Array.from([v]) };
    const out = F.totalEffects(X, 4, 5, names, w, net);
    const ev = (on) => v * Math.tanh(Math.tanh(a * on + c));
    const expected = w[2] + (ev(1) - ev(0)); // same for every species: fire is the only input
    assert.ok(Math.abs(out[2].mean - expected) < 1e-12);
    assert.ok(out[2].sd < 1e-12);
    // Columns the network ignores keep their linear weight.
    assert.ok(Math.abs(out[0].mean - w[0]) < 1e-12);
  });

  it("toggles one-hot blocks as a whole", () => {
    // EV depends on gen:1 only; for gen:2 the "off" state must also clear gen:1 for gen-1 species.
    const a = 1.2;
    const net = { hidden: [1, 1], W1: Float64Array.from([a, 0, 0, 0, 0]), c1: new Float64Array(1), W2: Float64Array.from([1]), c2: new Float64Array(1), v: Float64Array.from([1]) };
    const out = F.totalEffects(X, 4, 5, names, w, net);
    // gen:2 on (gen:1 off) vs block off: EV is 0 both ways, so total = w.
    assert.ok(Math.abs(out[1].mean - w[1]) < 1e-12);
    const g = Math.tanh(Math.tanh(a)) - Math.tanh(Math.tanh(0));
    assert.ok(Math.abs(out[0].mean - (w[0] + g)) < 1e-12);
  });
});
