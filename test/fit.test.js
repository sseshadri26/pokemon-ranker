const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const F = require("../js/model.js");

function closeTo(actual, expected, digits) {
  const delta = Math.abs(expected - actual);
  const limit = 10 ** -digits / 2;
  assert.ok(delta < limit, `${actual} is not within ${digits} digits of ${expected} (delta ${delta})`);
}

function mono(id, type, generation = 1) {
  return { id, types: [type], generation };
}

describe("Bradley–Terry fit", () => {
  it("puts a near-zero gradient at the MAP", () => {
    const design = F.buildDesignMatrix(
      [mono(1, "fire", 1), mono(2, "water", 1), mono(3, "fire", 2)],
      F.coreExtractors,
    );
    const comparisons = [
      { a: 1, b: 2, outcome: "a" },
      { a: 1, b: 3, outcome: "tie" },
      { a: 3, b: 2, outcome: "a" },
      { a: 2, b: 3, outcome: "b" },
    ];
    const fit = F.fitBradleyTerry(design, comparisons);
    assert.equal(fit.converged, true);

    const eps = 1e-5;
    const base = F.posteriorNll(design, comparisons, fit.weights, fit.offset);
    const grad = [];
    for (let k = 0; k < fit.weights.length; k++) {
      const up = fit.weights.slice();
      const down = fit.weights.slice();
      up[k] += eps;
      down[k] -= eps;
      grad.push(
        (F.posteriorNll(design, comparisons, up, fit.offset) -
          F.posteriorNll(design, comparisons, down, fit.offset)) /
          (2 * eps),
      );
    }
    for (let i = 0; i < fit.offset.length; i++) {
      const up = fit.offset.slice();
      const down = fit.offset.slice();
      up[i] += eps;
      down[i] -= eps;
      grad.push(
        (F.posteriorNll(design, comparisons, fit.weights, up) -
          F.posteriorNll(design, comparisons, fit.weights, down)) /
          (2 * eps),
      );
    }
    for (const g of grad) assert.ok(Math.abs(g) < 2e-3);
    assert.equal(Number.isFinite(base), true);
  });

  it("ranks a repeated winner above a repeated loser", () => {
    const design = F.buildDesignMatrix([mono(1, "fire"), mono(2, "fire")], F.coreExtractors);
    const comparisons = Array.from({ length: 24 }, () => ({ a: 1, b: 2, outcome: "a" }));
    const fit = F.fitBradleyTerry(design, comparisons);
    assert.ok(fit.strength[0] > fit.strength[1] + 0.4);
    const priorSd = Math.sqrt(fit.sigmaB ** 2 + fit.sigmaW ** 2 * 2);
    assert.ok(fit.sd[0] < priorSd - 0.05);
  });

  it("treats ties as symmetric half-wins and pulls the pair together", () => {
    const design = F.buildDesignMatrix([mono(1, "grass"), mono(2, "grass")], F.coreExtractors);
    const ties = Array.from({ length: 30 }, () => ({ a: 1, b: 2, outcome: "tie" }));
    const flipped = ties.map(() => ({ a: 2, b: 1, outcome: "tie" }));
    const wins = Array.from({ length: 12 }, () => ({ a: 1, b: 2, outcome: "a" }));
    const tied = F.fitBradleyTerry(design, ties);
    const tiedOtherWay = F.fitBradleyTerry(design, flipped);
    const decisive = F.fitBradleyTerry(design, wins);

    assert.ok(Math.abs(tied.strength[0] - tied.strength[1]) < 0.05);
    for (let i = 0; i < 2; i++) closeTo(tied.strength[i], tiedOtherWay.strength[i], 5);
    assert.ok(
      Math.abs(decisive.strength[0] - decisive.strength[1]) >
        Math.abs(tied.strength[0] - tied.strength[1]) + 0.3,
    );
  });

  it("ignores skips because they never become comparisons", () => {
    const history = [
      { a: 1, b: 2, outcome: "a", at: 1 },
      { a: 1, b: 3, outcome: "skip", at: 2 },
      { a: 2, b: 3, outcome: "tie", at: 3 },
      { a: 3, b: 1, outcome: "skip", at: 4 },
    ];
    assert.deepEqual(F.ratedComparisons(history), [
      { a: 1, b: 2, outcome: "a" },
      { a: 2, b: 3, outcome: "tie" },
    ]);
  });

  it("learns trait weights and parks uncompared species on the trait prediction", () => {
    const fire = Array.from({ length: 8 }, (_, i) => mono(i + 1, "fire"));
    const water = Array.from({ length: 8 }, (_, i) => mono(i + 9, "water"));
    const heldFire = mono(100, "fire");
    const heldWater = mono(101, "water");
    const design = F.buildDesignMatrix([...fire, ...water, heldFire, heldWater], F.coreExtractors);
    const comparisons = [];
    for (let k = 0; k < 48; k++) {
      comparisons.push({ a: (k % 8) + 1, b: (k % 8) + 9, outcome: "a" });
    }
    const fit = F.fitBradleyTerry(design, comparisons);
    const fireW = fit.weights[fit.featureNames.indexOf("type:fire")];
    const waterW = fit.weights[fit.featureNames.indexOf("type:water")];
    assert.ok(fireW > waterW + 0.2);

    const heldFireRow = fit.ids.indexOf(100);
    const heldWaterRow = fit.ids.indexOf(101);
    assert.ok(fit.strength[heldFireRow] > fit.strength[heldWaterRow] + 0.2);
    assert.ok(Math.abs(fit.offset[heldFireRow]) < 0.05);
    assert.ok(Math.abs(fit.offset[heldWaterRow]) < 0.05);
    closeTo(fit.strength[heldFireRow], fireW + fit.weights[fit.featureNames.indexOf("gen:1")], 5);
  });

  it("lets one upset lose to the trait prior", () => {
    const roster = [
      ...Array.from({ length: 6 }, (_, i) => mono(i + 1, "fire")),
      ...Array.from({ length: 6 }, (_, i) => mono(i + 7, "water")),
    ];
    const design = F.buildDesignMatrix(roster, F.coreExtractors);
    const comparisons = [];
    for (let k = 0; k < 36; k++) {
      const fire = 2 + (k % 5);
      const water = 8 + (k % 5);
      comparisons.push({ a: fire, b: water, outcome: "a" });
    }
    comparisons.push({ a: 1, b: 7, outcome: "b" });
    const fit = F.fitBradleyTerry(design, comparisons);
    assert.ok(fit.strength[fit.ids.indexOf(1)] > fit.strength[fit.ids.indexOf(7)]);
  });

  it("matches the prior variance when nobody has been compared", () => {
    const design = F.buildDesignMatrix([mono(1, "electric", 3)], F.coreExtractors);
    const fit = F.fitBradleyTerry(design, []);
    const prior = fit.sigmaB ** 2 + fit.sigmaW ** 2 * 2;
    closeTo(fit.strength[0], 0, 8);
    closeTo(fit.sd[0] ** 2, prior, 4);
    assert.equal(fit.offset[0], 0);
  });

  it("warm-starts to the same ranking as a cold fit", () => {
    const design = F.buildDesignMatrix(
      [mono(1, "fire"), mono(2, "water"), mono(3, "grass", 2)],
      F.coreExtractors,
    );
    const comparisons = [
      { a: 1, b: 2, outcome: "a" },
      { a: 2, b: 3, outcome: "tie" },
      { a: 3, b: 1, outcome: "b" },
      { a: 1, b: 2, outcome: "a" },
    ];
    const cold = F.fitBradleyTerry(design, comparisons);
    const warm = F.fitBradleyTerry(design, comparisons, {
      warm: { w: cold.weights.slice(), b: cold.offset.slice() },
    });
    for (let i = 0; i < cold.strength.length; i++) closeTo(warm.strength[i], cold.strength[i], 4);
    assert.ok(warm.iterations <= cold.iterations);
  });

  it("raises confidence once the history carries real answers", () => {
    const design = F.buildDesignMatrix(
      [mono(1, "fire"), mono(2, "water"), mono(3, "grass")],
      F.coreExtractors,
    );
    const before = F.rankingSummary(F.fitBradleyTerry(design, []), design);
    const after = F.rankingSummary(
      F.fitBradleyTerry(
        design,
        Array.from({ length: 15 }, (_, i) => ({
          a: (i % 3) + 1,
          b: ((i + 1) % 3) + 1,
          outcome: "a",
        })),
      ),
      design,
    );
    assert.ok(before.confidence < 0.05);
    assert.ok(after.confidence > before.confidence);
    assert.equal(after.matchups, 15);
  });
});

