const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRanker, STORAGE_KEY, MODEL_CATEGORIES } = require("../js/ranker.js");
const F = require("../js/model.js");

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

  it("shows a chosen pair until that matchup is answered", () => {
    const ranker = createRanker(
      [mon(1, "A", "fire"), mon(2, "B", "water"), mon(3, "C", "grass")],
      { storage: null, explore: 0, rng: () => 0.5, now: () => 1 },
    );
    ranker.queuePair(1, 3);
    assert.deepEqual([ranker.getState().pair.a, ranker.getState().pair.b], [1, 3]);
    ranker.answer("tie");
    const answered = ranker.getState().history.at(-1);
    assert.equal(answered.a, 1);
    assert.equal(answered.b, 3);
    assert.equal(answered.outcome, "tie");
    ranker.queuePair(2, 3);
    assert.deepEqual([ranker.getState().pair.a, ranker.getState().pair.b], [2, 3]);
  });

  it("lists every trait category and the weight learned for each column", () => {
    const store = memory();
    const ranker = createRanker(
      [mon(1, "A", "fire"), mon(2, "B", "water"), mon(3, "C", "grass")],
      { storage: store, explore: 0, rng: () => 0.5, now: () => 1 },
    );
    const model = ranker.getState().model;
    assert.equal(model.family, "Hierarchical Bradley–Terry with a two-layer network");
    assert.equal(model.strength, "s = x·w + EV(x) + b");
    assert.deepEqual(model.network.hidden, [8, 4]);
    assert.equal(model.network.inputCount, model.columns);
    assert.equal(model.sigmaW, 0.7);
    assert.equal(model.sigmaB, 1);
    assert.equal(model.comparisons, 0);
    assert.equal(model.converged, true);
    assert.deepEqual(
      model.categories.map((category) => category.id),
      F.extendedExtractors.map((extractor) => extractor.id),
    );
    assert.deepEqual(
      model.categories.map((category) => category.id),
      MODEL_CATEGORIES.map((category) => category.id),
    );
    const listed = model.categories.reduce((sum, category) => sum + category.weights.length, 0);
    assert.equal(listed, model.columns);
    const type = model.categories.find((category) => category.id === "type");
    assert.deepEqual(
      type.weights.map((row) => row.key).sort(),
      ["type:fire", "type:grass", "type:water"],
    );
    assert.ok(type.weights.every((row) => Number.isFinite(row.weight) && Number.isFinite(row.sd)));
    assert.equal(model.categories.find((category) => category.id === "legendary").weights.length, 0);
  });

  it("moves the type weight when one type keeps winning", () => {
    const roster = [
      ...Array.from({ length: 6 }, (_, i) => mon(i + 1, "F" + i, "fire")),
      ...Array.from({ length: 6 }, (_, i) => mon(i + 7, "W" + i, "water")),
    ];
    const history = [];
    for (let k = 0; k < 24; k++) {
      history.push({ a: (k % 6) + 1, b: (k % 6) + 7, outcome: "a", at: k + 1 });
    }
    const store = memory();
    store.raw = JSON.stringify(history);
    const ranker = createRanker(roster, { storage: store, explore: 0, rng: () => 0.5 });
    const type = ranker.getState().model.categories.find((category) => category.id === "type");
    const fire = type.weights.find((row) => row.key === "type:fire");
    const water = type.weights.find((row) => row.key === "type:water");
    assert.ok(fire.weight > water.weight + 0.15);
    assert.equal(ranker.getState().model.comparisons, 24);
    assert.ok(fire.sd < 0.7);
  });
});

describe("page files", () => {
  it("loads with relative scripts and artwork, and keeps the storage key", () => {
    const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
    assert.match(html, /src="data\/pokedex\.js"/);
    assert.match(html, /src="js\/model\.js"/);
    assert.match(html, /src="js\/app\.js"/);
    assert.match(html, /id="view-model"/);
    assert.match(html, /id="model"/);
    assert.match(html, /id="model-network"/);
    assert.match(html, /Hierarchical Bradley–Terry/);
    const nav = html.slice(html.indexOf("<nav>"), html.indexOf("</nav>"));
    assert.match(nav, /id="data-menu"/);
    assert.match(nav, />Data</);
    assert.equal(nav.includes('id="export"'), false);
    assert.equal(nav.includes('id="import"'), false);
    assert.equal(nav.includes('id="reset"'), false);
    const panel = html.slice(html.indexOf('id="data-panel"'), html.indexOf('id="modal"'));
    assert.match(panel, /id="export"/);
    assert.match(panel, /id="import"/);
    assert.match(panel, /id="reset"/);
    assert.match(panel, /id="data-close"/);
    assert.match(panel, /id="import-file"/);
    const desk = html.slice(html.indexOf('class="desk-bar"'), html.indexOf('class="device"'));
    assert.match(desk, /id="dex-theme"/);
    assert.equal(desk.includes("data-menu"), false);
    const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
    assert.match(css, /body:not\(\.view-duel\)/);
    assert.match(css, /body\.view-duel[\s\S]*overflow:\s*hidden/);
    assert.match(css, /\.data-panel\s*\{[^}]*position:\s*fixed/);
    assert.match(html, /href="favicon\.svg"/);
    assert.equal(html.includes("/src/"), false);
    assert.equal(html.includes("type=\"module\""), false);
    const app = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
    assert.match(app, /getElementById\("data-menu"\)/);
    assert.match(app, /getElementById\("data-panel"\)/);
    assert.match(app, /getElementById\("data-close"\)/);
    assert.match(app, /getElementById\("export"\)/);
    assert.match(app, /getElementById\("import"\)/);
    assert.match(app, /getElementById\("reset"\)/);
    assert.match(app, /network\.layers/);
    assert.equal(app.includes("network.units"), false);
    assert.match(app, /return "artwork\/" \+ file/);
    assert.equal(app.includes('"/artwork/'), false);
    assert.equal(STORAGE_KEY, "favordex.history.v1");
  });
});
