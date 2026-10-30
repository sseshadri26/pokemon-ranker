/* Session state for one person's answers. Loaded after js/model.js. */
(function (root, factory) {
  var Favordex = root.Favordex;
  if (!Favordex && typeof require === "function") Favordex = require("./model.js");
  var api = factory(Favordex);
  if (typeof module === "object" && module && module.exports) module.exports = api;
  root.FavordexRanker = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (F) {
  var STORAGE_KEY = "pokeranker.history.v1";
  var RANKING_MODE_KEY = "pokeranker.ranking.v1";
  // Keys from when the app was called Favordex. Read only when the new key is absent.
  var LEGACY_KEYS = {
    "pokeranker.history.v1": "favordex.history.v1",
    "pokeranker.ranking.v1": "favordex.ranking.v1",
    "pokeranker.dex.v1": "favordex.dex.v1",
  };

  // Reads a key, falling back to its old Favordex name so saved data survives the rename.
  function readKey(store, key) {
    var value = store.getItem(key);
    if (value !== null && value !== undefined) return value;
    var old = LEGACY_KEYS[key];
    return old ? store.getItem(old) : null;
  }

  function entryKey(entry) {
    return entry.a + "|" + entry.b + "|" + entry.outcome + "|" + entry.at;
  }

  // Append: keeps every current entry, adds imported ones that are not exact duplicates
  // (same pair, outcome, and timestamp), and orders the result by time (stable).
  // Skips are not votes. Older saves and exports contain them; they are dropped on load.
  function dropSkips(history) {
    return history.filter(function (entry) { return entry.outcome !== "skip"; });
  }

  function mergeHistory(current, incoming) {
    var seen = new Set(current.map(entryKey));
    var merged = current.slice();
    incoming.forEach(function (entry) {
      var key = entryKey(entry);
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(entry);
    });
    return merged
      .map(function (entry, index) { return { entry: entry, index: index }; })
      .sort(function (x, y) { return x.entry.at - y.entry.at || x.index - y.index; })
      .map(function (item) { return item.entry; });
  }

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
      id: "games",
      label: "Games",
      prefix: "game:",
      encoding: "share",
      detail: "One column for each version group this species appears in, from its Pokédex entries. A species in n of those games puts 1/n on each, so the games block sums to 1. A species in one game still puts 1 on that column. Games it is absent from stay 0. Expansions such as the Isle of Armor have their own column as well as the base game. Legends: Z-A is not listed; PokéAPI has no version group for it yet.",
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
      detail: "One column for each evolution stage and whether that species evolves further, so a stage 1 that evolves is separate from a stage 1 that does not.",
    },
    {
      id: "evolution",
      label: "Evolution scores",
      prefix: "evo:",
      encoding: "score",
      detail: "The strength of the pre-evolution, and the mean and best strength among later evolutions, counting only relatives you have compared. Each value is tanh of that relative's strength with these columns left out, so it stays between -1 and 1 and a line cannot amplify itself. Scores are copied from the previous fit step. A relative you have not compared leaves its part at 0.",
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
      detail: "HP, Attack, Defense, Sp. Atk, Sp. Def, Speed, and base stat total. Each is centered and scaled. These are inputs to the linear score and to the network.",
    },
    {
      id: "body",
      label: "Body",
      prefix: "size:",
      encoding: "scaled",
      detail: "Height is tanh of the natural log of meters, 0 at 1 m, so a huge species stays near other big ones. Weight is tanh of log10 kilograms minus 1.4, 0 near 25 kg, so extremes squash toward -1 and 1. Bigger numbers are larger Pokémon.",
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

  function lookupName(names, id) {
    if (!names) return "#" + id;
    var found = typeof names.get === "function" ? names.get(id) : names[id];
    if (found == null) return "#" + id;
    if (typeof found === "string") return found;
    if (found.name) return found.name;
    return "#" + id;
  }

  function speciesRecord(history, id, names) {
    var wins = 0;
    var losses = 0;
    var ties = 0;
    var skips = 0;
    var matchups = [];
    for (var i = 0; i < history.length; i++) {
      var entry = history[i];
      var side = entry.a === id ? "a" : entry.b === id ? "b" : "";
      if (!side) continue;
      var result;
      if (entry.outcome === "tie") {
        ties += 1;
        result = "tie";
      } else if (entry.outcome === "skip") {
        skips += 1;
        result = "skip";
      } else if (entry.outcome === side) {
        wins += 1;
        result = "won";
      } else if (entry.outcome === "a" || entry.outcome === "b") {
        losses += 1;
        result = "lost";
      } else {
        continue;
      }
      matchups.push({
        opponentId: side === "a" ? entry.b : entry.a,
        opponent: lookupName(names, side === "a" ? entry.b : entry.a),
        result: result,
        at: entry.at,
        order: i,
      });
    }
    matchups.sort(function (a, b) {
      if (a.at !== b.at) return b.at - a.at;
      return b.order - a.order;
    });
    return {
      wins: wins,
      losses: losses,
      ties: ties,
      skips: skips,
      matchups: matchups.map(function (row) {
        return {
          opponentId: row.opponentId,
          opponent: row.opponent,
          result: row.result,
          at: row.at,
        };
      }),
    };
  }

  function groupContributions(columns) {
    var buckets = MODEL_CATEGORIES.map(function () { return []; });
    var other = [];
    columns.forEach(function (column) {
      if (!column || column.value === 0) return;
      var copy = {
        key: column.key,
        value: column.value,
        weight: column.weight,
        contribution: column.contribution,
      };
      var at = categoryIndex(column.key);
      if (at === -1) other.push(copy);
      else buckets[at].push(copy);
    });
    function finish(id, label, list, order) {
      list.sort(function (a, b) {
        var diff = Math.abs(b.contribution) - Math.abs(a.contribution);
        if (diff) return diff;
        if (a.key < b.key) return -1;
        if (a.key > b.key) return 1;
        return 0;
      });
      var sum = 0;
      for (var i = 0; i < list.length; i++) sum += list[i].contribution;
      return { id: id, label: label, contribution: sum, columns: list, order: order };
    }
    var categories = [];
    for (var i = 0; i < MODEL_CATEGORIES.length; i++) {
      if (buckets[i].length === 0) continue;
      categories.push(finish(MODEL_CATEGORIES[i].id, MODEL_CATEGORIES[i].label, buckets[i], i));
    }
    if (other.length > 0) categories.push(finish("other", "Other", other, MODEL_CATEGORIES.length));
    categories.sort(function (a, b) {
      var diff = Math.abs(b.contribution) - Math.abs(a.contribution);
      if (diff) return diff;
      return a.order - b.order;
    });
    return categories.map(function (category) {
      return {
        id: category.id,
        label: category.label,
        contribution: category.contribution,
        columns: category.columns,
      };
    });
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
      family: networked ? "Hierarchical Bradley–Terry with a two-layer network" : "Hierarchical Bradley–Terry",
      strength: networked ? "s = x·w + EV(x) + b" : "s = x·w + b",
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
      evolves: Boolean(pokemon.evolves),
      evolvesFrom: pokemon.evolvesFrom == null ? null : pokemon.evolvesFrom,
      games: pokemon.games || [],
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

  function browserStorage() {
    return {
      load: function () {
        try {
          return readKey(localStorage, STORAGE_KEY);
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
    var design = F.appendColumns(
      F.buildDesignMatrix(traits, options.extractors || F.extendedExtractors),
      F.EVO_COLUMNS
    );
    var evoGraph = F.evolutionGraph(traits);
    var evoColumns = {
      parent: evoGraph.parent,
      descendants: evoGraph.descendants,
      from: design.names.indexOf("evo:from"),
      intoMean: design.names.indexOf("evo:into-mean"),
      intoMax: design.names.indexOf("evo:into-max"),
    };
    var byId = new Map(pokemon.map(function (p) { return [p.id, p]; }));
    var state = null;
    var lastFit = null;
    var effectsCache = null;
    var rankingMode = options.rankingMode === "bradley-terry" ? "bradley-terry" : "full";
    var boardVisible = false;
    var historyToken = 0;
    var plainCache = null;
    var fullRows = null;
    var lastGames = null;

    function persist() {
      if (!storage) return null;
      try {
        storage.save(history);
        return null;
      } catch (error) {
        return "Could not save to this browser's storage.";
      }
    }

    function rowsFrom(fit, games) {
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
      return ranked.map(function (row, index) {
        return {
          pokemon: row.pokemon,
          score: row.score,
          sd: row.sd,
          games: row.games,
          rank: index + 1,
        };
      });
    }

    // Species offsets only. No trait columns and no network, so s_i = b_i.
    // This is a separate fit from the joint model: those offsets were shrunk by x·w and EV.
    function plainDesign() {
      return {
        ids: design.ids,
        names: [],
        values: new Float64Array(0),
        rows: design.rows,
        cols: 0,
      };
    }

    function ensurePlain() {
      if (plainCache && plainCache.token === historyToken) return plainCache;
      var fit = F.fitBradleyTerry(plainDesign(), F.ratedComparisons(history), {
        mlp: false,
        maxIter: Math.max(options.maxIter || 0, 24),
      });
      plainCache = {
        token: historyToken,
        fit: fit,
        rows: rowsFrom(fit, F.comparisonCounts(history, fit.ids)),
      };
      return plainCache;
    }

    function recompute() {
      var rated = F.ratedComparisons(history);
      var fit = F.fitBradleyTerry(design, rated, {
        warm: warm || undefined,
        maxIter: options.maxIter || 12,
        mlp: options.mlp !== false,
        evolution: evoColumns,
      });
      lastFit = fit;
      warm = {
        w: fit.weights.slice(),
        b: fit.offset.slice(),
        net: fit.network ? {
          W1: fit.network.W1,
          c1: fit.network.c1,
          W2: fit.network.W2,
          c2: fit.network.c2,
          v: fit.network.v,
        } : undefined,
      };
      var games = F.comparisonCounts(history, fit.ids);
      var summary = F.rankingSummary(fit, design);
      var last = history[history.length - 1];
      var forcedPair = forced && forced.a !== forced.b && byId.has(forced.a) && byId.has(forced.b)
        ? { a: forced.a, b: forced.b }
        : null;
      lastGames = games;
      var pair = forcedPair || noteShown(pickPair(fit, games, last ? [last.a, last.b] : undefined));
      fullRows = rowsFrom(fit, games);
      var rows = fullRows;
      if (rankingMode === "bradley-terry" || boardVisible) {
        var plain = ensurePlain();
        if (rankingMode === "bradley-terry") rows = plain.rows;
      }
      state = {
        history: history.slice(),
        pair: pair,
        rows: rows,
        rankingMode: rankingMode,
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

    // Pairs shown lately, newest last: seeded from the saved tail, then every pair drawn this
    // session (skipped ones included). In memory only.
    var RECENT_PAIRS = 10;
    var recentPairs = null;
    function recentIds() {
      if (!recentPairs) {
        recentPairs = history.slice(-RECENT_PAIRS).map(function (e) { return [e.a, e.b]; });
      }
      var ids = [];
      recentPairs.slice(-RECENT_PAIRS).forEach(function (p) { ids.push(p[0], p[1]); });
      return ids;
    }
    function noteShown(pair) {
      if (!pair) return pair;
      recentIds();
      var last = recentPairs[recentPairs.length - 1];
      if (!last || last[0] !== pair.a || last[1] !== pair.b) recentPairs.push([pair.a, pair.b]);
      if (recentPairs.length > RECENT_PAIRS * 2) recentPairs = recentPairs.slice(-RECENT_PAIRS);
      return pair;
    }

    function pickPair(fit, games, avoid) {
      return F.selectNextPair(
        {
          ids: fit.ids,
          strength: fit.strength,
          offsetVar: fit.offsetVar,
          traitCoords: fit.traitCoords,
        },
        {
          explore: options.explore === undefined ? 0.12 : options.explore,
          games: games,
          avoid: avoid,
          recent: recentIds(),
          rng: options.rng,
          topN: options.topN,
          topBoost: options.topBoost,
          topPairs: options.topPairs,
        },
      );
    }

    function commit(next) {
      history = next;
      historyToken += 1;
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
        history = raw ? dropSkips(F.parseHistory(raw)) : [];
        // Older saves recorded skips. Rewrite the store without them.
        if (raw && history.length !== F.parseHistory(raw).length) persist();
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
        if (outcome === "skip") {
          // A skip only moves on. Nothing is recorded, saved, or fitted; the skipped
          // pair is avoided for the next draw, in memory only.
          forced = null;
          state.pair = noteShown(pickPair(lastFit, lastGames, [state.pair.a, state.pair.b]));
          return state;
        }
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
        var last = history[history.length - 1];
        forced = { a: last.a, b: last.b };
        commit(F.undo(history));
        release();
        return state;
      },
      editOutcome: function (index, outcome) {
        if (lock) return state;
        if (!Number.isInteger(index) || index < 0 || index >= history.length) return state;
        if (outcome !== "a" && outcome !== "b" && outcome !== "tie") return state;
        var current = history[index];
        if (current.outcome === outcome) return state;
        lock = true;
        var next = history.slice();
        next[index] = { a: current.a, b: current.b, outcome: outcome, at: current.at };
        commit(next);
        release();
        return state;
      },
      deleteEntry: function (index) {
        if (lock) return state;
        if (!Number.isInteger(index) || index < 0 || index >= history.length) return state;
        lock = true;
        var removed = history[index];
        // The latest row is the one Undo would take back, so that pair returns to the duel.
        // An older row leaves a queued matchup in place, and otherwise keeps whatever is on screen.
        if (index === history.length - 1) forced = { a: removed.a, b: removed.b };
        else if (!forced && state.pair) forced = { a: state.pair.a, b: state.pair.b };
        commit(history.slice(0, index).concat(history.slice(index + 1)));
        release();
        return state;
      },
      movePast: function (id, passedIds, direction) {
        if (lock || (direction !== "above" && direction !== "below")) return state;
        if (!byId.has(id) || !Array.isArray(passedIds)) return state;
        var unique = [];
        var seen = new Set();
        for (var i = 0; i < passedIds.length; i++) {
          var other = passedIds[i];
          if (other === id || !byId.has(other) || seen.has(other)) continue;
          seen.add(other);
          unique.push(other);
        }
        if (unique.length === 0) return state;
        var base = history.slice();
        function batch(copies) {
          var entries = [];
          for (var copy = 0; copy < copies; copy++) {
            for (var n = 0; n < unique.length; n++) {
              entries.push({
                a: id,
                b: unique[n],
                outcome: direction === "above" ? "a" : "b",
                at: options.now ? options.now() : Date.now(),
              });
            }
          }
          return entries;
        }
        function onRequestedSide() {
          var by = new Map();
          for (var r = 0; r < state.rows.length; r++) by.set(state.rows[r].pokemon.id, state.rows[r]);
          var mine = by.get(id);
          for (var n = 0; n < unique.length; n++) {
            var other = by.get(unique[n]);
            if (direction === "above" && !(mine.score > other.score + 0.05)) return false;
            if (direction === "below" && !(other.score > mine.score + 0.05)) return false;
          }
          return true;
        }
        lock = true;
        var schedule = [1, 2, 4, 8, 16];
        for (var step = 0; step < schedule.length; step++) {
          commit(base.concat(batch(schedule[step])));
          if (onRequestedSide()) break;
        }
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
      importText: function (text, mode) {
        var incoming = dropSkips(F.parseHistory(text));
        var next = incoming;
        lock = true;
        if (mode === "append") {
          next = mergeHistory(history, incoming);
          var added = next.length - history.length;
          notice = "Added " + added.toLocaleString() + " of " + incoming.length.toLocaleString() +
            " imported answers" + (added < incoming.length ? " (" + (incoming.length - added).toLocaleString() + " already here)." : ".");
        } else {
          notice = "Imported " + next.length.toLocaleString() + " answers.";
        }
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
      setRankingMode: function (mode) {
        if (mode !== "full" && mode !== "bradley-terry") return state;
        if (mode === rankingMode) return state;
        rankingMode = mode;
        state.rankingMode = mode;
        state.rows = mode === "bradley-terry" ? ensurePlain().rows : fullRows;
        return state;
      },
      // Model tab: average total effect of each column (linear + network), computed on first
      // request and cached per fit. Null in Bradley–Terry-only mode (no network there).
      totalEffects: function () {
        if (!lastFit || rankingMode === "bradley-terry") return null;
        if (effectsCache && effectsCache.fit === lastFit) return effectsCache;
        var started = Date.now();
        var list = F.totalEffects(design.values, design.rows, design.cols, design.names, lastFit.weights, lastFit.network);
        var byName = {};
        list.forEach(function (row) { byName[row.name] = row; });
        effectsCache = { fit: lastFit, byName: byName, ms: Date.now() - started, network: Boolean(lastFit.network) };
        return effectsCache;
      },
      setBoardVisible: function (visible) {
        var next = Boolean(visible);
        if (next === boardVisible) {
          if (next && (!plainCache || plainCache.token !== historyToken)) ensurePlain();
          return state;
        }
        boardVisible = next;
        if (boardVisible) ensurePlain();
        return state;
      },
      speciesDetail: function (id) {
        if (!lastFit || !state || !byId.has(id)) return null;
        var plain = rankingMode === "bradley-terry";
        var active = plain ? ensurePlain().fit : lastFit;
        var index = -1;
        for (var i = 0; i < active.ids.length; i++) {
          if (active.ids[i] === id) {
            index = i;
            break;
          }
        }
        if (index < 0) return null;
        var cols = design.cols;
        var row = new Array(cols);
        var base = index * cols;
        var parts = null;
        if (!plain) {
          for (var k = 0; k < cols; k++) row[k] = design.values[base + k];
          parts = F.strengthBreakdown(row, lastFit.weights, lastFit.network, lastFit.offset[index], design.names);
        }
        var mon = byId.get(id);
        var ranked = null;
        for (var r = 0; r < state.rows.length; r++) {
          if (state.rows[r].pokemon.id === id) {
            ranked = state.rows[r];
            break;
          }
        }
        var strength = ranked ? ranked.score : active.strength[index];
        var record = speciesRecord(history, id, byId);
        var forms = [];
        if (mon.forms && mon.forms.length) {
          for (var f = 0; f < mon.forms.length; f++) {
            var form = mon.forms[f];
            if (!form) continue;
            forms.push({ name: form.name || mon.name, kind: form.kind || "" });
          }
        }
        return {
          id: id,
          name: mon.name,
          dex: mon.id,
          types: (mon.types || []).slice(),
          generation: mon.generation,
          art: mon.art || "",
          forms: forms,
          rank: ranked ? ranked.rank : null,
          strength: strength,
          sd: ranked ? ranked.sd : active.sd[index],
          uncertainty: plain ? null : F.uncertaintyBreakdown(lastFit, index),
          games: ranked ? ranked.games : 0,
          record: {
            wins: record.wins,
            losses: record.losses,
            ties: record.ties,
            skips: record.skips,
          },
          matchups: record.matchups,
          ranking: plain ? "bradley-terry" : "full",
          linear: plain ? 0 : parts.linear,
          ev: plain ? 0 : parts.ev,
          offset: plain ? active.offset[index] : parts.offset,
          partsMatch: plain ? true : Math.abs(parts.strength - strength) <= 1e-6,
          categories: plain ? [] : groupContributions(parts.columns),
        };
      },
    };
  }

  return {
    createRanker: createRanker,
    STORAGE_KEY: STORAGE_KEY,
    RANKING_MODE_KEY: RANKING_MODE_KEY,
    LEGACY_KEYS: LEGACY_KEYS,
    readKey: readKey,
    mergeHistory: mergeHistory,
    dropSkips: dropSkips,
    toTrait: toTrait,
    MODEL_CATEGORIES: MODEL_CATEGORIES,
  };
});
