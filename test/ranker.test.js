const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRanker, STORAGE_KEY, RANKING_MODE_KEY, MODEL_CATEGORIES } = require("../js/ranker.js");
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

  it("changes an older vote in place so the stored log and the fit use the new outcome", () => {
    const roster = [mon(1, "A", "fire"), mon(2, "B", "water"), mon(3, "C", "grass")];
    const store = memory();
    store.raw = JSON.stringify([
      { a: 1, b: 2, outcome: "a", at: 1 },
      { a: 2, b: 3, outcome: "skip", at: 2 },
      { a: 3, b: 1, outcome: "b", at: 3 },
    ]);
    const ranker = createRanker(roster, {
      storage: store,
      explore: 0,
      rng: () => 0.5,
      mlp: false,
      maxIter: 40,
    });
    const rankOf = (id) => ranker.getState().rows.find((row) => row.pokemon.id === id).rank;
    const gamesOf = (id) => ranker.getState().rows.find((row) => row.pokemon.id === id).games;
    assert.ok(rankOf(1) < rankOf(2));
    assert.equal(ranker.getState().summary.matchups, 2);
    assert.equal(gamesOf(3), 1);

    ranker.editOutcome(0, "b");
    const stored = JSON.parse(store.raw);
    assert.deepEqual(stored, [
      { a: 1, b: 2, outcome: "b", at: 1 },
      { a: 2, b: 3, outcome: "skip", at: 2 },
      { a: 3, b: 1, outcome: "b", at: 3 },
    ]);
    assert.deepEqual(ranker.getState().history, stored);
    assert.ok(rankOf(2) < rankOf(1));
    assert.equal(ranker.getState().summary.matchups, 2);
    const exported = F.parseHistory(ranker.exportText());
    assert.equal(exported[0].outcome, "b");
    assert.equal(exported[0].at, 1);
    assert.equal(exported[0].a, 1);
    assert.equal(exported[0].b, 2);
    assert.deepEqual(
      F.ratedComparisons(exported).map((entry) => [entry.a, entry.b, entry.outcome]),
      [[1, 2, "b"], [3, 1, "b"]],
    );

    assert.equal(gamesOf(2), 1);
    ranker.editOutcome(1, "tie");
    assert.equal(ranker.getState().history[1].outcome, "tie");
    assert.equal(ranker.getState().history[1].at, 2);
    assert.equal(ranker.getState().history[1].a, 2);
    assert.equal(ranker.getState().history[1].b, 3);
    assert.equal(ranker.getState().summary.matchups, 3);
    assert.equal(gamesOf(2), 2);
    assert.equal(F.ratedComparisons(F.parseHistory(ranker.exportText())).length, 3);

    ranker.editOutcome(0, "skip");
    ranker.editOutcome(0, "maybe");
    assert.equal(ranker.getState().history[0].outcome, "b");
    assert.equal(JSON.parse(store.raw)[0].outcome, "b");

    ranker.queuePair(1, 3);
    ranker.editOutcome(2, "tie");
    assert.deepEqual([ranker.getState().pair.a, ranker.getState().pair.b], [1, 3]);
    assert.equal(ranker.getState().history[2].at, 3);
    assert.equal(ranker.getState().history[2].outcome, "tie");
  });

  it("deletes a middle vote and leaves a pinned duel where it is", () => {
    const roster = [mon(1, "A", "fire"), mon(2, "B", "water"), mon(3, "C", "grass"), mon(4, "D", "electric")];
    const store = memory();
    store.raw = JSON.stringify([
      { a: 1, b: 2, outcome: "a", at: 1 },
      { a: 2, b: 3, outcome: "tie", at: 2 },
      { a: 3, b: 4, outcome: "b", at: 3 },
      { a: 4, b: 1, outcome: "a", at: 4 },
    ]);
    let draws = 0;
    const ranker = createRanker(roster, {
      storage: store,
      explore: 0,
      rng: () => {
        draws += 1;
        return 0.5;
      },
      mlp: false,
    });
    const shown = { a: ranker.getState().pair.a, b: ranker.getState().pair.b };
    const drawsAfterOpen = draws;
    ranker.deleteEntry(1);
    assert.equal(draws, drawsAfterOpen);
    assert.deepEqual(
      ranker.getState().history.map((entry) => [entry.a, entry.b, entry.outcome, entry.at]),
      [
        [1, 2, "a", 1],
        [3, 4, "b", 3],
        [4, 1, "a", 4],
      ],
    );
    assert.deepEqual(JSON.parse(store.raw).map((entry) => entry.at), [1, 3, 4]);
    assert.deepEqual({ a: ranker.getState().pair.a, b: ranker.getState().pair.b }, shown);
    assert.equal(ranker.getState().summary.matchups, 3);

    ranker.queuePair(2, 4);
    const pinned = { a: ranker.getState().pair.a, b: ranker.getState().pair.b };
    assert.deepEqual(pinned, { a: 2, b: 4 });
    const drawsAtPin = draws;
    ranker.deleteEntry(0);
    assert.equal(draws, drawsAtPin);
    assert.deepEqual(
      ranker.getState().history.map((entry) => [entry.a, entry.b, entry.at]),
      [
        [3, 4, 3],
        [4, 1, 4],
      ],
    );
    assert.deepEqual({ a: ranker.getState().pair.a, b: ranker.getState().pair.b }, pinned);
  });

  it("deletes the latest vote and puts that pair back on the duel", () => {
    const roster = Array.from({ length: 8 }, (_, i) => mon(i + 1, "M" + i, i % 2 ? "fire" : "water"));
    const seeded = [
      { a: 1, b: 2, outcome: "a", at: 11 },
      { a: 3, b: 4, outcome: "tie", at: 12 },
      { a: 5, b: 6, outcome: "b", at: 13 },
    ];
    const leftStore = memory();
    const rightStore = memory();
    leftStore.raw = JSON.stringify(seeded);
    rightStore.raw = JSON.stringify(seeded);
    let draws = 0;
    const options = {
      explore: 0,
      rng: () => {
        draws += 1;
        return 0.37;
      },
      mlp: false,
    };
    const ranker = createRanker(roster, { ...options, storage: leftStore });
    const undone = createRanker(roster, {
      ...options,
      storage: rightStore,
      rng: () => 0.37,
    });
    const latest = ranker.getState().history.at(-1);
    assert.deepEqual([latest.a, latest.b, latest.outcome], [5, 6, "b"]);
    const drawsBefore = draws;
    ranker.deleteEntry(ranker.getState().history.length - 1);
    undone.undoLast();
    assert.equal(draws, drawsBefore);
    assert.deepEqual(
      ranker.getState().history.map((entry) => [entry.a, entry.b, entry.outcome, entry.at]),
      [
        [1, 2, "a", 11],
        [3, 4, "tie", 12],
      ],
    );
    assert.deepEqual(JSON.parse(leftStore.raw).map((entry) => entry.at), [11, 12]);
    assert.deepEqual(
      { a: ranker.getState().pair.a, b: ranker.getState().pair.b },
      { a: latest.a, b: latest.b },
    );
    assert.deepEqual(ranker.getState().history, undone.getState().history);
    assert.deepEqual(
      [ranker.getState().pair.a, ranker.getState().pair.b],
      [undone.getState().pair.a, undone.getState().pair.b],
    );
  });
});

