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
    viewBoard: document.getElementById("view-board"),
    viewModel: document.getElementById("view-model"),
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

  function boxesClear(rects, gap) {
    for (var i = 0; i < rects.length; i++) {
      var rect = rects[i];
      if (rect.left < 0.5 || rect.right > 99.5 || rect.top < 0.5 || rect.bottom > 99.5) return false;
      for (var j = i + 1; j < rects.length; j++) {
        var other = rects[j];
        var apartX = rect.right + gap <= other.left || other.right + gap <= rect.left;
        var apartY = rect.bottom + gap <= other.top || other.bottom + gap <= rect.top;
        if (!apartX && !apartY) return false;
      }
    }
    return true;
  }

  function placePair(boxes, scales) {
    var gap = 2.2;
    var size = scales.map(function (scale, index) { return opaqueSize(scale, boxes[index]); });
    var total = size[0].w + gap + size[1].w;
    if (total > 97) return null;
    var x0 = (100 - total) / 2 + size[0].w / 2;
    var x1 = x0 + size[0].w / 2 + gap + size[1].w / 2;
    var floor = 96.5;
    var y0 = floor - size[0].h / 2;
    var y1 = floor - size[1].h / 2;
    var lift = Math.max(0.5 - (y0 - size[0].h / 2), 0.5 - (y1 - size[1].h / 2), 0);
    y0 += lift;
    y1 += lift;
    var rects = [opaqueRect(x0, y0, size[0]), opaqueRect(x1, y1, size[1])];
    if (!boxesClear(rects, gap)) return null;
    return [
      spriteFromOpaque(x0, y0, scales[0], boxes[0]),
      spriteFromOpaque(x1, y1, scales[1], boxes[1]),
    ];
  }

  function placeTriangle(boxes, scales) {
    var gap = 2.2;
    var size = scales.map(function (scale, index) { return opaqueSize(scale, boxes[index]); });
    var total = size[1].w + gap + size[2].w;
    if (total > 97) return null;
    var x1 = (100 - total) / 2 + size[1].w / 2;
    var x2 = x1 + size[1].w / 2 + gap + size[2].w / 2;
    var floor = 96.5;
    var y1 = floor - size[1].h / 2;
    var y2 = floor - size[2].h / 2;
    var rowTop = Math.min(y1 - size[1].h / 2, y2 - size[2].h / 2);
    var y0 = rowTop - gap - size[0].h / 2;
    var rects = [
      opaqueRect(50, y0, size[0]),
      opaqueRect(x1, y1, size[1]),
      opaqueRect(x2, y2, size[2]),
    ];
    if (!boxesClear(rects, gap)) return null;
    return [
      spriteFromOpaque(50, y0, scales[0], boxes[0]),
      spriteFromOpaque(x1, y1, scales[1], boxes[1]),
      spriteFromOpaque(x2, y2, scales[2], boxes[2]),
    ];
  }

  function placeDiamond(boxes, scales) {
    var gap = 2;
    var size = scales.map(function (scale, index) { return opaqueSize(scale, boxes[index]); });
    var angles = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
    for (var radius = 16; radius <= 42; radius += 0.5) {
      var points = angles.map(function (angle) {
        return { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius };
      });
      var rects = points.map(function (point, index) { return opaqueRect(point.x, point.y, size[index]); });
      var clear = rects.every(function (rect) {
        return rect.left >= 0.5 && rect.right <= 99.5 && rect.top >= 0.5 && rect.bottom <= 99.5;
      });
      if (!clear) continue;
      var apart = true;
      for (var i = 0; i < 4; i++) {
        var other = rects[(i + 1) % 4];
        var rect = rects[i];
        var apartX = rect.right + gap <= other.left || other.right + gap <= rect.left;
        var apartY = rect.bottom + gap <= other.top || other.bottom + gap <= rect.top;
        if (!apartX && !apartY) apart = false;
      }
      if (apart) {
        return points.map(function (point, index) {
          return spriteFromOpaque(point.x, point.y, scales[index], boxes[index]);
        });
      }
    }
    return null;
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
    var weights = forms.map(function (form) { return isCompactForm(form.kind) ? 0.62 : 1; });
    if (count > 4) return placeRing(boxes, weights);
    var chosen = null;
    for (var step = 56; step >= 0; step--) {
      var multiplier = 0.3 + step * 0.012;
      var scales = weights.map(function (weight) { return multiplier * weight; });
      var placed = count === 2
        ? placePair(boxes, scales)
        : count === 3
          ? placeTriangle(boxes, scales)
          : placeDiamond(boxes, scales);
      if (placed) {
        chosen = placed;
        break;
      }
    }
    if (chosen) return chosen;
    return weights.map(function (weight, index) {
      var angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
      return { x: 50 + Math.cos(angle) * 28, y: 50 + Math.sin(angle) * 28, scale: 0.36 * weight };
    });
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

  function traitLabel(categoryId, key) {
    var value = key.indexOf(":") === -1 ? key : key.slice(key.indexOf(":") + 1);
    if (categoryId === "generation") return generationLabel(Number(value));
    if (categoryId === "stage") return "Stage " + value;
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
    var peak = 0.5;
    model.categories.forEach(function (category) {
      category.weights.forEach(function (row) {
        peak = Math.max(peak, Math.abs(row.weight));
      });
    });
    function fact(term, value) {
      return "<div><dt>" + esc(term) + "</dt><dd>" + value + "</dd></div>";
    }
    els.modelFacts.innerHTML =
      fact("Family", esc(model.family)) +
      fact("Strength", "<code>" + esc(model.strength) + "</code>") +
      fact("Decisive win", "logistic of <code>" + esc(model.probability) + "</code>") +
      fact("Weight prior", "normal, sd " + model.sigmaW.toFixed(2)) +
      fact("Offset prior", "normal, sd " + model.sigmaB.toFixed(2) + ", one per species") +
      fact("Answers in the fit", model.comparisons.toLocaleString() + " (skips left out)") +
      fact("Newton steps", String(model.iterations) + (model.converged ? ", converged" : ", still moving")) +
      fact("Columns in x", model.columns.toLocaleString());
    els.modelCategories.innerHTML = model.categories.map(function (category) {
      var rows = category.weights.length === 0
        ? '<p class="trait-empty">Nothing in this dex turns this category on.</p>'
        : "<ol>" + category.weights.map(function (row) {
          var tone = row.weight > 0.0005 ? "up" : row.weight < -0.0005 ? "down" : "flat";
          var share = tone === "flat" ? 0 : Math.min(50, (Math.abs(row.weight) / peak) * 50);
          var edge = row.weight >= 0 ? "left:50%" : "right:50%";
          return "<li>" +
            '<span class="trait-name">' + esc(traitLabel(category.id, row.key)) + "</span>" +
            '<span class="track" title="' + esc(formatScore(row.weight) + " " + formatSd(row.sd)) + '">' +
            '<i class="' + tone + '" style="' + edge + ";width:" + share.toFixed(2) + '%"></i></span>' +
            '<span class="trait-num ' + tone + '">' + formatScore(row.weight) + "</span>" +
            '<span class="trait-sd">' + formatSd(row.sd) + "</span></li>";
        }).join("") + "</ol>";
      return '<section class="trait" data-category="' + esc(category.id) + '">' +
        "<h3>" + esc(category.label) + ' <span class="encoding">' + esc(category.encoding) + "</span></h3>" +
        "<p>" + esc(category.detail) + "</p>" +
        '<p class="trait-count">' + category.weights.length +
        (category.weights.length === 1 ? " column" : " columns") + "</p>" +
        rows + "</section>";
    }).join("");
  }

  function render() {
    renderHeader();
    var pair = sides();
    var showDuel = view === "duel" && pair.left && pair.right;
    els.duel.hidden = !showDuel;
    els.board.hidden = view !== "board";
    els.model.hidden = view !== "model";
    els.noDuel.hidden = view !== "duel" || Boolean(pair.left && pair.right);
    els.viewDuel.className = view === "duel" ? "on" : "";
    els.viewBoard.className = view === "board" ? "on" : "";
    els.viewModel.className = view === "model" ? "on" : "";
    if (showDuel) renderDuel();
    if (view === "board") renderBoard();
    if (view === "model") renderModel();
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

  document.getElementById("view-duel").addEventListener("click", function () {
    view = "duel";
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

  render();
})();
