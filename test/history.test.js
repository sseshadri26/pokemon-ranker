const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const F = require("../js/model.js");

function closeTo(actual, expected, digits) {
  const delta = Math.abs(expected - actual);
  assert.ok(delta < 10 ** -digits / 2, `${actual} is not within ${digits} digits of ${expected}`);
}

const roster = [
  { id: 1, types: ["fire"], generation: 1 },
  { id: 2, types: ["water"], generation: 1 },
  { id: 3, types: ["grass"], generation: 1 },
];

describe("answer history", () => {
  it("undoes one level at a time, including ties, and restores the fit", () => {
    const history = [
      { a: 1, b: 2, outcome: "a", at: 1 },
      { a: 2, b: 3, outcome: "tie", at: 2 },
      { a: 3, b: 1, outcome: "b", at: 3 },
      { a: 1, b: 3, outcome: "skip", at: 4 },
    ];
    const once = F.undo(history);
    const twice = F.undo(once);
    assert.deepEqual(once.map((a) => a.outcome), ["a", "tie", "b"]);
    assert.deepEqual(twice.map((a) => a.outcome), ["a", "tie"]);
    assert.deepEqual(F.undo([]), []);

    const design = F.buildDesignMatrix(roster, F.coreExtractors);
    const fitFull = F.fitBradleyTerry(design, F.ratedComparisons(history));
    const fitUndone = F.fitBradleyTerry(design, F.ratedComparisons(twice));
    const direct = F.fitBradleyTerry(design, [
      { a: 1, b: 2, outcome: "a" },
      { a: 2, b: 3, outcome: "tie" },
    ]);
    assert.equal(fitUndone.comparisons, 2);
    assert.equal(fitFull.comparisons, 3);
    for (let i = 0; i < 3; i++) closeTo(fitUndone.strength[i], direct.strength[i], 6);
  });

  it("does not count skips toward matchups", () => {
    const history = [
      { a: 1, b: 2, outcome: "a", at: 1 },
      { a: 1, b: 3, outcome: "skip", at: 2 },
      { a: 2, b: 3, outcome: "tie", at: 3 },
    ];
    assert.deepEqual(Array.from(F.comparisonCounts(history, [1, 2, 3])), [1, 2, 1]);
  });

  it("round-trips export and import, and rejects malformed files", () => {
    const history = [
      { a: 25, b: 6, outcome: "b", at: 10 },
      { a: 6, b: 3, outcome: "tie", at: 11 },
      { a: 150, b: 151, outcome: "skip", at: 12 },
    ];
    const text = F.serializeHistory(history, new Date("2026-10-26T12:00:00.000Z"));
    assert.deepEqual(F.parseHistory(text), history);

    assert.throws(() => F.parseHistory("{"), /JSON/);
    assert.throws(() => F.parseHistory('{"version":2,"history":[]}'), /version/);
    assert.throws(() => F.parseHistory('{"history":[{"a":1,"b":1,"outcome":"tie"}]}'), /itself/);
    assert.throws(() => F.parseHistory('{"history":[{"a":1,"b":2,"outcome":"maybe"}]}'), /outcome/);
  });
});
