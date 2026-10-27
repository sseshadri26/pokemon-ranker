import { describe, expect, it } from "vitest";
import { buildDesignMatrix, coreExtractors, type TraitExtractor, type TraitSource } from "./features";
import { fitBradleyTerry, posteriorNll, type Comparison } from "./fit";
import { ratedComparisons, type Answer } from "./history";
import { invertSPD, log2Factorial } from "./math";
import { rankingSummary } from "./summary";

function mono(id: number, type: string, generation = 1): TraitSource {
  return { id, types: [type], generation };
}

describe("Bradley–Terry fit", () => {
  it("puts a near-zero gradient at the MAP", () => {
    const design = buildDesignMatrix(
      [mono(1, "fire", 1), mono(2, "water", 1), mono(3, "fire", 2)],
      coreExtractors,
    );
    const comparisons: Comparison[] = [
      { a: 1, b: 2, outcome: "a" },
      { a: 1, b: 3, outcome: "tie" },
      { a: 3, b: 2, outcome: "a" },
      { a: 2, b: 3, outcome: "b" },
    ];
    const fit = fitBradleyTerry(design, comparisons);
    expect(fit.converged).toBe(true);

    const eps = 1e-5;
    const base = posteriorNll(design, comparisons, fit.weights, fit.offset);
    const grad: number[] = [];
    for (let k = 0; k < fit.weights.length; k++) {
      const up = fit.weights.slice();
      const down = fit.weights.slice();
      up[k] += eps;
      down[k] -= eps;
      grad.push(
        (posteriorNll(design, comparisons, up, fit.offset) -
          posteriorNll(design, comparisons, down, fit.offset)) /
          (2 * eps),
      );
    }
    for (let i = 0; i < fit.offset.length; i++) {
      const up = fit.offset.slice();
      const down = fit.offset.slice();
      up[i] += eps;
      down[i] -= eps;
      grad.push(
        (posteriorNll(design, comparisons, fit.weights, up) -
          posteriorNll(design, comparisons, fit.weights, down)) /
          (2 * eps),
      );
    }
    for (const g of grad) expect(Math.abs(g)).toBeLessThan(2e-3);
    expect(Number.isFinite(base)).toBe(true);
  });

  it("ranks a repeated winner above a repeated loser", () => {
    const design = buildDesignMatrix([mono(1, "fire"), mono(2, "fire")], coreExtractors);
    const comparisons: Comparison[] = Array.from({ length: 24 }, () => ({
      a: 1,
      b: 2,
      outcome: "a" as const,
    }));
    const fit = fitBradleyTerry(design, comparisons);
    expect(fit.strength[0]).toBeGreaterThan(fit.strength[1] + 0.4);
    // Marginal sd stays above σ_b because the shared trait weight is still
    // uncertain; it should still shrink versus the no-data prior.
    const priorSd = Math.sqrt(fit.sigmaB ** 2 + fit.sigmaW ** 2 * 2);
    expect(fit.sd[0]).toBeLessThan(priorSd - 0.05);
  });

  it("treats ties as symmetric half-wins and pulls the pair together", () => {
    const design = buildDesignMatrix([mono(1, "grass"), mono(2, "grass")], coreExtractors);
    const ties: Comparison[] = Array.from({ length: 30 }, () => ({
      a: 1,
      b: 2,
      outcome: "tie" as const,
    }));
    const flipped: Comparison[] = ties.map(() => ({ a: 2, b: 1, outcome: "tie" as const }));
    const wins: Comparison[] = Array.from({ length: 12 }, () => ({
      a: 1,
      b: 2,
      outcome: "a" as const,
    }));
    const tied = fitBradleyTerry(design, ties);
    const tiedOtherWay = fitBradleyTerry(design, flipped);
    const decisive = fitBradleyTerry(design, wins);

    expect(Math.abs(tied.strength[0] - tied.strength[1])).toBeLessThan(0.05);
    for (let i = 0; i < 2; i++) {
      expect(tied.strength[i]).toBeCloseTo(tiedOtherWay.strength[i], 5);
    }
    expect(Math.abs(decisive.strength[0] - decisive.strength[1])).toBeGreaterThan(
      Math.abs(tied.strength[0] - tied.strength[1]) + 0.3,
    );
  });

  it("ignores skips because they never become comparisons", () => {
    const history: Answer[] = [
      { a: 1, b: 2, outcome: "a", at: 1 },
      { a: 1, b: 3, outcome: "skip", at: 2 },
      { a: 2, b: 3, outcome: "tie", at: 3 },
      { a: 3, b: 1, outcome: "skip", at: 4 },
    ];
    expect(ratedComparisons(history)).toEqual([
      { a: 1, b: 2, outcome: "a" },
      { a: 2, b: 3, outcome: "tie" },
    ]);
  });

  it("learns trait weights and parks uncompared species on the trait prediction", () => {
    const fire = Array.from({ length: 8 }, (_, i) => mono(i + 1, "fire"));
    const water = Array.from({ length: 8 }, (_, i) => mono(i + 9, "water"));
    const heldFire = mono(100, "fire");
    const heldWater = mono(101, "water");
    const design = buildDesignMatrix([...fire, ...water, heldFire, heldWater], coreExtractors);
    const comparisons: Comparison[] = [];
    for (let k = 0; k < 48; k++) {
      comparisons.push({ a: (k % 8) + 1, b: (k % 8) + 9, outcome: "a" });
    }
    const fit = fitBradleyTerry(design, comparisons);
    const fireW = fit.weights[fit.featureNames.indexOf("type:fire")];
    const waterW = fit.weights[fit.featureNames.indexOf("type:water")];
    expect(fireW).toBeGreaterThan(waterW + 0.2);

    const heldFireRow = fit.ids.indexOf(100);
    const heldWaterRow = fit.ids.indexOf(101);
    expect(fit.strength[heldFireRow]).toBeGreaterThan(fit.strength[heldWaterRow] + 0.2);
    expect(Math.abs(fit.offset[heldFireRow])).toBeLessThan(0.05);
    expect(Math.abs(fit.offset[heldWaterRow])).toBeLessThan(0.05);
    expect(fit.strength[heldFireRow]).toBeCloseTo(
      fireW + fit.weights[fit.featureNames.indexOf("gen:1")],
      5,
    );
  });

  it("lets one upset lose to the trait prior", () => {
    const roster = [
      ...Array.from({ length: 6 }, (_, i) => mono(i + 1, "fire")),
      ...Array.from({ length: 6 }, (_, i) => mono(i + 7, "water")),
    ];
    const design = buildDesignMatrix(roster, coreExtractors);
    const comparisons: Comparison[] = [];
    for (let k = 0; k < 36; k++) {
      const fire = 2 + (k % 5);
      const water = 8 + (k % 5);
      comparisons.push({ a: fire, b: water, outcome: "a" });
    }
    comparisons.push({ a: 1, b: 7, outcome: "b" });
    const fit = fitBradleyTerry(design, comparisons);
    expect(fit.strength[fit.ids.indexOf(1)]).toBeGreaterThan(fit.strength[fit.ids.indexOf(7)]);
  });

  it("matches the prior variance when nobody has been compared", () => {
    const design = buildDesignMatrix([mono(1, "electric", 3)], coreExtractors);
    const fit = fitBradleyTerry(design, []);
    const prior = fit.sigmaB ** 2 + fit.sigmaW ** 2 * 2;
    expect(fit.strength[0]).toBeCloseTo(0, 8);
    expect(fit.sd[0] ** 2).toBeCloseTo(prior, 4);
    expect(fit.offset[0]).toBe(0);
  });

  it("warm-starts to the same ranking as a cold fit", () => {
    const design = buildDesignMatrix(
      [mono(1, "fire"), mono(2, "water"), mono(3, "grass", 2)],
      coreExtractors,
    );
    const comparisons: Comparison[] = [
      { a: 1, b: 2, outcome: "a" },
      { a: 2, b: 3, outcome: "tie" },
      { a: 3, b: 1, outcome: "b" },
      { a: 1, b: 2, outcome: "a" },
    ];
    const cold = fitBradleyTerry(design, comparisons);
    const warm = fitBradleyTerry(design, comparisons, {
      warm: { w: cold.weights.slice(), b: cold.offset.slice() },
    });
    for (let i = 0; i < cold.strength.length; i++) {
      expect(warm.strength[i]).toBeCloseTo(cold.strength[i], 4);
    }
    expect(warm.iterations).toBeLessThanOrEqual(cold.iterations);
  });

  it("raises confidence once the history carries real answers", () => {
    const design = buildDesignMatrix(
      [mono(1, "fire"), mono(2, "water"), mono(3, "grass")],
      coreExtractors,
    );
    const before = rankingSummary(fitBradleyTerry(design, []), design);
    const after = rankingSummary(
      fitBradleyTerry(
        design,
        Array.from({ length: 15 }, (_, i) => ({
          a: (i % 3) + 1,
          b: ((i + 1) % 3) + 1,
          outcome: "a" as const,
        })),
      ),
      design,
    );
    expect(before.confidence).toBeLessThan(0.05);
    expect(after.confidence).toBeGreaterThan(before.confidence);
    expect(after.matchups).toBe(15);
  });
});

