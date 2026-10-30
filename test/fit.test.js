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

  it("fits species strengths alone when the design has no columns", () => {
    const species = [mono(1, "fire"), mono(2, "water"), mono(3, "fire")];
    const comparisons = Array.from({ length: 40 }, () => ({ a: 1, b: 2, outcome: "a" }));
    const traits = F.buildDesignMatrix(species, [F.typeExtractor]);
    const empty = F.buildDesignMatrix(species, []);
    assert.equal(empty.cols, 0);
    const joint = F.fitBradleyTerry(traits, comparisons, { mlp: false });
    const plain = F.fitBradleyTerry(empty, comparisons, { mlp: false });
    const at = (fit, id) => fit.ids.indexOf(id);
    assert.equal(plain.network, null);
    assert.equal(plain.weights.length, 0);
    assert.equal(plain.featureNames.length, 0);
    assert.ok(plain.strength[at(plain, 1)] > plain.strength[at(plain, 2)]);
    assert.ok(plain.strength[at(plain, 1)] > plain.strength[at(plain, 3)]);
    closeTo(plain.strength[at(plain, 3)], 0, 8);
    closeTo(plain.offset[at(plain, 3)], 0, 8);
    closeTo(plain.sd[at(plain, 3)], plain.sigmaB, 6);
    for (const id of [1, 2, 3]) closeTo(plain.strength[at(plain, id)], plain.offset[at(plain, id)], 8);
    assert.ok(Math.abs(plain.strength[at(plain, 1)] - joint.offset[at(joint, 1)]) > 0.05);
    assert.ok(joint.strength[at(joint, 3)] > joint.strength[at(joint, 2)]);
    assert.ok(joint.strength[at(joint, 3)] > 0.2);
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
    const comparisons = [];
    for (let k = 0; k < 24; k++) comparisons.push({ a: 2, b: 1, outcome: "a" });
    const fit = F.fitBradleyTerry(design, comparisons, { mlp: true, maxIter: 8 });
    assert.deepEqual(fit.network.hidden, [8, 4]);
    assert.equal(fit.network.inputCount, design.cols);
    assert.equal(fit.network.layers.length, 2);
    assert.equal(fit.network.output.name, "EV");
    assert.ok(fit.strength[design.ids.indexOf(2)] > fit.strength[design.ids.indexOf(1)] + 0.2);
    const attackCol = fit.featureNames.indexOf("stat:attack");
    const attackWeight = fit.weights[attackCol];
    let attackInNet = false;
    for (let unit = 0; unit < fit.network.hidden[0]; unit++) {
      if (Math.abs(fit.network.W1[unit * design.cols + attackCol]) > 1e-4) attackInNet = true;
    }
    assert.ok(attackWeight > 0.05 || attackInNet);
  });

  it("feeds pre-evolution and descendant strengths back in as columns", () => {
    const graph = F.evolutionGraph([
      { id: 1, evolvesFrom: null },
      { id: 2, evolvesFrom: 1 },
      { id: 3, evolvesFrom: 2 },
    ]);
    assert.equal(graph.parent[0], -1);
    assert.equal(graph.parent[1], 0);
    assert.equal(graph.parent[2], 1);
    assert.deepEqual(graph.descendants[0].slice().sort(), [1, 2]);
    assert.deepEqual(graph.descendants[1], [2]);
    assert.deepEqual(graph.descendants[2], []);

    function plain(id, evolvesFrom) {
      return { id, types: ["normal"], generation: 1, evolvesFrom };
    }
    const lines = 8;
    const roster = [];
    for (let i = 0; i < lines; i++) roster.push(plain(1 + i, null));
    for (let i = 0; i < lines; i++) roster.push(plain(9 + i, null));
    for (let i = 0; i < lines; i++) roster.push(plain(17 + i, 1 + i));
    for (let i = 0; i < lines; i++) roster.push(plain(25 + i, 9 + i));
    roster.push(plain(33, null), plain(34, null), plain(35, 33), plain(36, 34));
    const comparisons = [];
    for (let i = 0; i < lines; i++) {
      for (let j = 0; j < lines; j++) {
        comparisons.push({ a: 1 + i, b: 9 + j, outcome: "a" });
        comparisons.push({ a: 17 + i, b: 25 + j, outcome: "a" });
      }
    }
    for (let k = 0; k < 8; k++) comparisons.push({ a: 33, b: 34, outcome: "a" });

    const built = F.appendColumns(F.buildDesignMatrix(roster, F.coreExtractors), F.EVO_COLUMNS);
    const evo = F.evolutionGraph(roster);
    const fit = F.fitBradleyTerry(built, comparisons, {
      mlp: false,
      maxIter: 24,
      evolution: {
        parent: evo.parent,
        descendants: evo.descendants,
        from: built.names.indexOf("evo:from"),
        intoMean: built.names.indexOf("evo:into-mean"),
        intoMax: built.names.indexOf("evo:into-max"),
      },
    });
    const fromWeight = fit.weights[fit.featureNames.indexOf("evo:from")];
    assert.ok(fromWeight > 0.05, `evo:from weight was ${fromWeight}`);
    const strongChild = fit.strength[fit.ids.indexOf(35)];
    const weakChild = fit.strength[fit.ids.indexOf(36)];
    assert.ok(strongChild > weakChild + 0.05, `held-out children ${strongChild} vs ${weakChild}`);
  });
});

