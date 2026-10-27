/* Session state for one person's answers. Loaded after js/model.js. */
(function (root, factory) {
  var Favordex = root.Favordex;
  if (!Favordex && typeof require === "function") Favordex = require("./model.js");
  var api = factory(Favordex);
  if (typeof module === "object" && module && module.exports) module.exports = api;
  root.FavordexRanker = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (F) {
  var STORAGE_KEY = "favordex.history.v1";

  function toTrait(pokemon) {
    return {
      id: pokemon.id,
      types: pokemon.types,
      generation: pokemon.generation,
      color: pokemon.color,
      shape: pokemon.shape,
      habitat: pokemon.habitat,
      eggGroups: pokemon.eggGroups,
      isLegendary: pokemon.legendary,
      isMythical: pokemon.mythical,
      isBaby: pokemon.baby,
      evolutionStage: pokemon.stage,
      isStarter: pokemon.starter,
    };
  }

  function browserStorage() {
    return {
      load: function () {
        try {
          return localStorage.getItem(STORAGE_KEY);
        } catch (error) {
          return null;
        }
      },
      save: function (history) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
      },
    };
  }

  function createRanker(pokemon, options) {
    options = options || {};
    var storage = options.storage === undefined ? browserStorage() : options.storage;
    var history = [];
    var notice = null;
    var warm = null;
    var lock = false;
    var design = F.buildDesignMatrix(pokemon.map(toTrait), options.extractors || F.extendedExtractors);
    var byId = new Map(pokemon.map(function (p) { return [p.id, p]; }));
    var state = null;

    function persist() {
      if (!storage) return null;
      try {
        storage.save(history);
        return null;
      } catch (error) {
        return "Could not save to this browser's storage.";
      }
    }

    function recompute() {
      var rated = F.ratedComparisons(history);
      var fit = F.fitBradleyTerry(design, rated, {
        warm: warm || undefined,
        maxIter: options.maxIter || 18,
      });
      warm = { w: fit.weights.slice(), b: fit.offset.slice() };
      var games = F.comparisonCounts(history, fit.ids);
      var summary = F.rankingSummary(fit, design);
      var last = history[history.length - 1];
      var pair = F.selectNextPair(
        {
          ids: fit.ids,
          strength: fit.strength,
          offsetVar: fit.offsetVar,
          traitCoords: fit.traitCoords,
        },
        {
          explore: options.explore === undefined ? 0.12 : options.explore,
          games: games,
          avoid: last ? [last.a, last.b] : undefined,
          rng: options.rng,
        },
      );
      var ranked = fit.ids.map(function (id, index) {
        return {
          pokemon: byId.get(id),
          score: fit.strength[index],
          sd: fit.sd[index],
          games: games[index] || 0,
        };
      });
      ranked.sort(function (a, b) {
        return b.score - a.score || a.pokemon.id - b.pokemon.id;
      });
      state = {
        history: history.slice(),
        pair: pair,
        rows: ranked.map(function (row, index) {
          return {
            pokemon: row.pokemon,
            score: row.score,
            sd: row.sd,
            games: row.games,
            rank: index + 1,
          };
        }),
        summary: summary,
        leans: fit.featureNames
          .map(function (name, index) { return { name: name, weight: fit.weights[index] }; })
          .filter(function (trait) { return trait.name.indexOf("type:") === 0; })
          .sort(function (a, b) { return Math.abs(b.weight) - Math.abs(a.weight); })
          .slice(0, 4),
        notice: notice,
        byId: byId,
      };
      return state;
    }

    function commit(next) {
      history = next;
      var err = persist();
      if (err) notice = err;
      return recompute();
    }

    function release() {
      if (state.pair) lock = false;
    }

    if (storage) {
      try {
        var raw = storage.load();
        history = raw ? F.parseHistory(raw) : [];
      } catch (error) {
        history = [];
      }
    }
    recompute();

    return {
      getState: function () { return state; },
      answer: function (outcome) {
        if (!state.pair || lock) return state;
        lock = true;
        commit(history.concat([{
          a: state.pair.a,
          b: state.pair.b,
          outcome: outcome,
          at: options.now ? options.now() : Date.now(),
        }]));
        release();
        return state;
      },
      undoLast: function () {
        if (history.length === 0 || lock) return state;
        lock = true;
        commit(F.undo(history));
        release();
        return state;
      },
      reset: function () {
        if (lock) return state;
        lock = true;
        notice = null;
        commit([]);
        release();
        return state;
      },
      importText: function (text) {
        var next = F.parseHistory(text);
        lock = true;
        notice = "Imported " + next.length.toLocaleString() + " answers.";
        commit(next);
        release();
        return state;
      },
      exportText: function () {
        return F.serializeHistory(history);
      },
      setNotice: function (message) {
        notice = message;
        state.notice = message;
        return state;
      },
    };
  }

  return { createRanker: createRanker, STORAGE_KEY: STORAGE_KEY, toTrait: toTrait };
});
