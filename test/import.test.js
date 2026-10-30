const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRanker, mergeHistory, readKey, STORAGE_KEY, RANKING_MODE_KEY } = require("../js/ranker.js");

function mon(id, name, type) {
  return { id, name, types: [type], generation: 1 };
}
function memory(raw) {
  return { raw: raw || null, load() { return this.raw; }, save(h) { this.raw = JSON.stringify(h); } };
}
const e = (a, b, outcome, at) => ({ a, b, outcome, at });

describe("history merge", () => {
  it("adds new entries, drops exact duplicates, and orders by time", () => {
    const current = [e(1, 2, "a", 10), e(2, 3, "tie", 30)];
    const incoming = [e(1, 2, "a", 10), e(1, 3, "b", 20), e(2, 3, "tie", 30), e(2, 3, "tie", 40)];
    assert.deepEqual(mergeHistory(current, incoming), [
      e(1, 2, "a", 10), e(1, 3, "b", 20), e(2, 3, "tie", 30), e(2, 3, "tie", 40),
    ]);
  });

  it("keeps same-pair answers that differ in outcome or time, and does not mutate inputs", () => {
    const current = [e(1, 2, "a", 10)];
    const incoming = [e(1, 2, "b", 10), e(1, 2, "a", 11)];
    const merged = mergeHistory(current, incoming);
    assert.equal(merged.length, 3);
    assert.equal(current.length, 1);
    assert.deepEqual(mergeHistory([], incoming), incoming);
    assert.deepEqual(mergeHistory(current, []), current);
  });

  it("imports with append or replace through the ranker", () => {
    const store = memory(JSON.stringify([e(1, 2, "a", 10)]));
    const ranker = createRanker([mon(1, "A", "fire"), mon(2, "B", "water"), mon(3, "C", "grass")],
      { storage: store, explore: 0, rng: () => 0.5, mlp: false });
    const file = JSON.stringify({ version: 1, history: [e(1, 2, "a", 10), e(2, 3, "b", 20)] });
    ranker.importText(file, "append");
    assert.equal(ranker.getState().history.length, 2);
    assert.match(ranker.getState().notice, /Added 1 of 2/);
    ranker.importText(file, "append");
    assert.equal(ranker.getState().history.length, 2);
    ranker.importText(JSON.stringify([e(3, 1, "tie", 5)]), "replace");
    assert.deepEqual(ranker.getState().history, [e(3, 1, "tie", 5)]);
    assert.deepEqual(JSON.parse(store.raw), [e(3, 1, "tie", 5)]);
    assert.throws(() => ranker.importText("nope", "append"));
    assert.equal(ranker.getState().history.length, 1);
  });

  it("still accepts the old Favordex export file", () => {
    const file = path.join(__dirname, "..", "favordex-history.json");
    if (!fs.existsSync(file)) return;
    const ranker = createRanker([mon(1, "A", "fire"), mon(2, "B", "water")], { storage: null, mlp: false, explore: 0, rng: () => 0.5 });
    const count = JSON.parse(fs.readFileSync(file, "utf8")).history.filter((e) => e.outcome !== "skip").length;
    ranker.importText(fs.readFileSync(file, "utf8"), "append");
    assert.equal(ranker.getState().history.length, count);
    assert.equal(ranker.getState().history.some((e) => e.outcome === "skip"), false);
  });

  it("drops skips from imports (append and replace) and from saved history", () => {
    const skipFile = JSON.stringify([e(1, 2, "a", 1), e(2, 3, "skip", 2), e(1, 3, "tie", 3)]);
    const store = memory(skipFile);
    const ranker = createRanker([mon(1, "A", "fire"), mon(2, "B", "water"), mon(3, "C", "grass")],
      { storage: store, explore: 0, rng: () => 0.5, mlp: false });
    assert.equal(ranker.getState().history.length, 2);
    assert.equal(store.raw.includes("skip"), false);
    ranker.importText(JSON.stringify([e(2, 3, "skip", 9), e(2, 3, "b", 10)]), "append");
    assert.deepEqual(ranker.getState().history.map((x) => x.outcome), ["a", "tie", "b"]);
    ranker.importText(skipFile, "replace");
    assert.deepEqual(ranker.getState().history.map((x) => x.outcome), ["a", "tie"]);
    assert.equal(ranker.exportText().includes("skip"), false);
  });
});

describe("storage rename", () => {
  function fake(entries) {
    const map = new Map(Object.entries(entries));
    return { getItem: (k) => (map.has(k) ? map.get(k) : null) };
  }
  it("reads old favordex keys only when the new key is absent", () => {
    assert.equal(STORAGE_KEY, "pokeranker.history.v1");
    assert.equal(readKey(fake({ "favordex.history.v1": "old" }), STORAGE_KEY), "old");
    assert.equal(readKey(fake({ "favordex.history.v1": "old", "pokeranker.history.v1": "new" }), STORAGE_KEY), "new");
    assert.equal(readKey(fake({ "favordex.ranking.v1": "bradley-terry" }), RANKING_MODE_KEY), "bradley-terry");
    assert.equal(readKey(fake({}), STORAGE_KEY), null);
  });
  it("shows PokéRanker (with the accent and a utf-8 charset) in the page and downloads pokeranker-history.json", () => {
    const root = path.join(__dirname, "..");
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const app = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
    assert.match(html, /<title>PokéRanker<\/title>/);
    assert.match(html, /<h1>PokéRanker<\/h1>/);
    assert.match(html, /<meta charset="utf-8">/i);
    assert.match(app, /"PokéRanker"/);
    assert.match(html, /id="import-append"/);
    assert.match(html, /id="import-replace"/);
    assert.match(app, /pokeranker-history\.json/);
    assert.equal(/favordex-history/.test(app), false);
  });
});
