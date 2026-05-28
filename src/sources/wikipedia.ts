import { performance } from "node:perf_hooks";
import type { Source, RawResult, Trace } from "./types.ts";

const UA = "hcraes/0.1 (https://github.com/h8d13/hcraes)";
const BATCH = 100;
const MAX = 1000;

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

async function fetchPage(query: string, limit: number, offset: number, signal: AbortSignal): Promise<{ results: RawResult[]; bytes: number; readMs: number; parseMs: number; transformMs: number }> {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query", list: "search", srsearch: query,
    srlimit: String(limit), sroffset: String(offset),
    format: "json", origin: "*"
  }).toString();

  const res = await fetch(url, { signal, headers: { "user-agent": UA } });
  const t1 = performance.now();
  if (!res.ok) throw new Error(`wiki ${res.status}`);
  const body = await res.text();
  const t2 = performance.now();
  const json = JSON.parse(body) as { query?: { search?: Array<{ title: string; snippet: string }> } };
  const t3 = performance.now();

  const results = (json.query?.search ?? []).map((h, i): RawResult => ({
    title: h.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, "_"))}`,
    snippet: stripHtml(h.snippet),
    rank: offset + i
  }));
  const t4 = performance.now();
  return { results, bytes: body.length, readMs: t2 - t1, parseMs: t3 - t2, transformMs: t4 - t3 };
}

export const wikipedia: Source = {
  name: "wikipedia",
  weight: 1.0,
  defaultCount: 100,
  async search(query, signal, opts = {}) {
    const want = Math.min(opts.count ?? this.defaultCount, MAX);
    const batches = Math.ceil(want / BATCH);
    const trace = opts.trace;

    const wallStart = performance.now();
    const settled = await Promise.allSettled(
      Array.from({ length: batches }, (_, i) => fetchPage(query, BATCH, i * BATCH, signal))
    );
    const fetchWallMs = performance.now() - wallStart;

    const out: RawResult[] = [];
    let bytes = 0, readMs = 0, parseMs = 0, transformMs = 0;
    for (const s of settled) {
      if (s.status !== "fulfilled") continue;
      out.push(...s.value.results);
      bytes += s.value.bytes;
      readMs += s.value.readMs;
      parseMs += s.value.parseMs;
      transformMs += s.value.transformMs;
    }
    out.sort((a, b) => a.rank - b.rank);
    if (trace) Object.assign(trace, { fetchWallMs, readMs, parseMs, transformMs, bytes, batches });
    return out.slice(0, want);
  }
};
