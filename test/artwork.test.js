const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const { pokemon } = JSON.parse(fs.readFileSync(path.join(root, "data", "pokemon.json"), "utf8"));

describe("form artwork", () => {
  it("points every form at a file that exists", () => {
    const missing = [];
    for (const mon of pokemon) {
      for (const form of mon.forms || []) {
        if (form.art && !fs.existsSync(path.join(root, "artwork", form.art))) missing.push(form.name + " " + form.art);
      }
    }
    assert.deepEqual(missing, []);
  });

  it("uses full artwork, not 96px game sprites, for alternate forms", () => {
    const pixel = [];
    for (const mon of pokemon) for (const form of mon.forms || []) if (form.pixel) pixel.push(form.name);
    assert.deepEqual(pixel, []);
  });
});

describe("merged look-alike forms", () => {
  it("has no totem or look-alike forms, and saved votes still resolve to a species", () => {
    const names = [];
    for (const mon of pokemon) for (const form of mon.forms || []) names.push(form.name);
    assert.equal(names.some((n) => /totem/i.test(n)), false);
    for (const gone of ["Battle Bond Greninja", "Own Tempo Rockruff", "50% Zygarde", "Gigantamax Low Key Toxtricity",
      "Blue Meteor Minior", "Large Pumpkaboo", "Super Gourgeist"]) assert.equal(names.includes(gone), false, gone);
    assert.ok(names.includes("Alolan Marowak"));
    assert.ok(names.includes("Busted Mimikyu"));
    // Votes store species ids, not form ids, so a merged form cannot orphan a vote.
    const file = path.join(root, "favordex-history.json");
    if (fs.existsSync(file)) {
      const ids = new Set(pokemon.map((mon) => mon.id));
      const { createRanker } = require("../js/ranker.js");
      const ranker = createRanker(pokemon, { storage: null, mlp: false, explore: 0, rng: () => 0.5, maxIter: 2 });
      ranker.importText(fs.readFileSync(file, "utf8"), "replace");
      for (const entry of ranker.getState().history) assert.ok(ids.has(entry.a) && ids.has(entry.b));
    }
  });
});
