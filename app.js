/* Onsen ryokan map: pins, clusters, hover card, side panel, client-side filters. Data: window.RYOKANS (data.js). */
(() => {
  const DATA = window.RYOKANS || [];
  const IMG_BASE = window.IMG_BASE || "";
  const RANGES = [["16-18", [0, 1]], ["17-19", [1, 2]], ["16-19", [0, 1, 2]]];
  const NIGHTS = ["Nov 16", "Nov 17", "Nov 18"];
  const SETTING = { "Onsen town": { cls: "onsen", color: "var(--onsen)" }, Remote: { cls: "remote", color: "var(--remote)" },
    Town: { cls: "town", color: "var(--town)" } };
  const BANDS = [[25000, "var(--p1)", "≤ ¥25k"], [32000, "var(--p2)", "¥25-32k"], [40000, "var(--p3)", "¥32-40k"], [Infinity, "var(--p4)", "> ¥40k"]];
  const SCORES = [["room", "Room"], ["bath", "Bath"], ["breakfast", "Breakfast"], ["dinner", "Dinner"], ["service", "Service"], ["clean", "Clean"]];
  const TOUCH = window.matchMedia("(hover: none)").matches;
  const DEFAULTS = { budget: 40000, rating: 3, range: "any", twoMeals: false, settings: ["Onsen town", "Remote", "Town"], pref: "", q: "", colorBy: "setting",
    starred: true, starredOnly: false };
  const STAR_Z = 10000; // starred pins sit above the clustered ones

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const yen = (v) => (v == null ? "—" : "¥" + Math.round(v).toLocaleString("en-US"));
  const yenK = (v) => "¥" + Math.round(v / 1000) + "k";
  // Jalan serves the same photo at several widths: pictL 300px, pict2L 600px, pict4L 1200px.
  // data.js stores ryokan photos as pict4L/... and plan room photos as pictL/...
  const SIZE_RE = /^pict\d?L\//;
  const photo = (u, size = "pictL") => (/^https?:/.test(u) ? u : IMG_BASE + u.replace(SIZE_RE, size + "/"));
  const photoKey = (u) => u.replace(SIZE_RE, "");
  const thumb = (r, u, size) => `<img loading="lazy" src="${esc(photo(u, size))}" alt="" data-rid="${esc(r.id)}" data-ph="${esc(photoKey(u))}">`;
  const jalanUrl = (r) => `https://www.jalan.net/yad${r.id}/`;
  const bookUrl = (r, p) => `https://www.jalan.net/uw/uwp3200/uww3201init.do?yadNo=${r.id}&planCd=${p.planCd}&roomTypeCd=${p.roomCd}` +
    "&calYear=2026&calMonth=11&dateUndecided=1&roomCount=1&adultNum=2#price_cal";

  // Plan averages per range (null unless every night in the range has a price).
  for (const r of DATA) for (const p of r.plans || []) {
    p.avg = RANGES.map(([, idx]) => (idx.every((i) => p.prices && p.prices[i] != null)
      ? Math.round(idx.reduce((s, i) => s + p.prices[i], 0) / idx.length) : null));
  }

  const state = { ...DEFAULTS, settings: new Set(DEFAULTS.settings) };
  const rangeIdx = () => (state.range === "any" ? [0, 1, 2] : [Number(state.range)]);

  // Cheapest in-budget average for one plan over the selected ranges (budget Infinity: cheapest at any price).
  function planPrice(p, idx = rangeIdx(), budget = state.budget) {
    let best = null;
    for (const i of idx) { const a = p.avg[i]; if (a != null && a <= budget && (best == null || a < best)) best = a; }
    return best;
  }
  function qualifyingPlans(r, budget = state.budget) {
    return (r.plans || [])
      .filter((p) => !state.twoMeals || p.meals === "Breakfast & dinner")
      .map((p) => ({ p, price: planPrice(p, rangeIdx(), budget) }))
      .filter((x) => x.price != null)
      .sort((a, b) => a.price - b.price);
  }
  function cheapestFor(r, i, meals, budget = state.budget) {
    let best = null;
    for (const p of r.plans || []) {
      if (meals && p.meals !== meals) continue;
      const a = planPrice(p, i == null ? [0, 1, 2] : [i], budget);
      if (a != null && (best == null || a < best)) best = a;
    }
    return best;
  }
  // Starred pins show a price even when no plan fits: the cheapest for the selected dates and meals
  // regardless of budget, else for any dates and meals.
  function fromPrice(r) {
    const q = qualifyingPlans(r, Infinity);
    return q.length ? q[0].price : cheapestFor(r, null, null, Infinity);
  }
  function passes(r) {
    if (!state.settings.has(r.setting)) return false;
    if (state.pref && r.pref !== state.pref) return false;
    if ((r.rating || 0) < state.rating - 1e-9) return false;
    if (state.q) {
      const hay = `${r.name} ${r.nameJp} ${r.area} ${r.pref}`.toLowerCase();
      if (!hay.includes(state.q.toLowerCase())) return false;
    }
    return true;
  }
  const pinColor = (r, price) => (state.colorBy === "price"
    ? BANDS.find(([max]) => price <= max)[1] : (SETTING[r.setting] || SETTING.Town).color);

  // Map
  const map = (window.ryokanMap = L.map("map", { zoomControl: false, maxZoom: 19 }).setView([36.3, 138.6], 7));
  L.control.zoom({ position: "bottomright" }).addTo(map);
  // Base maps. Default: OpenTopoMap (raster, local-language labels). "Topo": GSI's English topographic tiles (Japan, zoom 5-11), handing over to the
  // OpenFreeMap vector map (MapLibre GL, labels switched to English) outside that zoom range.
  // tile.openstreetmap.org refuses requests without a Referer (what a file:// page sends), so from disk the
  // raster fallback for the vector map is the OSM France-hosted Humanitarian (HOT) style.
  const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const OFM_STYLE = "https://tiles.openfreemap.org/styles/liberty";
  const EN_NAME = ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name:latin"], ["get", "name"]];
  const GSI_MIN = 5, GSI_MAX = 11;
  const gsi = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/english/{z}/{x}/{y}.png", {
    minNativeZoom: GSI_MIN, maxNativeZoom: GSI_MAX, maxZoom: 19, bounds: [[20, 122], [46.5, 154]],
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">GSI Tiles (地理院タイル)</a>' });
  const rasters = {
    otm: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { subdomains: "abc", maxNativeZoom: 17, maxZoom: 19,
      attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ' +
        '<a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> ' +
        '(<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)' }),
    osm: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: OSM_ATTR }),
    hot: L.tileLayer("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", { maxZoom: 19, subdomains: "abc",
      attribution: `${OSM_ATTR}, tiles style by <a href="https://www.hotosm.org/">HOT</a> hosted by <a href="https://openstreetmap.fr/">OSM France</a>` }),
  };
  const fallbackRaster = rasters[location.protocol === "file:" ? "hot" : "osm"];
  const BASES = [["otm", "OpenTopoMap"], ["topo", "Topo (GSI English)"], ["vector", "English (vector)"], ["osm", "OpenStreetMap"],
    ["hot", "OpenStreetMap HOT"], ["gsi", `GSI English (z${GSI_MIN}-${GSI_MAX} only)`]];
  const DEFAULT_BASE = "otm";
  // The layer switcher only holds empty marker layers; syncBase() decides which real layer is shown.
  const baseTokens = Object.fromEntries(BASES.map(([k]) => [k, Object.assign(L.layerGroup(), { baseKey: k })]));
  L.control.layers(Object.fromEntries(BASES.map(([k, label]) => [label, baseTokens[k]])), null, { position: "bottomright" }).addTo(map);
  let baseKey = DEFAULT_BASE, shownBase = null, vector = null, vectorState = "pending", vectorOk = false, vectorWatch = 0;
  baseTokens[baseKey].addTo(map);

  // The vector map, or the raster fallback once it has failed; null while the style is still loading.
  const closeUp = () => (vectorState === "ready" ? vector : vectorState === "failed" ? fallbackRaster : null);
  function wantedBase() {
    const z = map.getZoom();
    if (baseKey === "topo") return z >= GSI_MIN && z <= GSI_MAX ? gsi : closeUp();
    if (baseKey === "vector") return closeUp();
    if (baseKey === "otm" && otmFailed) return fallbackRaster;
    return baseKey === "gsi" ? gsi : rasters[baseKey];
  }
  // OpenTopoMap is a small volunteer server: if its tiles keep failing before any has loaded, use the OSM fallback.
  let otmFailed = false, otmErrors = 0, otmLoaded = false;
  rasters.otm.on("tileload", () => { otmLoaded = true; });
  rasters.otm.on("tileerror", () => {
    if (otmLoaded || otmFailed || ++otmErrors < 8) return;
    otmFailed = true;
    console.warn("OpenTopoMap tiles failed to load; using OpenStreetMap tiles instead.");
    syncBase();
  });
  // Calls `cb` once `layer` has drawn. The vector map waits for MapLibre's "idle" with at least one tile loaded
  // (if that never happens, watchVector gives up on it); tile layers also give up after a few seconds.
  function whenDrawn(layer, cb) {
    let done = false;
    const once = () => { if (!done) { done = true; cb(); } };
    if (layer === vector) {
      const gl = vector.getMaplibreMap();
      const check = () => { if (vectorOk) once(); else if (vectorState === "ready" && map.hasLayer(vector)) gl.once("idle", check); };
      if (vectorOk && gl.loaded()) once(); else gl.once("idle", check);
      return;
    }
    setTimeout(once, 4000);
    if (!layer.isLoading()) once(); else layer.once("load", once);
  }
  // Show the wanted base layer. The previous ones stay underneath until the new one has drawn, so switching
  // between GSI and vector at the zoom boundary doesn't flash an empty map.
  const allBases = () => [gsi, vector, ...Object.values(rasters)].filter(Boolean);
  function syncBase() {
    const want = wantedBase();
    if (!want || want === shownBase) return;
    shownBase = want;
    map.addLayer(want);
    if (want === vector) watchVector();
    whenDrawn(want, () => {
      if (shownBase === want) for (const l of allBases()) if (l !== want && map.hasLayer(l)) map.removeLayer(l);
    });
  }
  function setBase(key) {
    if (!baseTokens[key] || key === baseKey) return;
    map.removeLayer(baseTokens[baseKey]);
    baseKey = key;
    baseTokens[key].addTo(map);
    syncBase();
  }
  function vectorFailed(why) {
    console.warn(`English vector map unavailable (${why}); using raster tiles with local-language labels.`);
    vectorState = "failed";
    if (vector && map.hasLayer(vector)) map.removeLayer(vector);
    if (shownBase === vector) shownBase = null;
    syncBase();
  }
  // Give up on the vector map if no tile has loaded after 3 errors or 10 s of the page being visible (blocked
  // tiles, GL failure). Hidden tabs don't render, so time spent hidden doesn't count.
  function watchVector() {
    if (vectorOk || vectorWatch) return;
    const gl = vector.getMaplibreMap();
    let errors = 0, visibleMs = 0;
    gl.on("data", (e) => { if (e.dataType === "source" && e.tile) vectorOk = true; });
    gl.on("error", () => { errors++; });
    vectorWatch = setInterval(() => {
      if (vectorOk || !map.hasLayer(vector)) { clearInterval(vectorWatch); vectorWatch = 0; return; }
      if (document.visibilityState === "visible") visibleMs += 500;
      if (errors < 3 && visibleMs < 10000) return;
      clearInterval(vectorWatch); vectorWatch = 0;
      vectorFailed(errors ? "tiles failed to load" : "did not load");
    }, 500);
  }
  map.on("baselayerchange", (e) => {
    if (!e.layer.baseKey || e.layer.baseKey === baseKey) return;
    baseKey = e.layer.baseKey;
    syncBase();
    scheduleHash();
  });
  map.on("zoomend", syncBase);
  syncBase();

  // maplibre-gl-leaflet 0.1.4 finishes a zoom in a requestAnimationFrame callback that throws if the layer was
  // removed in the meantime, which the GSI/vector handover does at zoomend. Same code, with a guard.
  const SafeMaplibreGL = L.MaplibreGL ? L.MaplibreGL.extend({
    _transitionEnd() {
      L.Util.requestAnimFrame(function () {
        if (!this._map || !this._glMap) return;
        const zoom = this._map.getZoom(), center = this._map.getCenter();
        const offset = this._map.latLngToContainerPoint(this._map.getBounds().getNorthWest());
        this._resizeContainer();
        L.DomUtil.setTransform(this._glMap._actualCanvas, offset, 1);
        this._glMap.once("moveend", () => { if (this._map) this._zoomEnd(); });
        this._glMap.jumpTo({ center, zoom: zoom - 1 });
      }, this);
    },
  }) : null;
  const webgl = (() => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; } })();
  if (!webgl || !SafeMaplibreGL) vectorFailed(webgl ? "MapLibre not loaded" : "no WebGL");
  else {
    const ctl = new AbortController();
    const abort = setTimeout(() => ctl.abort(), 8000);
    fetch(OFM_STYLE, { signal: ctl.signal }).then((res) => { if (!res.ok) throw new Error(`style HTTP ${res.status}`); return res.json(); })
      .then((style) => {
        clearTimeout(abort);
        for (const l of style.layers) {
          if (l.type === "symbol" && l.layout && JSON.stringify(l.layout["text-field"] || "").includes('"name')) l.layout["text-field"] = EN_NAME;
        }
        // Liberty draws no mountain names; add peaks (with elevation) below the place labels:
        // only each tile's top-ranked peaks when zoomed out, all of them from (GL) zoom 10.
        const at = style.layers.findIndex((l) => l.id === "label_other");
        const peaks = (id, minzoom, maxzoom, rankMax) => ({
          id, type: "symbol", source: "openmaptiles", "source-layer": "mountain_peak", minzoom, maxzoom,
          filter: ["all", ["has", "name"], ["in", ["get", "class"], ["literal", ["peak", "volcano"]]], ["<=", ["coalesce", ["get", "rank"], 99], rankMax]],
          layout: {
            "icon-image": ["match", ["get", "class"], "volcano", "volcano_11", "mountain_11"], "icon-size": 0.8,
            "text-field": ["concat", EN_NAME, ["case", ["has", "ele"], ["concat", "\n", ["to-string", ["get", "ele"]], " m"], ""]],
            "text-font": ["Noto Sans Italic"], "text-size": 11, "text-anchor": "top", "text-offset": [0, 0.7],
          },
          paint: { "text-color": "#6b4f2a", "text-halo-color": "#fff", "text-halo-width": 1.2 },
        });
        style.layers.splice(at < 0 ? style.layers.length : at, 0, peaks("peak_major", 6, 10, 1), peaks("peak_all", 10, 24, 99));
        // A fixed attribution (customAttribution) so it is removed cleanly when the layer is swapped out;
        // otherwise the plugin re-adds the style's own attribution on load and it stays behind.
        vector = new SafeMaplibreGL({ style, attributionControl: { customAttribution: `<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> ` +
          `<a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> ${OSM_ATTR}` } });
        vector.on("add", () => vector.getMaplibreMap().on("error", (e) => console.warn("Vector map:", e && e.error ? e.error.message : e)));
        vectorState = "ready";
        syncBase();
      })
      .catch((e) => { clearTimeout(abort); vectorFailed(e.message || String(e)); });
  }
  const clusters = L.markerClusterGroup({
    maxClusterRadius: 48, showCoverageOnHover: false, spiderfyOnMaxZoom: true, disableClusteringAtZoom: 14,
    iconCreateFunction(c) {
      const prices = c.getAllChildMarkers().map((m) => m.options.price).filter((v) => v != null);
      const low = prices.length ? Math.min(...prices) : null;
      return L.divIcon({ className: "cl-wrap", iconSize: [40, 40],
        html: `<div class="cl"><b>${c.getChildCount()}</b>${low != null ? `<span>from ${yenK(low)}</span>` : ""}</div>` });
    },
  });
  map.addLayer(clusters);

  // Starred properties have their own layer, straight on the map: never clustered, never filtered out.
  const stars = L.layerGroup().addTo(map);

  const located = DATA.filter((r) => r.lat != null && r.lng != null);
  const makeMarker = (r) => {
    const m = L.marker([r.lat, r.lng], { riseOnHover: true, keyboard: false, title: "", zIndexOffset: r.starred ? STAR_Z : 0 });
    m.ryokan = r;
    if (TOUCH) {
      m.on("click", () => showCard(r, m, true));
    } else {
      m.on("mouseover", () => showCard(r, m, false));
      m.on("mouseout", () => hideCard(300));
      m.on("click", () => { hideCard(); openPanel(r); });
    }
    return m;
  };
  const markers = located.filter((r) => !r.starred).map(makeMarker);
  const starMarkers = located.filter((r) => r.starred).map(makeMarker);

  let activeId = null;
  // `forced`: the open property is shown (greyed) even when the filters exclude it, e.g. from a shared link.
  const ratingHtml = (r) => (r.rating ? ` <span class="r">· ${r.rating.toFixed(1)}</span>` : "");
  function pinIcon(r, price, forced) {
    const label = `${price != null ? yenK(price) : "—"}${ratingHtml(r)}`;
    const color = forced ? "#6b7280" : pinColor(r, price);
    return L.divIcon({ className: "pin-wrap", iconSize: [0, 0], iconAnchor: [0, 0],
      html: `<div class="pin${r.id === activeId ? " active" : ""}${forced ? " forced" : ""}" style="background:${color};border-top-color:${color}">${label}</div>` });
  }
  // `muted`: no plan fits the budget and dates, so `price` is the cheapest "from" price.
  function starIcon(r, price, muted, forced) {
    const label = `★ ${muted && price != null ? "from " : ""}${price != null ? yenK(price) : "—"}${ratingHtml(r)}`;
    return L.divIcon({ className: "pin-wrap", iconSize: [0, 0], iconAnchor: [0, 0],
      html: `<div class="pin star${muted ? " muted" : ""}${r.id === activeId ? " active" : ""}${forced ? " forced" : ""}">${label}</div>` });
  }
  const matchesFilters = (r) => passes(r) && qualifyingPlans(r).length > 0;
  const anyPrice = (r) => { const v = (r.plans || []).flatMap((p) => p.avg).filter((x) => x != null); return v.length ? Math.min(...v) : null; };

  function apply() {
    const visible = [];
    let n = 0;
    for (const m of markers) {
      const r = m.ryokan;
      const q = !state.starredOnly && passes(r) ? qualifyingPlans(r) : [];
      m.options.price = q.length ? q[0].price : null;
      if (q.length) { m.setIcon(pinIcon(r, q[0].price)); visible.push(m); n++; }
      else if (r.id === activeId) { m.setIcon(pinIcon(r, anyPrice(r), true)); visible.push(m); }
    }
    clusters.clearLayers();
    clusters.addLayers(visible);
    // Starred pins ignore the filters; hidden ones still show while open.
    let ns = 0;
    stars.clearLayers();
    for (const m of starMarkers) {
      const r = m.ryokan;
      if (!state.starred && r.id !== activeId) continue;
      const q = qualifyingPlans(r);
      m.setIcon(starIcon(r, q.length ? q[0].price : fromPrice(r), !q.length, !state.starred));
      stars.addLayer(m);
      if (state.starred) ns++;
    }
    $("count").textContent = n;
    $("starcount").textContent = ns ? ` + ${ns} starred` : "";
    renderLegend();
    if (activeId) { const r = DATA.find((x) => x.id === activeId); if (r) renderPanel(r); }
  }

  // Hover / tap card
  const card = $("card");
  let hideTimer = null;
  function photosHtml(r, max) {
    const ph = ["main", "bath", "room", "food"].map((k) => r.photos && r.photos[k]).filter(Boolean).slice(0, max);
    return ph.length ? `<div class="photos" style="grid-template-columns:repeat(${ph.length},1fr)">${
      ph.map((u) => thumb(r, u)).join("")}</div>` : "";
  }
  function scoresHtml(r) {
    const s = SCORES.filter(([k]) => r.scores && r.scores[k] != null).map(([k, l]) => `<span>${l} <b>${r.scores[k].toFixed(1)}</b></span>`).join("");
    return s ? `<div class="scores">${s}</div>` : "";
  }
  function badgeHtml(r) {
    const s = SETTING[r.setting] || SETTING.Town;
    return `<span class="badge b-${s.cls}">${esc(r.setting)}</span>`;
  }
  function headHtml(r) {
    return `<h2>${esc(r.name)}${r.starred ? ' <span class="star-badge" title="Hand-picked">★ Starred</span>' : ""}</h2><div class="jp">${esc(r.nameJp)} · ${esc(r.area)}, ${esc(r.pref)}</div>
      <div class="badges"><span class="stars">★ ${r.rating ? r.rating.toFixed(1) : "—"}</span>
      <span class="muted">${r.reviews ? r.reviews.toLocaleString("en-US") + " reviews" : ""}</span>${badgeHtml(r)}</div>${scoresHtml(r)}`;
  }
  // Cheapest in-budget price per range; when nothing fits the budget, the cheapest over-budget one, marked as such.
  function pricesHtml(r) {
    const cell = (l, i, meals) => {
      const v = cheapestFor(r, i, meals);
      return v != null ? [l, v, false] : [l, cheapestFor(r, i, meals, Infinity), true];
    };
    const cells = RANGES.map(([l], i) => cell(l, i));
    cells.push(cell("2 meals", null, "Breakfast & dinner"));
    return `<div class="prices">${cells.map(([l, v, over]) => (v == null ? `<div class="none"><small>${l}</small><b>—</b></div>`
      : `<div class="${over ? "over" : ""}"><small>${l}</small><b>${yen(v)}</b>${over ? "<small>over budget</small>" : ""}</div>`)).join("")}</div>`;
  }
  function roomLine(p) {
    return [p.roomStyle, p.size, p.bedding, p.bath && p.bath !== "none" ? `bath: ${p.bath}` : null, p.view].filter(Boolean).join(" · ") || p.room || "";
  }
  function dinnerLine(p) {
    if (p.meals === "Room only" || p.meals === "Breakfast only") return "No dinner";
    return [p.dinnerStyle && p.dinnerStyle !== "none" ? p.dinnerStyle : null, p.dinner].filter(Boolean).join(": ") || "Dinner";
  }
  function showCard(r, m, touch) {
    clearTimeout(hideTimer);
    // Nothing fits (e.g. a starred property): list the cheapest plans anyway, marked over budget.
    let q = qualifyingPlans(r).slice(0, 3), over = false;
    if (!q.length) { q = qualifyingPlans(r, Infinity).slice(0, 3); over = q.length > 0; }
    card.className = "card" + (touch ? " touch" : "");
    card.innerHTML = `${touch ? '<button class="icon-btn close" style="float:right" data-close>×</button>' : ""}${headHtml(r)}${photosHtml(r, 4)}
      ${r.setting ? `<div class="kv"><b>${esc(r.setting)}:</b> ${esc(r.settingNote || "")}</div>` : ""}
      ${r.onsen ? `<div class="kv"><b>Onsen:</b> ${esc(r.onsen)}</div>` : ""}
      ${r.strong && r.strong.length ? `<ul class="pts">${r.strong.slice(0, 4).map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
      ${r.watch ? `<div class="kv watch"><b>Watch-outs:</b> ${esc(r.watch)}</div>` : ""}
      ${pricesHtml(r)}
      <div class="top3">${q.map(({ p, price }) => `<div class="pl${over ? " over" : ""}"><div class="meal">${esc(p.meals)}</div>
        <div class="price">${yen(price)}<small>${over ? "over budget" : "/ night"}</small></div>
        <div class="one">${esc(roomLine(p))}</div><div class="one">${esc(dinnerLine(p))}</div></div>`).join("")}</div>
      ${touch ? '<button class="btn" data-open>All plans &amp; booking</button>' : '<div class="hint">Click a photo to enlarge · click the card or pin for all plans and booking links</div>'}`;
    card.hidden = false;
    card.onclick = touch ? null : (e) => { if (!e.target.closest("img[data-ph]")) { hideCardNow(); openPanel(r); } };
    if (touch) {
      card.querySelector("[data-close]").onclick = hideCardNow;
      card.querySelector("[data-open]").onclick = () => { hideCardNow(); openPanel(r); };
      return;
    }
    const pt = map.latLngToContainerPoint(m.getLatLng());
    const w = card.offsetWidth, h = card.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    const panelW = $("panel").hidden ? 0 : $("panel").offsetWidth;
    let x = pt.x + 18;
    if (x + w > vw - panelW - 10) x = pt.x - w - 18;
    x = Math.max(10, x);
    const y = Math.min(Math.max(10, pt.y - h / 2), vh - h - 10);
    card.style.left = x + "px"; card.style.top = Math.max(10, y) + "px";
  }
  function hideCard(delay = 150) { clearTimeout(hideTimer); hideTimer = setTimeout(hideCardNow, delay); }
  function hideCardNow() { clearTimeout(hideTimer); card.hidden = true; }
  // Keep the desktop card open while the pointer is on it, so its photos can be clicked.
  card.addEventListener("mouseenter", () => clearTimeout(hideTimer));
  card.addEventListener("mouseleave", () => { if (!card.classList.contains("touch")) hideCard(); });

  // Side panel
  const panel = $("panel");
  // `fromHash`: restoring state from the URL, so don't write a new history entry.
  function openPanel(r, fromHash) {
    activeId = r.id;
    renderPanel(r);
    panel.hidden = false;
    panel.scrollTop = 0;
    apply();
    if (!fromHash) writeHash(true); // pushState, so Back closes the panel
  }
  function closePanel(fromHash) {
    panel.hidden = true; activeId = null; apply();
    if (!fromHash) scheduleHash();
  }
  function renderPanel(r) {
    const ph = ["main", "bath", "room", "food"].map((k) => r.photos && r.photos[k]).filter(Boolean);
    const plans = [...(r.plans || [])].sort((a, b) => Math.min(...a.avg.map((v) => v ?? 1e9)) - Math.min(...b.avg.map((v) => v ?? 1e9)));
    const qualifies = (p) => (!state.twoMeals || p.meals === "Breakfast & dinner") && planPrice(p) != null;
    const nq = plans.filter(qualifies).length;
    $("panel-body").innerHTML = `
      ${ph.length ? `<div class="gallery${ph.length === 1 ? " n1" : ""}" style="grid-template-rows:repeat(${Math.max(1, ph.length - 1)},1fr)">${ph.map((u, i) => thumb(r, u, i ? "pictL" : "pict2L")).join("")}</div>` : ""}
      ${headHtml(r)}
      ${matchesFilters(r) ? "" : `<div class="note">${r.starred ? "Starred, so always shown, but it" : "This property"} does not match the current filters.</div>`}
      <div class="links"><a class="btn" href="${jalanUrl(r)}" target="_blank" rel="noopener">Jalan page</a>
        <a class="btn light" href="https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}" target="_blank" rel="noopener">Google Maps</a>
        <button class="btn light" data-copy>Copy link</button></div>
      ${pricesHtml(r)}
      <div class="kv"><b>${esc(r.setting)}:</b> ${esc(r.settingNote || "")}</div>
      ${r.onsen ? `<div class="kv"><b>Onsen:</b> ${esc(r.onsen)}</div>` : ""}
      ${r.baths ? `<div class="kv"><b>Baths:</b> ${esc(r.baths)}</div>` : ""}
      ${r.checkInOut ? `<div class="kv"><b>Check-in / out:</b> ${esc(r.checkInOut)}</div>` : ""}
      ${r.strong && r.strong.length ? `<h3>Strong points</h3><ul class="pts">${r.strong.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
      ${r.watch ? `<h3>Watch-outs</h3><div class="watch">${esc(r.watch)}</div>` : ""}
      ${r.summary ? `<h3>Reviews</h3><div>${esc(r.summary)}</div>` : ""}
      <div class="plans-head"><h3>Plans (${plans.length})</h3><span class="muted">${nq} match filters</span></div>
      ${plans.map((p) => planHtml(r, p, qualifies(p))).join("")}`;
  }
  function planHtml(r, p, ok) {
    const facts = [
      ["Room", p.room], ["Style", [p.roomStyle, p.bedding, p.size].filter(Boolean).join(" · ")], ["View", p.view],
      ["Balcony", p.balcony], ["In-room bath", p.bath], ["Dinner", dinnerLine(p)],
    ].filter(([, v]) => v);
    const priceCell = (v) => `<td class="${v == null ? "" : v <= state.budget ? "ok" : "over"}">${yen(v)}</td>`;
    const over = planPrice(p) == null && planPrice(p, rangeIdx(), Infinity) != null; // priced for the dates, but above the budget
    return `<div class="plan${ok ? "" : " off"}${over ? " over-budget" : ""}"><div class="pname">${over ? '<span class="tag-over">Over budget</span> ' : ""}${esc(p.name || "Plan")}</div>
      <div class="facts"><div class="meal">${esc(p.meals)}</div>${facts.map(([k, v]) => `<div><span class="muted">${k}:</span> ${esc(v)}</div>`).join("")}</div>
      ${p.photo ? thumb(r, p.photo) : "<div></div>"}
      <table><tr><th>Night</th>${NIGHTS.map((n) => `<th>${n}</th>`).join("")}</tr>
        <tr><td>Price</td>${(p.prices || []).map((v) => `<td>${yen(v)}</td>`).join("")}</tr>
        <tr><th>Avg / night</th>${RANGES.map(([l]) => `<th>${l}</th>`).join("")}</tr>
        <tr><td></td>${p.avg.map(priceCell).join("")}</tr></table>
      <div class="foot"><span class="muted">${p.cancel ? `Free cancellation until ${esc(p.cancel)}` : ""}${p.oneNight ? " · 1-night limit" : ""}</span>
        <a class="btn" href="${bookUrl(r, p)}" target="_blank" rel="noopener">Prices &amp; booking</a></div></div>`;
  }

  // Lightbox: every photo of one ryokan (its 4 photos, then plan room photos, deduplicated).
  const lb = $("lightbox"), lbImg = $("lb-img");
  let lbItems = [], lbIdx = 0, lbRid = null, touchX = null, touchY = null;
  const PHOTO_LABELS = { main: "Main", bath: "Bath", room: "Room", food: "Food" };
  function galleryItems(r) {
    const items = [], seen = new Set();
    const add = (u, label) => { const k = photoKey(u); if (!seen.has(k)) { seen.add(k); items.push({ u, k, label }); } };
    for (const [k, label] of Object.entries(PHOTO_LABELS)) if (r.photos && r.photos[k]) add(r.photos[k], label);
    for (const p of r.plans || []) if (p.photo) add(p.photo, `Room: ${roomLine(p) || p.room || p.name || ""}`);
    return items;
  }
  function openLightbox(r, key, index) {
    lbItems = galleryItems(r);
    if (!lbItems.length) return;
    lbRid = r.id;
    lbIdx = index != null ? Math.min(Math.max(0, index), lbItems.length - 1) : Math.max(0, lbItems.findIndex((it) => it.k === key));
    $("lb-title").textContent = r.name;
    lb.hidden = false;
    document.body.classList.add("lb-open");
    showLightbox();
  }
  function closeLightbox() { lb.hidden = true; document.body.classList.remove("lb-open"); lbImg.removeAttribute("src"); scheduleHash(); }
  function showLightbox() {
    const i = lbIdx, it = lbItems[i];
    // Show the (usually cached) small version at once, then swap in the 1200px one; fall back to 600px if that fails.
    lbImg.src = photo(it.u, "pictL");
    lbImg.classList.add("loading");
    const sizes = ["pict4L", "pict2L"];
    const tryNext = () => {
      const size = sizes.shift();
      if (!size) { if (i === lbIdx) lbImg.classList.remove("loading"); return; }
      const big = new Image();
      big.onload = () => { if (i === lbIdx) { lbImg.src = big.src; lbImg.classList.remove("loading"); } };
      big.onerror = tryNext;
      big.src = photo(it.u, size);
    };
    tryNext();
    $("lb-cap").textContent = it.label;
    $("lb-count").textContent = `${i + 1} / ${lbItems.length}`;
    lb.classList.toggle("single", lbItems.length < 2);
    for (const d of [-1, 1]) if (lbItems.length > 1) new Image().src = photo(lbItems[(i + d + lbItems.length) % lbItems.length].u, "pict4L");
    scheduleHash();
  }
  function stepLightbox(d) {
    if (lbItems.length < 2) return;
    lbIdx = (lbIdx + d + lbItems.length) % lbItems.length;
    showLightbox();
  }
  document.addEventListener("click", (e) => {
    const img = e.target.closest && e.target.closest("img[data-ph]");
    if (!img || lb.contains(img)) return;
    const r = DATA.find((x) => x.id === img.dataset.rid);
    if (r) { e.preventDefault(); e.stopPropagation(); openLightbox(r, img.dataset.ph); }
  }, true);
  lb.addEventListener("click", (e) => {
    const act = e.target.closest("[data-lb]");
    if (act) { const a = act.dataset.lb; if (a === "close") closeLightbox(); else stepLightbox(a === "next" ? 1 : -1); return; }
    if (e.target === lb || e.target.classList.contains("lb-stage")) closeLightbox();
  });
  lb.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; }, { passive: true });
  lb.addEventListener("touchend", (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX, dy = e.changedTouches[0].clientY - touchY;
    touchX = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) stepLightbox(dx < 0 ? 1 : -1);
  });

  // Filters
  function renderLegend() {
    const items = state.colorBy === "price" ? BANDS.map(([, c, l]) => [c, l]) : Object.entries(SETTING).map(([l, s]) => [s.color, l]);
    $("legend").innerHTML = items.map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join("") +
      (state.starred ? '<span class="lg-star">★ Starred</span>' : "") + "<span>Pin: cheapest avg / night · rating</span>";
  }
  function syncLabels() {
    $("budget-val").textContent = yen(state.budget);
    $("rating-val").textContent = state.rating <= 3 ? "any" : state.rating.toFixed(1) + "+";
  }
  function readControls() {
    state.budget = Number($("budget").value);
    state.rating = Number($("rating").value);
    state.range = document.querySelector("input[name=range]:checked").value;
    state.twoMeals = $("twomeals").checked;
    state.settings = new Set([...document.querySelectorAll("#settings input:checked")].map((i) => i.value));
    state.pref = $("pref").value;
    state.q = $("q").value.trim();
    state.colorBy = $("colorby").value;
    state.starred = $("showstarred").checked;
    state.starredOnly = $("starredonly").checked;
    syncLabels();
  }
  function writeControls(s) {
    $("budget").value = s.budget; $("rating").value = s.rating; $("twomeals").checked = s.twoMeals;
    document.querySelector(`input[name=range][value="${s.range}"]`).checked = true;
    document.querySelectorAll("#settings input").forEach((i) => { i.checked = s.settings.includes(i.value); });
    $("pref").value = s.pref; $("q").value = s.q; $("colorby").value = s.colorBy;
    $("showstarred").checked = s.starred; $("starredonly").checked = s.starredOnly;
  }
  let timer = 0;
  const onChange = (e) => {
    // "Starred only" implies showing them; hiding them turns "Starred only" off.
    const t = e && e.target;
    if (t && t.id === "starredonly" && t.checked) $("showstarred").checked = true;
    if (t && t.id === "showstarred" && !t.checked) $("starredonly").checked = false;
    readControls(); clearTimeout(timer); timer = setTimeout(() => { apply(); scheduleHash(); }, 16); };

  // Shareable URL state: #map=<zoom>/<lat>/<lng>&r=<yadNo>&photo=<index> plus any non-default filters
  // (starred=0 hides the starred pins, starred=only hides all others).
  let hashTimer = 0, lastHash = null;
  function hashString() {
    const c = map.getCenter(), parts = [`map=${map.getZoom()}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}`];
    const rid = activeId || (!lb.hidden ? lbRid : null);
    if (rid) parts.push(`r=${rid}`);
    if (rid && !lb.hidden && lbRid === rid) parts.push(`photo=${lbIdx}`);
    if (state.budget !== DEFAULTS.budget) parts.push(`budget=${state.budget}`);
    if (state.range !== "any") parts.push(`dates=${RANGES[Number(state.range)][0]}`);
    if (state.twoMeals) parts.push("meals=2");
    if (state.rating > DEFAULTS.rating) parts.push(`minr=${state.rating}`);
    if (state.settings.size !== DEFAULTS.settings.length) parts.push(`setting=${[...state.settings].map(encodeURIComponent).join(",")}`);
    if (state.pref) parts.push(`pref=${encodeURIComponent(state.pref)}`);
    if (state.q) parts.push(`q=${encodeURIComponent(state.q)}`);
    if (state.colorBy !== DEFAULTS.colorBy) parts.push(`color=${state.colorBy}`);
    if (!state.starred) parts.push("starred=0");
    else if (state.starredOnly) parts.push("starred=only");
    if (baseKey !== DEFAULT_BASE) parts.push(`base=${baseKey}`);
    return parts.join("&");
  }
  function writeHash(push) {
    clearTimeout(hashTimer);
    const h = hashString();
    if (!push && h === lastHash) return;
    lastHash = h;
    try { history[push ? "pushState" : "replaceState"]({ ryokanMap: 1 }, "", "#" + h); } catch { location.replace("#" + h); }
  }
  function scheduleHash() { clearTimeout(hashTimer); hashTimer = setTimeout(() => writeHash(false), 300); }
  // Restore from the URL: filters first, then the view, then the panel and lightbox; unknown or invalid
  // values fall back to defaults. `panelOnly` (Back/Forward between this page's own entries) only opens or
  // closes the panel and lightbox, keeping the current filters and view.
  function applyHash(initial, panelOnly) {
    const h = location.hash.replace(/^#/, "");
    if (!initial && h === lastHash) return;
    clearTimeout(hashTimer);
    const P = new URLSearchParams(h), s = { ...DEFAULTS };
    if (panelOnly) {
      const r = DATA.find((x) => x.id === P.get("r") && x.lat != null);
      if (r) openPanel(r, true); else if (!panel.hidden) closePanel(true);
      const ph = parseInt(P.get("photo"), 10);
      if (r && Number.isInteger(ph)) openLightbox(r, null, ph); else if (!lb.hidden) closeLightbox();
      writeHash(false);
      return;
    }
    if (Number(P.get("budget")) > 0) s.budget = Number(P.get("budget"));
    const d = RANGES.findIndex(([l]) => l === P.get("dates"));
    if (d >= 0) s.range = String(d);
    s.twoMeals = P.get("meals") === "2";
    if (Number(P.get("minr")) > 0) s.rating = Number(P.get("minr"));
    if (P.has("setting")) s.settings = P.get("setting").split(",").filter((x) => SETTING[x]);
    if (prefs.includes(P.get("pref"))) s.pref = P.get("pref");
    s.q = P.get("q") || "";
    if (P.get("color") === "price") s.colorBy = "price";
    s.starred = P.get("starred") !== "0";
    s.starredOnly = P.get("starred") === "only";
    writeControls(s);
    readControls();
    setBase(baseTokens[P.get("base")] ? P.get("base") : DEFAULT_BASE);
    const r = DATA.find((x) => x.id === P.get("r") && x.lat != null);
    activeId = r ? r.id : null;
    apply();
    const v = (P.get("map") || "").split("/").map(Number);
    if (v.length === 3 && v.every(Number.isFinite)) map.setView([v[1], v[2]], v[0], { animate: false });
    else if (initial && located.length) map.fitBounds(L.latLngBounds(located.map((r) => [r.lat, r.lng])).pad(0.05));
    if (r) openPanel(r, true); else if (!panel.hidden) closePanel(true);
    const ph = parseInt(P.get("photo"), 10);
    if (r && Number.isInteger(ph)) openLightbox(r, null, ph); else if (!lb.hidden) closeLightbox();
    writeHash(false);
  }
  async function copyLink(btn) {
    writeHash(false);
    const url = location.href;
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch {
      const ta = Object.assign(document.createElement("textarea"), { value: url });
      ta.style.cssText = "position:fixed;top:0;opacity:0";
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      ta.remove();
    }
    if (!ok) { window.prompt("Copy this link:", url); return; }
    const old = btn.textContent;
    btn.textContent = "Copied";
    setTimeout(() => { btn.textContent = old; }, 1500);
  }

  const prefs = [...new Set(DATA.map((r) => r.pref))].sort();
  $("pref").innerHTML += prefs.map((p) => `<option>${esc(p)}</option>`).join("");
  $("filters-body").addEventListener("input", onChange);
  $("filters-body").addEventListener("change", onChange);
  $("reset").onclick = () => { writeControls(DEFAULTS); onChange(); };
  $("filters-toggle").onclick = () => {
    const c = $("filters").classList.toggle("collapsed");
    $("filters-toggle").textContent = c ? "+" : "–";
    $("filters-toggle").setAttribute("aria-expanded", String(!c));
  };
  $("panel-close").onclick = () => closePanel();
  document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest("[data-copy]"); if (b) copyLink(b); });
  document.addEventListener("keydown", (e) => {
    if (!lb.hidden) {
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowRight") stepLightbox(1);
      else if (e.key === "ArrowLeft") stepLightbox(-1);
      else return;
      e.preventDefault();
      return;
    }
    if (e.key === "Escape") { hideCardNow(); if (!panel.hidden) closePanel(); }
  });
  map.on("click zoomstart movestart", hideCardNow);
  map.on("moveend", scheduleHash);
  window.addEventListener("hashchange", () => applyHash(false));
  window.addEventListener("popstate", (e) => applyHash(false, !!(e.state && e.state.ryokanMap)));
  if (TOUCH && window.innerWidth < 640) { $("filters").classList.add("collapsed"); $("filters-toggle").textContent = "+"; }

  $("total").textContent = DATA.filter((r) => !r.starred).length;
  const missing = DATA.length - located.length;
  if (missing) $("nocoords").textContent = `(${missing} without coordinates)`;
  applyHash(true); // also overrides values the browser restores into the form on reload
})();
