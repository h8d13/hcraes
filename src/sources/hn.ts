import { performance } from "node:perf_hooks";
import type { Source, RawResult } from "./types.ts";

const BATCH = 100;
const MAX = 1000;

async function fetchPage(query: string, hitsPerPage: number, page: number, signal: AbortSignal): Promise<{ results: RawResult[]; bytes: number; readMs: number; parseMs: number; transformMs: number }> {
  const url = new URL("https://hn.algolia.com/api/v1/search");
  url.search = new URLSearchParams({
    query, hitsPerPage: String(hitsPerPage), page: String(page), tags: "story"
  }).toString();

  const res = await fetch(url, { signal });
  const t1 = performance.now();
  if (!res.ok) throw new Error(`hn ${res.status}`);
  const body = await res.text();
  const t2 = performance.now();
  const json = JSON.parse(body) as { hits?: Array<{ title?: string; url?: string; story_text?: string; objectID: string }> };
  const t3 = performance.now();

  const results = (json.hits ?? [])
    .filter(h => h.title)
    .map((h, i): RawResult => ({
      title: h.title!,
      url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
      snippet: (h.story_text ?? "").slice(0, 200),
      rank: page * hitsPerPage + i
    }));
  const t4 = performance.now();
  return { results, bytes: body.length, readMs: t2 - t1, parseMs: t3 - t2, transformMs: t4 - t3 };
}

export const hackerNews: Source = {
  name: "hn",
  weight: 0.6,
  defaultCount: 200,
  async search(query, signal, opts = {}) {
    const want = Math.min(opts.count ?? this.defaultCount, MAX);
    const batches = Math.ceil(want / BATCH);
    const trace = opts.trace;

    const wallStart = performance.now();
    const settled = await Promise.allSettled(
      Array.from({ length: batches }, (_, i) => fetchPage(query, BATCH, i, signal))
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