describe("trait features", () => {
  it("adds a column when a new extractor is registered", () => {
    const beloved = {
      id: "beloved",
      extract: (pokemon) => (pokemon.id === 1 ? { beloved: 1 } : {}),
    };
    const design = F.buildDesignMatrix([mono(1, "fire"), mono(2, "water")], [...F.coreExtractors, beloved]);
    assert.ok(design.names.includes("beloved"));
    assert.equal(design.values[design.names.indexOf("beloved")], 1);
    assert.equal(design.values[design.cols + design.names.indexOf("beloved")], 0);
  });
  it("ranks a high-attack species above a low-attack one and exposes the hidden layer", () => {
    function measured(id, attack) {
      return {
        id,
        types: ["normal"],
        generation: 1,
        hp: 50,
        attack,
        defense: 50,
        specialAttack: 50,
        specialDefense: 50,
        speed: 50,
        heightM: 1,
        weightKg: 20,
        captureRate: 100,
        happiness: 70,
        hatch: 20,
        genderRate: 4,
        growth: "medium",
      };
    }
    const low = measured(1, 40);
    const high = measured(2, 140);
    const design = F.buildDesignMatrix([low, high], F.extendedExtractors);
    const z = new Float64Array(F.CONTINUOUS_NAMES.length * 2);
    z.set(F.continuousFeatures(low), 0);
    z.set(F.continuousFeatures(high), F.CONTINUOUS_NAMES.length);
    const comparisons = [];
    for (let k = 0; k < 24; k++) comparisons.push({ a: 2, b: 1, outcome: "a" });
    const fit = F.fitBradleyTerry(design, comparisons, {
      continuous: { names: F.CONTINUOUS_NAMES, values: z, cols: F.CONTINUOUS_NAMES.length },
      maxIter: 16,
    });
    assert.equal(fit.network.hidden, 4);
    assert.equal(fit.network.inputs.length, 10);
    assert.ok(fit.strength[design.ids.indexOf(2)] > fit.strength[design.ids.indexOf(1)] + 0.2);
    const attackWeight = fit.weights[fit.featureNames.indexOf("stat:attack")];
    const attackInNet = fit.network.units.some((unit) => Math.abs(unit.weights.find((row) => row.name === "Attack").weight) > 1e-4);
    assert.ok(attackWeight > 0.05 || attackInNet);
  });
});

describe("linear algebra and the sorting bound", () => {
  it("inverts a 2×2 SPD matrix", () => {
    const factor = F.invertSPD(new Float64Array([4, 1, 1, 3]), 2);
    assert.ok(factor);
    const inv = factor.inverse;
    closeTo(inv[0], 3 / 11, 8);
    closeTo(inv[1], -1 / 11, 8);
    closeTo(inv[2], -1 / 11, 8);
    closeTo(inv[3], 4 / 11, 8);
  });

  it("puts log2(1025!) near 8,800 bits", () => {
    const bits = F.log2Factorial(1025);
    assert.ok(bits > 8700);
    assert.ok(bits < 8900);
  });
});
