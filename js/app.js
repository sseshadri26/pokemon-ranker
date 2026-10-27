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

  function cardHtml(mon, side) {
    var forms = formsOf(mon);
    var many = forms.length > 1;
    var hint = side === "a" ? "←" : "→";
    var testId = side === "a" ? "pick-a" : "pick-b";
    var scope = many ? "One vote covers all " + forms.length + " forms" : "One vote covers this Pokémon";
    var aria = many ? "Pick " + mon.name + ", all " + forms.length + " forms" : "Pick " + mon.name;
    var pickLabel = many ? "Pick all " + forms.length + " forms " + hint : "Pick " + hint;
    var head = '<p class="dex-no">#' + String(mon.id).padStart(4, "0") + "</p>" +
      "<h2>" + esc(mon.name) + "</h2>" +
      '<p class="meta">' + metaLine(mon) + "</p>" +
      '<p class="scope">' + esc(scope) + "</p>";
    if (!many) {
      var only = forms[0];
      return '<article class="card ' + side + '">' +
        '<button type="button" class="pick" data-testid="' + testId + '" data-side="' + side +
        '" aria-label="' + esc(aria) + '">' +
        '<div class="portrait">' + portraitHtml(only.art || mon.art, only.pixel, mon.name) + "</div>" +
        head +
        '<div class="types">' + typeChips(only.types) + "</div>" +
        '<span class="hint">' + esc(pickLabel) + "</span></button></article>";
    }
    var tiles = forms.map(function (entry) {
      return '<li class="form-tile">' +
        '<div class="tile-art">' + portraitHtml(entry.art || mon.art, entry.pixel, entry.name) + "</div>" +
        '<span class="form-tile-name">' + esc(entry.name) + "</span>" +
        '<span class="types">' + typeChips(entry.types) + "</span></li>";
    }).join("");
    return '<article class="card ' + side + ' has-forms">' +
      '<button type="button" class="pick" data-testid="' + testId + '" data-side="' + side +
      '" aria-label="' + esc(aria) + '">' +
      head +
      '<span class="hint">' + esc(pickLabel) + "</span></button>" +
      '<ol class="forms" aria-label="' + esc(mon.name) + ' forms">' + tiles + "</ol></article>";
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

  function render() {
    renderHeader();
    var pair = sides();
    var showDuel = view === "duel" && pair.left && pair.right;
    els.duel.hidden = !showDuel;
    els.board.hidden = view !== "board";
    els.noDuel.hidden = view !== "duel" || Boolean(pair.left && pair.right);
    els.viewDuel.className = view === "duel" ? "on" : "";
    els.viewBoard.className = view === "board" ? "on" : "";
    if (showDuel) renderDuel();
    if (view === "board") renderBoard();
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
    if (event.target.closest(".forms")) return;
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
    if (event.target.closest(".forms")) return;
    drag = { x: event.clientX, y: event.clientY, id: event.pointerId };
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
    drag = null;
    setOffset(0);
    if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      swiped = true;
      vote(dx > 0 ? "b" : "a");
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
