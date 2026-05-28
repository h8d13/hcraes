import { performance } from "node:perf_hooks";
import { wikipedia } from "./sources/wikipedia.ts";
import { hackerNews } from "./sources/hn.ts";
import { github } from "./sources/github.ts";
import { rrf, type FusedHit } from "./fusion.ts";
import { InvertedIndex } from "./index_store.ts";
import { search as bm25 } from "./search.ts";
import type { Source, RawResult, Trace } from "./sources/types.ts";

export const SOURCES: Source[] = [wikipedia, hackerNews, github];
const TIMEOUT_MS = 15000;

export type SourceOutcome = { name: string; ok: boolean; count: number; trace: Trace; err?: string };
export type SearchResult = {
  hits: FusedHit[];
  outcomes: SourceOutcome[];
  timings: { fanOutMs: number; rrfMs: number; rerankMs: number; totalMs: number };
  query: string;
  depth: number;
  uniqueCount: number;
};

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
      outcomes.push({ name, ok: false, count: 0, trace: blankTrace(), err: r.reason?.message ?? String(r.reason) });
    }
  });

  const t1 = performance.now();
  const fused = rrf(perSource, SOURCES);
  const t2 = performance.now();
  const hits = localRerank(query, fused);
  const t3 = performance.now();

  return {
    hits,
    outcomes,
    timings: { fanOutMs: t1 - t0, rrfMs: t2 - t1, rerankMs: t3 - t2, totalMs: t3 - t0 },
    query,
    depth,
    uniqueCount: fused.length
  };
}
