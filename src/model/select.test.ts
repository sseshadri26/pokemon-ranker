import { describe, expect, it } from "vitest";
import { buildDesignMatrix, coreExtractors, type TraitSource } from "./features";
import { fitBradleyTerry, type Comparison } from "./fit";
import { mulberry32, sigmoid } from "./math";
import { selectNextPair, type PairModel } from "./select";

function kendallTau(estimate: ArrayLike<number>, truth: ArrayLike<number>): number {
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
    const model: PairModel = {
      ids: [1, 2, 3, 4],
      strength: [0, 0.05, -0.05, 5],
      offsetVar: [3, 3, 3, 0.01],
    };
    const picked = selectNextPair(model, {
      explore: 0,
      topK: 1,
      rng: mulberry32(1),
    });
    expect(picked).not.toBeNull();
    expect([picked!.a, picked!.b].includes(4)).toBe(false);
  });

  it("can avoid repeating the pair just answered", () => {
    const model: PairModel = {
      ids: [1, 2, 3],
      strength: [0, 0, 0],
      offsetVar: [1, 1, 1],
    };
    const first = selectNextPair(model, { explore: 0, topK: 1, rng: mulberry32(2) });
    const second = selectNextPair(model, {
      explore: 0,
      topK: 1,
      avoid: [first!.a, first!.b],
      rng: mulberry32(2),
    });
    expect(new Set([second!.a, second!.b])).not.toEqual(new Set([first!.a, first!.b]));
  });

  it("explores toward species that have not been shown", () => {
    const model: PairModel = {
      ids: [10, 20, 30, 40],
      strength: [0, 0, 0, 0],
      offsetVar: [1, 1, 1, 1],
    };
    const picked = selectNextPair(model, {
      explore: 1,
      games: [9, 9, 0, 9],
      rng: mulberry32(3),
    });
    expect([picked!.a, picked!.b]).toContain(30);
  });

  it("selects the next pair for a full National Dex in under 100ms", () => {
    const n = 1025;
    const rng = mulberry32(4);
    const pokemon: TraitSource[] = Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      types: [i % 3 === 0 ? "fire" : i % 3 === 1 ? "water" : "grass", ...(i % 5 === 0 ? ["flying"] : [])],
      generation: (i % 9) + 1,
    }));
    const design = buildDesignMatrix(pokemon, coreExtractors);
    const fit = fitBradleyTerry(design, []);
    const model: PairModel = {
      ids: fit.ids,
      strength: fit.strength,
      offsetVar: fit.offsetVar,
      traitCoords: fit.traitCoords,
    };
    selectNextPair(model, { rng: mulberry32(5), explore: 0.12 });
    const start = performance.now();
    const picked = selectNextPair(model, { rng, explore: 0.12 });
    const elapsed = performance.now() - start;
    expect(picked).not.toBeNull();
    expect(elapsed).toBeLessThan(100);
  });

  it("recovers a hidden ranking faster with active pairs than with random pairs", () => {
    const n = 24;
    const rounds = 140;
    const seeds = [11, 22, 33, 44, 55, 66, 77, 88];
    const activeScores: number[] = [];
    const randomScores: number[] = [];

    for (const seed of seeds) {
      const world = mulberry32(seed);
      const pokemon: TraitSource[] = Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        types: [world() < 0.5 ? "dragon" : "bug"],
        generation: 1 + Math.floor(world() * 4),
      }));
      const truth = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * 0.45);
      const design = buildDesignMatrix(pokemon, coreExtractors);
      activeScores.push(run(design, truth, rounds, "active", seed));
      randomScores.push(run(design, truth, rounds, "random", seed));
    }

    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const active = mean(activeScores);
    const random = mean(randomScores);
    expect(active).toBeGreaterThan(random + 0.04);
  });
});

function run(
  design: ReturnType<typeof buildDesignMatrix>,
  truth: number[],
  rounds: number,
  mode: "active" | "random",
  seed: number,
): number {
  const rng = mulberry32(seed + (mode === "active" ? 1000 : 2000));
  const comparisons: Comparison[] = [];
  let fit = fitBradleyTerry(design, comparisons);
  for (let t = 0; t < rounds; t++) {
    const pair =
      mode === "active"
        ? selectNextPair(
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
    const p = sigmoid((truth[ai] - truth[bi]) / 0.7);
    const outcome = rng() < p ? "a" : "b";
    comparisons.push({ a: pair.a, b: pair.b, outcome });
    fit = fitBradleyTerry(design, comparisons, {
      warm: { w: fit.weights, b: fit.offset },
      maxIter: 12,
    });
  }
  return kendallTau(fit.strength, truth);
}

function randomPair(ids: readonly number[], rng: () => number): { a: number; b: number } {
  const i = Math.floor(rng() * ids.length);
  let j = Math.floor(rng() * (ids.length - 1));
  if (j >= i) j += 1;
  return { a: ids[i], b: ids[j] };
}
