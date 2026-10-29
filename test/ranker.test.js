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

  it("puts the undone pair back on the duel instead of drawing a new one", () => {
    const roster = Array.from({ length: 8 }, (_, i) => mon(i + 1, "M" + i, i % 2 ? "fire" : "water"));
    let draws = 0;
    const rng = () => {
      draws += 1;
      return 0.5;
    };
    const ranker = createRanker(roster, { storage: null, explore: 0, rng, now: () => 1, mlp: false });
    const first = { a: ranker.getState().pair.a, b: ranker.getState().pair.b };
    ranker.answer("a");
    const second = { a: ranker.getState().pair.a, b: ranker.getState().pair.b };
    assert.ok(second.a !== first.a || second.b !== first.b);
    const drawsBeforeUndo = draws;
    ranker.undoLast();
    assert.equal(draws, drawsBeforeUndo);
    assert.deepEqual(
      { a: ranker.getState().pair.a, b: ranker.getState().pair.b },
      first,
    );
    assert.equal(ranker.getState().history.length, 0);
    ranker.answer("b");
    const afterRestored = { a: ranker.getState().pair.a, b: ranker.getState().pair.b };
    assert.ok(afterRestored.a !== first.a || afterRestored.b !== first.b);
    ranker.answer("skip");
    const skipped = ranker.getState().history.at(-1);
    assert.equal(skipped.outcome, "skip");
    const shownAfterSkip = { a: ranker.getState().pair.a, b: ranker.getState().pair.b };
    assert.ok(shownAfterSkip.a !== skipped.a || shownAfterSkip.b !== skipped.b);
    ranker.undoLast();
    assert.deepEqual(
      { a: ranker.getState().pair.a, b: ranker.getState().pair.b },
      { a: skipped.a, b: skipped.b },
    );
    ranker.undoLast();
    assert.deepEqual(
      { a: ranker.getState().pair.a, b: ranker.getState().pair.b },
      first,
    );
  });

  it("records a rankings move as one comparison per species the row passes", () => {
    const store = memory();
    const roster = [mon(1, "A", "fire"), mon(2, "B", "water"), mon(3, "C", "grass"), mon(4, "D", "electric")];
    const ranker = createRanker(roster, {
      storage: store,
      explore: 0,
      rng: () => 0.5,
      now: () => 10,
      mlp: false,
    });
    const before = ranker.getState().rows.map((row) => row.pokemon.id);
    assert.deepEqual(before, [1, 2, 3, 4]);
    ranker.movePast(4, [2, 3], "above");
    const history = ranker.getState().history;
    assert.deepEqual(
      history.map((entry) => [entry.a, entry.b, entry.outcome]),
      [[4, 2, "a"], [4, 3, "a"]],
    );
    const rankOf = (state, id) => state.rows.find((row) => row.pokemon.id === id).rank;
    assert.ok(rankOf(ranker.getState(), 4) < rankOf(ranker.getState(), 2));
    assert.ok(rankOf(ranker.getState(), 4) < rankOf(ranker.getState(), 3));
    const again = createRanker(roster, { storage: store, explore: 0, rng: () => 0.5, mlp: false });
    assert.ok(rankOf(again.getState(), 4) < rankOf(again.getState(), 2));
    assert.ok(rankOf(again.getState(), 4) < rankOf(again.getState(), 3));
    again.movePast(1, [4], "below");
    const last = again.getState().history.at(-1);
    assert.deepEqual([last.a, last.b, last.outcome], [1, 4, "b"]);
    assert.ok(rankOf(again.getState(), 4) < rankOf(again.getState(), 1));
  });

  it("repeats a move until a wide gap no longer snaps the row back", () => {
    const roster = [mon(1, "A", "fire"), mon(2, "B", "fire")];
    const history = [];
    for (let k = 0; k < 8; k++) history.push({ a: 1, b: 2, outcome: "a", at: k + 1 });
    const store = memory();
    store.raw = JSON.stringify(history);
    let clock = 100;
    const ranker = createRanker(roster, {
      storage: store,
      explore: 0,
      rng: () => 0.5,
      now: () => clock++,
      mlp: false,
    });
    const rankOf = (id) => ranker.getState().rows.find((row) => row.pokemon.id === id).rank;
    assert.ok(rankOf(1) < rankOf(2));
    ranker.movePast(2, [1], "above");
    assert.ok(rankOf(2) < rankOf(1));
    const added = ranker.getState().history.slice(8);
    assert.ok(added.length > 1);
    assert.ok(added.every((entry) => entry.a === 2 && entry.b === 1 && entry.outcome === "a"));
    const reloaded = createRanker(roster, { storage: store, explore: 0, rng: () => 0.5, mlp: false });
    const again = (id) => reloaded.getState().rows.find((row) => row.pokemon.id === id).rank;
    assert.ok(again(2) < again(1));
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
