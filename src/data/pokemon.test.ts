import { describe, expect, it } from "vitest";
import { POKEDEX } from "./pokedex";

function species(id: number) {
  const found = POKEDEX.find((pokemon) => pokemon.id === id);
  if (!found) throw new Error(`Missing #${id}`);
  return found;
}

describe("bundled National Dex", () => {
  it("lists every species once, in dex order", () => {
    expect(POKEDEX.length).toBeGreaterThanOrEqual(1025);
    const ids = POKEDEX.map((pokemon) => pokemon.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(ids[0]).toBe(1);
    expect(ids[ids.length - 1]).toBe(POKEDEX.length);
    for (const pokemon of POKEDEX) {
      expect(pokemon.name.length).toBeGreaterThan(0);
      expect(pokemon.types.length).toBeGreaterThan(0);
      expect(pokemon.types.length).toBeLessThanOrEqual(2);
      expect(pokemon.generation).toBeGreaterThan(0);
      expect(pokemon.forms.length).toBeGreaterThan(0);
    }
  });

  it("keeps alternate forms on the species and marks starter lines", () => {
    const bulbasaur = species(1);
    expect(bulbasaur.name).toBe("Bulbasaur");
    expect(bulbasaur.types).toEqual(["grass", "poison"]);
    expect(bulbasaur.generation).toBe(1);
    expect(bulbasaur.starter).toBe(true);
    expect(bulbasaur.stage).toBe(1);
    expect(bulbasaur.color).toBe("green");

    expect(species(2).stage).toBe(2);
    const charizard = species(6);
    expect(charizard.stage).toBe(3);
    expect(charizard.starter).toBe(true);
    expect(charizard.forms.some((form) => form.kind === "mega")).toBe(true);
    expect(charizard.forms.some((form) => form.kind === "gmax")).toBe(true);

    expect(species(19).forms.some((form) => form.kind === "regional")).toBe(true);
    expect(species(150).legendary).toBe(true);
    expect(species(151).mythical).toBe(true);
    expect(species(172).baby).toBe(true);
    expect(species(172).stage).toBe(1);
    expect(species(133).starter).toBe(false);
  });
});
