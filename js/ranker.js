/* Session state for one person's answers. Loaded after js/model.js. */
(function (root, factory) {
  var Favordex = root.Favordex;
  if (!Favordex && typeof require === "function") Favordex = require("./model.js");
  var api = factory(Favordex);
  if (typeof module === "object" && module && module.exports) module.exports = api;
  root.FavordexRanker = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (F) {
  var STORAGE_KEY = "favordex.history.v1";

  // Same order and ids as Favordex.extendedExtractors. A new extractor belongs here too.
  var MODEL_CATEGORIES = [
    {
      id: "type",
      label: "Type",
      prefix: "type:",
      encoding: "multi-hot",
      detail: "One column for each type a species has. A dual-type species turns two columns on.",
    },
    {
      id: "generation",
      label: "Generation",
      prefix: "gen:",
      encoding: "one-hot",
      detail: "One column for the generation the species was introduced in.",
    },
    {
      id: "color",
      label: "Color",
      prefix: "color:",
      encoding: "one-hot",
      detail: "One column for the Pokédex color.",
    },
    {
      id: "shape",
      label: "Shape",
      prefix: "shape:",
      encoding: "one-hot",
      detail: "One column for the body shape.",
    },
    {
      id: "habitat",
      label: "Habitat",
      prefix: "habitat:",
      encoding: "one-hot",
      detail: "One column for the habitat. A species with no recorded habitat leaves this block off.",
    },
    {
      id: "egg",
      label: "Egg group",
      prefix: "egg:",
      encoding: "multi-hot",
      detail: "One column for each egg group. A species can turn on more than one.",
    },
    {
      id: "legendary",
      label: "Legendary",
      flag: "legendary",
      encoding: "flag",
      detail: "On for a legendary species, off otherwise.",
    },
    {
      id: "mythical",
      label: "Mythical",
      flag: "mythical",
      encoding: "flag",
      detail: "On for a mythical species, off otherwise.",
    },
    {
      id: "baby",
      label: "Baby",
      flag: "baby",
      encoding: "flag",
      detail: "On for a baby species, off otherwise.",
    },
    {
      id: "stage",
      label: "Evolution stage",
      prefix: "stage:",
      encoding: "one-hot",
      detail: "One column for the evolution stage, from 1 up.",
    },
    {
      id: "starter",
      label: "Starter",
      flag: "starter",
      encoding: "flag",
      detail: "On when the species is from a starter line.",
    },
    {
      id: "stats",
      label: "Battle stats",
      prefix: "stat:",
      encoding: "scaled",
      detail: "One column each for HP, Attack, Defense, Sp. Atk, Sp. Def, and Speed. Each is centered and scaled so a typical stat is near 0 and a big shift is about 1.",
    },
    {
      id: "body",
      label: "Body",
      prefix: "size:",
      encoding: "scaled",
      detail: "Height in meters, centered at 1 m. Weight is log kilograms, centered near 25 kg. Bigger numbers are larger Pokémon.",
    },
    {
      id: "ecology",
      label: "Catch and care",
      prefix: "eco:",
      encoding: "scaled",
      detail: "Catch rate, base happiness, and egg cycles. A higher catch-rate column means you have been picking Pokémon that are easier to catch.",
    },
    {
      id: "growth",
      label: "Growth rate",
      prefix: "growth:",
      encoding: "one-hot",
      detail: "One column for the experience curve, such as slow or medium.",
    },
    {
      id: "gender",
      label: "Gender",
      prefix: "gender:",
      encoding: "flag",
      detail: "On for genderless, male-only, or female-only species. Mixed-gender species leave this block off.",
    },
  ];

  function categoryIndex(name) {
    for (var i = 0; i < MODEL_CATEGORIES.length; i++) {
      var cat = MODEL_CATEGORIES[i];
      if (cat.flag && name === cat.flag) return i;
      if (cat.prefix && name.indexOf(cat.prefix) === 0) return i;
    }
    return -1;
  }

  function byWeight(a, b) {
    return b.weight - a.weight || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  }

  function modelReport(fit) {
    var buckets = MODEL_CATEGORIES.map(function () { return []; });
    var other = [];
    fit.featureNames.forEach(function (name, index) {
      var row = { key: name, weight: fit.weights[index], sd: fit.weightSd[index] };
      var at = categoryIndex(name);
      if (at === -1) other.push(row);
      else buckets[at].push(row);
    });
    var categories = MODEL_CATEGORIES.map(function (cat, index) {
      return {
        id: cat.id,
        label: cat.label,
        encoding: cat.encoding,
        detail: cat.detail,
        weights: buckets[index].sort(byWeight),
      };
    });
    if (other.length > 0) {
      categories.push({
        id: "other",
        label: "Other",
        encoding: "column",
        detail: "Columns the category list did not name.",
        weights: other.sort(byWeight),
      });
    }
    var networked = Boolean(fit.network);
    return {
      family: networked ? "Hierarchical Bradley–Terry, one hidden layer" : "Hierarchical Bradley–Terry",
      strength: networked ? "s = x·w + v·tanh(Uz + c) + b" : "s = x·w + b",
      probability: "σ(s_left − s_right)",
      network: fit.network,
      sigmaW: fit.sigmaW,
      sigmaB: fit.sigmaB,
      comparisons: fit.comparisons,
      iterations: fit.iterations,
      converged: fit.converged,
      columns: fit.featureNames.length,
      categories: categories,
    };
  }

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
      hp: pokemon.hp,
      attack: pokemon.attack,
      defense: pokemon.defense,
      specialAttack: pokemon.specialAttack,
      specialDefense: pokemon.specialDefense,
      speed: pokemon.speed,
      heightM: pokemon.heightM,
      weightKg: pokemon.weightKg,
      captureRate: pokemon.captureRate,
      happiness: pokemon.happiness,
      genderRate: pokemon.genderRate,
      hatch: pokemon.hatch,
      growth: pokemon.growth,
    };
  }

  function continuousMatrix(pokemon) {
    var rows = pokemon.map(function (mon) { return F.continuousFeatures(toTrait(mon)); });
    if (!rows.some(Boolean)) return null;
    var cols = F.CONTINUOUS_NAMES.length;
    var values = new Float64Array(pokemon.length * cols);
    rows.forEach(function (row, index) {
      if (!row) return;
      values.set(row, index * cols);
    });
    return { names: F.CONTINUOUS_NAMES.slice(), values: values, cols: cols };
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
    var forced = null;
    var warm = null;
    var lock = false;
    var traits = pokemon.map(toTrait);
    var design = F.buildDesignMatrix(traits, options.extractors || F.extendedExtractors);
    var continuous = options.continuous === false ? null : continuousMatrix(pokemon);
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
        continuous: continuous || undefined,
      });
      warm = {
        w: fit.weights.slice(),
        b: fit.offset.slice(),
        net: fit.network ? { v: fit.network.v, c: fit.network.c, U: fit.network.U } : undefined,
      };
      var games = F.comparisonCounts(history, fit.ids);
      var summary = F.rankingSummary(fit, design);
      var last = history[history.length - 1];
      var forcedPair = forced && forced.a !== forced.b && byId.has(forced.a) && byId.has(forced.b)
        ? { a: forced.a, b: forced.b }
        : null;
      var pair = forcedPair || F.selectNextPair(
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
        model: modelReport(fit),
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
      queuePair: function (a, b) {
        if (lock || a === b || !byId.has(a) || !byId.has(b)) return state;
        forced = { a: a, b: b };
        return recompute();
      },
      answer: function (outcome) {
        if (!state.pair || lock) return state;
        lock = true;
        forced = null;
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

  return {
    createRanker: createRanker,
    STORAGE_KEY: STORAGE_KEY,
    toTrait: toTrait,
    MODEL_CATEGORIES: MODEL_CATEGORIES,
  };
});