describe("trait features", () => {
  it("adds a column when a new extractor is registered", () => {
    const beloved: TraitExtractor = {
      id: "beloved",
      extract: (pokemon): Record<string, number> => (pokemon.id === 1 ? { beloved: 1 } : {}),
    };
    const design = buildDesignMatrix([mono(1, "fire"), mono(2, "water")], [...coreExtractors, beloved]);
    expect(design.names).toContain("beloved");
    expect(design.values[design.names.indexOf("beloved")]).toBe(1);
    expect(design.values[design.cols + design.names.indexOf("beloved")]).toBe(0);
  });
});

describe("linear algebra and the sorting bound", () => {
  it("inverts a 2×2 SPD matrix", () => {
    const factor = invertSPD(new Float64Array([4, 1, 1, 3]), 2);
    expect(factor).not.toBeNull();
    const inv = factor!.inverse;
    // (1/11) * [3, -1, -1, 4]
    expect(inv[0]).toBeCloseTo(3 / 11, 8);
    expect(inv[1]).toBeCloseTo(-1 / 11, 8);
    expect(inv[2]).toBeCloseTo(-1 / 11, 8);
    expect(inv[3]).toBeCloseTo(4 / 11, 8);
  });

  it("puts log2(1025!) near 8,800 bits", () => {
    const bits = log2Factorial(1025);
    expect(bits).toBeGreaterThan(8700);
    expect(bits).toBeLessThan(8900);
  });
});
