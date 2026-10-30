const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const G = require("../js/grids.js");
const Tabs = require("../js/tabs.js");

const box = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "data", "pokedex.js"), "utf8") + ";this.b=POKEDEX_BUNDLE;", box);
const dex = box.b.pokemon;
const byName = (name) => dex.find((p) => p.name === name);

describe("default form for a grid cell", () => {
  it("picks the form that fits the cell's traits", () => {
    const marowak = byName("Marowak");
    const form = G.cellForm(null, marowak, "type:fire", "type:ghost");
    assert.match(form.name, /Alola/i);
    const rotom = byName("Rotom");
    assert.match(G.cellForm(null, rotom, "type:water", "all").name, /Wash/i);
    assert.match(G.cellForm(null, rotom, "all", "type:fire").name, /Heat/i);
  });

  it("falls back to the main form when nothing fits better", () => {
    const marowak = byName("Marowak");
    assert.equal(G.cellForm(null, marowak, "all", "all").kind, "default");
    assert.equal(G.cellForm(null, marowak, "type:ground", "gen:1").kind, "default");
    const one = { id: 9, forms: [{ name: "Solo", kind: "default", types: ["fire"] }] };
    assert.equal(G.cellForm(null, one, "type:water", "all").name, "Solo");
  });

  it("does not choose mega or gmax forms for a type match", () => {
    const charizard = byName("Charizard");
    assert.equal(G.cellForm(null, charizard, "type:dragon", "all").kind, "default");
    assert.equal(G.cellForm(null, charizard, "flag:mega", "all").kind, "mega");
  });
});

describe("form picks", () => {
  it("an explicit pick wins, is per cell and per species, and survives save, load and grid files", () => {
    const marowak = byName("Marowak");
    const grid = G.makeGrid("Picks");
    grid.rows = ["type:fire"];
    grid.cols = ["type:ghost"];
    G.setPick(grid, "type:fire", "type:ghost", marowak.id, "Marowak");
    assert.equal(G.cellForm(grid, marowak, "type:fire", "type:ghost").name, "Marowak");
    assert.match(G.cellForm(grid, marowak, "type:fire", "all").name, /Alola/i);
    // A different species in the same cell gets its own default.
    const rotom = byName("Rotom");
    assert.equal(G.cellForm(grid, rotom, "type:fire", "type:ghost").kind, "default");

    const store = new Map();
    const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
    G.save(storage, [grid]);
    const back = G.load(storage)[0];
    assert.equal(G.cellForm(back, marowak, "type:fire", "type:ghost").name, "Marowak");

    const text = G.gridFileText(back);
    assert.ok(G.isGridFile(text));
    const imported = G.gridsFromExport(text);
    assert.equal(imported.length, 1);
    assert.equal(G.cellForm(imported[0], marowak, "type:fire", "type:ghost").name, "Marowak");
    const merged = G.mergeGrids([], imported);
    assert.equal(merged[0].picks["type:fire|type:ghost"][String(marowak.id)], "Marowak");

    G.setPick(back, "type:fire", "type:ghost", marowak.id, null);
    assert.match(G.cellForm(back, marowak, "type:fire", "type:ghost").name, /Alola/i);
  });

  it("drops malformed picks", () => {
    const [grid] = G.sanitize([{ id: "a", name: "x", rows: ["all"], cols: ["all"], picks: { "all|all": { "12": "Ok", bad: "x", "5": 7 }, junk: [] } }]);
    assert.deepEqual(grid.picks, { "all|all": { "12": "Ok" } });
  });
});

describe("tab memory", () => {
  it("the hash wins, then the saved tab, then Duel", () => {
    assert.equal(Tabs.initialView("#grids", "board"), "grids");
    assert.equal(Tabs.initialView("", "board"), "board");
    assert.equal(Tabs.initialView("#nope", "model"), "model");
    assert.equal(Tabs.initialView("#nope", "bogus"), "duel");
    assert.equal(Tabs.initialView("", null), "duel");
  });
  it("maps views and hashes both ways", () => {
    ["duel", "setup", "history", "board", "grids", "model"].forEach((view) => {
      assert.equal(Tabs.fromHash(Tabs.hashFor(view)), view);
    });
    assert.equal(Tabs.hashFor("board"), "#rankings");
    assert.equal(Tabs.fromHash("#choose"), "setup");
  });
});

describe("appending a grid file", () => {
  it("adds a new grid, and merges picks into an identical one", () => {
    const g = G.makeGrid("A");
    const file = G.makeGrid("B");
    G.setPick(file, "all", "all", 6, "Mega Charizard X");
    const added = G.mergeGrids([g], G.gridsFromExport(G.gridFileText(file)));
    assert.equal(added.length, 2);
    const twin = Object.assign({}, file, { picks: {} });
    const merged = G.mergeGrids([twin], G.gridsFromExport(G.gridFileText(file)));
    assert.equal(merged.length, 1);
    assert.equal(merged[0].picks["all|all"]["6"], "Mega Charizard X");
  });
});

