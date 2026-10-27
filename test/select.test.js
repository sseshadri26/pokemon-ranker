const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const F = require("../js/model.js");

function kendallTau(estimate, truth) {
  const n = estimate.length;
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const de = estimate[i] - estimate[j];
      const dt = truth[i] - truth[j];
      if (de === 0 || dt === 0) continue;
      if (de * dt > 0) concordant += 1;
      else discordant += 1;
    }
  }
  const total = concordant + discordant;
  return total === 0 ? 0 : (concordant - discordant) / total;
}

describe("pair selector", () => {
  it("prefers a close uncertain pair over a lopsided certain one", () => {
    const model = {
      ids: [1, 2, 3, 4],
      strength: [0, 0.05, -0.05, 5],
      offsetVar: [3, 3, 3, 0.01],
    };
    const picked = F.selectNextPair(model, { explore: 0, topK: 1, rng: F.mulberry32(1) });
    assert.ok(picked);
    assert.equal([picked.a, picked.b].includes(4), false);
  });

  it("can avoid repeating the pair just answered", () => {
    const model = { ids: [1, 2, 3], strength: [0, 0, 0], offsetVar: [1, 1, 1] };
    const first = F.selectNextPair(model, { explore: 0, topK: 1, rng: F.mulberry32(2) });
    const second = F.selectNextPair(model, {
      explore: 0,
      topK: 1,
      avoid: [first.a, first.b],
      rng: F.mulberry32(2),
    });
    const pairOf = (picked) => [picked.a, picked.b].slice().sort((a, b) => a - b);
    assert.notDeepEqual(pairOf(second), pairOf(first));
  });

  it("explores toward species that have not been shown", () => {
    const model = { ids: [10, 20, 30, 40], strength: [0, 0, 0, 0], offsetVar: [1, 1, 1, 1] };
    const picked = F.selectNextPair(model, {
      explore: 1,
      games: [9, 9, 0, 9],
      rng: F.mulberry32(3),
    });
    assert.ok([picked.a, picked.b].includes(30));
  });

  it("selects the next pair for a full National Dex in under 100ms", () => {
    const n = 1025;
    const rng = F.mulberry32(4);
    const pokemon = Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      types: [i % 3 === 0 ? "fire" : i % 3 === 1 ? "water" : "grass", ...(i % 5 === 0 ? ["flying"] : [])],
      generation: (i % 9) + 1,
    }));
    const design = F.buildDesignMatrix(pokemon, F.coreExtractors);
    const fit = F.fitBradleyTerry(design, []);
    const model = {
      ids: fit.ids,
      strength: fit.strength,
      offsetVar: fit.offsetVar,
      traitCoords: fit.traitCoords,
    };
    F.selectNextPair(model, { rng: F.mulberry32(5), explore: 0.12 });
    const start = performance.now();
    const picked = F.selectNextPair(model, { rng, explore: 0.12 });
    const elapsed = performance.now() - start;
    assert.ok(picked);
    assert.ok(elapsed < 100, `selection took ${elapsed}ms`);
  });

  it("recovers a hidden ranking faster with active pairs than with random pairs", () => {
    const n = 24;
    const rounds = 140;
    const seeds = [11, 22, 33, 44, 55, 66, 77, 88];
    const activeScores = [];
    const randomScores = [];

    for (const seed of seeds) {
      const world = F.mulberry32(seed);
      const pokemon = Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        types: [world() < 0.5 ? "dragon" : "bug"],
        generation: 1 + Math.floor(world() * 4),
      }));
      const truth = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * 0.45);
      const design = F.buildDesignMatrix(pokemon, F.coreExtractors);
      activeScores.push(run(design, truth, rounds, "active", seed));
      randomScores.push(run(design, truth, rounds, "random", seed));
    }

    const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const active = mean(activeScores);
    const random = mean(randomScores);
    assert.ok(active > random + 0.04, `active ${active} vs random ${random}`);
  });
});

function run(design, truth, rounds, mode, seed) {
  const rng = F.mulberry32(seed + (mode === "active" ? 1000 : 2000));
  const comparisons = [];
  let fit = F.fitBradleyTerry(design, comparisons);
  for (let t = 0; t < rounds; t++) {
    const pair = mode === "active"
      ? F.selectNextPair(
        {
          ids: fit.ids,
          strength: fit.strength,
          offsetVar: fit.offsetVar,
          traitCoords: fit.traitCoords,
        },
        { rng, explore: 0.08, topK: 4 },
      )
      : randomPair(fit.ids, rng);
    if (!pair) break;
    const ai = fit.ids.indexOf(pair.a);
    const bi = fit.ids.indexOf(pair.b);
    const p = F.sigmoid((truth[ai] - truth[bi]) / 0.7);
    const outcome = rng() < p ? "a" : "b";
    comparisons.push({ a: pair.a, b: pair.b, outcome });
    fit = F.fitBradleyTerry(design, comparisons, {
      warm: { w: fit.weights, b: fit.offset },
      maxIter: 12,
    });
  }
  return kendallTau(fit.strength, truth);
}

function randomPair(ids, rng) {
  const i = Math.floor(rng() * ids.length);
  let j = Math.floor(rng() * (ids.length - 1));
  if (j >= i) j += 1;
  return { a: ids[i], b: ids[j] };
}
