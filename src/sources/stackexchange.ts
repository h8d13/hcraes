import { performance } from "node:perf_hooks";
import type { Source, RawResult } from "./types.ts";

const BATCH = 30;
const MAX = 100;
const SITE = "stackoverflow";

type Question = {
  title: string;
  link: string;
  score: number;
  answer_count: number;
  is_answered: boolean;
  view_count: number;
  tags: string[];
  question_id: number;
};

async function fetchPage(query: string, pagesize: number, page: number, signal: AbortSignal): Promise<{ results: RawResult[]; bytes: number; readMs: number; parseMs: number; transformMs: number }> {
  const url = new URL("https://api.stackexchange.com/2.3/search/advanced");
  url.search = new URLSearchParams({
    q: query, site: SITE, order: "desc", sort: "relevance",
    pagesize: String(pagesize), page: String(page)
  }).toString();

  const res = await fetch(url, { signal });
  const t1 = performance.now();
  if (!res.ok) throw new Error(`stackexchange ${res.status}`);
  const body = await res.text();
  const t2 = performance.now();
  const json = JSON.parse(body) as { items?: Question[]; quota_remaining?: number };
  const t3 = performance.now();

  const startRank = (page - 1) * pagesize;
  const results = (json.items ?? []).map((q, i): RawResult => {
    const ans = q.is_answered ? "✓" : "?";
    const tags = q.tags.slice(0, 4).join(",");
    return {
      title: q.title.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
      url: q.link,
      snippet: `[${q.score}↑ ${ans} ${q.answer_count} ans, ${q.view_count.toLocaleString()} views, ${tags}]`,
      rank: startRank + i
    };
  });
  const t4 = performance.now();
  return { results, bytes: body.length, readMs: t2 - t1, parseMs: t3 - t2, transformMs: t4 - t3 };
}

export const stackexchange: Source = {
  name: "stack",
  weight: 0.9,
  defaultCount: 30,
  async search(query, signal, opts = {}) {
    const want = Math.min(opts.count ?? this.defaultCount, MAX);
    const batches = Math.ceil(want / BATCH);
    const trace = opts.trace;

    const wallStart = performance.now();
    const settled = await Promise.allSettled(
      Array.from({ length: batches }, (_, i) => fetchPage(query, BATCH, i + 1, signal))
    );
    const fetchWallMs = performance.now() - wallStart;

    const out: RawResult[] = [];
    let bytes = 0, readMs = 0, parseMs = 0, transformMs = 0;
    const errors: string[] = [];
    for (const s of settled) {
      if (s.status === "fulfilled") {
        out.push(...s.value.results);
        bytes += s.value.bytes;
        readMs += s.value.readMs;
        parseMs += s.value.parseMs;
        transformMs += s.value.transformMs;
      } else {
        errors.push(s.reason?.message ?? String(s.reason));
      }
    }
    out.sort((a, b) => a.rank - b.rank);
    if (trace) Object.assign(trace, { fetchWallMs, readMs, parseMs, transformMs, bytes, batches });
    if (out.length === 0 && errors.length > 0) throw new Error(errors[0]);
    return out.slice(0, want);
  }
};