describe("add a whole category to an axis", () => {
  const opts = G.traitOptions(dex);
  const types = G.categoryTraits(opts, opts.find((t) => t.id === "type:fire").group);
  const canon = ["normal", "fire", "water", "grass", "electric", "ice", "fighting", "poison", "ground",
    "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy"];
  it("lists all 18 types in the canonical in-game order", () => {
    assert.deepEqual(types, canon.map((t) => "type:" + t));
    const single = G.categoryTraits(opts, opts.find((t) => t.id === "only:fire").group);
    assert.deepEqual(single, canon.filter((t) => single.includes("only:" + t)).map((t) => "only:" + t));
    assert.equal(single[0], "only:normal");
  });
  it("orders generations, stages and games naturally", () => {
    const ids = (prefix) => opts.filter((t) => t.id.startsWith(prefix)).map((t) => t.id);
    assert.deepEqual(ids("gen:"), ["gen:1", "gen:2", "gen:3", "gen:4", "gen:5", "gen:6", "gen:7", "gen:8", "gen:9"]);
    assert.deepEqual(ids("stage:"), ["stage:1", "stage:2", "stage:3"]);
    const games = ids("game:");
    assert.equal(games[0], "game:red-blue");
    assert.equal(games[games.length - 1], "game:the-indigo-disk");
    assert.deepEqual(games, games.slice().sort((a, b) => G.GAME_ORDER.indexOf(a.slice(5)) - G.GAME_ORDER.indexOf(b.slice(5))));
  });
  it("replaces a lone All or a lone header", () => {
    assert.deepEqual(G.fillAxis(["all"], types), types);
    assert.deepEqual(G.fillAxis(["gen:1"], types), types);
  });
  it("otherwise appends and skips duplicates", () => {
    const out = G.fillAxis(["gen:1", "type:fire"], types);
    assert.equal(out.length, 19);
    assert.deepEqual(out.slice(0, 2), ["gen:1", "type:fire"]);
    assert.equal(out.filter((t) => t === "type:fire").length, 1);
  });
  it("an 18x18 grid of types computes quickly", () => {
    const rows = dex.map((pokemon, i) => ({ pokemon, rank: i + 1 }));
    const start = Date.now();
    types.forEach((r) => types.forEach((c) => G.cell(rows, r, c)));
    assert.ok(Date.now() - start < 1000);
  });
});

describe("grid-wide rules", () => {
  const ranked = dex.map((pokemon, i) => ({ pokemon, rank: i + 1 }));
  const base = (extra) => Object.assign(G.makeGrid("R"), extra);
  it("OR within a category, AND across categories, excludes always", () => {
    const rules = [
      { trait: "gen:4", mode: "include" },
      { trait: "gen:5", mode: "include" },
      { trait: "flag:legendary", mode: "exclude" },
      { trait: "type:dragon", mode: "exclude" },
      { trait: "flag:fully-evolved", mode: "include" },
    ];
    assert.equal(G.passesRules(byName("Garchomp"), rules), false); // dragon
    assert.equal(G.passesRules(byName("Infernape"), rules), true);
    assert.equal(G.passesRules(byName("Samurott"), rules), true);
    assert.equal(G.passesRules(byName("Chimchar"), rules), false); // not fully evolved
    assert.equal(G.passesRules(byName("Dialga"), rules), false); // legendary
    assert.equal(G.passesRules(byName("Charizard"), rules), false); // gen 1
    assert.equal(G.rulesText({ rules, unique: true }), "(gen:4 or gen:5) · flag:fully-evolved · not flag:legendary · not type:dragon · no duplicates");
  });
  it("every cell respects the rules", () => {
    const grid = base({ rows: ["type:fire", "type:water"], cols: ["all"], rules: [{ trait: "gen:4", mode: "include" }] });
    const cells = G.gridCells(grid, ranked);
    assert.equal(cells[0][0].best.pokemon.name, "Chimchar");
    assert.equal(cells[1][0].best.pokemon.name, "Piplup");
  });
  it("No duplicates gives each Pokémon one cell, ranked first", () => {
    const grid = base({ rows: ["type:fire", "gen:1"], cols: ["all"], unique: false });
    const dup = G.gridCells(grid, ranked);
    assert.equal(dup[0][0].best.pokemon.name, "Charmander");
    assert.equal(dup[1][0].best.pokemon.name, "Bulbasaur");
    const rows2 = [{ pokemon: byName("Charmander"), rank: 1 }, { pokemon: byName("Vulpix"), rank: 2 }, { pokemon: byName("Torchic"), rank: 3 }];
    const g2 = base({ rows: ["type:fire", "gen:1"], cols: ["all"], unique: true });
    const out = G.gridCells(g2, rows2);
    const names = out.map((line) => line[0].best && line[0].best.pokemon.name);
    assert.equal(new Set(names).size, 2);
    // Charmander (#1) fits both; Gen I has fewer candidates (2 vs 3), so it goes there and Vulpix (#2) takes Fire.
    assert.deepEqual(names, ["Vulpix", "Charmander"]);
  });
  it("rules persist, export, import and merge; old grids still load", () => {
    const grid = base({ rules: [{ trait: "gen:4", mode: "include" }, { trait: "type:dragon", mode: "exclude" }], unique: true });
    const back = G.gridsFromExport(G.gridFileText(grid))[0];
    assert.deepEqual(back.rules, grid.rules);
    assert.equal(back.unique, true);
    const [old] = G.sanitize([{ id: "o", name: "Old", rows: ["all"], cols: ["all"] }]);
    assert.deepEqual(old.rules, []);
    assert.equal(old.unique, false);
    const [bad] = G.sanitize([{ id: "b", name: "B", rows: ["all"], cols: ["all"], rules: [{ trait: "gen:4", mode: "weird" }, { trait: "gen:4" }, null, { trait: 5 }], unique: "yes" }]);
    assert.deepEqual(bad.rules, [{ trait: "gen:4", mode: "include" }]);
    assert.equal(bad.unique, false);
    const plain = Object.assign({}, grid, { id: grid.id, rules: [], unique: false });
    const merged = G.mergeGrids([plain], [grid]);
    assert.equal(merged.length, 2, "same layout with different rules is a different grid");
    assert.equal(G.mergeGrids(merged, [grid]).length, 2);
  });
});

