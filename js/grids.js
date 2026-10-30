/* PokeRanker grids: trait filters on rows and columns, best-ranked species in each cell.
 * Classic script: sets globalThis.PokeRankerGrids. Node: module.exports. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  root.PokeRankerGrids = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var STORAGE_KEY = "pokeranker.grids.v1";
  var ALL = "all";

  function cap(word) {
    return String(word).split("-").map(function (part) {
      return part.charAt(0).toUpperCase() + part.slice(1);
    }).join(" ");
  }

  // Types a species can be found as. The base species plus regional and alternate forms
  // (Alolan Marowak is Fire, Rotom-Wash is Water); Mega and Gigantamax forms are left out
  // because they are temporary battle states.
  function typesOf(mon) {
    var set = new Set(mon.types || []);
    (mon.forms || []).forEach(function (form) {
      if (form.kind === "mega" || form.kind === "gmax") return;
      (form.types || []).forEach(function (type) { set.add(type); });
    });
    return set;
  }

  function hasKind(mon, kind) {
    return (mon.forms || []).some(function (form) { return form.kind === kind; });
  }

  var ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];

  /** Every trait the bundled data supports, grouped for a <select>. */
  // Canonical in-game type order (Scarlet/Violet menus); Stellar last if present.
  var TYPE_ORDER = ["normal", "fire", "water", "grass", "electric", "ice", "fighting", "poison", "ground",
    "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy", "stellar"];
  // Main-series games in release order (PokeAPI version-group names).
  var GAME_ORDER = ["red-blue", "yellow", "gold-silver", "crystal", "ruby-sapphire", "emerald", "firered-leafgreen",
    "diamond-pearl", "platinum", "heartgold-soulsilver", "black-white", "black-2-white-2", "x-y",
    "omega-ruby-alpha-sapphire", "sun-moon", "ultra-sun-ultra-moon", "lets-go-pikachu-lets-go-eevee", "sword-shield",
    "the-isle-of-armor", "the-crown-tundra", "brilliant-diamond-and-shining-pearl", "legends-arceus", "scarlet-violet",
    "the-teal-mask", "the-indigo-disk"];
  function byList(list) {
    return function (a, b) {
      var i = list.indexOf(a);
      var j = list.indexOf(b);
      if (i < 0) i = list.length;
      if (j < 0) j = list.length;
      return i - j || (a < b ? -1 : a > b ? 1 : 0);
    };
  }

  function traitOptions(pokemon) {
    function values(pick, order) {
      var set = new Set();
      pokemon.forEach(function (mon) {
        [].concat(pick(mon)).forEach(function (v) { if (v != null && v !== "") set.add(v); });
      });
      return Array.from(set).sort(order || function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
    }
    var numeric = function (a, b) { return a - b; };
    var out = [{ id: ALL, label: "All", group: "" }];
    values(function (m) { return Array.from(typesOf(m)); }, byList(TYPE_ORDER)).forEach(function (t) {
      out.push({ id: "type:" + t, label: cap(t) + " type", group: "Type (any slot or form)" });
    });
    values(function (m) { return m.types && m.types.length === 1 ? m.types[0] : null; }, byList(TYPE_ORDER)).forEach(function (t) {
      out.push({ id: "only:" + t, label: "Mono type: " + cap(t), group: "Mono type (only this type)" });
    });
    out.push({ id: "count:1", label: "Mono type", group: "Type count" });
    out.push({ id: "count:2", label: "Dual type", group: "Type count" });
    values(function (m) { return m.generation; }, numeric).forEach(function (g) {
      out.push({ id: "gen:" + g, label: "Gen " + (ROMAN[g] || g), group: "Generation" });
    });
    values(function (m) { return m.color; }).forEach(function (c) {
      out.push({ id: "color:" + c, label: cap(c), group: "Colour" });
    });
    values(function (m) { return m.shape; }).forEach(function (s) {
      out.push({ id: "shape:" + s, label: cap(s), group: "Shape" });
    });
    values(function (m) { return m.habitat; }).forEach(function (h) {
      out.push({ id: "habitat:" + h, label: cap(h), group: "Habitat" });
    });
    values(function (m) { return m.eggGroups; }).forEach(function (e) {
      out.push({ id: "egg:" + e, label: cap(e), group: "Egg group" });
    });
    values(function (m) { return m.stage; }, numeric).forEach(function (s) {
      out.push({ id: "stage:" + s, label: "Stage " + s, group: "Evolution" });
    });
    out.push({ id: "flag:fully-evolved", label: "Fully evolved", group: "Evolution" });
    out.push({ id: "flag:evolves", label: "Can evolve", group: "Evolution" });
    out.push({ id: "flag:legendary", label: "Legendary", group: "Status" });
    out.push({ id: "flag:mythical", label: "Mythical", group: "Status" });
    out.push({ id: "flag:baby", label: "Baby", group: "Status" });
    out.push({ id: "flag:starter", label: "Starter line", group: "Status" });
    out.push({ id: "flag:mega", label: "Has a Mega", group: "Forms" });
    out.push({ id: "flag:gmax", label: "Has a Gigantamax", group: "Forms" });
    out.push({ id: "flag:regional", label: "Has a regional form", group: "Forms" });
    values(function (m) { return m.games; }, byList(GAME_ORDER)).forEach(function (g) {
      out.push({ id: "game:" + g, label: cap(g), group: "Game" });
    });
    return out;
  }

  // Mono/Dual type: the default form counts, and so do regional or alternate forms (like types do);
  // Mega and Gigantamax forms are ignored.
  function typeCountMatch(mon, n) {
    if ((mon.types || []).length === n) return true;
    return (mon.forms || []).some(function (form) {
      return form.kind !== "mega" && form.kind !== "gmax" && (form.types || []).length === n;
    });
  }

  function matches(mon, trait) {
    if (!trait || trait === ALL) return true;
    var cut = trait.indexOf(":");
    var kind = trait.slice(0, cut);
    var value = trait.slice(cut + 1);
    switch (kind) {
      case "type": return typesOf(mon).has(value);
      case "count": return typeCountMatch(mon, Number(value));
      case "only": return (mon.types || []).length === 1 && mon.types[0] === value;
      case "gen": return String(mon.generation) === value;
      case "color": return mon.color === value;
      case "shape": return mon.shape === value;
      case "habitat": return mon.habitat === value;
      case "egg": return (mon.eggGroups || []).indexOf(value) >= 0;
      case "stage": return String(mon.stage) === value;
      case "game": return (mon.games || []).indexOf(value) >= 0;
      case "flag":
        if (value === "fully-evolved") return !mon.evolves;
        if (value === "evolves") return Boolean(mon.evolves);
        if (value === "mega" || value === "gmax" || value === "regional") return hasKind(mon, value);
        return Boolean(mon[value]);
      default: return false;
    }
  }

  /**
   * rows: the ranking rows, best first ({ pokemon, rank, score }).
   * Returns { best, next, count } for the species matching both traits.
   */
  function cell(rows, rowTrait, colTrait) {
    var best = null;
    var next = null;
    var count = 0;
    for (var i = 0; i < rows.length; i++) {
      var mon = rows[i].pokemon;
      if (!matches(mon, rowTrait) || !matches(mon, colTrait)) continue;
      count += 1;
      if (!best) best = rows[i];
      else if (!next) next = rows[i];
    }
    return { best: best, next: next, count: count };
  }

  // ---- Grid-wide rules ----
  // A rule is { trait, mode: "include" | "exclude" }. Include rules in the same category are OR'd
  // (Gen IV + Gen V = either); different categories are AND'd; every Exclude must not match.
  var FLAG_CATEGORY = {
    "fully-evolved": "evolution", evolves: "evolution",
    legendary: "status", mythical: "status", baby: "status", starter: "status",
    mega: "forms", gmax: "forms", regional: "forms",
  };
  function ruleCategory(trait) {
    var cut = trait.indexOf(":");
    var kind = cut < 0 ? trait : trait.slice(0, cut);
    if (kind === "flag") return FLAG_CATEGORY[trait.slice(cut + 1)] || trait;
    if (kind === "stage") return "evolution";
    return kind;
  }

  function passesRules(mon, rules) {
    if (!rules || rules.length === 0) return true;
    var groups = {};
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (rule.trait === ALL) continue;
      if (rule.mode === "exclude") {
        if (matches(mon, rule.trait)) return false;
      } else {
        var cat = ruleCategory(rule.trait);
        groups[cat] = groups[cat] || matches(mon, rule.trait);
      }
    }
    for (var key in groups) if (!groups[key]) return false;
    return true;
  }

  /** Plain-language summary of the rules, for captions and exports. */
  function rulesText(grid, nameOf) {
    var rules = (grid && grid.rules) || [];
    var label = function (t) { return (nameOf && nameOf(t)) || t; };
    var groups = [];
    var byCat = {};
    rules.forEach(function (rule) {
      if (rule.mode === "exclude") return;
      var cat = ruleCategory(rule.trait);
      if (!byCat[cat]) {
        byCat[cat] = [];
        groups.push(byCat[cat]);
      }
      byCat[cat].push(label(rule.trait));
    });
    var parts = groups.map(function (names) { return names.length > 1 ? "(" + names.join(" or ") + ")" : names[0]; });
    rules.forEach(function (rule) {
      if (rule.mode === "exclude") parts.push("not " + label(rule.trait));
    });
    if (grid && grid.unique) parts.push("no duplicates");
    return parts.join(" · ");
  }

  /**
   * Every cell of a grid as rows[r][c] = { best, next, count }, honouring the grid rules.
   * With grid.unique, a Pokémon is used at most once: walk the ranking from the top and give each
   * Pokémon the free cell it qualifies for that has the fewest other candidates (ties: reading order).
   * Higher-ranked Pokémon choose first; sending them to their scarcest cell keeps more cells fillable.
   */
  function gridCells(grid, rows) {
    var R = grid.rows.length;
    var C = grid.cols.length;
    var eligible = rows.filter(function (row) { return passesRules(row.pokemon, grid.rules); });
    var rowHit = grid.rows.map(function (t) { return eligible.map(function (row) { return matches(row.pokemon, t); }); });
    var colHit = grid.cols.map(function (t) { return eligible.map(function (row) { return matches(row.pokemon, t); }); });
    var out = [];
    var r, c, i;
    for (r = 0; r < R; r++) {
      out.push([]);
      for (c = 0; c < C; c++) {
        var cellOut = { best: null, next: null, count: 0 };
        for (i = 0; i < eligible.length; i++) {
          if (!rowHit[r][i] || !colHit[c][i]) continue;
          cellOut.count += 1;
          if (!cellOut.best) cellOut.best = eligible[i];
          else if (!cellOut.next) cellOut.next = eligible[i];
        }
        out[r].push(cellOut);
      }
    }
    if (!grid.unique) return out;
    var taken = out.map(function (line) { return line.map(function () { return null; }); });
    var free = R * C;
    for (i = 0; i < eligible.length && free > 0; i++) {
      var pick = null;
      for (r = 0; r < R; r++) {
        if (!rowHit[r][i]) continue;
        for (c = 0; c < C; c++) {
          if (taken[r][c] || !colHit[c][i]) continue;
          if (!pick || out[r][c].count < out[pick[0]][pick[1]].count) pick = [r, c];
        }
      }
      if (pick) {
        taken[pick[0]][pick[1]] = eligible[i];
        free -= 1;
      }
    }
    return out.map(function (line, rr) {
      return line.map(function (cellOut, cc) {
        return { best: taken[rr][cc], next: null, count: cellOut.count };
      });
    });
  }

  function cleanRules(raw) {
    if (!Array.isArray(raw)) return [];
    var seen = new Set();
    var out = [];
    raw.forEach(function (rule) {
      if (!rule || typeof rule.trait !== "string" || !rule.trait || rule.trait.length > 80 || rule.trait === ALL) return;
      var mode = rule.mode === "exclude" ? "exclude" : "include";
      var key = mode + " " + rule.trait;
      if (seen.has(key) || out.length >= 40) return;
      seen.add(key);
      out.push({ trait: rule.trait, mode: mode });
    });
    return out;
  }

  // ---- Which form a cell shows ----
  function formScore(form, trait) {
    if (!trait || trait === ALL) return 0;
    var cut = trait.indexOf(":");
    var kind = trait.slice(0, cut);
    var value = trait.slice(cut + 1);
    var battle = form.kind === "mega" || form.kind === "gmax";
    var types = form.types || [];
    if (kind === "type") return !battle && types.indexOf(value) >= 0 ? 1 : 0;
    if (kind === "count") return !battle && types.length === Number(value) ? 1 : 0;
    if (kind === "only") return !battle && types.length === 1 && types[0] === value ? 1 : 0;
    if (kind === "flag" && (value === "mega" || value === "gmax" || value === "regional")) return form.kind === value ? 1 : 0;
    return 0;
  }

  /** Index of the form that best fits both traits; the main form wins ties and no-signal cells. */
  function defaultFormIndex(mon, rowTrait, colTrait) {
    var forms = mon.forms || [];
    if (forms.length === 0) return -1;
    var main = 0;
    for (var i = 0; i < forms.length; i++) {
      if (forms[i].kind === "default") {
        main = i;
        break;
      }
    }
    var best = main;
    var bestScore = formScore(forms[main], rowTrait) + formScore(forms[main], colTrait);
    forms.forEach(function (form, index) {
      var score = formScore(form, rowTrait) + formScore(form, colTrait);
      if (score > bestScore) {
        best = index;
        bestScore = score;
      }
    });
    return best;
  }

  function cellKey(rowTrait, colTrait) {
    return rowTrait + "|" + colTrait;
  }

  /** The form a cell shows: the user's pick for this species in this cell, else the default. */
  function cellForm(grid, mon, rowTrait, colTrait) {
    var forms = mon.forms || [];
    var picked = grid && grid.picks && grid.picks[cellKey(rowTrait, colTrait)];
    var name = picked ? picked[String(mon.id)] : null;
    if (name) {
      for (var i = 0; i < forms.length; i++) if (forms[i].name === name) return forms[i];
    }
    var index = defaultFormIndex(mon, rowTrait, colTrait);
    return index >= 0 ? forms[index] : null;
  }

  /** Remember a pick. Picks are per cell and per species, so they return if that species comes back. */
  function setPick(grid, rowTrait, colTrait, speciesId, formName) {
    grid.picks = grid.picks || {};
    var key = cellKey(rowTrait, colTrait);
    grid.picks[key] = grid.picks[key] || {};
    if (formName) grid.picks[key][String(speciesId)] = formName;
    else delete grid.picks[key][String(speciesId)];
    return grid;
  }

  function cleanPicks(raw) {
    var out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    Object.keys(raw).slice(0, 2000).forEach(function (key) {
      var bySpecies = raw[key];
      if (!bySpecies || typeof bySpecies !== "object" || Array.isArray(bySpecies)) return;
      var kept = {};
      Object.keys(bySpecies).forEach(function (id) {
        if (/^\d+$/.test(id) && typeof bySpecies[id] === "string" && bySpecies[id].length < 120) kept[id] = bySpecies[id];
      });
      if (Object.keys(kept).length) out[String(key).slice(0, 200)] = kept;
    });
    return out;
  }

  /** One grid as its own file. The empty history keeps it readable by the regular importer. */
  function gridFileText(grid) {
    return JSON.stringify({ version: 1, kind: "pokeranker-grid", history: [], grids: sanitize([grid]) }, null, 2);
  }

  function isGridFile(text) {
    try {
      var parsed = JSON.parse(text);
      return Boolean(parsed && parsed.kind === "pokeranker-grid");
    } catch (error) {
      return false;
    }
  }

  // Thumbnail chunk for an artwork file (same hash as scripts/build-thumbs.cjs).
  var THUMB_CHUNKS = 16;
  function thumbChunk(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return h % THUMB_CHUNKS;
  }

  var MAX_AXIS = 40;
  /** Trait ids in one picker category, in picker order. */
  function categoryTraits(options, group) {
    return options.filter(function (t) { return t.group === group; }).map(function (t) { return t.id; });
  }

  /** Fill an axis with a whole category: a lone header is replaced, otherwise append without duplicates. */
  function fillAxis(axis, ids) {
    var base = axis.length <= 1 ? [] : axis.slice();
    ids.forEach(function (id) {
      if (base.indexOf(id) < 0 && base.length < MAX_AXIS) base.push(id);
    });
    return base.length ? base : axis.slice();
  }

  var uid = 0;
  function newId() {
    uid += 1;
    return "g" + Date.now().toString(36) + uid.toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }

  function makeGrid(name) {
    return { id: newId(), name: name || "New grid", rows: [ALL], cols: [ALL], picks: {}, rules: [], unique: false };
  }

  function cleanTrait(value) {
    return typeof value === "string" && value.length > 0 && value.length < 80 ? value : ALL;
  }

  /** Keeps only well-formed grids. Unknown fields are dropped. */
  function sanitize(list) {
    if (!Array.isArray(list)) return [];
    var seen = new Set();
    var out = [];
    list.forEach(function (raw) {
      if (!raw || typeof raw !== "object") return;
      var rows = Array.isArray(raw.rows) && raw.rows.length ? raw.rows.map(cleanTrait).slice(0, 40) : [ALL];
      var cols = Array.isArray(raw.cols) && raw.cols.length ? raw.cols.map(cleanTrait).slice(0, 40) : [ALL];
      var id = typeof raw.id === "string" && raw.id ? raw.id : newId();
      while (seen.has(id)) id = newId();
      seen.add(id);
      var name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 80) : "Grid";
      out.push({ id: id, name: name, rows: rows, cols: cols, picks: cleanPicks(raw.picks),
        rules: cleanRules(raw.rules), unique: raw.unique === true });
    });
    return out;
  }

  /** Append: keeps current grids and adds imported ones; an identical grid (same id and content) is skipped. */
  function mergeGrids(current, incoming) {
    var out = current.slice();
    var ids = new Set(current.map(function (g) { return g.id; }));
    var keyOf = function (g) { return JSON.stringify([g.name, g.rows, g.cols, g.rules || [], Boolean(g.unique)]); };
    var keys = new Map(current.map(function (g, i) { return [keyOf(g), i]; }));
    sanitize(incoming).forEach(function (grid) {
      var key = keyOf(grid);
      if (keys.has(key)) {
        // Same grid already here: keep it, and add any form picks it lacks.
        var index = keys.get(key);
        var have = out[index];
        var picks = JSON.parse(JSON.stringify(have.picks || {}));
        Object.keys(grid.picks || {}).forEach(function (cell) {
          picks[cell] = Object.assign({}, grid.picks[cell], picks[cell] || {});
        });
        out[index] = Object.assign({}, have, { picks: picks });
        return;
      }
      keys.set(key, out.length);
      var copy = { id: grid.id, name: grid.name, rows: grid.rows.slice(), cols: grid.cols.slice(), picks: grid.picks,
        rules: grid.rules.slice(), unique: grid.unique };
      while (ids.has(copy.id)) copy.id = newId();
      ids.add(copy.id);
      out.push(copy);
    });
    return out;
  }

  /** Grids carried in an export file, or null when the file has none (older exports). */
  function gridsFromExport(text) {
    try {
      var parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray(parsed.grids)) {
        return sanitize(parsed.grids);
      }
    } catch (error) {
      /* The history parser reports bad JSON. */
    }
    return null;
  }

  function load(store) {
    try {
      var raw = store.getItem(STORAGE_KEY);
      return raw ? sanitize(JSON.parse(raw)) : [];
    } catch (error) {
      return [];
    }
  }

  function save(store, grids) {
    store.setItem(STORAGE_KEY, JSON.stringify(sanitize(grids)));
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    ALL: ALL,
    traitOptions: traitOptions,
    matches: matches,
    cell: cell,
    makeGrid: makeGrid,
    sanitize: sanitize,
    mergeGrids: mergeGrids,
    gridsFromExport: gridsFromExport,
    load: load,
    passesRules: passesRules,
    gridCells: gridCells,
    rulesText: rulesText,
    ruleCategory: ruleCategory,
    TYPE_ORDER: TYPE_ORDER,
    GAME_ORDER: GAME_ORDER,
    categoryTraits: categoryTraits,
    fillAxis: fillAxis,
    defaultFormIndex: defaultFormIndex,
    cellForm: cellForm,
    cellKey: cellKey,
    setPick: setPick,
    gridFileText: gridFileText,
    isGridFile: isGridFile,
    thumbChunk: thumbChunk,
    save: save,
  };
});
