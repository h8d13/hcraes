import { performance } from "node:perf_hooks";

const UA = "hcraes/0.1";
const HEADERS = { "user-agent": UA, "accept": "application/vnd.github+json", "x-github-api-version": "2022-11-28" };

async function probe(query: string, perPage: number): Promise<{ttfb: number; read: number; parse: number; total: number; bytes: number; remaining: string; reset: string}> {
  const url = new URL("https://api.github.com/search/repositories");
  url.search = new URLSearchParams({ q: query, per_page: String(perPage), page: "1" }).toString();

  const t0 = performance.now();
  const res = await fetch(url, { headers: HEADERS });
  const t1 = performance.now();
  const body = await res.text();
  const t2 = performance.now();
  JSON.parse(body);
  const t3 = performance.now();

  return {
    ttfb: t1 - t0,
    read: t2 - t1,
    parse: t3 - t2,
    total: t3 - t0,
    bytes: body.length,
    remaining: res.headers.get("x-ratelimit-remaining") ?? "?",
    reset: res.headers.get("x-ratelimit-reset") ?? "?"
  };
}

async function main(): Promise<void> {
  const query = process.argv.slice(2).join(" ") || "BM25 ranking";
  console.log(`# query="${query}"\n`);

  for (const perPage of [10, 30, 100]) {
    console.log(`--- per_page=${perPage} ---`);
    for (let i = 0; i < 3; i++) {
      try {
        const r = await probe(query, perPage);
        console.log(`  run ${i+1}: TTFB ${r.ttfb.toFixed(0).padStart(5)}ms  read ${r.read.toFixed(0).padStart(4)}ms  parse ${r.parse.toFixed(1).padStart(5)}ms  total ${r.total.toFixed(0).padStart(5)}ms  ${(r.bytes/1024).toFixed(0).padStart(4)}KB  rl=${r.remaining}/${r.reset}`);
      } catch (e) {
        console.log(`  run ${i+1}: ERROR ${e instanceof Error ? e.message : e}`);
      }
    }
    console.log();
  }

  console.log("--- comparison: same query, wikipedia + hn ---");
  for (const [name, mkUrl] of [
    ["wiki", () => { const u = new URL("https://en.wikipedia.org/w/api.php"); u.search = new URLSearchParams({action:"query",list:"search",srsearch:query,srlimit:"100",format:"json"}).toString(); return u; }],
    ["hn",   () => { const u = new URL("https://hn.algolia.com/api/v1/search"); u.search = new URLSearchParams({query, hitsPerPage:"100"}).toString(); return u; }]
  ] as const) {
    const u = mkUrl();
    const t0 = performance.now();
    const res = await fetch(u, { headers: { "user-agent": UA } });
    const t1 = performance.now();
    const body = await res.text();
    const t2 = performance.now();
    console.log(`  ${name.padEnd(5)}: TTFB ${(t1-t0).toFixed(0).padStart(5)}ms  read ${(t2-t1).toFixed(0).padStart(4)}ms  total ${(t2-t0).toFixed(0).padStart(5)}ms  ${(body.length/1024).toFixed(0)}KB`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
