import { runSearchStream, SOURCES } from "./lib/pipeline.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderArrival(name, ok, ms, count, err) {
  const dt = (performance.now() - window._t0).toFixed(0);
  const status = ok ? `${count} hits in ${ms.toFixed(0)}ms` : `FAIL (${esc(err ?? "")})`;
  $("#arrivals").insertAdjacentHTML("beforeend",
    `<p class="arr">↳ <strong>${esc(name)}</strong> @ ${dt}ms · ${status}</p>`);
}

const PAGE_SIZE = 30;

function renderHit(h) {
  return `<li class="hit">
    <div class="hit-title">
      <a href="${esc(h.url)}" rel="noopener" target="_blank">${esc(h.title)}</a>
      <span class="badges">${h.sources.map(s => `<span class="badge">${esc(s)}</span>`).join("")}</span>
      <span class="score">${h.score.toFixed(3)}</span>
    </div>
    <div class="hit-url">${esc(h.url)}</div>
    ${h.snippet ? `<div class="hit-snippet">${esc(h.snippet.slice(0, 240))}</div>` : ""}
  </li>`;
}

function renderHits(hits, uniqueCount, timings) {
  let shown = Math.min(PAGE_SIZE, hits.length);
  const paint = () => {
    $("#results").innerHTML = `<ol class="hits">${hits.slice(0, shown).map(renderHit).join("")}</ol>` +
      (shown < hits.length ? `<button id="more" type="button">load ${Math.min(PAGE_SIZE, hits.length - shown)} more (${hits.length - shown} remaining)</button>` : "");
    $("#meta").innerHTML =
      `showing ${shown}/${hits.length} · ${uniqueCount} unique fused · fan-out ${timings.fanOutMs.toFixed(0)}ms · RRF ${timings.rrfMs.toFixed(1)}ms · rerank ${timings.rerankMs.toFixed(1)}ms · total <strong>${timings.totalMs.toFixed(0)}ms</strong>`;
    const btn = $("#more");
    if (btn) btn.onclick = () => { shown = Math.min(shown + PAGE_SIZE, hits.length); paint(); };
  };
  paint();
}

const CACHE_TTL = 60_000;
function cacheGet(key) {
  try {
    const raw = sessionStorage.getItem("hcraes:" + key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) { sessionStorage.removeItem("hcraes:" + key); return null; }
    return data;
  } catch { return null; }
}
function cachePut(key, data) {
  try { sessionStorage.setItem("hcraes:" + key, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

const ENABLED_KEY = "hcraes:enabled";
function getEnabled() {
  try {
    const raw = localStorage.getItem(ENABLED_KEY);
    if (raw) {
      const set = new Set(JSON.parse(raw));
      const valid = SOURCES.filter(s => set.has(s.name)).map(s => s.name);
      if (valid.length > 0) return new Set(valid);
    }
  } catch {}
  return new Set(SOURCES.map(s => s.name));
}
function setEnabled(set) {
  try { localStorage.setItem(ENABLED_KEY, JSON.stringify([...set])); } catch {}
}
function activeSources() {
  const en = getEnabled();
  return SOURCES.filter(s => en.has(s.name));
}
function activeKey() {
  return [...getEnabled()].sort().join(",");
}

async function runQuery(query, depth) {
  $("#arrivals").innerHTML = "";
  $("#results").innerHTML = "";
  $("#meta").innerHTML = "";
  const cacheKey = `${query}::${depth}::${activeKey()}`;

  const cached = cacheGet(cacheKey);
  if (cached) {
    $("#status").textContent = "";
    $("#arrivals").innerHTML = `<p class="arr">↳ <em>cached</em></p>`;
    renderHits(cached.hits, cached.uniqueCount, cached.timings);
    return;
  }

  $("#status").textContent = "streaming sources as they land...";
  window._t0 = performance.now();

  try {
    for await (const ev of runSearchStream(query, depth, activeSources())) {
      if (ev.type === "source") {
        renderArrival(ev.name, ev.ok, ev.ms, ev.results.length, ev.err);
      } else {
        $("#status").textContent = "";
        renderHits(ev.hits, ev.uniqueCount, ev.timings);
        cachePut(cacheKey, { hits: ev.hits, uniqueCount: ev.uniqueCount, timings: ev.timings });
      }
    }
  } catch (e) {
    $("#status").innerHTML = `<span style="color:#dc2626">error: ${esc(e?.message ?? String(e))}</span>`;
  }
}

function prewarm() {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 3000);
  for (const s of activeSources()) s.search("test", ctrl.signal, { count: 1 }).catch(() => {});
}

function renderToggles() {
  const enabled = getEnabled();
  $(".tagline").innerHTML = `zero-dep metasearch. ` + SOURCES.map(s =>
    `<button type="button" class="src-toggle ${enabled.has(s.name) ? 'on' : 'off'}" data-name="${esc(s.name)}">${esc(s.name)}</button>`
  ).join(" ");
  for (const btn of $$(".src-toggle")) {
    btn.onclick = () => {
      const name = btn.dataset.name;
      const en = getEnabled();
      if (en.has(name)) en.delete(name); else en.add(name);
      if (en.size === 0) return;
      setEnabled(en);
      renderToggles();
    };
  }
}

function readParams() {
  const p = new URLSearchParams(location.search);
  return {
    query: (p.get("q") ?? "").trim(),
    depth: Math.max(10, Math.min(1000, parseInt(p.get("depth") ?? "100", 10) || 100))
  };
}

function init() {
  renderToggles();

  const { query, depth } = readParams();
  $("input[name=q]").value = query;
  $("input[name=depth]").value = depth;
  if (query) runQuery(query, depth);

  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("input[name=q]").value.trim();
    const d = parseInt($("input[name=depth]").value, 10) || 100;
    if (!q) return;
    const url = new URL(location.href);
    url.searchParams.set("q", q);
    url.searchParams.set("depth", String(d));
    history.pushState(null, "", url);
    runQuery(q, d);
  });

  prewarm();

  window.addEventListener("popstate", () => {
    const { query: q, depth: d } = readParams();
    $("input[name=q]").value = q;
    $("input[name=depth]").value = d;
    if (q) runQuery(q, d); else { $("#results").innerHTML = ""; $("#arrivals").innerHTML = ""; $("#meta").innerHTML = ""; }
  });
}

init();
