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

function renderHits(hits, uniqueCount, timings) {
  const lis = hits.slice(0, 30).map(h => `
    <li class="hit">
      <div class="hit-title">
        <a href="${esc(h.url)}" rel="noopener" target="_blank">${esc(h.title)}</a>
        <span class="badges">${h.sources.map(s => `<span class="badge">${esc(s)}</span>`).join("")}</span>
        <span class="score">${h.score.toFixed(3)}</span>
      </div>
      <div class="hit-url">${esc(h.url)}</div>
      ${h.snippet ? `<div class="hit-snippet">${esc(h.snippet.slice(0, 240))}</div>` : ""}
    </li>`).join("");
  $("#results").innerHTML = `<ol class="hits">${lis}</ol>`;
  $("#meta").innerHTML =
    `${uniqueCount} unique fused · fan-out ${timings.fanOutMs.toFixed(0)}ms · RRF ${timings.rrfMs.toFixed(1)}ms · rerank ${timings.rerankMs.toFixed(1)}ms · total <strong>${timings.totalMs.toFixed(0)}ms</strong>`;
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

async function runQuery(query, depth) {
  $("#arrivals").innerHTML = "";
  $("#results").innerHTML = "";
  $("#meta").innerHTML = "";
  const cacheKey = `${query}::${depth}`;

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
    for await (const ev of runSearchStream(query, depth)) {
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
  for (const s of SOURCES) s.search("test", ctrl.signal, { count: 1 }).catch(() => {});
}

function readParams() {
  const p = new URLSearchParams(location.search);
  return {
    query: (p.get("q") ?? "").trim(),
    depth: Math.max(10, Math.min(1000, parseInt(p.get("depth") ?? "100", 10) || 100))
  };
}

function init() {
  $(".tagline").innerHTML =
    `zero-dep metasearch. ${SOURCES.map(s => `<code>${s.name}</code>`).join(" + ")}.`;

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
