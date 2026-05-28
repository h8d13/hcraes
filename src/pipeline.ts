import { performance } from "node:perf_hooks";
import { wikipedia } from "./sources/wikipedia.ts";
import { hackerNews } from "./sources/hn.ts";
import { github } from "./sources/github.ts";
import { stackexchange } from "./sources/stackexchange.ts";
import { rrf, type FusedHit } from "./fusion.ts";
import { InvertedIndex } from "./index_store.ts";
import { search as bm25 } from "./search.ts";
import type { Source, RawResult, Trace } from "./sources/types.ts";

export const SOURCES: Source[] = [wikipedia, hackerNews, github, stackexchange];
const TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 200;

export type SourceOutcome = { name: string; ok: boolean; count: number; trace: Trace; err?: string };
export type SearchResult = {
  hits: FusedHit[];
  outcomes: SourceOutcome[];
  timings: { fanOutMs: number; rrfMs: number; rerankMs: number; totalMs: number };
  query: string;
  depth: number;
  uniqueCount: number;
  cached: boolean;
};

const cache = new Map<string, { ts: number; result: SearchResult }>();

function cacheGet(key: string): SearchResult | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.result;
}

function cachePut(key: string, result: SearchResult): void {
  if (cache.size >= CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, { ts: Date.now(), result });
}

function blankTrace(): Trace {
  return { fetchWallMs: 0, readMs: 0, parseMs: 0, transformMs: 0, bytes: 0, batches: 0 };
}

async function withTimeout<T>(p: Promise<T>, ms: number, ctrl: AbortController): Promise<T> {
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await p; } finally { clearTimeout(t); }
}

function localRerank(query: string, fused: FusedHit[]): FusedHit[] {
  if (fused.length === 0) return fused;
  const idx = new InvertedIndex();
  for (let i = 0; i < fused.length; i++) {
    const h = fused[i];
    idx.add({ id: String(i), text: `${h.title} ${h.title} ${h.snippet}` });
  }
  const ranked = bm25(idx, query, fused.length);
  return ranked.map(r => ({ ...fused[parseInt(r.docId, 10)], score: r.score }));
}

export async function runSearch(query: string, depth: number): Promise<SearchResult> {
  const cacheKey = `${query}::${depth}`;
  const hit = cacheGet(cacheKey);
  if (hit) return { ...hit, cached: true, timings: { ...hit.timings, totalMs: 0 } };

  const t0 = performance.now();
  const outcomes: SourceOutcome[] = [];
  const perSource = new Map<string, RawResult[]>();

  const settled = await Promise.allSettled(
    SOURCES.map(async s => {
      const ctrl = new AbortController();
      const trace = blankTrace();
      const r = await withTimeout(s.search(query, ctrl.signal, { count: depth, trace }), TIMEOUT_MS, ctrl);
      return { name: s.name, results: r, trace };
    })
  );
  settled.forEach((r, i) => {
    const name = SOURCES[i].name;
    if (r.status === "fulfilled") {
      perSource.set(r.value.name, r.value.results);
      outcomes.push({ name, ok: true, count: r.value.results.length, trace: r.value.trace });
    } else {
      const err = r.reason?.message ?? String(r.reason);
      outcomes.push({ name, ok: false, count: 0, trace: blankTrace(), err: err.includes("abort") ? "timeout" : err });
    }
  });

  const t1 = performance.now();
  const fused = rrf(perSource, SOURCES);
  const t2 = performance.now();
  const hits = localRerank(query, fused);
  const t3 = performance.now();

  const result: SearchResult = {
    hits,
    outcomes,
    timings: { fanOutMs: t1 - t0, rrfMs: t2 - t1, rerankMs: t3 - t2, totalMs: t3 - t0 },
    query, depth,
    uniqueCount: fused.length,
    cached: false
  };
  const allOk = outcomes.every(o => o.ok);
  if (allOk) cachePut(cacheKey, result);
  return result;
}

export type StreamEvent =
  | { type: "source"; name: string; ok: boolean; ms: number; results: RawResult[]; trace: Trace; err?: string }
  | { type: "final"; hits: FusedHit[]; timings: { fanOutMs: number; rrfMs: number; rerankMs: number; totalMs: number }; uniqueCount: number };

export async function* runSearchStream(query: string, depth: number): AsyncGenerator<StreamEvent> {
  const t0 = performance.now();
  const perSource = new Map<string, RawResult[]>();

  const tagged = SOURCES.map((s) => {
    const ctrl = new AbortController();
    const trace = blankTrace();
    const start = performance.now();
    return withTimeout(s.search(query, ctrl.signal, { count: depth, trace }), TIMEOUT_MS, ctrl)
      .then(results => ({ name: s.name, ok: true, ms: performance.now() - start, results, trace }))
      .catch(e => ({ name: s.name, ok: false, ms: performance.now() - start, results: [] as RawResult[], trace, err: e?.message ?? String(e) }));
  });

  const remaining = new Set(tagged.map((p, i) => ({ p, i })));
  while (remaining.size > 0) {
    const arr = [...remaining];
    const winner = await Promise.race(arr.map(x => x.p.then(v => ({ x, v }))));
    remaining.delete(winner.x);
    perSource.set(winner.v.name, winner.v.results);
    yield { type: "source", ...winner.v };
  }

  const t1 = performance.now();
  const fused = rrf(perSource, SOURCES);
  const t2 = performance.now();
  const hits = localRerank(query, fused);
  const t3 = performance.now();

  yield { type: "final", hits, uniqueCount: fused.length,
    timings: { fanOutMs: t1 - t0, rrfMs: t2 - t1, rerankMs: t3 - t2, totalMs: t3 - t0 } };
}

export async function prewarm(): Promise<void> {
  await Promise.allSettled(SOURCES.map(s => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 3000);
    return s.search("test", ctrl.signal, { count: 1 }).catch(() => {});
  }));
}
