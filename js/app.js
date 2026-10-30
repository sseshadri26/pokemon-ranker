/* PokeRanker page. Classic script. Opens from index.html with no server. */
(function () {
  var TYPE_ORDER = [
    "normal", "fire", "water", "grass", "electric", "ice", "fighting", "poison", "ground",
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
  function savedRankingMode() {
    try {
      var saved = window.FavordexRanker.readKey(localStorage, window.FavordexRanker.RANKING_MODE_KEY);
      if (saved === "full" || saved === "bradley-terry") return saved;
    } catch (error) {
      /* A missing store keeps the full model. */
    }
    return "full";
  }
  var ranker = window.FavordexRanker.createRanker(pokemon, { rankingMode: savedRankingMode() });
  var view = (function () {
    var saved = null;
    try {
      saved = localStorage.getItem(window.PokeRankerTabs.STORAGE_KEY);
    } catch (error) {
      /* No saved tab. */
    }
    return window.PokeRankerTabs.initialView(location.hash, saved);
  })();
  var pairKey = "";
  var offset = 0;
  var drag = null;
  var swiped = false;
  var uiLock = false;
  var speciesReturnId = null;
  var suppressRowClick = false;

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
    importModal: document.getElementById("import-modal"),
    viewDuel: document.getElementById("view-duel"),
    viewChoose: document.getElementById("view-choose"),
    viewHistory: document.getElementById("view-history"),
    viewBoard: document.getElementById("view-board"),
    viewModel: document.getElementById("view-model"),
    viewGrids: document.getElementById("view-grids"),
    grids: document.getElementById("grids"),
    gridList: document.getElementById("grid-list"),
    history: document.getElementById("history"),
    historyCount: document.getElementById("history-count"),
    matchLog: document.getElementById("match-log"),
    historyEmpty: document.getElementById("history-empty"),
    setup: document.getElementById("setup"),
    setupNote: document.getElementById("setup-note"),
    speciesPanel: document.getElementById("species-panel"),
    speciesTitle: document.getElementById("species-title"),
    speciesKicker: document.getElementById("species-kicker"),
    speciesBody: document.getElementById("species-body"),
    speciesClose: document.getElementById("species-close"),
    rankFull: document.getElementById("rank-full"),
    rankBt: document.getElementById("rank-bt"),
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

  function reviseHistory(index, outcome) {
    if (uiLock) return;
    var entry = state().history[index];
    if (!entry || entry.outcome === outcome) return;
    uiLock = true;
    ranker.editOutcome(index, outcome);
    render();
    release();
  }

  function removeHistory(index) {
    if (uiLock) return;
    uiLock = true;
    ranker.deleteEntry(index);
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

  // Many forms: a tight grid that fills the square portrait. Columns = ceil(sqrt(n)) maximises
  // the cell size in a square; a short last row is centred. Each sprite is scaled so its opaque
  // (ink) box fills its cell, with a little overlap so transparent corners don't read as gaps.
  function placeGrid(boxes, weights) {
    var count = boxes.length;
    var cols = Math.ceil(Math.sqrt(count));
    var rows = Math.ceil(count / cols);
    var cellW = 100 / cols;
    var cellH = 100 / rows;
    var cell = Math.min(cellW, cellH);
    var top = (100 - cell * rows) / 2;
    var overlap = count >= 9 ? 1.12 : 1.04;
    return boxes.map(function (box, index) {
      var row = Math.floor(index / cols);
      var col = index % cols;
      var inRow = row === rows - 1 ? count - row * cols : cols;
      var left = (100 - cell * inRow) / 2;
      var bw = Math.max(0.05, box.r - box.l);
      var bh = Math.max(0.05, box.b - box.t);
      var scale = Math.min(cell / bw, cell / bh) / 100 * overlap * weights[index];
      return spriteFromOpaque(left + cell * (col + 0.5), top + cell * (row + 0.5), scale, box);
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
    if (hero >= 0 && compact.some(Boolean) && count <= 5) return placeHero(boxes, compact, hero);
    if (count === 2) return placeEqualPair(boxes);
    var weights = compact.map(function (isSmall) { return isSmall ? 0.62 : 1; });
    if (count >= 4) return placeGrid(boxes, weights);
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
    var layout = forms.length <= 1 ? "single" : forms.length === 2 ? "pair" : forms.length === 3 ? "triangle" : "grid";
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
      var limit = window.innerHeight - 8;
      if (screen) {
        var screenRect = screen.getBoundingClientRect();
        var contentBottom = screenRect.top + screen.clientTop + screen.clientHeight;
        limit = Math.min(limit, contentBottom - 4);
      }
      var room = limit - pick.getBoundingClientRect().top - used;
      var size = Math.min(pick.clientWidth - 8, pick.clientHeight - used - 6, room);
      if (size < 48) size = 48;
      if (size > room) size = Math.max(0, room);
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
    var plainOrder = state().rankingMode === "bradley-terry";
    if (els.rankFull && els.rankBt) {
      els.rankFull.className = plainOrder ? "" : "on";
      els.rankBt.className = plainOrder ? "on" : "";
      els.rankFull.setAttribute("aria-pressed", plainOrder ? "false" : "true");
      els.rankBt.setAttribute("aria-pressed", plainOrder ? "true" : "false");
    }
    var leans = state().leans;
    if (!plainOrder && leans.length > 0) {
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
      return '<li data-id="' + row.pokemon.id + '" tabindex="0" aria-haspopup="dialog">' +
        '<span class="move">' +
        '<button type="button" data-dir="up" aria-label="Move ' + esc(row.pokemon.name) + ' up">Up</button>' +
        '<button type="button" data-dir="down" aria-label="Move ' + esc(row.pokemon.name) + ' down">Down</button>' +
        "</span>" +
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
      fact("Answers in the fit", model.comparisons.toLocaleString()) +
      fact("Newton steps", String(model.iterations) + (model.converged ? ", converged" : ", still moving")) +
      fact("Columns in x", model.columns.toLocaleString()) +
      (effects ? fact("Total effect", "The linear weight is the direct effect; the total also includes the network's average contribution" +
        (effects.network ? "" : " (the network is off, so they match)") + ". Computed in " + effects.ms + " ms.") : "") +
      networkFact;
    // Total effect: linear weight plus the network's average contribution, computed once per fit.
    var effects = ranker.totalEffects();
    var GAME_NOTE = "Game columns hold shares (1/n for a species in n games). The total effect here is one full unit of " +
      "this game column (as for a species found only in this game), with the species' other game shares unchanged.";
    function totalCell(key) {
      if (!effects) return "";
      var e = effects.byName[key];
      if (!e) return '<span class="trait-total"></span>';
      var unit = e.kind === "continuous" ? " per 1 SD" : "";
      var tip = "Average total effect on x·w + EV(x)" + unit + ", over all species. Middle 80% of species: " +
        formatScore(e.p10) + " to " + formatScore(e.p90) + " (SD " + e.sd.toFixed(2) + ")." +
        (e.kind === "continuous" ? " The linear weight is per unit; 1 SD of this column is " + e.colSd.toFixed(2) + "." : "") +
        (e.kind === "share" ? " " + GAME_NOTE : "") +
        (e.kind === "one-hot" ? " Compared with the whole block off, so the row never has two columns of the block on." : "");
      var spread = e.p90 - e.p10 > 0.005 ? '<small>' + formatScore(e.p10) + "…" + formatScore(e.p90) + "</small>" : "";
      return '<span class="trait-total" title="' + esc(tip) + '">' + formatScore(e.mean) +
        (unit ? "<small>/SD</small>" : "") + spread + "</span>";
    }
    function weightRow(name, weight, sd, key) {
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
        '<span class="trait-sd">' + formatSd(s) + "</span>" + totalCell(key) + "</li>";
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
          return weightRow(traitLabel(category.id, row.key), row.weight, row.sd, row.key);
        }).join("") + "</ol>";
      return '<section class="trait" data-category="' + esc(category.id) + '">' +
        "<h3>" + esc(category.label) + ' <span class="encoding">' + esc(category.encoding) + "</span></h3>" +
        "<p>" + esc(category.detail) + "</p>" +
        (effects ? '<p class="trait-cols">Weight · ± · <b>Total</b>' + (category.id === "games" ? ' <span title="' + esc(GAME_NOTE) + '">(games: one full unit ⓘ)</span>' : "") + "</p>" : "") +
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

  function countLabel(n, one, many) {
    return n.toLocaleString() + " " + (n === 1 ? one : many);
  }

  function formatInput(value) {
    if (!Number.isFinite(value)) return "0";
    var nearest = Math.round(value);
    if (Math.abs(value - nearest) < 1e-9) return String(nearest);
    return value.toFixed(3);
  }

  function formatBreakdown(value) {
    var text = value.toFixed(3);
    return value > 0 ? "+" + text : text;
  }

  function signedDigits(value, digits) {
    var text = value.toFixed(digits);
    return value > 0 ? "+" + text : text;
  }

  function equationDigits(linear, ev, offsetValue) {
    var digits = 3;
    function q(n, d) {
      return Math.round(n * Math.pow(10, d));
    }
    while (digits <= 8) {
      if (q(linear, digits) + q(ev, digits) + q(offsetValue, digits) === q(linear + ev + offsetValue, digits)) {
        return digits;
      }
      digits += 1;
    }
    return 4;
  }

  function certaintyPhrase(sd) {
    if (!Number.isFinite(sd)) return "The certainty of this strength is unknown.";
    if (sd < 0.35) return "Very certain. A smaller Laplace deviation means this strength is more pinned down.";
    if (sd < 0.75) return "Fairly certain. The Laplace deviation has narrowed, so this rank is more settled than a wide bar.";
    if (sd < 1.25) return "Somewhat uncertain. This Laplace deviation is still wide, and more matchups would make it more certain.";
    return "Uncertain. This Laplace deviation is large, so the strength can still move. A smaller deviation would mean more certainty.";
  }

  function resultWord(result) {
    if (result === "won") return "Won";
    if (result === "lost") return "Lost";
    if (result === "tie") return "Tie";
    if (result === "skip") return "Skip";
    return result;
  }

  function whenLabel(at) {
    var date = new Date(at);
    if (!Number.isFinite(date.getTime())) return "Unknown time";
    return date.toLocaleString();
  }

  function hideSpecies(restore) {
    if (!els.speciesPanel || els.speciesPanel.hidden) return;
    var id = speciesReturnId;
    els.speciesPanel.hidden = true;
    speciesReturnId = null;
    if (restore && id != null) {
      var row = els.ledger.querySelector('li[data-id="' + id + '"]');
      if (row) row.focus({ preventScroll: true });
    }
  }

  function showSpecies(id) {
    var detail = ranker.speciesDetail(id);
    if (!detail || !els.speciesPanel) return false;
    speciesReturnId = id;
    var dex = "#" + String(detail.dex).padStart(4, "0");
    els.speciesKicker.textContent = dex + " · " + generationLabel(detail.generation);
    els.speciesTitle.textContent = detail.name;
    var art = detail.art
      ? '<span class="mini"><img src="' + esc(artUrl(detail.art)) + '" alt=""></span>'
      : "";
    var forms = detail.forms.filter(function (form) { return form && form.name; });
    var formHtml = forms.length > 1
      ? '<p class="species-forms">Forms: ' + forms.map(function (form) { return esc(form.name); }).join(", ") + "</p>"
      : "";
    var breakdown;
    if (detail.ranking === "bradley-terry") {
      breakdown =
        '<section data-testid="species-breakdown"><h3 class="species-sub">Bradley–Terry</h3>' +
        '<p data-testid="species-plain">This order uses the Bradley–Terry strength only. The trait model and the network are not used in this order.</p>' +
        '<p class="parts-equation" data-testid="species-equation">' +
        "<span>s = b <strong>" + formatScore(detail.strength) + "</strong></span>" +
        "<span>Laplace sd <strong>" + formatSd(detail.sd) + "</strong></span>" +
        "</p></section>";
    } else {
      var digits = equationDigits(detail.linear, detail.ev, detail.offset);
      var equation = signedDigits(detail.linear, digits) + " + " +
        signedDigits(detail.ev, digits) + " + " +
        signedDigits(detail.offset, digits) + " = " +
        signedDigits(detail.linear + detail.ev + detail.offset, digits);
      var categories = detail.categories.length
        ? detail.categories.map(function (category) {
          var rows = category.columns.map(function (column) {
            return "<li>" +
              '<span class="trait-name">' + esc(traitLabel(category.id, column.key)) + "</span>" +
              '<span class="contrib-num">' + esc(formatInput(column.value)) + "</span>" +
              '<span class="contrib-num">' + formatBreakdown(column.weight) + "</span>" +
              '<span class="contrib-num">' + formatBreakdown(column.contribution) + "</span></li>";
          }).join("");
          return '<section class="trait" data-testid="species-category" data-category="' + esc(category.id) + '">' +
            "<h3>" + esc(category.label) + ' <span class="encoding">sum ' + formatBreakdown(category.contribution) + "</span></h3>" +
            '<p class="contrib-head"><span>Column</span><span>Input</span><span>Weight</span><span>Value × weight</span></p>' +
            '<ol class="contrib">' + rows + "</ol></section>";
        }).join("")
        : '<p class="empty">No trait columns are on for this species.</p>';
      var gap = detail.partsMatch
        ? ""
        : '<p class="empty">Linear + network + offset differs from the fitted strength.</p>';
      breakdown =
        '<section data-testid="species-breakdown"><h3 class="species-sub">Model breakdown</h3>' +
        "<p>s = x·w + EV(x) + b. Zero columns for this species are hidden. The rest are sorted by how much they add.</p>" +
        '<p class="parts-equation" data-testid="species-equation">' +
        "<span>x·w <strong>" + signedDigits(detail.linear, digits) + "</strong></span>" +
        "<span>EV(x) <strong>" + signedDigits(detail.ev, digits) + "</strong></span>" +
        "<span>b <strong>" + signedDigits(detail.offset, digits) + "</strong></span>" +
        "<span>s <strong>" + signedDigits(detail.linear + detail.ev + detail.offset, digits) + "</strong></span>" +
        "</p>" +
        '<p class="offset-note">Shown as ' + esc(equation) + ". The ranking row rounds this strength to two decimals.</p>" +
        gap +
        '<p class="offset-note">The species offset is part of the strength even when it is near zero. An uncompared species stays near the trait prediction because the offset prior pulls b toward 0.</p>' +
        categories +
        "</section>";
    }
    var matchups = detail.matchups.length
      ? '<ol class="match-log">' + detail.matchups.map(function (bout) {
        return "<li>" +
          '<span class="bout">' + esc(bout.opponent) + "</span>" +
          '<span class="result">' + esc(resultWord(bout.result)) + "</span>" +
          '<span class="when">' + esc(whenLabel(bout.at)) + "</span></li>";
      }).join("") + "</ol>"
      : '<p class="empty">No matchups yet.</p>';
    els.speciesBody.innerHTML =
      '<div class="species-id">' + art +
      '<div class="types">' + typeChips(detail.types) + "</div></div>" +
      formHtml +
      '<dl class="facts">' +
      '<div><dt>Rank</dt><dd data-testid="species-rank">' + detail.rank + "</dd></div>" +
      '<div><dt>Strength</dt><dd data-testid="species-strength">' + formatScore(detail.strength) + "</dd></div>" +
      '<div><dt>Uncertainty</dt><dd data-testid="species-uncertainty">' + formatSd(detail.sd) + "</dd></div>" +
      uncertaintyRows(detail.uncertainty) +
      '<div><dt>Matchups</dt><dd data-testid="species-matchups-count">' + detail.games + "</dd></div>" +
      "</dl>" +
      '<p class="certainty" data-testid="species-certainty">' + esc(certaintyPhrase(detail.sd)) + "</p>" +
      "<h3 class=\"species-sub\">Record</h3>" +
      '<ul class="record">' +
      "<li>" + countLabel(detail.record.wins, "win", "wins") + "</li>" +
      "<li>" + countLabel(detail.record.losses, "loss", "losses") + "</li>" +
      "<li>" + countLabel(detail.record.ties, "tie", "ties") + "</li>" +
      "</ul>" +
      '<p>' + countLabel(detail.games, "matchup", "matchups") + " in the ranking.</p>" +
      '<section data-testid="species-matchups"><h3 class="species-sub">Matchups</h3>' + matchups + "</section>" +
      breakdown;
    els.speciesPanel.hidden = false;
    return true;
  }

  function openSpecies(id) {
    if (!showSpecies(id)) return;
    els.speciesClose.focus({ preventScroll: true });
  }

  // Full model only: how the ± splits into a trait part and the species' own adjustment, plus
  // the old figure that added the two as if independent. Display only; the picker uses the ±.
  function uncertaintyRows(u) {
    if (!u) return "";
    return '<div class="unc-split" data-testid="species-uncertainty-split"><dt>Split</dt><dd>' +
      "traits " + formatSd(u.trait) + " · own " + formatSd(u.own) + "</dd></div>" +
      '<div class="unc-split" data-testid="species-uncertainty-naive" title="Adds the trait and own-adjustment parts as if independent. ' +
      'It ignores the trade-off between them: when the traits push one way, the own adjustment moves to compensate.">' +
      "<dt>Uncorrected</dt><dd>" + formatSd(u.naive) +
      ' <small>old figure, ignores the traits/own trade-off</small></dd></div>';
  }

  var Tabs = window.PokeRankerTabs;
  function rememberTab() {
    try {
      localStorage.setItem(Tabs.STORAGE_KEY, view);
    } catch (error) {
      /* The tab still works for this visit. */
    }
    var hash = Tabs.hashFor(view);
    if (location.hash !== hash) {
      // A tab click adds a history entry so Back returns to the previous tab.
      if (tabNavigated) history.pushState(null, "", hash);
      else history.replaceState(null, "", hash);
    }
    tabNavigated = false;
  }
  var tabNavigated = false;
  document.querySelector("nav").addEventListener("click", function () {
    tabNavigated = true;
  }, true);
  window.addEventListener("hashchange", function () {
    var next = Tabs.fromHash(location.hash);
    if (next && next !== view) {
      view = next;
      render();
    }
  });

  function render() {
    rememberTab();
    ranker.setBoardVisible(view === "board");
    if (view !== "board" && view !== "grids") hideSpecies(false);
    renderHeader();
    var pair = sides();
    var showDuel = view === "duel" && pair.left && pair.right;
    els.duel.hidden = !showDuel;
    els.board.hidden = view !== "board";
    els.model.hidden = view !== "model";
    els.grids.hidden = view !== "grids";
    els.viewGrids.className = view === "grids" ? "on" : "";
    els.history.hidden = view !== "history";
    els.setup.hidden = view !== "setup";
    els.noDuel.hidden = view !== "duel" || Boolean(pair.left && pair.right);
    els.viewDuel.className = view === "duel" ? "on" : "";
    els.viewChoose.className = view === "setup" ? "on" : "";
    els.viewHistory.className = view === "history" ? "on" : "";
    els.viewBoard.className = view === "board" ? "on" : "";
    els.viewModel.className = view === "model" ? "on" : "";
    [els.viewDuel, els.viewChoose, els.viewHistory, els.viewBoard, els.viewGrids, els.viewModel].forEach(function (tab) {
      if (tab.className === "on") tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    });
    document.body.classList.toggle("view-duel", view === "duel");
    if (showDuel) renderDuel();
    if (view === "board") renderBoard();
    if (view === "board" && speciesReturnId != null && els.speciesPanel && !els.speciesPanel.hidden) {
      showSpecies(speciesReturnId);
    }
    if (view === "model") renderModel();
    if (view === "grids") renderGrids();
    if (view === "history") renderHistory();
  }

  function outcomeLabel(outcome, left, right) {
    if (outcome === "tie") return "Tie";
    if (outcome === "skip") return "Skip";
    if (outcome === "a") return left + " won";
    if (outcome === "b") return right + " won";
    return outcome;
  }

  function outcomeButton(outcome, current, label, testId) {
    var pressed = current === outcome ? "true" : "false";
    return '<button type="button" data-outcome="' + outcome + '" data-testid="' + testId +
      '" aria-pressed="' + pressed + '">' + label + "</button>";
  }

  function voteControls(entry, leftName, rightName) {
    return '<div class="vote-edit" role="group" aria-label="' +
      esc("Change vote, " + leftName + " vs " + rightName) + '">' +
      outcomeButton("a", entry.outcome, 'Pick left <span class="side-name">' + esc(leftName) + "</span>", "history-pick-left") +
      outcomeButton("b", entry.outcome, 'Pick right <span class="side-name">' + esc(rightName) + "</span>", "history-pick-right") +
      outcomeButton("tie", entry.outcome, "Tie", "history-tie") +
      '<button type="button" data-action="delete" data-testid="history-delete" aria-label="' +
      esc("Delete " + leftName + " vs " + rightName) + '">Delete</button></div>';
  }

  function renderHistory() {
    var history = state().history;
    var byId = state().byId;
    els.historyCount.textContent = history.length.toLocaleString() + " " + (history.length === 1 ? "answer" : "answers");
    els.historyEmpty.hidden = history.length !== 0;
    els.matchLog.innerHTML = history.map(function (entry, index) {
      var left = byId.get(entry.a);
      var right = byId.get(entry.b);
      var leftName = left ? left.name : "#" + entry.a;
      var rightName = right ? right.name : "#" + entry.b;
      var when = new Date(entry.at).toLocaleString();
      return '<li data-index="' + index + '">' +
        '<span class="when">' + esc(when) + "</span>" +
        '<span class="bout">' + esc(leftName) + " vs " + esc(rightName) + "</span>" +
        '<span class="result">' + esc(outcomeLabel(entry.outcome, leftName, rightName)) + "</span>" +
        voteControls(entry, leftName, rightName) +
        "</li>";
    }).reverse().join("");
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
  function chooseRanking(mode) {
    try {
      localStorage.setItem(window.FavordexRanker.RANKING_MODE_KEY, mode);
    } catch (error) {
      /* The order still changes for this visit. */
    }
    ranker.setRankingMode(mode);
    if (view === "board") render();
  }
  document.getElementById("rank-full").addEventListener("click", function () {
    chooseRanking("full");
  });
  document.getElementById("rank-bt").addEventListener("click", function () {
    chooseRanking("bradley-terry");
  });
  // ---- Grids ----
  var Grids = window.PokeRankerGrids;
  var grids = Grids.load(localStorage);
  var traitList = Grids.traitOptions(pokemon);
  var gridTraitName = new Map(traitList.map(function (t) { return [t.id, t.label]; }));
  var traitGroups = [];
  var traitSelectHtml = (function () {
    var html = "";
    var group = null;
    traitList.forEach(function (t) {
      if (t.group !== group) {
        if (group) html += "</optgroup>";
        group = t.group;
        if (group) {
          // A select can't make the group heading clickable, so each group starts with an "add all" entry.
          traitGroups.push(group);
          var count = traitList.filter(function (o) { return o.group === group; }).length;
          html += '<optgroup label="' + esc(group) + '"><option value="addall:' + (traitGroups.length - 1) + '">All ' +
            esc(group) + " (" + count + ") →</option>";
        }
      }
      html += '<option value="' + esc(t.id) + '">' + esc(t.label) + "</option>";
    });
    if (group) html += "</optgroup>";
    return html;
  })();

  function saveGrids() {
    try {
      Grids.save(localStorage, grids);
    } catch (error) {
      /* The grids still work for this visit. */
    }
  }

  function traitSelect(axis, index, value, gridName) {
    var label = (axis === "row" ? "Row " : "Column ") + (index + 1) + " trait, " + gridName;
    // The visible label wraps; the select sits invisibly on top so nothing is clipped.
    var html = '<span class="axis-label" aria-hidden="true">' + esc(gridTraitName.get(value) || value) + "</span>" +
      '<select data-axis="' + axis + '" data-i="' + index + '" aria-label="' + esc(label) + '">' + traitSelectHtml + "</select>";
    return html.replace('value="' + esc(value) + '"', 'value="' + esc(value) + '" selected');
  }

  function gridCellHtml(grid, found, rowTrait, colTrait, r, c) {
    if (!found.best) {
      var why = found.count ? "Every match is already used elsewhere (No duplicates)" : "No Pokémon fits this cell and the grid rules";
      return '<td class="grid-cell none" title="' + why + '">–</td>';
    }
    var mon = found.best.pokemon;
    var form = Grids.cellForm(grid, mon, rowTrait, colTrait) || { name: mon.name, art: mon.art };
    var hint = form.name + " · #" + found.best.rank + " · " + found.count.toLocaleString() +
      (found.count === 1 ? " match" : " matches") +
      (found.next ? " · next: " + found.next.pokemon.name + " #" + found.next.rank : "");
    return '<td class="grid-cell"><button type="button" class="grid-pick" data-id="' + mon.id + '" data-r="' + r +
      '" data-c="' + c + '" title="' + esc(hint) + '" aria-label="' + esc(hint) + '">' +
      '<span class="grid-art">' + portraitHtml(form.art || mon.art, form.pixel, mon.name) + "</span>" +
      '<span class="grid-name" aria-hidden="true">' + esc(mon.name) + "</span>" +
      '<span class="grid-rank" aria-hidden="true">' + found.best.rank + "</span></button></td>";
  }

  var ruleSelectHtml = '<option value="" selected>+ Add rule…</option>' +
    traitSelectHtml.replace(/<option value="addall:[^"]*">[^<]*<\/option>/g, "").replace('<option value="all">All</option>', "");

  function rulesHtml(grid) {
    var chips = (grid.rules || []).map(function (rule, i) {
      var name = gridTraitName.get(rule.trait) || rule.trait;
      var ex = rule.mode === "exclude";
      return '<span class="rule-chip' + (ex ? " ex" : "") + '">' +
        '<button type="button" class="rule-mode" data-act="rule-mode" data-i="' + i + '" title="Switch between must have and must not have" aria-label="' +
        esc((ex ? "Exclude " : "Include ") + name + ", switch") + '">' + (ex ? "Not" : "Only") + "</button>" +
        '<span class="rule-name">' + esc(name) + "</span>" +
        '<button type="button" class="rule-x" data-act="rule-del" data-i="' + i + '" aria-label="Remove rule ' + esc(name) + '">×</button></span>';
    }).join("");
    var summary = Grids.rulesText(grid, function (t) { return gridTraitName.get(t); });
    return '<div class="grid-rules"><span class="grid-rules-label">Rules</span>' + chips +
      '<label class="rule-add"><span class="sr-only">Add a rule to ' + esc(grid.name) + '</span><select class="rule-select">' + ruleSelectHtml + "</select></label>" +
      '<label class="rule-unique"><input type="checkbox" class="rule-unique-box"' + (grid.unique ? " checked" : "") + "> No duplicates</label>" +
      (summary ? '<span class="grid-rules-sum" title="Same category: any one of them. Different categories: all of them.">Every cell: ' + esc(summary) + "</span>" : "") +
      "</div>";
  }

  function renderGrids() {
    var rows = state().rows;
    if (grids.length === 0) {
      els.gridList.innerHTML = '<p class="empty">No grids yet. Make one with New grid.</p>';
      return;
    }
    els.gridList.innerHTML = grids.map(function (grid) {
      var cells = Grids.gridCells(grid, rows);
      var head = '<th class="grid-corner" scope="col"><button type="button" data-act="add-row">+ Row</button>' +
        '<button type="button" data-act="add-col">+ Column</button></th>' +
        grid.cols.map(function (trait, c) {
          return '<th scope="col"><div class="grid-axis">' + traitSelect("col", c, trait, grid.name) +
            (grid.cols.length > 1 ? '<button type="button" class="grid-x" data-act="del-col" data-i="' + c +
              '" aria-label="Remove column ' + esc(gridTraitName.get(trait) || trait) + '">×</button>' : "") +
            "</div></th>";
        }).join("");
      var body = grid.rows.map(function (rowTrait, r) {
        return '<tr><th scope="row"><div class="grid-axis">' + traitSelect("row", r, rowTrait, grid.name) +
          (grid.rows.length > 1 ? '<button type="button" class="grid-x" data-act="del-row" data-i="' + r +
            '" aria-label="Remove row ' + esc(gridTraitName.get(rowTrait) || rowTrait) + '">×</button>' : "") +
          "</div></th>" +
          grid.cols.map(function (colTrait, c) { return gridCellHtml(grid, cells[r][c], rowTrait, colTrait, r, c); }).join("") + "</tr>";
      }).join("");
      return '<article class="grid-card" data-grid="' + esc(grid.id) + '">' +
        '<div class="grid-title"><input class="grid-title-input" value="' + esc(grid.name) + '" aria-label="Grid name" maxlength="80">' +
        '<button type="button" data-act="png" title="Download this grid as a picture">Export PNG</button>' +
        '<button type="button" data-act="json" title="Download just this grid; Import → Append adds it">Grid file (.json)</button>' +
        '<button type="button" data-act="dup">Duplicate</button>' +
        '<button type="button" class="danger" data-act="del">Delete</button></div>' +
        rulesHtml(grid) +
        '<div class="grid-scroll"><table class="trait-grid"><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table></div></article>";
    }).join("");
    restoreGridScroll();
  }

  // The grid last touched is remembered so a refresh on the Grids tab scrolls back to it.
  var gridToRestore = null;
  try {
    gridToRestore = localStorage.getItem(Tabs.GRID_KEY);
  } catch (error) {
    /* Nothing to restore. */
  }
  function restoreGridScroll() {
    if (!gridToRestore) return;
    var card = els.gridList.querySelector('.grid-card[data-grid="' + gridToRestore.replace(/["\\]/g, "") + '"]');
    gridToRestore = null;
    if (card && card !== els.gridList.firstElementChild) card.scrollIntoView({ block: "start" });
  }
  function rememberGrid(grid) {
    try {
      localStorage.setItem(Tabs.GRID_KEY, grid.id);
    } catch (error) {
      /* Optional. */
    }
  }

  function gridOf(el) {
    var card = el.closest(".grid-card");
    if (!card) return null;
    var id = card.getAttribute("data-grid");
    return grids.find(function (g) { return g.id === id; }) || null;
  }

  document.getElementById("grid-add").addEventListener("click", function () {
    grids.push(Grids.makeGrid("Grid " + (grids.length + 1)));
    saveGrids();
    renderGrids();
  });
  els.gridList.addEventListener("click", function (event) {
    var pick = event.target.closest(".grid-pick");
    if (pick) {
      if (gridOf(pick)) rememberGrid(gridOf(pick));
      openFormPop(pick);
      return;
    }
    var btn = event.target.closest("button[data-act]");
    if (!btn) return;
    var grid = gridOf(btn);
    if (!grid) return;
    rememberGrid(grid);
    var act = btn.getAttribute("data-act");
    if (act === "rule-mode" || act === "rule-del") {
      var ruleIndex = Number(btn.getAttribute("data-i"));
      var rule = grid.rules[ruleIndex];
      if (rule && act === "rule-mode") {
        var flipped = rule.mode === "exclude" ? "include" : "exclude";
        var dupe = grid.rules.some(function (o) { return o !== rule && o.trait === rule.trait && o.mode === flipped; });
        if (dupe) grid.rules.splice(ruleIndex, 1);
        else rule.mode = flipped;
      } else if (rule) grid.rules.splice(ruleIndex, 1);
      saveGrids();
      renderGrids();
      return;
    }
    if (act === "png") {
      exportGridPng(grid);
      return;
    }
    if (act === "json") {
      downloadBlob(new Blob([Grids.gridFileText(grid)], { type: "application/json" }), gridFileName(grid) + ".json");
      return;
    }
    var i = Number(btn.getAttribute("data-i"));
    if (act === "add-row") grid.rows.push(Grids.ALL);
    else if (act === "add-col") grid.cols.push(Grids.ALL);
    else if (act === "del-row" && grid.rows.length > 1) grid.rows.splice(i, 1);
    else if (act === "del-col" && grid.cols.length > 1) grid.cols.splice(i, 1);
    else if (act === "dup") {
      var copy = Grids.makeGrid(grid.name + " copy");
      copy.rows = grid.rows.slice();
      copy.cols = grid.cols.slice();
      copy.picks = JSON.parse(JSON.stringify(grid.picks || {}));
      copy.rules = JSON.parse(JSON.stringify(grid.rules || []));
      copy.unique = Boolean(grid.unique);
      grids.splice(grids.indexOf(grid) + 1, 0, copy);
    } else if (act === "del") {
      if (!window.confirm("Delete the grid “" + grid.name + "”?")) return;
      grids.splice(grids.indexOf(grid), 1);
    }
    saveGrids();
    renderGrids();
  });
  els.gridList.addEventListener("change", function (event) {
    var grid = gridOf(event.target);
    if (!grid) return;
    if (event.target.matches("select[data-axis]")) {
      var isRow = event.target.getAttribute("data-axis") === "row";
      var list = isRow ? grid.rows : grid.cols;
      var value = event.target.value;
      if (value.indexOf("addall:") === 0) {
        var ids = Grids.categoryTraits(traitList, traitGroups[Number(value.slice(7))]);
        if (isRow) grid.rows = Grids.fillAxis(grid.rows, ids);
        else grid.cols = Grids.fillAxis(grid.cols, ids);
      } else {
        list[Number(event.target.getAttribute("data-i"))] = value;
      }
      saveGrids();
      renderGrids();
    } else if (event.target.matches(".grid-title-input")) {
      grid.name = event.target.value.trim() || "Grid";
      saveGrids();
    } else if (event.target.matches(".rule-select")) {
      var trait = event.target.value;
      if (trait && !grid.rules.some(function (o) { return o.trait === trait && o.mode === "include"; })) {
        grid.rules.push({ trait: trait, mode: "include" });
      }
      saveGrids();
      renderGrids();
    } else if (event.target.matches(".rule-unique-box")) {
      grid.unique = event.target.checked;
      saveGrids();
      renderGrids();
    }
  });

  // ---- Form picker popover ----
  var formPop = document.createElement("div");
  formPop.className = "form-pop";
  formPop.hidden = true;
  formPop.setAttribute("role", "dialog");
  formPop.setAttribute("aria-label", "Choose a picture");
  document.body.appendChild(formPop);
  var formPopFor = null;

  function closeFormPop(refocus) {
    if (formPop.hidden) return;
    formPop.hidden = true;
    var back = formPopFor;
    formPopFor = null;
    if (refocus && back && document.body.contains(back.button)) back.button.focus({ preventScroll: true });
  }

  function openFormPop(button) {
    var grid = gridOf(button);
    var mon = state().byId.get(Number(button.getAttribute("data-id")));
    if (!grid || !mon) return;
    var r = Number(button.getAttribute("data-r"));
    var c = Number(button.getAttribute("data-c"));
    var rowTrait = grid.rows[r];
    var colTrait = grid.cols[c];
    var forms = mon.forms || [];
    if (forms.length < 2) {
      openSpecies(mon.id);
      return;
    }
    var current = Grids.cellForm(grid, mon, rowTrait, colTrait);
    var auto = forms[Grids.defaultFormIndex(mon, rowTrait, colTrait)];
    formPopFor = { button: button, gridId: grid.id, rowTrait: rowTrait, colTrait: colTrait, mon: mon };
    formPop.innerHTML = '<div class="form-pop-head"><strong>' + esc(mon.name) + '</strong><button type="button" class="form-pop-x" data-pop="close" aria-label="Close">×</button></div>' +
      '<div class="form-pop-list">' + forms.map(function (form, i) {
        var on = current && form.name === current.name;
        return '<button type="button" class="form-pop-item' + (on ? " on" : "") + '" data-form="' + i + '" aria-pressed="' + on +
          '" title="' + esc(form.name + (form === auto ? " (best fit)" : "")) + '">' +
          '<span class="form-pop-art">' + portraitHtml(form.art, form.pixel, form.name) + "</span>" +
          '<span class="form-pop-name">' + esc(form.name) + "</span></button>";
      }).join("") + "</div>" +
      '<div class="form-pop-foot"><button type="button" data-pop="details">Details</button></div>';
    formPop.hidden = false;
    var rect = button.getBoundingClientRect();
    var w = formPop.offsetWidth;
    var h = formPop.offsetHeight;
    var left = Math.min(Math.max(8, rect.left + rect.width / 2 - w / 2), window.innerWidth - w - 8);
    var top = rect.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 6);
    formPop.style.left = Math.round(Math.max(8, left)) + "px";
    formPop.style.top = Math.round(top) + "px";
    var focus = formPop.querySelector(".form-pop-item.on") || formPop.querySelector(".form-pop-item");
    if (focus) focus.focus({ preventScroll: true });
  }

  formPop.addEventListener("click", function (event) {
    var ctx = formPopFor;
    if (!ctx) return;
    var target = event.target.closest("button");
    if (!target) return;
    if (target.getAttribute("data-pop") === "close") {
      closeFormPop(true);
      return;
    }
    if (target.getAttribute("data-pop") === "details") {
      closeFormPop(false);
      openSpecies(ctx.mon.id);
      return;
    }
    var index = Number(target.getAttribute("data-form"));
    var form = ctx.mon.forms[index];
    var grid = grids.find(function (g) { return g.id === ctx.gridId; });
    if (!form || !grid) return;
    // Choosing the best-fit form clears the pick, so the cell keeps following its traits.
    var auto = Grids.defaultFormIndex(ctx.mon, ctx.rowTrait, ctx.colTrait);
    Grids.setPick(grid, ctx.rowTrait, ctx.colTrait, ctx.mon.id, index === auto ? null : form.name);
    saveGrids();
    var r = ctx.button.getAttribute("data-r");
    var c = ctx.button.getAttribute("data-c");
    closeFormPop(false);
    renderGrids();
    var again = els.gridList.querySelector('.grid-card[data-grid="' + grid.id + '"] .grid-pick[data-r="' + r + '"][data-c="' + c + '"]');
    if (again) again.focus({ preventScroll: true });
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !formPop.hidden) closeFormPop(true);
  });
  document.addEventListener("mousedown", function (event) {
    if (!formPop.hidden && !formPop.contains(event.target) && !event.target.closest(".grid-pick")) closeFormPop(false);
  });
  window.addEventListener("resize", function () { closeFormPop(false); });
  els.gridList.addEventListener("scroll", function () { closeFormPop(false); }, true);

  // ---- Grid export ----
  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function gridFileName(grid) {
    return "pokeranker-grid-" + (grid.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "grid");
  }

  function loadImage(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  // From file:// the browser marks drawn artwork as foreign and refuses to save the canvas,
  // so there we draw the bundled data-URL thumbnails (data/thumbs/*.js, loaded on demand).
  var thumbChunksLoaded = {};
  function loadThumbChunk(n) {
    if (!thumbChunksLoaded[n]) {
      thumbChunksLoaded[n] = new Promise(function (resolve) {
        var script = document.createElement("script");
        script.src = "data/thumbs/t" + (n < 10 ? "0" : "") + n + ".js";
        script.onload = function () { resolve(); };
        script.onerror = function () { resolve(); };
        document.head.appendChild(script);
      });
    }
    return thumbChunksLoaded[n];
  }

  function exportImages(files, useThumbs) {
    var unique = Array.from(new Set(files.filter(Boolean)));
    var ready = useThumbs ? Promise.all(Array.from(new Set(unique.map(Grids.thumbChunk))).map(loadThumbChunk)) : Promise.resolve();
    return ready.then(function () {
      var thumbs = window.POKERANKER_THUMBS || {};
      return Promise.all(unique.map(function (file) {
        var src = useThumbs ? thumbs[file] : artUrl(file);
        return src ? loadImage(src) : null;
      }));
    }).then(function (images) {
      var map = new Map();
      unique.forEach(function (file, i) { if (images[i]) map.set(file, images[i]); });
      return map;
    });
  }

  function wrapLines(ctx, text, width, maxLines) {
    var words = String(text).split(/\s+/);
    var lines = [];
    var line = "";
    words.forEach(function (word) {
      var test = line ? line + " " + word : word;
      if (ctx.measureText(test).width <= width || !line) line = test;
      else {
        lines.push(line);
        line = word;
      }
    });
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      var last = lines[maxLines - 1];
      while (last.length > 1 && ctx.measureText(last + "…").width > width) last = last.slice(0, -1);
      lines[maxLines - 1] = last + "…";
    }
    return lines.map(function (l) {
      while (l.length > 1 && ctx.measureText(l).width > width) l = l.slice(0, -2) + "…";
      return l;
    });
  }

  function drawGrid(grid, images) {
    var rows = state().rows;
    var CELL = 112;
    var HEAD = 128;
    var PAD = 16;
    var summary = Grids.rulesText(grid, function (t) { return gridTraitName.get(t); });
    var TITLE = summary ? 70 : 48;
    var cells = Grids.gridCells(grid, rows);
    var colHead = 52;
    var scale = 2;
    var width = PAD * 2 + HEAD + CELL * grid.cols.length;
    var height = PAD * 2 + TITLE + colHead + CELL * grid.rows.length + 18;
    var canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    var ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    var font = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = "#fbfaf7";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#1f2328";
    ctx.font = "700 22px " + font;
    ctx.textBaseline = "middle";
    ctx.fillText(wrapLines(ctx, grid.name, width - PAD * 2, 1)[0], PAD, PAD + 16);
    if (summary) {
      ctx.fillStyle = "#4b5058";
      ctx.font = "13px " + font;
      ctx.fillText(wrapLines(ctx, "Every cell: " + summary, width - PAD * 2, 1)[0], PAD, PAD + 42);
      ctx.fillStyle = "#1f2328";
    }
    var x0 = PAD + HEAD;
    var y0 = PAD + TITLE + colHead;
    ctx.font = "600 12px " + font;
    ctx.textAlign = "center";
    grid.cols.forEach(function (trait, c) {
      var lines = wrapLines(ctx, gridTraitName.get(trait) || trait, CELL - 8, 3);
      lines.forEach(function (line, i) {
        ctx.fillText(line, x0 + c * CELL + CELL / 2, y0 - colHead / 2 + (i - (lines.length - 1) / 2) * 15);
      });
    });
    ctx.textAlign = "right";
    grid.rows.forEach(function (trait, r) {
      var lines = wrapLines(ctx, gridTraitName.get(trait) || trait, HEAD - 12, 4);
      lines.forEach(function (line, i) {
        ctx.fillText(line, x0 - 8, y0 + r * CELL + CELL / 2 + (i - (lines.length - 1) / 2) * 15);
      });
    });
    grid.rows.forEach(function (rowTrait, r) {
      grid.cols.forEach(function (colTrait, c) {
        var x = x0 + c * CELL;
        var y = y0 + r * CELL;
        ctx.fillStyle = (r + c) % 2 ? "#f1efe9" : "#ffffff";
        ctx.fillRect(x, y, CELL, CELL);
        var found = cells[r][c];
        ctx.textAlign = "center";
        if (!found.best) {
          ctx.fillStyle = "#9aa0a6";
          ctx.font = "16px " + font;
          ctx.fillText("–", x + CELL / 2, y + CELL / 2);
          return;
        }
        var mon = found.best.pokemon;
        var form = Grids.cellForm(grid, mon, rowTrait, colTrait) || mon;
        var img = images.get(form.art || mon.art);
        if (img) {
          var box = CELL - 26;
          var ratio = Math.min(box / img.naturalWidth, box / img.naturalHeight);
          var w = img.naturalWidth * ratio;
          var h = img.naturalHeight * ratio;
          ctx.imageSmoothingEnabled = !form.pixel;
          ctx.drawImage(img, x + (CELL - w) / 2, y + 4 + (box - h) / 2, w, h);
        }
        ctx.fillStyle = "#1f2328";
        ctx.font = "600 11px " + font;
        ctx.fillText(wrapLines(ctx, form.kind === "default" || !form.name ? mon.name : form.name, CELL - 8, 1)[0], x + CELL / 2, y + CELL - 11);
        ctx.font = "700 10px " + font;
        var badge = "#" + found.best.rank;
        var bw = ctx.measureText(badge).width + 8;
        ctx.fillStyle = "#1f2328";
        ctx.fillRect(x + 3, y + 3, bw, 15);
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "left";
        ctx.fillText(badge, x + 7, y + 11);
      });
    });
    ctx.strokeStyle = "#d6d2c8";
    ctx.lineWidth = 1;
    for (var i = 0; i <= grid.cols.length; i++) {
      ctx.beginPath();
      ctx.moveTo(x0 + i * CELL + 0.5, y0);
      ctx.lineTo(x0 + i * CELL + 0.5, y0 + grid.rows.length * CELL);
      ctx.stroke();
    }
    for (var j = 0; j <= grid.rows.length; j++) {
      ctx.beginPath();
      ctx.moveTo(x0, y0 + j * CELL + 0.5);
      ctx.lineTo(x0 + grid.cols.length * CELL, y0 + j * CELL + 0.5);
      ctx.stroke();
    }
    ctx.fillStyle = "#6b7078";
    ctx.font = "11px " + font;
    ctx.textAlign = "right";
    ctx.fillText("PokéRanker", width - PAD, height - PAD);
    return canvas;
  }

  function gridArtFiles(grid) {
    var rows = state().rows;
    var files = [];
    var cells = Grids.gridCells(grid, rows);
    grid.rows.forEach(function (rowTrait, r) {
      grid.cols.forEach(function (colTrait, c) {
        var found = cells[r][c];
        if (!found.best) return;
        var form = Grids.cellForm(grid, found.best.pokemon, rowTrait, colTrait) || found.best.pokemon;
        files.push(form.art || found.best.pokemon.art);
      });
    });
    return files;
  }

  function canvasBlob(canvas) {
    return new Promise(function (resolve, reject) {
      try {
        canvas.toBlob(function (blob) { if (blob) resolve(blob); else reject(new Error("empty")); }, "image/png");
      } catch (error) {
        reject(error);
      }
    });
  }

  function renderGridPng(grid) {
    var files = gridArtFiles(grid);
    var thumbsFirst = location.protocol === "file:";
    function attempt(useThumbs) {
      return exportImages(files, useThumbs).then(function (images) { return canvasBlob(drawGrid(grid, images)); });
    }
    return attempt(thumbsFirst).catch(function (error) {
      if (thumbsFirst) throw error;
      return attempt(true);
    });
  }
  window.PokeRankerExportGrid = function (id) {
    var grid = grids.find(function (g) { return g.id === id; });
    return grid ? renderGridPng(grid) : Promise.reject(new Error("no grid"));
  };

  function exportGridPng(grid) {
    renderGridPng(grid).then(function (blob) {
      downloadBlob(blob, gridFileName(grid) + ".png");
    }).catch(function () {
      ranker.setNotice("Could not draw that grid as a picture.");
      render();
    });
  }

  els.viewGrids.addEventListener("click", function () {
    view = "grids";
    render();
  });

  document.getElementById("view-model").addEventListener("click", function () {
    view = "model";
    render();
  });
  document.getElementById("tie").addEventListener("click", function () { vote("tie"); });
  document.getElementById("skip").addEventListener("click", function () { vote("skip"); });
  document.getElementById("undo").addEventListener("click", undo);
  els.matchLog.addEventListener("click", function (event) {
    var button = event.target.closest("button");
    if (!button || !els.matchLog.contains(button)) return;
    var row = button.closest("li");
    if (!row) return;
    var index = Number(row.getAttribute("data-index"));
    if (!Number.isInteger(index)) return;
    if (button.getAttribute("data-action") === "delete") {
      removeHistory(index);
      return;
    }
    var outcome = button.getAttribute("data-outcome");
    if (outcome === "a" || outcome === "b" || outcome === "tie") reviseHistory(index, outcome);
  });
  els.cardA.addEventListener("click", function (event) { onCardClick(event, "a"); });
  els.cardB.addEventListener("click", function (event) { onCardClick(event, "b"); });
  document.getElementById("notice-dismiss").addEventListener("click", function () {
    ranker.setNotice(null);
    renderHeader();
  });
  var dataMenu = document.getElementById("data-menu");
  var dataPanel = document.getElementById("data-panel");

  function placeDataPanel() {
    var rect = dataMenu.getBoundingClientRect();
    var margin = 8;
    var width = dataPanel.offsetWidth;
    var height = dataPanel.offsetHeight;
    var left = rect.right - width;
    if (left < margin) left = margin;
    if (left + width > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - width - margin);
    var top = rect.bottom + 8;
    if (top + height > window.innerHeight - margin) {
      var above = rect.top - height - 8;
      top = above >= margin ? above : Math.max(margin, window.innerHeight - height - margin);
    }
    dataPanel.style.left = Math.round(left) + "px";
    dataPanel.style.top = Math.round(top) + "px";
  }

  function setDataOpen(open) {
    var wasInside = dataPanel.contains(document.activeElement);
    dataPanel.hidden = !open;
    dataMenu.setAttribute("aria-expanded", open ? "true" : "false");
    dataMenu.classList.toggle("open", open);
    if (open) placeDataPanel();
    else if (wasInside) dataMenu.focus({ preventScroll: true });
  }

  dataMenu.addEventListener("click", function (event) {
    var open = dataPanel.hidden;
    setDataOpen(open);
    if (open && event.detail === 0) document.getElementById("export").focus({ preventScroll: true });
  });
  document.getElementById("data-close").addEventListener("click", function () {
    setDataOpen(false);
  });
  els.speciesClose.addEventListener("click", function () {
    hideSpecies(true);
  });
  els.speciesPanel.addEventListener("pointerdown", function (event) {
    if (event.target === els.speciesPanel) hideSpecies(true);
  });
  document.addEventListener("pointerdown", function (event) {
    if (dataPanel.hidden) return;
    var target = event.target;
    if (dataPanel.contains(target) || dataMenu.contains(target)) return;
    if (els.modal.hidden === false && els.modal.contains(target)) return;
    if (els.importModal.hidden === false && els.importModal.contains(target)) return;
    if (els.speciesPanel && els.speciesPanel.hidden === false && els.speciesPanel.contains(target)) return;
    setDataOpen(false);
    if (els.stage.contains(target)) {
      event.preventDefault();
      event.stopPropagation();
      // The click that follows this press is only closing the sheet.
      swiped = true;
    }
  }, true);
  window.addEventListener("scroll", function () {
    if (!dataPanel.hidden) placeDataPanel();
  }, true);

  document.getElementById("export").addEventListener("click", function () {
    // The history export plus the grids. Older readers ignore the extra field.
    var payload = JSON.parse(ranker.exportText());
    payload.grids = Grids.sanitize(grids);
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "pokeranker-history.json";
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
        // Parse now so a bad file is reported before asking Append or Replace.
        window.Favordex.parseHistory(text);
      } catch (error) {
        ranker.setNotice(error instanceof Error ? error.message : "Could not import that file.");
        render();
        return;
      }
      pendingImport = text;
      els.importModal.hidden = false;
      document.getElementById("import-append").focus({ preventScroll: true });
    });
  });
  var pendingImport = null;
  function finishImport(mode) {
    var text = pendingImport;
    pendingImport = null;
    els.importModal.hidden = true;
    if (text === null || !mode) return;
    try {
      if (Grids.isGridFile(text)) {
        // A single-grid file only carries grids: Append adds them, Replace swaps the grid list. History is untouched.
        var only = Grids.gridsFromExport(text) || [];
        grids = mode === "append" ? Grids.mergeGrids(grids, only) : only;
        saveGrids();
        view = "grids";
        render();
        return;
      }
      ranker.importText(text, mode);
      // Files without grids (older exports) leave the current grids alone.
      var incoming = Grids.gridsFromExport(text);
      if (incoming) {
        grids = mode === "append" ? Grids.mergeGrids(grids, incoming) : incoming;
        saveGrids();
      }
    } catch (error) {
      ranker.setNotice(error instanceof Error ? error.message : "Could not import that file.");
    }
    render();
  }
  document.getElementById("import-append").addEventListener("click", function () {
    finishImport("append");
  });
  document.getElementById("import-replace").addEventListener("click", function () {
    finishImport("replace");
  });
  document.getElementById("import-cancel").addEventListener("click", function () {
    finishImport(null);
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

  function shownIndex(id) {
    var rows = shownRows();
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].pokemon.id === id) return i;
    }
    return -1;
  }

  function applyMove(id, toIndex) {
    var rows = shownRows();
    var from = shownIndex(id);
    if (from < 0 || toIndex < 0 || toIndex >= rows.length || toIndex === from) return;
    var passed = [];
    var lo = Math.min(from, toIndex);
    var hi = Math.max(from, toIndex);
    for (var i = lo; i <= hi; i++) {
      if (i !== from) passed.push(rows[i].pokemon.id);
    }
    ranker.movePast(id, passed, toIndex < from ? "above" : "below");
    render();
    var dir = toIndex < from ? "up" : "down";
    var button = els.ledger.querySelector('li[data-id="' + id + '"] button[data-dir="' + dir + '"]');
    if (button) button.focus({ preventScroll: true });
  }

  var rowDrag = null;
  els.ledger.addEventListener("click", function (event) {
    if (suppressRowClick) {
      suppressRowClick = false;
      event.preventDefault();
      return;
    }
    var button = event.target.closest("button");
    if (button && els.ledger.contains(button)) {
      if (!button.hasAttribute("data-dir")) return;
      var li = button.closest("li");
      if (!li) return;
      var id = Number(li.getAttribute("data-id"));
      var from = shownIndex(id);
      if (from < 0) return;
      applyMove(id, from + (button.getAttribute("data-dir") === "up" ? -1 : 1));
      return;
    }
    var row = event.target.closest("li");
    if (!row || !els.ledger.contains(row)) return;
    openSpecies(Number(row.getAttribute("data-id")));
  });
  els.ledger.addEventListener("pointerdown", function (event) {
    suppressRowClick = false;
    if (event.button !== 0 && event.pointerType === "mouse") return;
    if (event.target.closest("button")) return;
    var li = event.target.closest("li");
    if (!li || !els.ledger.contains(li)) return;
    rowDrag = {
      id: Number(li.getAttribute("data-id")),
      pointer: event.pointerId,
      y: event.clientY,
      active: false,
    };
    try {
      li.setPointerCapture(event.pointerId);
    } catch (error) {
      /* The pointer can already be gone. */
    }
  });
  function clearDragMarks() {
    Array.prototype.forEach.call(els.ledger.children, function (item) {
      item.classList.remove("drop-before", "drop-after", "dragging");
    });
  }
  function indexAtPointer(clientY) {
    var items = els.ledger.children;
    for (var i = 0; i < items.length; i++) {
      var rect = items[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return items.length - 1;
  }
  els.ledger.addEventListener("pointermove", function (event) {
    if (!rowDrag || rowDrag.pointer !== event.pointerId) return;
    if (!rowDrag.active) {
      if (Math.abs(event.clientY - rowDrag.y) < 6) return;
      rowDrag.active = true;
    }
    event.preventDefault();
    clearDragMarks();
    var dragging = els.ledger.querySelector('li[data-id="' + rowDrag.id + '"]');
    if (dragging) dragging.classList.add("dragging");
    var items = els.ledger.children;
    if (!items.length) return;
    var to = indexAtPointer(event.clientY);
    if (to < items.length - 1) items[to].classList.add("drop-before");
    else items[items.length - 1].classList.add("drop-after");
  });
  function finishRowDrag(event) {
    if (!rowDrag || rowDrag.pointer !== event.pointerId) return;
    var info = rowDrag;
    rowDrag = null;
    var moved = info.active;
    var to = moved ? indexAtPointer(event.clientY) : -1;
    clearDragMarks();
    if (moved) {
      suppressRowClick = true;
      applyMove(info.id, to);
    }
  }
  els.ledger.addEventListener("pointerup", finishRowDrag);
  els.ledger.addEventListener("pointercancel", function (event) {
    if (!rowDrag || rowDrag.pointer !== event.pointerId) return;
    rowDrag = null;
    clearDragMarks();
  });

  function duelShortcut(event) {
    var key = event.key;
    if (key === "ArrowLeft") return "a";
    if (key === "ArrowRight") return "b";
    if (key === "ArrowDown") return "tie";
    if (key === "ArrowUp") return "skip";
    if (event.altKey || event.shiftKey) return null;
    if (String(key).toLowerCase() === "z") return "undo";
    return null;
  }

  window.addEventListener("keydown", function (event) {
    if (els.speciesPanel && els.speciesPanel.hidden === false) {
      if (event.key === "Escape") {
        event.preventDefault();
        hideSpecies(true);
      }
      return;
    }
    var tag = event.target && event.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if ((view === "history" || els.history.contains(event.target)) &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown")) {
      return;
    }
    if (els.ledger.contains(event.target)) {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        var li = event.target.closest("li");
        if (!li) return;
        var id = Number(li.getAttribute("data-id"));
        var from = shownIndex(id);
        if (from < 0) return;
        applyMove(id, from + (event.key === "ArrowUp" ? -1 : 1));
        return;
      }
      if ((event.key === "Enter" || event.key === " ") && event.target.tagName === "LI") {
        event.preventDefault();
        openSpecies(Number(event.target.getAttribute("data-id")));
        return;
      }
      if (duelShortcut(event) !== "undo") return;
    }
    if (els.modal.hidden === false && event.key === "Escape") {
      els.modal.hidden = true;
      return;
    }
    if (els.importModal.hidden === false) {
      if (event.key === "Escape") finishImport(null);
      return;
    }
    if (dataPanel.hidden === false && event.key === "Escape") {
      event.preventDefault();
      setDataOpen(false);
      return;
    }
    if (dataPanel.hidden === false && dataPanel.contains(event.target)) return;
    var action = duelShortcut(event);
    if (action === "undo") {
      if (els.modal.hidden === false || dataPanel.hidden === false) return;
      event.preventDefault();
      undo();
    } else if (action) {
      event.preventDefault();
      vote(action);
    }
  });

  els.stage.addEventListener("pointerdown", function (event) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    // Tie, Skip, and Undo listen for click. Capturing this pointer would retarget that click.
    if (event.target.closest("#tie, #skip, #undo")) return;
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
      localStorage.setItem("pokeranker.dex.v1", next);
    } catch (error) {
      /* The look still changes for this visit. */
    }
    if (!dataPanel.hidden) placeDataPanel();
  });

  window.addEventListener("resize", function () {
    fitPortraits();
    if (!dataPanel.hidden) placeDataPanel();
  });
  render();
})();
