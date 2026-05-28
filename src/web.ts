import { runSearch, SOURCES } from "./pipeline.ts";

const DEFAULT_DEPTH = 200;
const TOP_K = 20;

function parseArgs(argv: string[]): { query: string; depth: number; topK: number } {
  let depth = DEFAULT_DEPTH, topK = TOP_K;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--depth" && argv[i + 1]) depth = parseInt(argv[++i], 10) || depth;
    else if (argv[i] === "--top" && argv[i + 1]) topK = parseInt(argv[++i], 10) || topK;
    else rest.push(argv[i]);
  }
  return { query: rest.join(" "), depth, topK };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error("usage: node src/web.ts [--depth N] [--top K] <query>");
    console.error(`  defaults: depth=${DEFAULT_DEPTH}/source, top=${TOP_K}`);
    console.error(`  sources : ${SOURCES.map(s => s.name).join(", ")}`);
    process.exit(1);
  }
  const { query, depth, topK } = parseArgs(argv);
  const r = await runSearch(query, depth);

  if (r.hits.length === 0) {
    console.log("no hits");
    return;
  }
  for (const h of r.hits.slice(0, topK)) {
    console.log(`${h.score.toFixed(4)}  [${h.sources.join(",")}]  ${h.title}`);
    console.log(`        ${h.url}`);
    if (h.snippet) console.log(`        ${h.snippet.slice(0, 140)}`);
    console.log();
  }

  console.error(`# source breakdown:`);
  for (const o of r.outcomes) {
    if (o.ok) console.error(`  ${o.name.padEnd(10)} ${String(o.count).padStart(4)} results, ${o.trace.batches} batches, ${(o.trace.bytes/1024).toFixed(1)}KB, fetch wall ${o.trace.fetchWallMs.toFixed(0)}ms`);
    else console.error(`  ${o.name.padEnd(10)} FAIL ${o.err}`);
  }
  console.error(`# fan-out ${r.timings.fanOutMs.toFixed(0)}ms | RRF ${r.timings.rrfMs.toFixed(1)}ms | rerank ${r.timings.rerankMs.toFixed(1)}ms | total ${r.timings.totalMs.toFixed(0)}ms`);
  console.error(`# ${r.uniqueCount} unique fused hits, showing top ${Math.min(topK, r.hits.length)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
