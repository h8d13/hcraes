import { performance } from "node:perf_hooks";
import { wikipedia } from "./sources/wikipedia.ts";
import { hackerNews } from "./sources/hn.ts";
import { github } from "./sources/github.ts";
import { stackexchange } from "./sources/stackexchange.ts";
import { rrf } from "./fusion.ts";
import { InvertedIndex } from "./index_store.ts";
import { search as bm25 } from "./search.ts";
import type { Source, Trace } from "./sources/types.ts";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SOURCES: Source[] = [wikipedia, hackerNews, github, stackexchange];

function blankTrace(): Trace {
  return { fetchWallMs: 0, readMs: 0, parseMs: 0, transformMs: 0, bytes: 0, batches: 0 };
}

function stats(arr: number[]): { min: number; p50: number; p95: number; max: number; mean: number } {
  const a = [...arr].sort((x, y) => x - y);
  const p = (q: number) => a[Math.min(a.length - 1, Math.floor(a.length * q))];
  return { min: a[0], p50: p(0.5), p95: p(0.95), max: a[a.length - 1], mean: a.reduce((x, y) => x + y, 0) / a.length };
}

function fmt(n: number, w = 7): string { return n.toFixed(1).padStart(w); }
function row(label: string, s: ReturnType<typeof stats>, extra = ""): string {
  return `  ${label.padEnd(14)} min ${fmt(s.min)}  p50 ${fmt(s.p50)}  p95 ${fmt(s.p95)}  max ${fmt(s.max)}  mean ${fmt(s.mean)}  ${extra}`;
}

async function benchWeb(query: string, depth: number, n: number): Promise<void> {
  console.log(`\n=== web "${query}" depth=${depth}/source (n=${n}, cold first run included) ===`);

  const per = new Map<string, { wall: number[]; read: number[]; parse: number[]; transform: number[]; bytes: number[]; batches: number[]; count: number[] }>();
  for (const s of SOURCES) per.set(s.name, { wall: [], read: [], parse: [], transform: [], bytes: [], batches: [], count: [] });
  const wallTimes: number[] = [];
  const fusionTimes: number[] = [];
  const rerankTimes: number[] = [];

  for (let i = 0; i < n; i++) {
    const w0 = performance.now();
    const settled = await Promise.allSettled(
      SOURCES.map(async s => {
        const trace = blankTrace();
        const r = await s.search(query, new AbortController().signal, { count: depth, trace });
        return { name: s.name, trace, count: r.length, results: r };
      })
    );
    const w1 = performance.now();
    wallTimes.push(w1 - w0);

    const fused = new Map<string, ReturnType<typeof Array.prototype.slice> | any>();
    for (const r of settled) {
      if (r.status !== "fulfilled") continue;
      const slot = per.get(r.value.name)!;
      slot.wall.push(r.value.trace.fetchWallMs);
      slot.read.push(r.value.trace.readMs);
      slot.parse.push(r.value.trace.parseMs);
      slot.transform.push(r.value.trace.transformMs);
      slot.bytes.push(r.value.trace.bytes);
      slot.batches.push(r.value.trace.batches);
      slot.count.push(r.value.count);
      fused.set(r.value.name, r.value.results);
    }

    const f0 = performance.now();
    const hits = rrf(fused as Map<string, any>, SOURCES);
    const f1 = performance.now();
    fusionTimes.push(f1 - f0);

    const idx = new InvertedIndex();
    for (let j = 0; j < hits.length; j++) {
      idx.add({ id: String(j), text: `${hits[j].title} ${hits[j].title} ${hits[j].snippet}` });
    }
    bm25(idx, query, hits.length);
    const f2 = performance.now();
    rerankTimes.push(f2 - f1);

    if (i === 0) console.log(`  (first run: ${hits.length} fused hits)`);
  }

  for (const s of SOURCES) {
    const slot = per.get(s.name)!;
    if (slot.wall.length === 0) { console.log(`  [${s.name}] all failed`); continue; }
    const avgBytes = slot.bytes.reduce((a, b) => a + b, 0) / slot.bytes.length;
    const avgCount = slot.count.reduce((a, b) => a + b, 0) / slot.count.length;
    const avgBatches = slot.batches.reduce((a, b) => a + b, 0) / slot.batches.length;
    console.log(`\n  [${s.name}] ${avgCount.toFixed(0)} results across ${avgBatches.toFixed(0)} parallel batches, ${(avgBytes/1024).toFixed(1)}KB total`);
    console.log(row("fetch wall",    stats(slot.wall),      "ms (max of parallel batches)"));
    console.log(row("read body sum", stats(slot.read),      "ms"));
    console.log(row("JSON.parse",    stats(slot.parse),     "ms"));
    console.log(row("transform",     stats(slot.transform), "ms"));
  }

  console.log(`\n  [aggregate]`);
  console.log(row("RRF fusion",    stats(fusionTimes), "ms"));
  console.log(row("local rerank",  stats(rerankTimes), "ms"));
  console.log(row("wall (total)",  stats(wallTimes),   "ms"));
}

function benchLocal(): void {
  console.log(`\n=== local BM25 ===`);

  const corpus: string[] = [];
  for (const f of readdirSync("data")) {
    const p = join("data", f);
    if (statSync(p).isFile()) corpus.push(readFileSync(p, "utf8"));
  }
  if (corpus.length === 0) { console.log("  no data/"); return; }

  for (const size of [10, 100, 1000, 10000]) {
    const idx = new InvertedIndex();
    const t0 = performance.now();
    for (let i = 0; i < size; i++) idx.add({ id: `d${i}`, text: corpus[i % corpus.length] });
    const t1 = performance.now();

    const queries = ["linux kernel", "brown dog", "bm25 ranking probabilistic", "information retrieval"];
    const qTimes: number[] = [];
    for (let i = 0; i < 200; i++) {
      const qt0 = performance.now();
      bm25(idx, queries[i % queries.length]);
      qTimes.push(performance.now() - qt0);
    }
    const s = stats(qTimes);
    console.log(`  N=${String(size).padStart(5)}  index ${(t1-t0).toFixed(1).padStart(7)}ms  query min ${fmt(s.min, 6)}  p50 ${fmt(s.p50, 6)}  p95 ${fmt(s.p95, 6)}  max ${fmt(s.max, 6)} ms`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args[0];

  if (mode === "local") { benchLocal(); return; }
  if (mode === "web") {
    const depth = parseInt(args[1] || "200", 10) || 200;
    const q = args.slice(2).join(" ") || "linux kernel";
    await benchWeb(q, depth, 5);
    return;
  }
  benchLocal();
  await benchWeb("linux kernel", 200, 5);
  await benchWeb("linux kernel", 500, 5);
}

main().catch(e => { console.error(e); process.exit(1); });
