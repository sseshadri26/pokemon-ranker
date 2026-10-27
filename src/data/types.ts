export type FormKind = "default" | "mega" | "gmax" | "regional" | "other";

export type PokemonForm = {
  name: string;
  art: string | null;
  types: string[];
  kind: FormKind;
  pixel: boolean;
};

/** One ranked National Dex species, plus every alternate form to look at. */
export type Pokemon = {
  id: number;
  name: string;
  generation: number;
  types: string[];
  color: string | null;
  shape: string | null;
  habitat: string | null;
  eggGroups: string[];
  legendary: boolean;
  mythical: boolean;
  baby: boolean;
  stage: number;
  starter: boolean;
  art: string | null;
  forms: PokemonForm[];
};

export type PokemonBundle = {
  generatedAt: string;
  source: string;
  count: number;
  pokemon: Pokemon[];
};