describe("Bradley–Terry ranking order", () => {
  it("follows the comparisons and ignores a trait the full model rewards", () => {
    assert.equal(RANKING_MODE_KEY, "pokeranker.ranking.v1");
    const history = Array.from({ length: 40 }, (_, i) => ({ a: 1, b: 2, outcome: "a", at: i + 1 }));
    const store = memory();
    store.raw = JSON.stringify(history);
    const ranker = createRanker(
      [mon(1, "A", "fire"), mon(2, "B", "water"), mon(3, "C", "fire")],
      { storage: store, extractors: [F.typeExtractor], mlp: false, explore: 0, rng: () => 0.5 },
    );
    function row(name) {
      return ranker.getState().rows.find((entry) => entry.pokemon.name === name);
    }
    const fullA = row("A");
    const fullB = row("B");
    const fullC = row("C");
    assert.ok(fullA.score > fullB.score);
    assert.ok(fullC.score > fullB.score);
    assert.ok(fullC.score > 0.2);
    const fullDetailA = ranker.speciesDetail(1);
    const fullDetailC = ranker.speciesDetail(3);
    assert.equal(fullDetailC.ranking, "full");
    assert.ok(fullDetailC.categories.some((category) => category.id === "type"));
    assert.ok(Math.abs(fullDetailA.linear + fullDetailA.ev + fullDetailA.offset - fullDetailA.strength) < 1e-6);

    const before = JSON.stringify(ranker.getState().history);
    const pair = { a: ranker.getState().pair.a, b: ranker.getState().pair.b };
    const saved = store.raw;
    ranker.setRankingMode("bradley-terry");
    ranker.setRankingMode("full");
    ranker.setRankingMode("bradley-terry");
    assert.equal(JSON.stringify(ranker.getState().history), before);
    assert.equal(ranker.getState().history.length, 40);
    assert.equal(store.raw, saved);
    assert.deepEqual({ a: ranker.getState().pair.a, b: ranker.getState().pair.b }, pair);

    const plainA = row("A");
    const plainB = row("B");
    const plainC = row("C");
    assert.ok(plainA.score > plainB.score);
    assert.ok(plainA.score > plainC.score);
    assert.ok(plainA.rank < plainC.rank);
    assert.ok(Math.abs(plainC.score) < 1e-8);
    assert.ok(Math.abs(plainC.sd - 1) < 1e-6);
    assert.ok(plainC.score < fullC.score - 0.2);

    const plainDetailA = ranker.speciesDetail(1);
    const plainDetailC = ranker.speciesDetail(3);
    assert.equal(plainDetailA.ranking, "bradley-terry");
    assert.equal(plainDetailC.categories.length, 0);
    assert.equal(plainDetailC.record.wins, 0);
    assert.equal(plainDetailA.record.wins, 40);
    assert.ok(Math.abs(plainDetailC.strength) < 1e-8);
    assert.ok(Math.abs(plainDetailC.offset - plainDetailC.strength) < 1e-9);
    assert.ok(Math.abs(plainDetailC.sd - 1) < 1e-6);
    assert.ok(Math.abs(plainDetailA.strength - fullDetailA.offset) > 0.05);
    assert.ok(Math.abs(plainDetailA.strength - plainDetailA.offset) < 1e-9);

    ranker.setRankingMode("full");
    assert.equal(ranker.getState().history.length, 40);
    assert.equal(store.raw, saved);
    assert.ok(Math.abs(row("C").score - fullC.score) < 1e-9);
    const restored = ranker.speciesDetail(3);
    assert.equal(restored.ranking, "full");
    assert.ok(restored.categories.some((category) => category.id === "type"));
    assert.ok(Math.abs(restored.linear + restored.ev + restored.offset - restored.strength) < 1e-6);
  });
});

describe("page files", () => {
  it("loads with relative scripts and artwork, and keeps the storage key", () => {
    const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
    assert.match(html, /src="data\/pokedex\.js"/);
    assert.match(html, /src="js\/model\.js"/);
    assert.match(html, /src="js\/app\.js"/);
    assert.match(html, /id="view-model"/);
    assert.match(html, /id="rank-full"/);
    assert.match(html, />Full model</);
    assert.match(html, /id="rank-bt"/);
    assert.match(html, />Bradley–Terry</);
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
    assert.match(app, /getElementById\("rank-full"\)/);
    assert.match(app, /getElementById\("rank-bt"\)/);
    assert.match(app, /setRankingMode/);
    assert.match(app, /species-plain/);
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
    assert.equal(STORAGE_KEY, "pokeranker.history.v1");
  });
});
