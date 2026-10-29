const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const F = require("../js/model.js");

function endRankError(estimate, truth, k) {
  const n = truth.length;
  const byTruth = truth.map((_, index) => index).sort((a, b) => truth[b] - truth[a] || a - b);
  const byEstimate = estimate.map((_, index) => index).sort((a, b) => estimate[b] - estimate[a] || a - b);
  const estimatedRank = new Array(n);
  byEstimate.forEach((index, place) => { estimatedRank[index] = place + 1; });
  let error = 0;
  for (let place = 0; place < k; place++) {
    error += Math.abs(estimatedRank[byTruth[place]] - (place + 1));
    error += Math.abs(estimatedRank[byTruth[n - 1 - place]] - (n - place));
  }
  return error / (2 * k);
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

  it("places the true ends more accurately than random pairing", () => {
    // Whole-list Kendall tau is the wrong score once pairs are tail-weighted.
    // On these 24 species and 140 duels it is about 0.73 for active pairing
    // and 0.80 for random: most pairwise agreements sit in the middle, and
    // the weight spends duels on the ends. Mean absolute rank error of the
    // true top two and bottom two is the check that matches that objective.
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
    assert.ok(active + 0.25 < random, `active end error ${active} vs random ${random}`);
  });

  it("is 1 at both ends, 0 at the median, and symmetric", () => {
    assert.equal(F.tailWeight(0), 1);
    assert.equal(F.tailWeight(1), 1);
    assert.ok(Math.abs(F.tailWeight(0.5)) < 1e-12);
    for (let k = 0; k <= 20; k++) {
      const p = k / 20;
      assert.ok(Math.abs(F.tailWeight(p) - F.tailWeight(1 - p)) < 1e-12, `p=${p}`);
    }
  });

  it("ranks a top-versus-second pair above a middle pair when information gain matches", () => {
    const n = 1025;
    const eig = 0.4;
    const at = (rank) => F.tailWeight((rank - 1) / (n - 1));
    const topSecond = eig * F.pairTailMultiplier(at(1), at(2));
    const middle = eig * F.pairTailMultiplier(at(512), at(513));
    assert.ok(topSecond > middle);
    assert.ok(Math.abs(F.pairTailMultiplier(1, 1) - 1) < 1e-12);
    assert.ok(Math.abs(F.pairTailMultiplier(1, 0) - 0.6) < 1e-12);
    assert.ok(Math.abs(F.pairTailMultiplier(0, 0) - 0.2) < 1e-12);

    const model = {
      ids: [1, 2, 3, 4, 5, 6, 7],
      strength: [0, 0, 0, 0, 0, 0, 0],
      offsetVar: [1, 1, 1, 1, 1, 1, 1],
    };
    const picked = F.selectNextPair(model, {
      explore: 0,
      topK: 1,
      window: 7,
      rng: F.mulberry32(9),
    });
    assert.deepEqual([picked.a, picked.b].slice().sort((a, b) => a - b), [1, 7]);
  });

  it("falls off smoothly past rank 10, with no cutoff there", () => {
    const n = 1025;
    const at = (rank) => F.tailWeight((rank - 1) / (n - 1));
    const t1 = at(1);
    const t10 = at(10);
    const t11 = at(11);
    const tThird = at(Math.round(n / 3));
    assert.equal(t1, 1);
    assert.ok(t1 > t10);
    assert.ok(t10 > t11);
    assert.ok(t10 - t11 < 0.001);
    assert.ok(t11 > 0.99);
    assert.ok(t11 > tThird + 0.7);
    const step9 = at(9) - at(10);
    const step10 = at(10) - at(11);
    const step11 = at(11) - at(12);
    assert.ok(step10 < step9 * 1.5);
    assert.ok(step11 < step10 * 1.5);
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
  return endRankError(fit.strength, truth, 2);
}

function randomPair(ids, rng) {
  const i = Math.floor(rng() * ids.length);
  let j = Math.floor(rng() * (ids.length - 1));
  if (j >= i) j += 1;
  return { a: ids[i], b: ids[j] };
}
