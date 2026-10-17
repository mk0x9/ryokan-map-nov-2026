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
  const DEFAULTS = { budget: 40000, rating: 3, range: "any", twoMeals: false, settings: ["Onsen town", "Remote", "Town"], pref: "", q: "", colorBy: "setting" };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const yen = (v) => (v == null ? "—" : "¥" + Math.round(v).toLocaleString("en-US"));
  const yenK = (v) => "¥" + Math.round(v / 1000) + "k";
  // Jalan serves the same photo at several widths: pictL 300px, pict2L 600px, pict4L 1200px (what data.js stores).
  const photo = (u, size = "pictL") => (/^https?:/.test(u) ? u : IMG_BASE + u.replace(/^pict4L\//, size + "/"));
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

  // Cheapest in-budget average for one plan over the selected ranges.
  function planPrice(p, idx = rangeIdx(), budget = state.budget) {
    let best = null;
    for (const i of idx) { const a = p.avg[i]; if (a != null && a <= budget && (best == null || a < best)) best = a; }
    return best;
  }
  function qualifyingPlans(r) {
    return (r.plans || [])
      .filter((p) => !state.twoMeals || p.meals === "Breakfast & dinner")
      .map((p) => ({ p, price: planPrice(p) }))
      .filter((x) => x.price != null)
      .sort((a, b) => a.price - b.price);
  }
  function cheapestFor(r, i, meals) {
    let best = null;
    for (const p of r.plans || []) {
      if (meals && p.meals !== meals) continue;
      const a = planPrice(p, i == null ? [0, 1, 2] : [i]);
      if (a != null && (best == null || a < best)) best = a;
    }
    return best;
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
  const map = (window.ryokanMap = L.map("map", { zoomControl: false }).setView([36.3, 138.6], 7));
  L.control.zoom({ position: "bottomright" }).addTo(map);
  // tile.openstreetmap.org refuses requests without a Referer, which is what a file:// page sends,
  // so from disk the default is the OSM France-hosted Humanitarian (HOT) style; standard OSM stays one click away.
  const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const bases = {
    OpenStreetMap: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: OSM_ATTR }),
    "OpenStreetMap HOT": L.tileLayer("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", { maxZoom: 19, subdomains: "abc",
      attribution: `${OSM_ATTR}, tiles style by <a href="https://www.hotosm.org/">HOT</a> hosted by <a href="https://openstreetmap.fr/">OSM France</a>` }),
  };
  bases[location.protocol === "file:" ? "OpenStreetMap HOT" : "OpenStreetMap"].addTo(map);
  L.control.layers(bases, null, { position: "bottomright" }).addTo(map);
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

  const located = DATA.filter((r) => r.lat != null && r.lng != null);
  const markers = located.map((r) => {
    const m = L.marker([r.lat, r.lng], { riseOnHover: true, keyboard: false, title: "" });
    m.ryokan = r;
    if (TOUCH) {
      m.on("click", () => showCard(r, m, true));
    } else {
      m.on("mouseover", () => showCard(r, m, false));
      m.on("mouseout", hideCard);
      m.on("click", () => { hideCard(); openPanel(r); });
    }
    return m;
  });

  let activeId = null;
  function pinIcon(r, price) {
    const label = `${yenK(price)}${r.rating ? ` <span class="r">· ${r.rating.toFixed(1)}</span>` : ""}`;
    const color = pinColor(r, price);
    return L.divIcon({ className: "pin-wrap", iconSize: [0, 0], iconAnchor: [0, 0],
      html: `<div class="pin${r.id === activeId ? " active" : ""}" style="background:${color};border-top-color:${color}">${label}</div>` });
  }

  function apply() {
    const visible = [];
    for (const m of markers) {
      const r = m.ryokan;
      const q = passes(r) ? qualifyingPlans(r) : [];
      m.options.price = q.length ? q[0].price : null;
      if (q.length) { m.setIcon(pinIcon(r, q[0].price)); visible.push(m); }
    }
    clusters.clearLayers();
    clusters.addLayers(visible);
    $("count").textContent = visible.length;
    renderLegend();
    if (activeId) { const r = DATA.find((x) => x.id === activeId); if (r) renderPanel(r); }
  }

  // Hover / tap card
  const card = $("card");
  let hideTimer = null;
  function photosHtml(r, max) {
    const ph = ["main", "bath", "room", "food"].map((k) => r.photos && r.photos[k]).filter(Boolean).slice(0, max);
    return ph.length ? `<div class="photos" style="grid-template-columns:repeat(${ph.length},1fr)">${
      ph.map((u) => `<img loading="lazy" src="${esc(photo(u))}" alt="">`).join("")}</div>` : "";
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
    return `<h2>${esc(r.name)}</h2><div class="jp">${esc(r.nameJp)} · ${esc(r.area)}, ${esc(r.pref)}</div>
      <div class="badges"><span class="stars">★ ${r.rating ? r.rating.toFixed(1) : "—"}</span>
      <span class="muted">${r.reviews ? r.reviews.toLocaleString("en-US") + " reviews" : ""}</span>${badgeHtml(r)}</div>${scoresHtml(r)}`;
  }
  function pricesHtml(r) {
    const cells = RANGES.map(([l], i) => [l, cheapestFor(r, i)]);
    cells.push(["2 meals", cheapestFor(r, null, "Breakfast & dinner")]);
    return `<div class="prices">${cells.map(([l, v]) => `<div class="${v == null ? "none" : ""}"><small>${l}</small><b>${yen(v)}</b></div>`).join("")}</div>`;
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
    const q = qualifyingPlans(r).slice(0, 3);
    card.className = "card" + (touch ? " touch" : "");
    card.innerHTML = `${touch ? '<button class="icon-btn close" style="float:right" data-close>×</button>' : ""}${headHtml(r)}${photosHtml(r, 4)}
      ${r.setting ? `<div class="kv"><b>${esc(r.setting)}:</b> ${esc(r.settingNote || "")}</div>` : ""}
      ${r.onsen ? `<div class="kv"><b>Onsen:</b> ${esc(r.onsen)}</div>` : ""}
      ${r.strong && r.strong.length ? `<ul class="pts">${r.strong.slice(0, 4).map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
      ${r.watch ? `<div class="kv watch"><b>Watch-outs:</b> ${esc(r.watch)}</div>` : ""}
      ${pricesHtml(r)}
      <div class="top3">${q.map(({ p, price }) => `<div class="pl"><div class="meal">${esc(p.meals)}</div>
        <div class="price">${yen(price)}<small>/ night</small></div>
        <div class="one">${esc(roomLine(p))}</div><div class="one">${esc(dinnerLine(p))}</div></div>`).join("")}</div>
      ${touch ? '<button class="btn" data-open>All plans &amp; booking</button>' : '<div class="hint">Click the pin for all plans and booking links</div>'}`;
    card.hidden = false;
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
  function hideCard() { clearTimeout(hideTimer); hideTimer = setTimeout(hideCardNow, 80); }
  function hideCardNow() { card.hidden = true; }

  // Side panel
  const panel = $("panel");
  function openPanel(r) {
    activeId = r.id;
    renderPanel(r);
    panel.hidden = false;
    panel.scrollTop = 0;
    apply();
  }
  function closePanel() { panel.hidden = true; activeId = null; apply(); }
  function renderPanel(r) {
    const ph = ["main", "bath", "room", "food"].map((k) => r.photos && r.photos[k]).filter(Boolean);
    const plans = [...(r.plans || [])].sort((a, b) => Math.min(...a.avg.map((v) => v ?? 1e9)) - Math.min(...b.avg.map((v) => v ?? 1e9)));
    const qualifies = (p) => (!state.twoMeals || p.meals === "Breakfast & dinner") && planPrice(p) != null;
    const nq = plans.filter(qualifies).length;
    $("panel-body").innerHTML = `
      ${ph.length ? `<div class="gallery${ph.length === 1 ? " n1" : ""}" style="grid-template-rows:repeat(${Math.max(1, ph.length - 1)},1fr)">${ph.map((u, i) => `<img loading="lazy" src="${esc(photo(u, i ? "pictL" : "pict2L"))}" alt="">`).join("")}</div>` : ""}
      ${headHtml(r)}
      <div class="links"><a class="btn" href="${jalanUrl(r)}" target="_blank" rel="noopener">Jalan page</a>
        <a class="btn light" href="https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}" target="_blank" rel="noopener">Google Maps</a></div>
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
    return `<div class="plan${ok ? "" : " off"}"><div class="pname">${esc(p.name || "Plan")}</div>
      <div class="facts"><div class="meal">${esc(p.meals)}</div>${facts.map(([k, v]) => `<div><span class="muted">${k}:</span> ${esc(v)}</div>`).join("")}</div>
      ${p.photo ? `<img loading="lazy" src="${esc(photo(p.photo))}" alt="">` : "<div></div>"}
      <table><tr><th>Night</th>${NIGHTS.map((n) => `<th>${n}</th>`).join("")}</tr>
        <tr><td>Price</td>${(p.prices || []).map((v) => `<td>${yen(v)}</td>`).join("")}</tr>
        <tr><th>Avg / night</th>${RANGES.map(([l]) => `<th>${l}</th>`).join("")}</tr>
        <tr><td></td>${p.avg.map(priceCell).join("")}</tr></table>
      <div class="foot"><span class="muted">${p.cancel ? `Free cancellation until ${esc(p.cancel)}` : ""}${p.oneNight ? " · 1-night limit" : ""}</span>
        <a class="btn" href="${bookUrl(r, p)}" target="_blank" rel="noopener">Prices &amp; booking</a></div></div>`;
  }

  // Filters
  function renderLegend() {
    const items = state.colorBy === "price" ? BANDS.map(([, c, l]) => [c, l]) : Object.entries(SETTING).map(([l, s]) => [s.color, l]);
    $("legend").innerHTML = items.map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join("") +
      "<span>Pin: cheapest avg / night · rating</span>";
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
    syncLabels();
  }
  function writeControls(s) {
    $("budget").value = s.budget; $("rating").value = s.rating; $("twomeals").checked = s.twoMeals;
    document.querySelector(`input[name=range][value="${s.range}"]`).checked = true;
    document.querySelectorAll("#settings input").forEach((i) => { i.checked = s.settings.includes(i.value); });
    $("pref").value = s.pref; $("q").value = s.q; $("colorby").value = s.colorBy;
  }
  let timer = 0;
  const onChange = () => { readControls(); clearTimeout(timer); timer = setTimeout(apply, 16); };

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
  $("panel-close").onclick = closePanel;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { hideCardNow(); if (!panel.hidden) closePanel(); } });
  map.on("click zoomstart movestart", hideCardNow);
  if (TOUCH && window.innerWidth < 640) { $("filters").classList.add("collapsed"); $("filters-toggle").textContent = "+"; }

  $("total").textContent = DATA.length;
  const missing = DATA.length - located.length;
  if (missing) $("nocoords").textContent = `(${missing} without coordinates)`;
  writeControls(DEFAULTS); // ignore values the browser restores into the form on reload
  readControls();
  apply();
  if (markers.length) map.fitBounds(L.latLngBounds(markers.map((m) => m.getLatLng())).pad(0.05));
})();
