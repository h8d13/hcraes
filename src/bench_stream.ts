import { performance } from "node:perf_hooks";
import { runSearch, runSearchStream } from "./pipeline.ts";

const query = process.argv.slice(2).join(" ") || "urandom size";
const depth = 100;
const N = 5;

function stats(arr: number[]): { p50: number; min: number; max: number } {
  const a = [...arr].sort((x, y) => x - y);
  return { min: a[0], p50: a[Math.floor(a.length / 2)], max: a[a.length - 1] };
}

async function benchClassic(): Promise<{ total: number[] }> {
  const totals: number[] = [];
  for (let i = 0; i < N; i++) {
    const q = `${query} ${i}`;
    const t0 = performance.now();
    await runSearch(q, depth);
    totals.push(performance.now() - t0);
  }
  return { total: totals };
}

async function benchStream(): Promise<{ total: number[]; ttfr: number[]; perSource: Map<string, number[]> }> {
  const totals: number[] = [];
  const ttfrs: number[] = [];
  const perSource = new Map<string, number[]>();

  for (let i = 0; i < N; i++) {
    const q = `${query} ${i + 100}`;
    const t0 = performance.now();
    let firstResult = -1;
    for await (const ev of runSearchStream(q, depth)) {
      if (ev.type === "source") {
        const dt = performance.now() - t0;
        if (firstResult < 0 && ev.results.length > 0) firstResult = dt;
        const arr = perSource.get(ev.name) ?? [];
        arr.push(dt);
        perSource.set(ev.name, arr);
      } else {
        totals.push(performance.now() - t0);
      }
    }
    ttfrs.push(firstResult);
  }
  return { total: totals, ttfr: ttfrs, perSource };
}

async function main(): Promise<void> {
  console.log(`# query="${query}" depth=${depth} n=${N}\n`);

  console.log("=== classic /search (awaits all sources) ===");
  const c = await benchClassic();
  const ct = stats(c.total);
  console.log(`  total wall: min ${ct.min.toFixed(0)}ms  p50 ${ct.p50.toFixed(0)}ms  max ${ct.max.toFixed(0)}ms`);
  console.log(`  (note: classic = TTFB == total, single response after last source)`);

  console.log("\n=== streaming /stream (yields per source) ===");
  const s = await benchStream();
  const st = stats(s.total);
  const sf = stats(s.ttfr);
  console.log(`  total wall: min ${st.min.toFixed(0)}ms  p50 ${st.p50.toFixed(0)}ms  max ${st.max.toFixed(0)}ms`);
  console.log(`  TTFR (time to first results): min ${sf.min.toFixed(0)}ms  p50 ${sf.p50.toFixed(0)}ms  max ${sf.max.toFixed(0)}ms`);
  console.log(`\n  per-source arrival times (ms from request start):`);
  for (const [name, arr] of s.perSource) {
    const x = stats(arr);
    console.log(`    ${name.padEnd(10)} min ${x.min.toFixed(0).padStart(4)}  p50 ${x.p50.toFixed(0).padStart(4)}  max ${x.max.toFixed(0).padStart(4)}`);
  }

  console.log(`\n=== verdict ===`);
  const ttfrWin = ct.p50 - sf.p50;
  console.log(`  classic blocks for ${ct.p50.toFixed(0)}ms before any byte`);
  console.log(`  streaming shows first hit at ${sf.p50.toFixed(0)}ms — ${ttfrWin.toFixed(0)}ms perceived speedup (${(ttfrWin/ct.p50*100).toFixed(0)}%)`);
  console.log(`  total wall is ~same (both bound by slowest source)`);
}

main().catch(e => { console.error(e); process.exit(1); });
