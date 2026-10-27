import type { TraitSource } from "../model/features";
import type { Pokemon, PokemonBundle } from "./types";
import raw from "./pokemon.json";

export const bundle = raw as PokemonBundle;
export const POKEDEX: Pokemon[] = bundle.pokemon;

export function artUrl(file: string | null | undefined): string | null {
  if (!file) return null;
  return `/artwork/${file}`;
}

export function toTrait(pokemon: Pokemon): TraitSource {
  return {
    id: pokemon.id,
    types: pokemon.types,
    generation: pokemon.generation,
    color: pokemon.color,
    shape: pokemon.shape,
    habitat: pokemon.habitat,
    eggGroups: pokemon.eggGroups,
    isLegendary: pokemon.legendary,
    isMythical: pokemon.mythical,
    isBaby: pokemon.baby,
    evolutionStage: pokemon.stage,
    isStarter: pokemon.starter,
  };
}
