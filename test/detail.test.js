const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createRanker } = require("../js/ranker.js");
const F = require("../js/model.js");

function mon(id, name, type) {
  return {
    id,
    name,
    types: [type],
    generation: 1,
    color: null,
    shape: null,
    habitat: null,
    eggGroups: [],
    legendary: false,
    mythical: false,
    baby: false,
    stage: 1,
    starter: false,
    art: null,
    forms: [{ name, art: null, types: [type], kind: "default", pixel: false }],
  };
}

function memory(raw) {
  return {
    raw: raw == null ? null : raw,
    load() { return this.raw; },
    save(history) { this.raw = JSON.stringify(history); },
  };
}

describe("strength breakdown", () => {
  it("splits one non-zero column into value times weight, EV, and offset", () => {
    const design = F.buildDesignMatrix([
      { id: 1, types: ["fire"], generation: 1 },
      { id: 2, types: ["water"], generation: 1 },
    ], [F.typeExtractor]);
    const fireAt = design.names.indexOf("type:fire");
    const waterAt = design.names.indexOf("type:water");
    assert.ok(fireAt >= 0 && waterAt >= 0);
    const row = Array.from(design.values.subarray(0, design.cols));
    const other = Array.from(design.values.subarray(design.cols));
    assert.equal(row.filter((value) => value !== 0).length, 1);
    assert.equal(row[fireAt], 1);
    assert.equal(other[waterAt], 1);

    const weights = new Float64Array(design.cols);
    weights[fireAt] = 1.25;
    weights[waterAt] = -4;
    assert.equal(design.cols, 2);
    const network = {
      W1: Float64Array.of(0.2, -0.7, 0.1, 0.3),
      c1: Float64Array.of(0.05, -0.1),
      W2: Float64Array.of(0.4, -0.2),
      c2: Float64Array.of(0.15),
      v: Float64Array.of(0.8),
    };
    const parts = F.strengthBreakdown(row, weights, network, -0.3, design.names);
    const fire = parts.columns.find((column) => column.key === "type:fire");
    const water = parts.columns.find((column) => column.key === "type:water");
    assert.equal(fire.value, 1);
    assert.equal(fire.weight, 1.25);
    assert.equal(fire.contribution, fire.value * fire.weight);
    assert.equal(water.value, 0);
    assert.equal(water.contribution, 0);
    assert.equal(parts.linear, 1.25);

    const h1a = Math.tanh(0.05 + 0.2 * row[0] + -0.7 * row[1]);
    const h1b = Math.tanh(-0.1 + 0.1 * row[0] + 0.3 * row[1]);
    const ev = 0.8 * Math.tanh(0.15 + 0.4 * h1a + -0.2 * h1b);
    assert.ok(Math.abs(parts.ev - ev) < 1e-12);
    assert.equal(parts.offset, -0.3);
    assert.ok(Math.abs(parts.strength - (parts.linear + parts.ev + parts.offset)) < 1e-12);

    const plain = F.strengthBreakdown(other, weights, null, 0.2, design.names);
    const waterOnly = plain.columns.find((column) => column.key === "type:water");
    assert.equal(waterOnly.contribution, waterOnly.value * waterOnly.weight);
    assert.equal(plain.ev, 0);
    assert.ok(Math.abs(plain.strength - (plain.linear + plain.ev + plain.offset)) < 1e-12);
  });
});

describe("species detail", () => {
  it("counts a win, a tie, and a skip, and names those opponents newest first", () => {
    const roster = [mon(1, "A", "fire"), mon(2, "B", "water"), mon(3, "C", "grass"), mon(4, "D", "electric")];
    const store = memory(JSON.stringify([
      { a: 1, b: 2, outcome: "a", at: 1000 },
      { a: 1, b: 3, outcome: "tie", at: 2000 },
      { a: 1, b: 4, outcome: "skip", at: 3000 },
    ]));
    const ranker = createRanker(roster, {
      storage: store,
      explore: 0,
      rng: () => 0.5,
      now: () => 1,
      mlp: false,
    });
    const before = ranker.getState();
    const detail = ranker.speciesDetail(1);
    assert.equal(ranker.getState(), before);
    assert.equal(before.history.length, 3);
    assert.equal(detail.record.wins, 1);
    assert.equal(detail.record.losses, 0);
    assert.equal(detail.record.ties, 1);
    assert.equal(detail.record.skips, 1);
    assert.deepEqual(detail.matchups.map((bout) => bout.opponent), ["D", "C", "B"]);
    assert.deepEqual(detail.matchups.map((bout) => bout.result), ["skip", "tie", "won"]);
    assert.equal(detail.games, 2);

    const beaten = ranker.speciesDetail(2);
    assert.equal(beaten.record.wins, 0);
    assert.equal(beaten.record.losses, 1);
    assert.equal(beaten.matchups[0].opponent, "A");
    assert.equal(beaten.matchups[0].result, "lost");

    const keys = detail.categories.flatMap((category) => category.columns.map((column) => column.key));
    assert.equal(keys.includes("type:water"), false);
    assert.ok(keys.includes("type:fire"));
    let summed = 0;
    for (const category of detail.categories) {
      let categorySum = 0;
      for (let i = 0; i < category.columns.length; i++) {
        const column = category.columns[i];
        assert.notEqual(column.value, 0);
        assert.ok(Math.abs(column.contribution - column.value * column.weight) < 1e-12);
        categorySum += column.contribution;
        if (i > 0) {
          assert.ok(Math.abs(category.columns[i - 1].contribution) + 1e-12 >= Math.abs(column.contribution));
        }
      }
      assert.ok(Math.abs(categorySum - category.contribution) < 1e-9);
      summed += category.contribution;
    }
    assert.ok(Math.abs(summed - detail.linear) < 1e-8);
    assert.equal(typeof detail.offset, "number");
    assert.ok(Math.abs(detail.linear + detail.ev + detail.offset - detail.strength) < 1e-6);
    assert.equal(detail.partsMatch, true);
    assert.equal(ranker.speciesDetail(99), null);
  });

  it("adds the network output to the fitted strength without fitting again", () => {
    const roster = [mon(1, "A", "fire"), mon(2, "B", "water")];
    const store = memory(JSON.stringify([{ a: 1, b: 2, outcome: "a", at: 1 }]));
    const ranker = createRanker(roster, {
      storage: store,
      explore: 0,
      rng: () => 0.5,
      mlp: true,
      maxIter: 4,
    });
    const before = ranker.getState();
    const detail = ranker.speciesDetail(1);
    assert.equal(ranker.getState(), before);
    assert.equal(detail.partsMatch, true);
    assert.ok(Math.abs(detail.linear + detail.ev + detail.offset - detail.strength) < 1e-6);
    assert.ok(detail.categories.length > 0);
  });
});
