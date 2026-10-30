/* PokeRanker tab memory: which top-level view to open. Classic script: globalThis.PokeRankerTabs. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  root.PokeRankerTabs = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var STORAGE_KEY = "pokeranker.tab";
  var DEFAULT_VIEW = "duel";
  // URL hash name -> internal view name.
  var HASH_TO_VIEW = { duel: "duel", choose: "setup", history: "history", rankings: "board", grids: "grids", model: "model" };
  var VIEW_TO_HASH = {};
  Object.keys(HASH_TO_VIEW).forEach(function (hash) { VIEW_TO_HASH[HASH_TO_VIEW[hash]] = hash; });

  function fromHash(hash) {
    var name = String(hash || "").replace(/^#/, "").toLowerCase();
    return Object.prototype.hasOwnProperty.call(HASH_TO_VIEW, name) ? HASH_TO_VIEW[name] : null;
  }

  function fromSaved(saved) {
    return Object.prototype.hasOwnProperty.call(VIEW_TO_HASH, saved) ? saved : null;
  }

  /** The hash wins over the saved tab; anything invalid falls back to the duel. */
  function initialView(hash, saved) {
    return fromHash(hash) || fromSaved(saved) || DEFAULT_VIEW;
  }

  function hashFor(view) {
    return "#" + (VIEW_TO_HASH[view] || VIEW_TO_HASH[DEFAULT_VIEW]);
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    GRID_KEY: "pokeranker.tab.grid",
    DEFAULT_VIEW: DEFAULT_VIEW,
    fromHash: fromHash,
    initialView: initialView,
    hashFor: hashFor,
  };
});
