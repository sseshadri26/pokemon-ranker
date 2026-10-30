const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const G = require("../js/grids.js");
const { createRanker } = require("../js/ranker.js");

function mon(id, name, types, extra) {
  return Object.assign({ id, name, types, generation: 1, forms: [{ name, types, kind: "default" }] }, extra || {});
}
const rows = [
  { pokemon: mon(1, "Ember", ["fire"], { color: "red", generation: 1 }), rank: 1 },
  { pokemon: mon(2, "Puddle", ["water"], { color: "blue", generation: 2 }), rank: 2 },
  { pokemon: mon(3, "Steam", ["fire", "water"], { color: "white", generation: 2 }), rank: 3 },
  {
    pokemon: mon(4, "Bone", ["ground"], {
      color: "brown",
      forms: [
        { name: "Bone", types: ["ground"], kind: "default" },
        { name: "Alolan Bone", types: ["fire", "ghost"], kind: "regional" },
        { name: "Mega Bone", types: ["dragon"], kind: "mega" },
      ],
    }),
    rank: 4,
  },
];

describe("grid cells", () => {
  it("uses both filters, one filter with All, and the overall #1 with All twice", () => {
    assert.equal(G.cell(rows, "type:water", "gen:2").best.pokemon.name, "Puddle");
    assert.equal(G.cell(rows, "type:fire", "type:water").best.pokemon.name, "Steam");
    assert.equal(G.cell(rows, "all", "color:blue").best.pokemon.name, "Puddle");
    assert.equal(G.cell(rows, "type:water", "all").best.pokemon.name, "Puddle");
    const top = G.cell(rows, "all", "all");
    assert.equal(top.best.pokemon.name, "Ember");
    assert.equal(top.count, 4);
    assert.equal(top.next.pokemon.name, "Puddle");
  });

  it("leaves a cell empty when nothing matches", () => {
    const none = G.cell(rows, "type:water", "color:red");
    assert.equal(none.best, null);
    assert.equal(none.count, 0);
  });

  it("counts regional and alternate form types, not Mega or Gigantamax ones", () => {
    assert.equal(G.cell(rows, "type:ghost", "all").best.pokemon.name, "Bone");
    assert.equal(G.cell(rows, "type:dragon", "all").best, null);
    assert.ok(G.matches(rows[3].pokemon, "flag:regional"));
    assert.ok(G.matches(rows[3].pokemon, "flag:mega"));
    assert.ok(G.matches(rows[0].pokemon, "only:fire"));
    assert.ok(!G.matches(rows[2].pokemon, "only:fire"));
  });

  it("offers every trait in the shipped data and each one matches someone", () => {
    const { pokemon } = require("../data/pokemon.json");
    const options = G.traitOptions(pokemon);
    assert.equal(options[0].id, "all");
    for (const prefix of ["type:", "only:", "gen:", "color:", "shape:", "habitat:", "egg:", "stage:", "game:", "flag:legendary", "flag:regional"]) {
      assert.ok(options.some((o) => o.id.startsWith(prefix)), prefix);
    }
    for (const o of options) assert.ok(pokemon.some((p) => G.matches(p, o.id)), o.id);
  });

  it("follows the ranking order the Rankings tab is showing", () => {
    const roster = [mon(1, "A", ["fire"]), mon(2, "B", ["fire"]), mon(3, "C", ["water"])];
    const history = Array.from({ length: 30 }, (_, i) => ({ a: 2, b: 1, outcome: "a", at: i + 1 }));
    const ranker = createRanker(roster, {
      storage: { load: () => JSON.stringify(history), save() {} },
      mlp: false, explore: 0, rng: () => 0.5,
    });
    assert.equal(G.cell(ranker.getState().rows, "type:fire", "all").best.pokemon.name, "B");
    ranker.setRankingMode("bradley-terry");
    assert.equal(G.cell(ranker.getState().rows, "type:fire", "all").best.pokemon.name, "B");
  });
});

describe("grid storage and import", () => {
  function store() {
    const map = new Map();
    return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v), map };
  }

  it("round-trips grids through localStorage under a pokeranker key", () => {
    const s = store();
    const grid = G.makeGrid("Types by gen");
    grid.rows = ["type:fire", "all"];
    grid.cols = ["gen:1", "gen:2"];
    G.save(s, [grid]);
    assert.equal(G.STORAGE_KEY, "pokeranker.grids.v1");
    assert.deepEqual(G.load(s), [grid]);
    s.setItem(G.STORAGE_KEY, "not json");
    assert.deepEqual(G.load(s), []);
  });

  it("appends imported grids without exact duplicates, and old exports have none", () => {
    const a = { id: "x", name: "A", rows: ["all"], cols: ["type:fire"] };
    const b = { id: "x", name: "B", rows: ["gen:1"], cols: ["all"] };
    const merged = G.mergeGrids([a], [a, b]);
    assert.equal(merged.length, 2);
    assert.notEqual(merged[1].id, "x");
    assert.deepEqual(G.gridsFromExport(JSON.stringify({ version: 1, history: [], grids: [b] }))[0].rows, ["gen:1"]);
    assert.equal(G.gridsFromExport(JSON.stringify({ version: 1, history: [] })), null);
    assert.equal(G.gridsFromExport("[]"), null);
    const old = path.join(__dirname, "..", "favordex-history.json");
    if (fs.existsSync(old)) assert.equal(G.gridsFromExport(fs.readFileSync(old, "utf8")), null);
    assert.deepEqual(G.sanitize([{ name: "", rows: [5], cols: "nope" }])[0].rows, ["all"]);
  });

  it("lets the history importer read an export that carries grids", () => {
    const ranker = createRanker([mon(1, "A", ["fire"]), mon(2, "B", ["water"])], { storage: null, mlp: false, explore: 0, rng: () => 0.5 });
    ranker.importText(JSON.stringify({ version: 1, history: [{ a: 1, b: 2, outcome: "a", at: 1 }], grids: [G.makeGrid("g")] }), "replace");
    assert.equal(ranker.getState().history.length, 1);
  });
});