describe("game shares", () => {
  it("puts 1/2 on each of two games and 0 on a game the species is absent from", () => {
    const design = F.buildDesignMatrix(
      [
        { id: 1, types: ["normal"], generation: 1, games: ["alpha", "beta"] },
        { id: 2, types: ["normal"], generation: 1, games: ["alpha", "gamma"] },
        { id: 3, types: ["normal"], generation: 1, games: ["delta"] },
        { id: 4, types: ["normal"], generation: 1, games: ["alpha", "colosseum"] },
      ],
      [F.gamesExtractor],
    );
    const col = (name) => design.names.indexOf(`game:${name}`);
    const cell = (row, name) => design.values[row * design.cols + col(name)];
    assert.equal(cell(0, "alpha"), 0.5);
    assert.equal(cell(0, "beta"), 0.5);
    assert.equal(cell(0, "gamma"), 0);
    assert.equal(cell(1, "beta"), 0);
    assert.equal(cell(2, "delta"), 1);
    assert.equal(cell(2, "alpha"), 0);
    assert.equal(col("colosseum"), -1);
    assert.equal(cell(3, "alpha"), 1);
  });

  it("does not let a long game list outweigh a repeated preference", () => {
    function poke(id, type, games) {
      return { id, types: [type], generation: 1, games };
    }
    const many = Array.from({ length: 16 }, (_, i) => `g${i}`);
    const roster = [];
    for (let i = 0; i < 8; i++) roster.push(poke(i + 1, "normal", many));
    for (let i = 0; i < 8; i++) roster.push(poke(i + 9, "normal", ["obscure"]));
    roster.push(poke(17, "fire", ["g0"]));
    roster.push(poke(18, "normal", many));
    const comparisons = [];
    for (let k = 0; k < 48; k++) comparisons.push({ a: (k % 8) + 1, b: (k % 8) + 9, outcome: "a" });
    for (let k = 0; k < 2; k++) comparisons.push({ a: 17, b: 1 + k, outcome: "a" });
    const design = F.buildDesignMatrix(roster, [F.typeExtractor, F.generationExtractor, F.gamesExtractor]);
    const gameCols = design.names
      .map((name, index) => (name.startsWith("game:") ? index : -1))
      .filter((index) => index >= 0);
    const row = (id) => design.ids.indexOf(id);
    let l1 = 0;
    for (const index of gameCols) l1 += Math.abs(design.values[row(18) * design.cols + index]);
    closeTo(l1, 1, 8);
    closeTo(design.values[row(18) * design.cols + design.names.indexOf("game:g0")], 1 / 16, 8);
    assert.equal(design.values[row(18) * design.cols + design.names.indexOf("game:obscure")], 0);
    const fit = F.fitBradleyTerry(design, comparisons, { mlp: false });
    const preferred = fit.strength[fit.ids.indexOf(17)];
    const widelyReleased = fit.strength[fit.ids.indexOf(18)];
    assert.ok(
      preferred > widelyReleased,
      `preference ${preferred} lost to the species that is only in more games ${widelyReleased}`,
    );
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

describe("squashed body size", () => {
  function heightFeature(meters) {
    return F.bodyExtractor.extract({ heightM: meters })["size:height"];
  }
  function weightFeature(kilograms) {
    return F.bodyExtractor.extract({ weightKg: kilograms })["size:weight"];
  }
  function cell(design, id, name) {
    const column = design.names.indexOf(name);
    assert.ok(column >= 0, name);
    return design.values[design.ids.indexOf(id) * design.cols + column];
  }

  it("keeps height in (-1, 1) and saturates past a tall species", () => {
    for (const meters of [0.1, 0.5, 1, 2, 5, 20, 100]) {
      const feature = heightFeature(meters);
      assert.equal(typeof feature, "number");
      assert.ok(feature > -1 && feature < 1, `${meters} m mapped to ${feature}`);
    }
    const one = heightFeature(1);
    const two = heightFeature(2);
    const five = heightFeature(5);
    const twenty = heightFeature(20);
    assert.ok(Math.abs(one) < 1e-12, `1 m was ${one}`);
    assert.ok(two > one);
    assert.ok(two - one > 0.4, `1 m and 2 m differed by ${two - one}`);
    assert.ok(twenty - five < 0.1, `20 m and 5 m differed by ${twenty - five}`);
    assert.ok(twenty - five < (20 - 5) / 0.8 / 10);

    assert.equal(heightFeature(0), undefined);
    assert.equal(heightFeature(-2), undefined);
    assert.equal("size:height" in F.bodyExtractor.extract({}), false);

    const design = F.buildDesignMatrix(
      [
        { id: 1, heightM: 1 },
        { id: 2, heightM: 2 },
        { id: 5, heightM: 5 },
        { id: 20, heightM: 20 },
      ],
      [F.bodyExtractor],
    );
    assert.equal(cell(design, 1, "size:height"), 0);
    assert.ok(Math.abs(cell(design, 2, "size:height") - two) < 1e-12);
    assert.ok(Math.abs(cell(design, 20, "size:height") - twenty) < 1e-12);
    assert.ok(cell(design, 20, "size:height") < 1);
  });

  it("squashes weight so very heavy species stay near heavy ones", () => {
    const ordinary = weightFeature(25);
    const heavy = weightFeature(400);
    const veryHeavy = weightFeature(1000);
    assert.ok(heavy > ordinary);
    assert.ok(veryHeavy > ordinary);
    assert.ok(heavy > 0.8 && heavy < 1, `400 kg was ${heavy}`);
    assert.ok(veryHeavy > 0.8 && veryHeavy < 1, `1000 kg was ${veryHeavy}`);
    const rawLogGap = Math.log10(1000) - Math.log10(400);
    assert.ok(veryHeavy - heavy < rawLogGap, `${veryHeavy - heavy} was not inside ${rawLogGap}`);

    assert.equal(weightFeature(0), undefined);
    assert.equal(weightFeature(-10), undefined);
    assert.equal("size:weight" in F.bodyExtractor.extract({}), false);

    const design = F.buildDesignMatrix(
      [
        { id: 25, weightKg: 25 },
        { id: 400, weightKg: 400 },
        { id: 1000, weightKg: 1000 },
      ],
      [F.bodyExtractor],
    );
    assert.ok(Math.abs(cell(design, 1000, "size:weight") - veryHeavy) < 1e-12);
    assert.ok(cell(design, 1000, "size:weight") < 1);
    assert.ok(cell(design, 400, "size:weight") < 1);

    const stats = {
      hp: 50,
      attack: 50,
      defense: 50,
      specialAttack: 50,
      specialDefense: 50,
      speed: 50,
    };
    const continuous = F.continuousFeatures({ ...stats, heightM: 20, weightKg: 1000 });
    assert.equal(continuous[F.CONTINUOUS_NAMES.indexOf("Height")], heightFeature(20));
    assert.equal(continuous[F.CONTINUOUS_NAMES.indexOf("Weight")], weightFeature(1000));
    const missing = F.continuousFeatures(stats);
    assert.equal(missing[F.CONTINUOUS_NAMES.indexOf("Height")], 0);
    assert.equal(missing[F.CONTINUOUS_NAMES.indexOf("Weight")], 0);
  });
});
