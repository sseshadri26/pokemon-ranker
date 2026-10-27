const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const bundle = JSON.parse(fs.readFileSync(path.join(root, "data", "pokemon.json"), "utf8"));
const POKEDEX = bundle.pokemon;

function species(id) {
  const found = POKEDEX.find((pokemon) => pokemon.id === id);
  if (!found) throw new Error(`Missing #${id}`);
  return found;
}

describe("bundled National Dex", () => {
  it("lists every species once, in dex order", () => {
    assert.ok(POKEDEX.length >= 1025);
    const ids = POKEDEX.map((pokemon) => pokemon.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
    assert.equal(ids[0], 1);
    assert.equal(ids[ids.length - 1], POKEDEX.length);
    for (const pokemon of POKEDEX) {
      assert.ok(pokemon.name.length > 0);
      assert.ok(pokemon.types.length > 0);
      assert.ok(pokemon.types.length <= 2);
      assert.ok(pokemon.generation > 0);
      assert.ok(pokemon.forms.length > 0);
    }
  });

  it("keeps alternate forms on the species and marks starter lines", () => {
    const bulbasaur = species(1);
    assert.equal(bulbasaur.name, "Bulbasaur");
    assert.deepEqual(bulbasaur.types, ["grass", "poison"]);
    assert.equal(bulbasaur.generation, 1);
    assert.equal(bulbasaur.starter, true);
    assert.equal(bulbasaur.stage, 1);
    assert.equal(bulbasaur.color, "green");
    assert.ok(fs.existsSync(path.join(root, "artwork", bulbasaur.art)));

    assert.equal(species(2).stage, 2);
    const charizard = species(6);
    assert.equal(charizard.stage, 3);
    assert.equal(charizard.starter, true);
    assert.equal(charizard.forms.some((form) => form.kind === "mega"), true);
    assert.equal(charizard.forms.some((form) => form.kind === "gmax"), true);
    assert.ok(fs.existsSync(path.join(root, "artwork", charizard.art)));

    assert.equal(species(19).forms.some((form) => form.kind === "regional"), true);
    assert.equal(species(150).legendary, true);
    assert.equal(species(151).mythical, true);
    assert.equal(species(172).baby, true);
    assert.equal(species(172).stage, 1);
    assert.equal(species(133).starter, false);
  });

  it("ships the same dex as the script the page loads", () => {
    const script = fs.readFileSync(path.join(root, "data", "pokedex.js"), "utf8");
    assert.match(script, /^var POKEDEX_BUNDLE = /);
    const parsed = JSON.parse(script.replace(/^var POKEDEX_BUNDLE = /, "").replace(/;\s*$/, ""));
    assert.equal(parsed.count, bundle.count);
    assert.equal(parsed.pokemon.length, POKEDEX.length);
    assert.equal(parsed.pokemon[5].name, "Charizard");
  });
});
