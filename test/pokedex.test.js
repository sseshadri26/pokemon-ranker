const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { toTrait, MODEL_CATEGORIES } = require("../js/ranker.js");
const F = require("../js/model.js");

const root = path.join(__dirname, "..");
const bundle = JSON.parse(fs.readFileSync(path.join(root, "data", "pokemon.json"), "utf8"));
const POKEDEX = bundle.pokemon;
const KIND_ORDER = { default: 0, mega: 1, gmax: 2, regional: 3, other: 4 };

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

  it("separates evolution stage from whether the species evolves", () => {
    assert.equal(typeof species(1).evolves, "boolean");
    assert.equal(species(1).evolves, true);
    assert.equal(species(1).stage, 1);
    assert.equal(species(21).evolves, true);
    assert.equal(species(22).name, "Fearow");
    assert.equal(species(22).evolves, false);
    assert.equal(species(22).stage, 2);
    assert.equal(species(2).name, "Ivysaur");
    assert.equal(species(2).evolves, true);
    assert.equal(species(2).stage, 2);
    assert.equal(species(6).evolves, false);
    assert.equal(species(6).stage, 3);
    assert.equal(species(128).name, "Tauros");
    assert.equal(species(128).evolves, false);
    assert.equal(species(128).stage, 1);
    assert.equal(species(132).name, "Ditto");
    assert.equal(species(132).evolves, false);
    assert.equal(species(172).stage, 1);

    function column(id) {
      const keys = Object.keys(F.stageExtractor.extract(toTrait(species(id))));
      assert.equal(keys.length, 1);
      return keys[0];
    }
    assert.equal(column(128), "stage:1-final");
    assert.equal(column(1), "stage:1-evolves");
    assert.equal(column(22), "stage:2-final");
    assert.equal(column(2), "stage:2-evolves");
    assert.equal(column(6), "stage:3-final");
    for (const pokemon of POKEDEX) {
      assert.equal(typeof pokemon.evolves, "boolean");
      const key = column(pokemon.id);
      assert.match(key, /^stage:\d+-(evolves|final)$/);
    }
    const stage = MODEL_CATEGORIES.find((category) => category.id === "stage");
    assert.match(stage.detail, /evolves/);
  });

  it("records the pre-evolution and the games each species appears in", () => {
    assert.equal(species(1).evolvesFrom, null);
    assert.equal(species(2).name, "Ivysaur");
    assert.equal(species(2).evolvesFrom, 1);
    assert.equal(species(3).evolvesFrom, 2);
    assert.equal(species(6).evolvesFrom, 5);
    assert.equal(species(133).evolvesFrom, null);
    assert.ok(species(134).evolvesFrom === 133);
    assert.equal(species(1000).name, "Gholdengo");
    assert.equal(species(1000).evolvesFrom, 999);

    for (const pokemon of POKEDEX) {
      assert.ok(Array.isArray(pokemon.games));
      assert.ok(pokemon.games.length > 0);
      if (pokemon.evolvesFrom != null) {
        assert.equal(typeof pokemon.evolvesFrom, "number");
        assert.ok(species(pokemon.evolvesFrom));
      }
    }

    assert.ok(species(1).games.includes("red-blue"));
    assert.ok(species(1).games.includes("the-isle-of-armor"));
    assert.equal(species(1).games.includes("scarlet-violet"), false);
    assert.ok(species(6).games.includes("sword-shield"));
    assert.ok(species(891).games.includes("the-isle-of-armor"));
    assert.ok(species(891).games.includes("sword-shield"));
    assert.deepEqual(species(1000).games, ["scarlet-violet"]);
    assert.ok(species(899).games.includes("legends-arceus"));
    assert.equal(species(1).games.includes("colosseum"), false);

    const games = F.gamesExtractor.extract(toTrait(species(1)));
    assert.equal(games["game:red-blue"], 1);
    assert.equal(games["game:colosseum"], undefined);
    const category = MODEL_CATEGORIES.find((item) => item.id === "games");
    assert.equal(category.prefix, "game:");
  });

  it("keeps Legends Z-A megas on the existing species", async () => {
    const { ZA_MEGAS } = await import("../scripts/za-megas.mjs");
    assert.equal(ZA_MEGAS.length, 48);
    assert.equal(POKEDEX.length, 1025);
    const megaForms = POKEDEX.flatMap((pokemon) => pokemon.forms.filter((form) => form.kind === "mega"));
    assert.equal(megaForms.length, 96);

    for (const entry of ZA_MEGAS) {
      const form = species(entry.dex).forms.find((item) => item.name === entry.name);
      assert.ok(form, entry.name);
      assert.equal(form.kind, "mega");
      assert.equal(form.pixel, false);
      assert.deepEqual(form.types, entry.types);
      if (form.art != null) {
        assert.equal(form.art, entry.file);
        assert.ok(fs.existsSync(path.join(root, "artwork", form.art)));
      }
    }

    const raichu = species(26);
    assert.ok(raichu.forms.some((form) => form.name === "Alolan Raichu"));
    assert.ok(raichu.forms.some((form) => form.name === "Mega Raichu X" && form.types.length === 1));
    assert.ok(raichu.forms.some((form) => form.name === "Mega Raichu Y"));
    const garchomp = species(445);
    assert.ok(garchomp.forms.some((form) => form.name === "Mega Garchomp"));
    assert.deepEqual(garchomp.forms.find((form) => form.name === "Mega Garchomp Z").types, ["dragon"]);
    assert.equal(species(978).forms.filter((form) => form.kind === "mega").length, 3);
    assert.equal(species(801).forms.filter((form) => form.kind === "mega").length, 2);
    assert.equal(species(6).forms.filter((form) => form.kind === "mega").length, 2);
    assert.equal(POKEDEX.some((pokemon) => pokemon.name.startsWith("Mega ")), false);

    for (const pokemon of POKEDEX) {
      const keys = pokemon.forms.map((form) => `${form.kind}|${form.name}`);
      const sorted = pokemon.forms
        .slice()
        .sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || a.name.localeCompare(b.name))
        .map((form) => `${form.kind}|${form.name}`);
      assert.deepEqual(keys, sorted);
    }
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
