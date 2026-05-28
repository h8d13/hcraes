import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import { runSearchStream, SOURCES, prewarm } from "./pipeline.ts";

const PORT = parseInt(process.env.PORT ?? "8080", 10);

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CSS = `
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 820px; margin: 2em auto; padding: 0 1em; color: #222; }
  h1 { font-size: 1.6em; margin: 0 0 .2em; }
  h1 a { color: #222; text-decoration: none; }
  .tagline { color: #666; margin: 0 0 1.5em; font-size: .9em; }
  form { display: flex; gap: .5em; flex-wrap: wrap; align-items: center; margin-bottom: 1.2em; }
  input[name=q] { flex: 1; min-width: 220px; padding: .55em .7em; font-size: 1em; border: 1px solid #bbb; border-radius: 4px; }
  input[name=depth] { width: 5em; padding: .55em .5em; border: 1px solid #bbb; border-radius: 4px; }
  button { padding: .55em 1.1em; font-size: 1em; background: #2563eb; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
  button:hover { background: #1d4ed8; }
  label { font-size: .85em; color: #555; display: flex; gap: .35em; align-items: center; }
  .meta { color: #666; font-size: .82em; border-top: 1px solid #eee; padding-top: .8em; margin-top: 1.5em; }
  .meta code { background: #f3f4f6; padding: 1px 5px; border-radius: 3px; }
  ol.hits { padding: 0; list-style: none; }
  li.hit { margin: 0 0 1.2em; }
  .hit-title { font-size: 1.05em; }
  .hit-title a { color: #2563eb; text-decoration: none; font-weight: 500; }
  .hit-title a:hover { text-decoration: underline; }
  .hit-url { color: #15803d; font-size: .8em; word-break: break-all; margin: 2px 0; }
  .hit-snippet { color: #444; font-size: .92em; }
  .badges { display: inline-flex; gap: .3em; margin-left: .5em; }
  .badge { font-size: .7em; padding: 1px 6px; background: #eef2ff; color: #3730a3; border-radius: 10px; font-weight: 500; }
  .score { color: #888; font-size: .75em; }
  .empty { color: #888; padding: 2em 0; text-align: center; }
`;

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head><body>${body}</body></html>`;
}

function searchForm(query = "", depth = 100): string {
  return `<form action="/search" method="get">
    <input name="q" value="${esc(query)}" placeholder="search ${SOURCES.map(s => s.name).join(', ')}..." autofocus required>
    <label>depth <input name="depth" type="number" min="10" max="1000" value="${depth}"></label>
    <button>search</button>
  </form>`;
}

function indexPage(): string {
  return layout("hcraes", `
    <h1><a href="/">hcraes</a></h1>
    <p class="tagline">zero-dep metasearch. ${SOURCES.map(s => `<code>${s.name}</code>`).join(" + ")}.</p>
    ${searchForm()}
  `);
}


const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(indexPage());
      return;
    }
    if (req.method === "GET" && url.pathname === "/search") {
      const query = (url.searchParams.get("q") ?? "").trim();
      const depth = Math.max(10, Math.min(1000, parseInt(url.searchParams.get("depth") ?? "100", 10) || 100));
      if (!query) { res.writeHead(302, { location: "/" }); res.end(); return; }

      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", "x-accel-buffering": "no" });
      res.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(query)} — hcraes</title><style>${CSS} .arr{color:#15803d;font-size:.85em;margin:.4em 0}</style></head><body>`);
      res.write(`<h1><a href="/">hcraes</a></h1>${searchForm(query, depth)}<p class="arr">streaming sources as they land...</p>`);

      const t0 = performance.now();
      for await (const ev of runSearchStream(query, depth)) {
        if (ev.type === "source") {
          const dt = (performance.now() - t0).toFixed(0);
          const status = ev.ok ? `${ev.results.length} hits in ${ev.ms.toFixed(0)}ms` : `FAIL (${ev.err})`;
          res.write(`<p class="arr">↳ <strong>${ev.name}</strong> @ ${dt}ms · ${status}</p>`);
        } else {
          res.write(`<ol class="hits">${ev.hits.slice(0, 30).map(h => `
            <li class="hit">
              <div class="hit-title"><a href="${esc(h.url)}" rel="noopener">${esc(h.title)}</a>
                <span class="badges">${h.sources.map(s => `<span class="badge">${esc(s)}</span>`).join("")}</span>
                <span class="score">${h.score.toFixed(3)}</span></div>
              <div class="hit-url">${esc(h.url)}</div>
              ${h.snippet ? `<div class="hit-snippet">${esc(h.snippet.slice(0, 240))}</div>` : ""}
            </li>`).join("")}</ol>
            <p class="meta">${ev.uniqueCount} unique fused · fan-out ${ev.timings.fanOutMs.toFixed(0)}ms · RRF ${ev.timings.rrfMs.toFixed(1)}ms · rerank ${ev.timings.rerankMs.toFixed(1)}ms · total <strong>${ev.timings.totalMs.toFixed(0)}ms</strong></p>`);
        }
        if (typeof (res as any).flush === "function") (res as any).flush();
      }
      res.end(`</body></html>`);
      console.log(`[${new Date().toISOString()}] "${query}" depth=${depth}`);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  } catch (e) {
    console.error("handler err:", e);
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("internal error: " + (e instanceof Error ? e.message : String(e)));
  }
});

server.listen(PORT, async () => {
  console.log(`hcraes serving on http://localhost:${PORT}`);
  console.log(`sources: ${SOURCES.map(s => s.name).join(", ")}`);
  console.log("prewarming TLS...");
  const t0 = performance.now();
  await prewarm();
  console.log(`prewarmed in ${(performance.now()-t0).toFixed(0)}ms`);
});
