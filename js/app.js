/* Favordex page. Classic script. Opens from index.html with no server. */
(function () {
  var TYPE_ORDER = [
    "normal", "fire", "water", "electric", "grass", "ice", "fighting", "poison", "ground",
    "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy",
  ];
  var TYPE_COLORS = {
    normal: "#9a9a84", fire: "#ee8130", water: "#6390f0", electric: "#f7d02c", grass: "#7ac74c",
    ice: "#96d9d6", fighting: "#c22e28", poison: "#a33ea1", ground: "#e2bf65", flying: "#a98ff3",
    psychic: "#f95587", bug: "#a6b91a", rock: "#b6a136", ghost: "#735797", dragon: "#6f35fc",
    dark: "#705746", steel: "#b7b7ce", fairy: "#d685ad",
  };
  var ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

  var bundle = window.POKEDEX_BUNDLE;
  var pokemon = (bundle && bundle.pokemon) || [];
  var ranker = window.FavordexRanker.createRanker(pokemon);
  var view = "duel";
  var pairKey = "";
  var offset = 0;
  var drag = null;
  var swiped = false;
  var uiLock = false;

  var els = {
    count: document.getElementById("matchup-count"),
    confidence: document.getElementById("confidence"),
    bar: document.getElementById("confidence-bar"),
    bound: document.getElementById("bound"),
    notice: document.getElementById("notice"),
    noticeText: document.getElementById("notice-text"),
    duel: document.getElementById("duel"),
    board: document.getElementById("board"),
    model: document.getElementById("model"),
    modelFacts: document.getElementById("model-facts"),
    modelCategories: document.getElementById("model-categories"),
    modelNetwork: document.getElementById("model-network"),
    noDuel: document.getElementById("no-duel"),
    live: document.getElementById("versus-live"),
    stage: document.getElementById("stage"),
    cardA: document.getElementById("card-a"),
    cardB: document.getElementById("card-b"),
    seal: document.getElementById("seal"),
    hint: document.getElementById("swipe-hint"),
    undo: document.getElementById("undo"),
    leans: document.getElementById("leans"),
    ledger: document.getElementById("ledger"),
    shown: document.getElementById("shown"),
    filterEmpty: document.getElementById("filter-empty"),
    search: document.getElementById("search"),
    typeFilter: document.getElementById("type-filter"),
    genFilter: document.getElementById("gen-filter"),
    modal: document.getElementById("modal"),
    viewDuel: document.getElementById("view-duel"),
    viewChoose: document.getElementById("view-choose"),
    viewHistory: document.getElementById("view-history"),
    viewBoard: document.getElementById("view-board"),
    viewModel: document.getElementById("view-model"),
    history: document.getElementById("history"),
    historyCount: document.getElementById("history-count"),
    matchLog: document.getElementById("match-log"),
    historyEmpty: document.getElementById("history-empty"),
    setup: document.getElementById("setup"),
    setupNote: document.getElementById("setup-note"),
  };

  function typeColor(type) {
    return TYPE_COLORS[type] || "#8d8678";
  }

  function typeInk(type) {
    var hex = typeColor(type).replace("#", "");
    var r = parseInt(hex.slice(0, 2), 16);
    var g = parseInt(hex.slice(2, 4), 16);
    var b = parseInt(hex.slice(4, 6), 16);
    var luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.62 ? "#1c1914" : "#fffaf3";
  }

  function generationLabel(generation) {
    return "Gen " + (ROMAN[generation] || generation);
  }

  function formatScore(score) {
    var rounded = score.toFixed(2);
    return score > 0 ? "+" + rounded : rounded;
  }

  function formatSd(sd) {
    return "±" + sd.toFixed(2);
  }

  function titleType(type) {
    return type.charAt(0).toUpperCase() + type.slice(1);
  }

  function artUrl(file) {
    if (!file) return "";
    return "artwork/" + file;
  }

  function esc(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function state() {
    return ranker.getState();
  }

  function sides() {
    var pair = state().pair;
    if (!pair) return { left: null, right: null };
    return { left: state().byId.get(pair.a), right: state().byId.get(pair.b) };
  }

  function release() {
    if (state().pair) uiLock = false;
  }

  function vote(outcome) {
    if (uiLock) return;
    uiLock = true;
    ranker.answer(outcome);
    render();
    release();
  }

  function undo() {
    if (uiLock) return;
    uiLock = true;
    ranker.undoLast();
    render();
    release();
  }

  function formsOf(mon) {
    if (mon.forms && mon.forms.length > 0) return mon.forms;
    return [{ name: mon.name, art: mon.art, types: mon.types, kind: "default", pixel: false }];
  }

  function typeChips(types) {
    return types.map(function (type) {
      return '<span class="type" style="background:' + typeColor(type) + ";color:" + typeInk(type) + '">' +
        esc(titleType(type)) + "</span>";
    }).join("");
  }

  function metaLine(mon) {
    var meta = "<span>" + esc(generationLabel(mon.generation)) + "</span>";
    if (mon.stage > 1) meta += "<span>Stage " + mon.stage + "</span>";
    if (mon.starter) meta += "<span>Starter</span>";
    if (mon.legendary) meta += "<span>Legendary</span>";
    if (mon.mythical) meta += "<span>Mythical</span>";
    if (mon.baby) meta += "<span>Baby</span>";
    return meta;
  }

  function portraitHtml(file, pixel, fallback) {
    var src = artUrl(file);
    if (!src) return '<span class="monogram">' + esc(fallback.slice(0, 1)) + "</span>";
    return '<img src="' + esc(src) + '" alt="" class="' + (pixel ? "pixel" : "") + '" draggable="false">';
  }

  function inkBox(file) {
    var raw = (typeof FORM_INK !== "undefined" && file && FORM_INK[file]) || [0, 0, 1000, 1000];
    return { l: raw[0] / 1000, t: raw[1] / 1000, r: raw[2] / 1000, b: raw[3] / 1000 };
  }

  function isCompactForm(kind) {
    return kind === "mega" || kind === "gmax";
  }

  function opaqueSize(scale, box) {
    return { w: (box.r - box.l) * scale * 100, h: (box.b - box.t) * scale * 100 };
  }

  function spriteFromOpaque(anchorX, anchorY, scale, box) {
    var ox = ((box.l + box.r) / 2 - 0.5) * scale * 100;
    var oy = ((box.t + box.b) / 2 - 0.5) * scale * 100;
    return { x: anchorX - ox, y: anchorY - oy, scale: scale };
  }

  function opaqueRect(cx, cy, size) {
    return {
      left: cx - size.w / 2,
      right: cx + size.w / 2,
      top: cy - size.h / 2,
      bottom: cy + size.h / 2,
    };
  }

  function overlapAmount(a, b) {
    return {
      x: Math.min(a.right, b.right) - Math.max(a.left, b.left),
      y: Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
    };
  }

  function placeHero(boxes, compact, hero) {
    var heroScale = 0.96;
    var badgeCount = compact.filter(Boolean).length;
    var badgeScale = badgeCount > 2 ? 0.3 : badgeCount > 1 ? 0.34 : 0.4;
    var corners = [
      { x: 82, y: 82 },
      { x: 18, y: 82 },
      { x: 82, y: 20 },
      { x: 18, y: 20 },
    ];
    var placed = [];
    var corner = 0;
    for (var i = 0; i < boxes.length; i++) {
      if (i === hero) {
        placed.push(spriteFromOpaque(50, 50, heroScale, boxes[i]));
      } else {
        var spot = corners[Math.min(corner, corners.length - 1)];
        corner += 1;
        var size = opaqueSize(badgeScale, boxes[i]);
        var x = Math.min(98 - size.w / 2, Math.max(size.w / 2 + 1, spot.x));
        var y = Math.min(98 - size.h / 2, Math.max(size.h / 2 + 1, spot.y));
        placed.push(spriteFromOpaque(x, y, badgeScale, boxes[i]));
      }
    }
    return placed;
  }

  function placeEqualPair(boxes) {
    for (var step = 28; step >= 0; step--) {
      var scale = 0.56 + step * 0.008;
      var left = opaqueSize(scale, boxes[0]);
      var right = opaqueSize(scale, boxes[1]);
      var minX = left.w + right.w - 98;
      var minY = left.h + right.h - 98;
      if (minX > 22 || minY > 22) continue;
      var overlapX = Math.max(minX, 8);
      var overlapY = Math.max(minY, 8);
      var x0 = 1 + left.w / 2;
      var y0 = 1 + left.h / 2;
      var x1 = x0 + left.w / 2 - overlapX + right.w / 2;
      var y1 = y0 + left.h / 2 - overlapY + right.h / 2;
      if (x1 + right.w / 2 > 99) x1 = 99 - right.w / 2;
      if (y1 + right.h / 2 > 99) y1 = 99 - right.h / 2;
      var rects = [opaqueRect(x0, y0, left), opaqueRect(x1, y1, right)];
      if (rects[0].left < -1 || rects[0].top < -1 || rects[1].right > 101 || rects[1].bottom > 101) continue;
      var got = overlapAmount(rects[0], rects[1]);
      if (got.x < 5 || got.y < 5) continue;
      return [
        spriteFromOpaque(x0, y0, scale, boxes[0]),
        spriteFromOpaque(x1, y1, scale, boxes[1]),
      ];
    }
    return [
      spriteFromOpaque(34, 38, 0.66, boxes[0]),
      spriteFromOpaque(66, 62, 0.66, boxes[1]),
    ];
  }

  function placeRing(boxes, weights) {
    var count = boxes.length;
    var base = count <= 8 ? 0.4 : count <= 20 ? 0.28 : 0.18;
    var radius = count > 12 ? 34 : 30;
    return boxes.map(function (box, index) {
      var scale = base * weights[index];
      var angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
      var ax = 50 + Math.cos(angle) * radius;
      var ay = 50 + Math.sin(angle) * radius;
      var ux = 50 - ax;
      var uy = 50 - ay;
      var len = Math.hypot(ux, uy) || 1;
      ux /= len;
      uy /= len;
      var padX = ux >= 0 ? 1 - box.r : box.l;
      var padY = uy >= 0 ? 1 - box.b : box.t;
      var move = Math.max(0, (Math.abs(ux) * padX + Math.abs(uy) * padY) * scale * 100 * 0.85);
      return spriteFromOpaque(ax + ux * move, ay + uy * move, scale, box);
    });
  }

  function placeForms(forms) {
    var count = forms.length;
    if (count <= 1) return [{ x: 50, y: 50, scale: 1 }];
    var boxes = forms.map(function (form) { return inkBox(form.art); });
    var compact = forms.map(function (form) { return isCompactForm(form.kind); });
    var hero = -1;
    for (var i = 0; i < count; i++) {
      if (compact[i]) continue;
      if (hero < 0 || forms[i].kind === "default") hero = i;
    }
    if (hero >= 0 && compact.some(Boolean)) return placeHero(boxes, compact, hero);
    if (count === 2) return placeEqualPair(boxes);
    var weights = compact.map(function (isSmall) { return isSmall ? 0.62 : 1; });
    return placeRing(boxes, weights);
  }

  function cardHtml(mon, side) {
    var forms = formsOf(mon);
    var many = forms.length > 1;
    var hint = side === "a" ? "←" : "→";
    var testId = side === "a" ? "pick-a" : "pick-b";
    var aria = many ? "Pick " + mon.name + ", all " + forms.length + " forms" : "Pick " + mon.name;
    var head = '<p class="dex-no">#' + String(mon.id).padStart(4, "0") + "</p>" +
      "<h2>" + esc(mon.name) + "</h2>" +
      '<p class="meta">' + metaLine(mon) + "</p>";
    var placed = placeForms(forms);
    var lead = 0;
    for (var i = 0; i < forms.length; i++) {
      if (forms[i].kind === "default") {
        lead = i;
        break;
      }
    }
    var sprites = forms.map(function (entry, index) {
      var spot = placed[index];
      var z = index + 1;
      if (isCompactForm(entry.kind)) z = forms.length + 2 + index;
      else if (index === lead) z = forms.length + 1;
      return '<span class="sprite" style="left:' + spot.x.toFixed(2) + "%;top:" + spot.y.toFixed(2) +
        "%;--sprite:" + spot.scale.toFixed(3) + ";z-index:" + z +
        '" title="' + esc(entry.name) + '">' +
        portraitHtml(entry.art || mon.art, entry.pixel, entry.name) + "</span>";
    }).join("");
    var names = "";
    if (forms.length > 1 && forms.length <= 6) {
      names = '<ol class="form-names">' + forms.map(function (entry) {
        return "<li>" + esc(entry.name) + "</li>";
      }).join("") + "</ol>";
    }
    var layout = forms.length <= 1 ? "single" : forms.length === 2 ? "pair" : forms.length === 3 ? "triangle" : forms.length === 4 ? "diamond" : "circle";
    return '<article class="card ' + side + '">' +
      '<button type="button" class="pick" data-testid="' + testId + '" data-side="' + side +
      '" aria-label="' + esc(aria) + '">' +
      '<div class="portrait" data-forms="' + forms.length + '" data-layout="' + layout + '">' + sprites + "</div>" +
      names +
      head +
      '<div class="types">' + typeChips(mon.types) + "</div>" +
      '<span class="hint">Pick ' + hint + "</span></button></article>";
  }

  function renderHeader() {
    var summary = state().summary;
    var confidence = Math.round(summary.confidence * 100);
    var bound = Math.round(summary.lowerBoundBits).toLocaleString();
    var n = summary.matchups;
    els.count.textContent = n.toLocaleString() + " " + (n === 1 ? "matchup" : "matchups");
    els.bar.style.width = confidence + "%";
    els.confidence.title = confidence + "% of prior uncertainty has been resolved";
    els.bound.textContent = confidence + "% confidence · noiseless sort needs about " + bound + " comparisons";
    els.undo.disabled = state().history.length === 0;
    if (state().notice) {
      els.notice.hidden = false;
      els.noticeText.textContent = state().notice;
    } else {
      els.notice.hidden = true;
    }
  }

  function renderDuel() {
    var pair = sides();
    if (!pair.left || !pair.right) return;
    var key = pair.left.id + ":" + pair.right.id;
    if (key !== pairKey) {
      pairKey = key;
      setOffset(0);
    }
    els.live.textContent = votePhrase(pair.left) + " versus " + votePhrase(pair.right);
    els.cardA.innerHTML = cardHtml(pair.left, "a");
    els.cardB.innerHTML = cardHtml(pair.right, "b");
    els.undo.disabled = state().history.length === 0;
    fitPortraits();
    requestAnimationFrame(fitPortraits);
  }

  function fitPortraits() {
    if (view !== "duel") return;
    [els.cardA, els.cardB].forEach(function (slot) {
      var pick = slot.querySelector(".pick");
      var portrait = slot.querySelector(".portrait");
      if (!pick || !portrait) return;
      var used = 0;
      Array.prototype.forEach.call(pick.children, function (child) {
        if (child === portrait) return;
        var style = getComputedStyle(child);
        used += child.offsetHeight + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
      });
      var screen = document.querySelector(".screen");
      var screenBottom = screen ? screen.getBoundingClientRect().bottom : window.innerHeight;
      var limit = Math.min(window.innerHeight, screenBottom) - 8;
      var room = limit - pick.getBoundingClientRect().top - used;
      var size = Math.min(pick.clientWidth - 8, pick.clientHeight - used - 6, room);
      if (size < 48) size = 48;
      portrait.style.width = size + "px";
      portrait.style.height = size + "px";
    });
  }

  function shownRows() {
    var type = els.typeFilter.value;
    var generation = els.genFilter.value;
    var query = els.search.value.trim().toLowerCase();
    return state().rows.filter(function (row) {
      if (type !== "all" && row.pokemon.types.indexOf(type) === -1) return false;
      if (generation !== "all" && row.pokemon.generation !== Number(generation)) return false;
      if (query && row.pokemon.name.toLowerCase().indexOf(query) === -1) return false;
      return true;
    });
  }

  function renderBoard() {
    var rows = shownRows();
    var summary = state().summary;
    els.shown.textContent = "Showing " + rows.length.toLocaleString() + " of " + summary.species.toLocaleString();
    var leans = state().leans;
    if (leans.length > 0) {
      els.leans.hidden = false;
      els.leans.innerHTML = "Type leanings " + leans.map(function (lean) {
        var sign = lean.weight >= 0 ? "+" : "";
        return '<span class="' + (lean.weight >= 0 ? "up" : "down") + '">' +
          esc(titleType(lean.name.slice(5))) + " " + sign + lean.weight.toFixed(2) + "</span>";
      }).join(" ");
    } else {
      els.leans.hidden = true;
    }
    els.ledger.innerHTML = rows.map(function (row) {
      var art = row.pokemon.art
        ? '<img src="' + esc(artUrl(row.pokemon.art)) + '" alt="" loading="lazy">'
        : "<span>" + esc(row.pokemon.name.slice(0, 1)) + "</span>";
      var types = row.pokemon.types.map(function (name) {
        return '<span class="type" style="background:' + typeColor(name) + ";color:" + typeInk(name) + '">' +
          esc(titleType(name)) + "</span>";
      }).join("");
      return "<li>" +
        '<span class="rank">' + row.rank + "</span>" +
        '<span class="mini">' + art + "</span>" +
        '<span class="who"><strong>' + esc(row.pokemon.name) + '</strong><span class="types inline">' + types + "</span></span>" +
        '<span class="gen">' + esc(generationLabel(row.pokemon.generation)) + "</span>" +
        '<span class="score">' + formatScore(row.score) + "</span>" +
        '<span class="sd" title="Laplace standard deviation of this species\' strength">' + formatSd(row.sd) +
        '<i class="band" style="width:' + Math.min(100, row.sd * 36) + '%"></i></span>' +
        '<span class="games">' + row.games + "</span></li>";
    }).join("");
    els.filterEmpty.hidden = rows.length !== 0;
  }

  var GAME_LABELS = {
    "red-blue": "Red & Blue",
    yellow: "Yellow",
    "gold-silver": "Gold & Silver",
    crystal: "Crystal",
    "ruby-sapphire": "Ruby & Sapphire",
    emerald: "Emerald",
    "firered-leafgreen": "FireRed & LeafGreen",
    "diamond-pearl": "Diamond & Pearl",
    platinum: "Platinum",
    "heartgold-soulsilver": "HeartGold & SoulSilver",
    "black-white": "Black & White",
    "black-2-white-2": "Black 2 & White 2",
    "x-y": "X & Y",
    "omega-ruby-alpha-sapphire": "Omega Ruby & Alpha Sapphire",
    "sun-moon": "Sun & Moon",
    "ultra-sun-ultra-moon": "Ultra Sun & Ultra Moon",
    "lets-go-pikachu-lets-go-eevee": "Let's Go Pikachu & Let's Go Eevee",
    "sword-shield": "Sword & Shield",
    "the-isle-of-armor": "The Isle of Armor",
    "the-crown-tundra": "The Crown Tundra",
    "brilliant-diamond-and-shining-pearl": "Brilliant Diamond & Shining Pearl",
    "legends-arceus": "Legends: Arceus",
    "scarlet-violet": "Scarlet & Violet",
    "the-teal-mask": "The Teal Mask",
    "the-indigo-disk": "The Indigo Disk",
  };

  function traitLabel(categoryId, key) {
    var value = key.indexOf(":") === -1 ? key : key.slice(key.indexOf(":") + 1);
    if (categoryId === "generation") return generationLabel(Number(value));
    if (categoryId === "stage") {
      var stageParts = /^(\d+)-(evolves|final)$/.exec(value);
      if (stageParts) {
        return "Stage " + stageParts[1] + ", " + (stageParts[2] === "evolves" ? "evolves" : "does not evolve");
      }
      return "Stage " + value;
    }
    if (categoryId === "stats") {
      return {
        hp: "HP", attack: "Attack", defense: "Defense",
        "special-attack": "Sp. Atk", "special-defense": "Sp. Def", speed: "Speed", bst: "BST",
      }[value] || value;
    }
    if (categoryId === "body") return value === "height" ? "Height" : "Weight";
    if (categoryId === "ecology") {
      return { capture: "Catch rate", happiness: "Happiness", hatch: "Egg cycles" }[value] || value;
    }
    if (categoryId === "games" && GAME_LABELS[value]) return GAME_LABELS[value];
    if (categoryId === "evolution") {
      return {
        from: "Pre-evolution score",
        "into-mean": "Mean evolution score",
        "into-max": "Best evolution score",
      }[value] || value;
    }
    if (value === "water1") return "Water 1";
    if (value === "water2") return "Water 2";
    if (value === "humanshape") return "Human-like";
    if (value === "no-eggs") return "No eggs";
    return value.split("-").map(function (part) {
      return part.charAt(0).toUpperCase() + part.slice(1);
    }).join(" ");
  }

  function renderModel() {
    var model = state().model;
    var network = model.network;
    var layers = network && network.layers ? network.layers : [];
    var peak = 0.5;
    function bump(value) {
      if (Number.isFinite(value)) peak = Math.max(peak, Math.abs(value));
    }
    model.categories.forEach(function (category) {
      category.weights.forEach(function (row) { bump(row.weight); });
    });
    layers.forEach(function (layer) {
      (layer.units || []).forEach(function (unit) {
        bump(unit.bias);
        (unit.weights || []).forEach(function (row) { bump(row.weight); });
      });
    });
    if (network && network.output) {
      (network.output.weights || []).forEach(function (row) { bump(row.weight); });
    }
    function fact(term, value) {
      return "<div><dt>" + esc(term) + "</dt><dd>" + value + "</dd></div>";
    }
    var networkFact = "";
    if (network) {
      var hidden = network.hidden || [];
      networkFact = fact(
        "Network",
        String(hidden[0] || 0) + " then " + String(hidden[1] || 0) + " tanh units, then EV"
      );
    }
    els.modelFacts.innerHTML =
      fact("Family", esc(model.family)) +
      fact("Strength", "<code>" + esc(model.strength) + "</code>") +
      fact("Decisive win", "logistic of <code>" + esc(model.probability) + "</code>") +
      fact("Weight prior", "normal, sd " + model.sigmaW.toFixed(2)) +
      fact("Offset prior", "normal, sd " + model.sigmaB.toFixed(2) + ", one per species") +
      fact("Answers in the fit", model.comparisons.toLocaleString() + " (skips left out)") +
      fact("Newton steps", String(model.iterations) + (model.converged ? ", converged" : ", still moving")) +
      fact("Columns in x", model.columns.toLocaleString()) +
      networkFact;
    function weightRow(name, weight, sd) {
      var w = Number.isFinite(weight) ? weight : 0;
      var s = Number.isFinite(sd) ? sd : 0;
      var tone = w > 0.0005 ? "up" : w < -0.0005 ? "down" : "flat";
      var share = tone === "flat" ? 0 : Math.min(50, (Math.abs(w) / peak) * 50);
      var edge = w >= 0 ? "left:50%" : "right:50%";
      return "<li>" +
        '<span class="trait-name">' + esc(name) + "</span>" +
        '<span class="track" title="' + esc(formatScore(w) + " " + formatSd(s)) + '">' +
        '<i class="' + tone + '" style="' + edge + ";width:" + share.toFixed(2) + '%"></i></span>' +
        '<span class="trait-num ' + tone + '">' + formatScore(w) + "</span>" +
        '<span class="trait-sd">' + formatSd(s) + "</span></li>";
    }
    function featureLabel(name) {
      var c, w;
      for (c = 0; c < model.categories.length; c++) {
        var category = model.categories[c];
        for (w = 0; w < category.weights.length; w++) {
          if (category.weights[w].key === name) return traitLabel(category.id, name);
        }
      }
      return name;
    }
    els.modelCategories.innerHTML = model.categories.map(function (category) {
      var rows = category.weights.length === 0
        ? '<p class="trait-empty">Nothing in this dex turns this category on.</p>'
        : "<ol>" + category.weights.map(function (row) {
          return weightRow(traitLabel(category.id, row.key), row.weight, row.sd);
        }).join("") + "</ol>";
      return '<section class="trait" data-category="' + esc(category.id) + '">' +
        "<h3>" + esc(category.label) + ' <span class="encoding">' + esc(category.encoding) + "</span></h3>" +
        "<p>" + esc(category.detail) + "</p>" +
        '<p class="trait-count">' + category.weights.length +
        (category.weights.length === 1 ? " column" : " columns") + "</p>" +
        rows + "</section>";
    }).join("");
    if (!els.modelNetwork) return;
    if (!network || !layers.length) {
      els.modelNetwork.innerHTML = "";
      return;
    }
    var inputs = network.inputs || [];
    var inputCol = '<section class="net-col" data-category="inputs">' +
      '<h3>Inputs <span class="encoding">x</span></h3>' +
      "<p>" + inputs.length + " columns. These are the inputs to both the linear weights and the network.</p>" +
      '<ol class="net-inputs">' + inputs.map(function (name) {
        return "<li>" + esc(featureLabel(name)) + "</li>";
      }).join("") + "</ol></section>";
    function columnNames(count, prefix) {
      var names = [];
      var i;
      for (i = 0; i < count; i++) names.push(prefix + " · " + (i + 1));
      return names;
    }
    function fullIncoming(matrix, unitIndex, names, sd) {
      if (!matrix || !names || !names.length) return null;
      var width = names.length;
      if (matrix.length < (unitIndex + 1) * width) return null;
      var rows = [];
      var base = unitIndex * width;
      var i;
      for (i = 0; i < width; i++) {
        rows.push({ name: names[i], weight: matrix[base + i], sd: sd });
      }
      rows.sort(function (a, b) {
        var diff = Math.abs(b.weight) - Math.abs(a.weight);
        if (diff) return diff;
        if (a.name < b.name) return -1;
        if (a.name > b.name) return 1;
        return 0;
      });
      return rows;
    }
    var layerCols = layers.map(function (layer, layerIndex) {
      var units = layer.units || [];
      var nodes = units.map(function (unit, index) {
        var incomingNames = null;
        var matrix = null;
        if (layerIndex === 0) {
          matrix = network.W1;
          incomingNames = inputs;
        } else if (layerIndex === 1 && layers[0] && layers[0].units) {
          matrix = network.W2;
          incomingNames = columnNames(layers[0].units.length, "Hidden 1");
        }
        var weights = fullIncoming(matrix, index, incomingNames, unit.biasSd) || unit.weights || [];
        var rows = weightRow("Bias", unit.bias, unit.biasSd) +
          weights.map(function (row) {
            return weightRow(featureLabel(row.name), row.weight, row.sd);
          }).join("");
        var more = "";
        if (unit.fanIn > weights.length) {
          more = '<p class="net-more">Reads all ' + unit.fanIn +
            " inputs. Showing the " + weights.length + " strongest incoming weights.</p>";
        }
        return '<div class="net-node trait" data-unit="' + (index + 1) + '">' +
          "<h4>Unit " + (index + 1) + "</h4>" +
          "<ol>" + rows + "</ol>" + more + "</div>";
      }).join("");
      return '<section class="net-col" data-layer="' + esc(layer.name) + '">' +
        "<h3>" + esc(layer.name) + ' <span class="encoding">' + esc(layer.activation) + "</span></h3>" +
        "<p>" + units.length + " " + esc(layer.activation) +
        " units. Each adds a bias, weights its inputs, then squashes with " +
        esc(layer.activation) + ".</p>" +
        nodes + "</section>";
    }).join("");
    var output = network.output || { name: "EV", weights: [] };
    var evNames = layers[1] && layers[1].units ? columnNames(layers[1].units.length, "Hidden 2") : [];
    var evSd = layers[1] && layers[1].units && layers[1].units[0] && Number.isFinite(layers[1].units[0].biasSd)
      ? layers[1].units[0].biasSd
      : 0;
    var evWeights = fullIncoming(network.v, 0, evNames, evSd) || output.weights || [];
    var evRows = evWeights.map(function (row) {
      return weightRow(featureLabel(row.name), row.weight, row.sd);
    }).join("");
    var evCol = '<section class="net-col" data-layer="EV" data-category="ev">' +
      "<h3>" + esc(output.name || "EV") + ' <span class="encoding">readout</span></h3>' +
      "<p>EV(x) is this readout of Hidden 2. Strength is s = x·w + EV(x) + b.</p>" +
      '<div class="trait"><ol>' + evRows + "</ol></div></section>";
    els.modelNetwork.innerHTML = inputCol + layerCols + evCol;
  }

  function render() {
    renderHeader();
    var pair = sides();
    var showDuel = view === "duel" && pair.left && pair.right;
    els.duel.hidden = !showDuel;
    els.board.hidden = view !== "board";
    els.model.hidden = view !== "model";
    els.history.hidden = view !== "history";
    els.setup.hidden = view !== "setup";
    els.noDuel.hidden = view !== "duel" || Boolean(pair.left && pair.right);
    els.viewDuel.className = view === "duel" ? "on" : "";
    els.viewChoose.className = view === "setup" ? "on" : "";
    els.viewHistory.className = view === "history" ? "on" : "";
    els.viewBoard.className = view === "board" ? "on" : "";
    els.viewModel.className = view === "model" ? "on" : "";
    document.body.classList.toggle("view-duel", view === "duel");
    if (showDuel) renderDuel();
    if (view === "board") renderBoard();
    if (view === "model") renderModel();
    if (view === "history") renderHistory();
  }

  function outcomeLabel(outcome, left, right) {
    if (outcome === "tie") return "Tie";
    if (outcome === "skip") return "Skip";
    if (outcome === "a") return left + " won";
    if (outcome === "b") return right + " won";
    return outcome;
  }

  function renderHistory() {
    var history = state().history;
    var byId = state().byId;
    els.historyCount.textContent = history.length.toLocaleString() + " " + (history.length === 1 ? "answer" : "answers");
    els.historyEmpty.hidden = history.length !== 0;
    var rows = history.slice().reverse();
    els.matchLog.innerHTML = rows.map(function (entry) {
      var left = byId.get(entry.a);
      var right = byId.get(entry.b);
      var leftName = left ? left.name : "#" + entry.a;
      var rightName = right ? right.name : "#" + entry.b;
      var when = new Date(entry.at).toLocaleString();
      return "<li>" +
        '<span class="when">' + esc(when) + "</span>" +
        '<span class="bout">' + esc(leftName) + " vs " + esc(rightName) + "</span>" +
        '<span class="result">' + esc(outcomeLabel(entry.outcome, leftName, rightName)) + "</span>" +
        "</li>";
    }).join("");
  }

  function votePhrase(mon) {
    var count = formsOf(mon).length;
    return count > 1 ? mon.name + ", all " + count + " forms" : mon.name;
  }

  function setOffset(px) {
    offset = px;
    els.seal.style.transform = "translateX(" + (offset * 0.15) + "px)";
    els.hint.style.opacity = Number.isFinite(offset) ? String(Math.min(1, Math.abs(offset) / 90)) : "0";
    var pair = sides();
    if (!pair.left || offset === 0) els.hint.textContent = "Swipe or tap";
    else els.hint.textContent = offset < 0 ? "Pick " + votePhrase(pair.left) : "Pick " + votePhrase(pair.right);
  }

  function onCardClick(event, side) {
    if (!event.target.closest(".pick")) return;
    if (swiped) {
      swiped = false;
      return;
    }
    vote(side);
  }

  TYPE_ORDER.forEach(function (name) {
    var option = document.createElement("option");
    option.value = name;
    option.textContent = titleType(name);
    els.typeFilter.appendChild(option);
  });
  var gens = [];
  pokemon.forEach(function (mon) {
    if (gens.indexOf(mon.generation) === -1) gens.push(mon.generation);
  });
  gens.sort(function (a, b) { return a - b; });
  gens.forEach(function (gen) {
    var option = document.createElement("option");
    option.value = String(gen);
    option.textContent = generationLabel(gen);
    els.genFilter.appendChild(option);
  });

  var chosen = { a: null, b: null };

  function suggest(input, list, side) {
    var query = input.value.trim().toLowerCase();
    list.innerHTML = "";
    if (!query) return;
    var hits = pokemon.filter(function (mon) {
      return mon.name.toLowerCase().indexOf(query) !== -1;
    }).slice(0, 8);
    list.innerHTML = hits.map(function (mon) {
      return '<li><button type="button" data-id="' + mon.id + '">' + esc(mon.name) + "</button></li>";
    }).join("");
    list.querySelectorAll("button").forEach(function (button) {
      button.addEventListener("click", function () {
        var id = Number(button.getAttribute("data-id"));
        var mon = pokemon.filter(function (entry) { return entry.id === id; })[0];
        chosen[side] = mon || null;
        input.value = mon ? mon.name : "";
        document.getElementById(side === "a" ? "chosen-a" : "chosen-b").textContent = mon ? mon.name : "No species chosen";
        list.innerHTML = "";
        els.setupNote.hidden = true;
      });
    });
  }

  document.getElementById("query-a").addEventListener("input", function (event) {
    chosen.a = null;
    document.getElementById("chosen-a").textContent = "No species chosen";
    suggest(event.target, document.getElementById("suggest-a"), "a");
  });
  document.getElementById("query-b").addEventListener("input", function (event) {
    chosen.b = null;
    document.getElementById("chosen-b").textContent = "No species chosen";
    suggest(event.target, document.getElementById("suggest-b"), "b");
  });
  document.getElementById("begin-match").addEventListener("click", function () {
    if (!chosen.a || !chosen.b) {
      els.setupNote.hidden = false;
      els.setupNote.textContent = "Choose a species for each side.";
      return;
    }
    if (chosen.a.id === chosen.b.id) {
      els.setupNote.hidden = false;
      els.setupNote.textContent = "Pick two different species.";
      return;
    }
    ranker.queuePair(chosen.a.id, chosen.b.id);
    view = "duel";
    render();
  });

  document.getElementById("view-duel").addEventListener("click", function () {
    view = "duel";
    render();
  });
  document.getElementById("view-choose").addEventListener("click", function () {
    view = "setup";
    render();
  });
  document.getElementById("view-history").addEventListener("click", function () {
    view = "history";
    render();
  });
  document.getElementById("view-board").addEventListener("click", function () {
    view = "board";
    render();
  });
  document.getElementById("view-model").addEventListener("click", function () {
    view = "model";
    render();
  });
  document.getElementById("tie").addEventListener("click", function () { vote("tie"); });
  document.getElementById("skip").addEventListener("click", function () { vote("skip"); });
  document.getElementById("undo").addEventListener("click", undo);
  els.cardA.addEventListener("click", function (event) { onCardClick(event, "a"); });
  els.cardB.addEventListener("click", function (event) { onCardClick(event, "b"); });
  document.getElementById("notice-dismiss").addEventListener("click", function () {
    ranker.setNotice(null);
    renderHeader();
  });
  document.getElementById("export").addEventListener("click", function () {
    var blob = new Blob([ranker.exportText()], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "favordex-history.json";
    link.click();
    URL.revokeObjectURL(url);
  });
  document.getElementById("import").addEventListener("click", function () {
    document.getElementById("import-file").click();
  });
  document.getElementById("import-file").addEventListener("change", function (event) {
    var file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
    file.text().then(function (text) {
      try {
        ranker.importText(text);
      } catch (error) {
        ranker.setNotice(error instanceof Error ? error.message : "Could not import that file.");
      }
      render();
    });
  });
  document.getElementById("reset").addEventListener("click", function () {
    els.modal.hidden = false;
  });
  document.getElementById("keep").addEventListener("click", function () {
    els.modal.hidden = true;
  });
  document.getElementById("confirm-reset").addEventListener("click", function () {
    if (uiLock) return;
    uiLock = true;
    ranker.reset();
    els.modal.hidden = true;
    view = "duel";
    render();
    release();
  });

  els.search.addEventListener("input", function () { if (view === "board") renderBoard(); });
  els.typeFilter.addEventListener("change", function () { if (view === "board") renderBoard(); });
  els.genFilter.addEventListener("change", function () { if (view === "board") renderBoard(); });

  window.addEventListener("keydown", function (event) {
    var tag = event.target && event.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (els.modal.hidden === false && event.key === "Escape") {
      els.modal.hidden = true;
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      vote("a");
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      vote("b");
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      vote("tie");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      vote("skip");
    } else if (event.key === "Backspace") {
      event.preventDefault();
      undo();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
      event.preventDefault();
      undo();
    }
  });

  els.stage.addEventListener("pointerdown", function (event) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    var pick = event.target.closest(".pick");
    var side = null;
    if (pick && els.cardA.contains(pick)) side = "a";
    else if (pick && els.cardB.contains(pick)) side = "b";
    drag = { x: event.clientX, y: event.clientY, id: event.pointerId, side: side };
    try {
      els.stage.setPointerCapture(event.pointerId);
    } catch (error) {
      /* The pointer can already be gone. */
    }
  });
  els.stage.addEventListener("pointermove", function (event) {
    if (!drag || drag.id !== event.pointerId) return;
    setOffset(event.clientX - drag.x);
  });
  function finishPointer(event) {
    if (!drag || drag.id !== event.pointerId) return;
    var dx = event.clientX - drag.x;
    var dy = event.clientY - drag.y;
    var side = drag.side;
    drag = null;
    setOffset(0);
    if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      swiped = true;
      vote(dx > 0 ? "b" : "a");
      return;
    }
    // Pointer capture retargets the gesture, so a tap on Pick may never click the button.
    if (side) {
      swiped = true;
      vote(side);
    }
  }
  els.stage.addEventListener("pointerup", finishPointer);
  els.stage.addEventListener("pointercancel", finishPointer);

  var dexTheme = document.getElementById("dex-theme");
  dexTheme.value = document.documentElement.dataset.dex || "1";
  dexTheme.addEventListener("change", function () {
    var next = /^[1-9]$/.test(dexTheme.value) ? dexTheme.value : "1";
    document.documentElement.dataset.dex = next;
    try {
      localStorage.setItem("favordex.dex.v1", next);
    } catch (error) {
      /* The look still changes for this visit. */
    }
  });

  window.addEventListener("resize", fitPortraits);
  render();
})();
