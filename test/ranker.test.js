const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRanker, STORAGE_KEY } = require("../js/ranker.js");

function mon(id, name, type) {
  return {
    id,
    name,
    types: [type],
    generation: 1,
    color: null,
    shape: null,
    habitat: null,
    eggGroups: [],
    legendary: false,
    mythical: false,
    baby: false,
    stage: 1,
    starter: false,
    art: null,
    forms: [{ name, art: null, types: [type], kind: "default", pixel: false }],
  };
}

function memory() {
  return {
    raw: null,
    load() { return this.raw; },
    save(history) { this.raw = JSON.stringify(history); },
  };
}

describe("ranker session", () => {
  it("counts picks and ties, ignores skips, and undoes one answer at a time", () => {
    const store = memory();
    let clock = 1000;
    const ranker = createRanker(
      [mon(1, "A", "fire"), mon(2, "B", "water"), mon(3, "C", "grass")],
      { storage: store, explore: 0, rng: () => 0.5, now: () => clock++ },
    );
    assert.equal(ranker.getState().summary.matchups, 0);
    ranker.answer("a");
    assert.equal(ranker.getState().summary.matchups, 1);
    ranker.answer("b");
    ranker.answer("tie");
    assert.equal(ranker.getState().summary.matchups, 3);
    ranker.answer("skip");
    assert.equal(ranker.getState().summary.matchups, 3);
    ranker.undoLast();
    assert.equal(ranker.getState().summary.matchups, 3);
    ranker.undoLast();
    assert.equal(ranker.getState().summary.matchups, 2);
    assert.equal(store.raw.includes('"skip"'), false);
    assert.equal(JSON.parse(store.raw).length, 2);
  });

  it("round-trips the saved log through a new session", () => {
    const store = memory();
    const first = createRanker(
      [mon(1, "A", "fire"), mon(2, "B", "water")],
      { storage: store, explore: 0, rng: () => 0.2, now: () => 5 },
    );
    first.answer("a");
    const second = createRanker(
      [mon(1, "A", "fire"), mon(2, "B", "water")],
      { storage: store, explore: 0, rng: () => 0.2 },
    );
    assert.equal(second.getState().summary.matchups, 1);
    assert.equal(second.exportText().includes('"version": 1'), true);
    second.reset();
    assert.equal(second.getState().summary.matchups, 0);
    assert.equal(store.raw, "[]");
  });
});

describe("page files", () => {
  it("loads with relative scripts and artwork, and keeps the storage key", () => {
    const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
    assert.match(html, /src="data\/pokedex\.js"/);
    assert.match(html, /src="js\/model\.js"/);
    assert.match(html, /src="js\/app\.js"/);
    assert.match(html, /href="favicon\.svg"/);
    assert.equal(html.includes("/src/"), false);
    assert.equal(html.includes("type=\"module\""), false);
    const app = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
    assert.match(app, /return "artwork\/" \+ file/);
    assert.equal(app.includes('"/artwork/'), false);
    assert.equal(STORAGE_KEY, "favordex.history.v1");
  });
});
