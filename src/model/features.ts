/**
 * Trait features for the hierarchical Bradley–Terry model.
 *
 * Each extractor emits a sparse map of feature name → value. The design
 * matrix is the union of those names, so a new trait is a new extractor:
 * no other fitting code changes. Binary flags, one-hots, and real-valued
 * traits are all just columns.
 *
 * The app turns on `extendedExtractors` (types and generation, plus color,
 * shape, habitat, egg group, legendary / mythical / baby, evolution stage,
 * and starter). Tests can pass a smaller list.
 */

export type TraitSource = {
  id: number;
  types: readonly string[];
  generation: number;
  color?: string | null;
  shape?: string | null;
  habitat?: string | null;
  eggGroups?: readonly string[];
  isLegendary?: boolean;
  isMythical?: boolean;
  isBaby?: boolean;
  /** 1 = basic, 2 = middle, 3+ = further evolved. */
  evolutionStage?: number;
  isStarter?: boolean;
};

export type TraitExtractor = {
  id: string;
  extract(pokemon: TraitSource): Record<string, number>;
};

function flag(name: string, on: boolean | undefined): Record<string, number> {
  return on ? { [name]: 1 } : {};
}

function oneHot(prefix: string, value: string | null | undefined): Record<string, number> {
  if (!value) return {};
  return { [`${prefix}:${value}`]: 1 };
}

export const typeExtractor: TraitExtractor = {
  id: "type",
  extract: (p) => Object.fromEntries(p.types.map((t) => [`type:${t}`, 1])),
};

export const generationExtractor: TraitExtractor = {
  id: "generation",
  extract: (p) => ({ [`gen:${p.generation}`]: 1 }),
};

export const colorExtractor: TraitExtractor = {
  id: "color",
  extract: (p) => oneHot("color", p.color),
};

export const shapeExtractor: TraitExtractor = {
  id: "shape",
  extract: (p) => oneHot("shape", p.shape),
};

export const habitatExtractor: TraitExtractor = {
  id: "habitat",
  extract: (p) => oneHot("habitat", p.habitat),
};

export const eggGroupExtractor: TraitExtractor = {
  id: "egg",
  extract: (p) => Object.fromEntries((p.eggGroups ?? []).map((g) => [`egg:${g}`, 1])),
};

export const legendaryExtractor: TraitExtractor = {
  id: "legendary",
  extract: (p) => flag("legendary", p.isLegendary),
};

export const mythicalExtractor: TraitExtractor = {
  id: "mythical",
  extract: (p) => flag("mythical", p.isMythical),
};

export const babyExtractor: TraitExtractor = {
  id: "baby",
  extract: (p) => flag("baby", p.isBaby),
};

export const stageExtractor: TraitExtractor = {
  id: "stage",
  extract: (p) => (p.evolutionStage ? { [`stage:${p.evolutionStage}`]: 1 } : {}),
};

export const starterExtractor: TraitExtractor = {
  id: "starter",
  extract: (p) => flag("starter", p.isStarter),
};

/** The two traits the model is specified around. */
export const coreExtractors: TraitExtractor[] = [typeExtractor, generationExtractor];

/** Core traits plus the rest of the bundled PokéAPI fields. */
export const extendedExtractors: TraitExtractor[] = [
  ...coreExtractors,
  colorExtractor,
  shapeExtractor,
  habitatExtractor,
  eggGroupExtractor,
  legendaryExtractor,
  mythicalExtractor,
  babyExtractor,
  stageExtractor,
  starterExtractor,
];

export type DesignMatrix = {
  ids: number[];
  /** Column names, sorted for stability. */
  names: string[];
  /** Row-major N × F. Rows follow `ids`. */
  values: Float64Array;
  rows: number;
  cols: number;
};

export function buildDesignMatrix(
  pokemon: readonly TraitSource[],
  extractors: readonly TraitExtractor[],
): DesignMatrix {
  const sparse = pokemon.map((p) => {
    const acc: Record<string, number> = {};
    for (const extractor of extractors) {
      const part = extractor.extract(p);
      for (const [key, value] of Object.entries(part)) {
        if (value !== 0) acc[key] = (acc[key] ?? 0) + value;
      }
    }
    return acc;
  });

  const names = [...new Set(sparse.flatMap((row) => Object.keys(row)))].sort();
  const index = new Map(names.map((name, i) => [name, i]));
  const cols = names.length;
  const values = new Float64Array(pokemon.length * cols);
  sparse.forEach((row, r) => {
    const base = r * cols;
    for (const [key, value] of Object.entries(row)) {
      const c = index.get(key);
      if (c !== undefined) values[base + c] = value;
    }
  });

  return {
    ids: pokemon.map((p) => p.id),
    names,
    values,
    rows: pokemon.length,
    cols,
  };
}