describe("Mono type and Dual type", () => {
  const opts = G.traitOptions(dex);
  it("are offered as traits and the per-type list is labelled Mono type", () => {
    assert.ok(opts.some((t) => t.id === "count:1" && t.label === "Mono type"));
    assert.ok(opts.some((t) => t.id === "count:2" && t.label === "Dual type"));
    assert.equal(opts.find((t) => t.id === "only:fire").label, "Mono type: Fire");
  });
  it("match by type count, counting regional forms but not Mega or Gmax", () => {
    assert.equal(G.matches(byName("Charmander"), "count:1"), true);
    assert.equal(G.matches(byName("Charmander"), "count:2"), false);
    assert.equal(G.matches(byName("Bulbasaur"), "count:2"), true);
    assert.equal(G.matches(byName("Bulbasaur"), "count:1"), false);
    // Charizard is Fire/Flying; Mega X is Fire/Dragon, Gmax Fire/Flying: never mono.
    assert.equal(G.matches(byName("Charizard"), "count:1"), false);
    // Meowth is Normal; Alolan Meowth is Dark: mono either way. Marowak: Ground, Alolan Fire/Ghost: both.
    assert.equal(G.matches(byName("Marowak"), "count:1"), true);
    assert.equal(G.matches(byName("Marowak"), "count:2"), true);
    // Ampharos is Electric; only its Mega is Electric/Dragon, so it is not dual.
    assert.equal(G.matches(byName("Ampharos"), "count:2"), false);
  });
  it("work as headers and as grid rules, and pick a fitting form", () => {
    const ranked = dex.map((pokemon, i) => ({ pokemon, rank: i + 1 }));
    const grid = Object.assign(G.makeGrid("M"), { rows: ["type:fire"], cols: ["count:2"], rules: [{ trait: "count:1", mode: "exclude" }] });
    const best = G.gridCells(grid, ranked)[0][0].best.pokemon;
    assert.equal(best.types.length, 2);
    assert.equal(G.passesRules(byName("Charmander"), grid.rules), false);
    assert.match(G.cellForm(null, byName("Marowak"), "count:2", "all").name, /Alola/);
  });
});

describe("top-25 focus in the pair selector", () => {
  const F = require("../js/model.js");
  it("top probabilities are high above the cut, about half at it, low below", () => {
    const n = 60;
    const strength = Float64Array.from({ length: n }, (_, i) => i / 10);
    const model = { ids: Array.from({ length: n }, (_, i) => i + 1), strength, offsetVar: new Float64Array(n).fill(0.04) };
    const order = Array.from({ length: n }, (_, i) => i);
    const p = F.topProbabilities(model, order, 25);
    assert.ok(p[n - 1] > 0.99);
    assert.ok(p[0] < 0.01);
    assert.ok(Math.abs(p[n - 25] - 0.5) < 0.4 && p[n - 25] > 0.5 && p[n - 26] < 0.5);
  });
  it("weights pairs of likely top-25 species more, and boost 0 is the old selector", () => {
    assert.equal(F.topFocusMultiplier(1, 1, 1), 2);
    assert.equal(F.topFocusMultiplier(0, 0.9, 1), 1);
    assert.equal(F.topFocusMultiplier(0.9, 0.9, 0), 1);
  });
  it("still returns valid, non-repeated pairs with the focus on", () => {
    const n = 40;
    let seed = 3;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const model = { ids: Array.from({ length: n }, (_, i) => i + 1), strength: Float64Array.from({ length: n }, (_, i) => i / 8), offsetVar: new Float64Array(n).fill(0.5) };
    const pair = F.selectNextPair(model, { rng, explore: 0, topN: 10, recent: [40, 39] });
    assert.ok(pair && pair.a !== pair.b);
  });
});
