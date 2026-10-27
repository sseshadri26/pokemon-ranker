import { describe, expect, it } from "vitest";
import { fitBradleyTerry, type Comparison } from "./fit";
import { buildDesignMatrix, coreExtractors, type TraitSource } from "./features";
import {
  comparisonCounts,
  parseHistory,
  ratedComparisons,
  serializeHistory,
  undo,
  type Answer,
} from "./history";

const roster: TraitSource[] = [
  { id: 1, types: ["fire"], generation: 1 },
  { id: 2, types: ["water"], generation: 1 },
  { id: 3, types: ["grass"], generation: 1 },
];

describe("answer history", () => {
  it("undoes one level at a time, including ties, and restores the fit", () => {
    const history: Answer[] = [
      { a: 1, b: 2, outcome: "a", at: 1 },
      { a: 2, b: 3, outcome: "tie", at: 2 },
      { a: 3, b: 1, outcome: "b", at: 3 },
      { a: 1, b: 3, outcome: "skip", at: 4 },
    ];
    const once = undo(history);
    const twice = undo(once);
    expect(once.map((a) => a.outcome)).toEqual(["a", "tie", "b"]);
    expect(twice.map((a) => a.outcome)).toEqual(["a", "tie"]);
    expect(undo([])).toEqual([]);

    const design = buildDesignMatrix(roster, coreExtractors);
    const fitFull = fitBradleyTerry(design, ratedComparisons(history));
    const fitUndone = fitBradleyTerry(design, ratedComparisons(twice));
    const direct = fitBradleyTerry(design, [
      { a: 1, b: 2, outcome: "a" },
      { a: 2, b: 3, outcome: "tie" },
    ] satisfies Comparison[]);
    expect(fitUndone.comparisons).toBe(2);
    expect(fitFull.comparisons).toBe(3);
    for (let i = 0; i < 3; i++) expect(fitUndone.strength[i]).toBeCloseTo(direct.strength[i], 6);
  });

  it("does not count skips toward matchups", () => {
    const history: Answer[] = [
      { a: 1, b: 2, outcome: "a", at: 1 },
      { a: 1, b: 3, outcome: "skip", at: 2 },
      { a: 2, b: 3, outcome: "tie", at: 3 },
    ];
    expect(Array.from(comparisonCounts(history, [1, 2, 3]))).toEqual([1, 2, 1]);
  });

  it("round-trips export and import, and rejects malformed files", () => {
    const history: Answer[] = [
      { a: 25, b: 6, outcome: "b", at: 10 },
      { a: 6, b: 3, outcome: "tie", at: 11 },
      { a: 150, b: 151, outcome: "skip", at: 12 },
    ];
    const text = serializeHistory(history, new Date("2026-10-26T12:00:00.000Z"));
    expect(parseHistory(text)).toEqual(history);

    expect(() => parseHistory("{")).toThrow(/JSON/);
    expect(() => parseHistory('{"version":2,"history":[]}')).toThrow(/version/);
    expect(() => parseHistory('{"history":[{"a":1,"b":1,"outcome":"tie"}]}')).toThrow(/itself/);
    expect(() => parseHistory('{"history":[{"a":1,"b":2,"outcome":"maybe"}]}')).toThrow(/outcome/);
  });
});
