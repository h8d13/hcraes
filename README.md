# hcraes

Tiny BM25 search engine. Zero runtime deps. Native Node TS (no compile step).

## Requires

- Linux (tested arch, node 26)
- Node >= 23.6 (unflagged type stripping)

## Two modes

**Local BM25** — index `./data/*.txt`, rank with BM25.
**Web metasearch** — parallel batched fan-out to Wikipedia + HN Algolia + GitHub. Each source pulls `depth` results across N parallel offset-batches. Results fused with RRF, then locally re-ranked with BM25.
**Web UI** — 2-page server (`/` index form, `/search` results). Run `./scripts/serve.sh` → http://localhost:8080.

## Layout

```
src/
  tokenizer.ts     lowercase, strip punct, stopwords, naive stemmer
  index_store.ts   InvertedIndex: term -> [{docId, tf}]
  search.ts        BM25 ranker + snippet
  main.ts          local CLI: index ./data/*, query, print hits
  tests.ts         zero-framework asserts
  web.ts           web CLI: batched fan-out + RRF + local rerank
  server.ts        2-page http UI (node:http, no deps)
  pipeline.ts      shared search pipeline (used by web.ts + server.ts)
  bench.ts         end-to-end timings
  fusion.ts        Reciprocal Rank Fusion (k=60), url-normalized dedupe
  sources/
    types.ts       Source interface w/ count + trace opts
    wikipedia.ts   batched (srlimit=100, parallel offsets, max 1000)
    hn.ts          batched (hitsPerPage=100, parallel pages, max 1000)
    github.ts      batched (per_page=100, parallel pages, max 300; 10 req/min unauth)
data/              plain .txt docs (local mode)
scripts/
  run.sh           local BM25
  web.sh           web metasearch (CLI)
  serve.sh         2-page web UI on :8080
  bench.sh         benchmarks
  test.sh          unit tests
```

## Use

```sh
./scripts/run.sh "brown dog"                           # local BM25
./scripts/web.sh "linux kernel"                        # default depth=200/source
./scripts/web.sh --depth 500 --top 30 "your query"     # deeper pool, more hits
./scripts/serve.sh                                     # PORT=8080 ./scripts/serve.sh to override
./scripts/bench.sh                                     # full bench
./scripts/test.sh                                      # unit tests
```

Output: `score [sources] title / url / snippet`, ranked desc.
- `score` = BM25 of the locally-rebuilt index over the fused pool.
- `[sources]` shows which engines returned the same URL (RRF dedupe).
- Pipeline: fan-out → RRF fuse/dedupe → local BM25 rerank → top-K.

## How RRF works

For each result at rank `r` from source `s` with weight `w_s`:
```
score += w_s / (k + r + 1)        // k=60, canonical
```
Same URL across sources -> scores sum. Cheap, no score calibration needed across heterogeneous engines. See `src/fusion.ts`.

## Why batched parallel always

Single-shot per source = wasted parallelism. A batched source fires N parallel offset requests (Wikipedia `sroffset`, Algolia `page`), so wall time ≈ slowest single batch regardless of how deep you go. Bench shows 1000 results in ~660ms — same wall as the old 10-result single fetch — for **100x more recall**. The big pool then gets BM25-reranked locally (<30ms) to pull buried gems into the top-K.

## Extend

- Add a source: implement `Source` (with batched internals) in `src/sources/`, push into `SOURCES` in `web.ts`.
- Persist the fused pool by query hash → repeat queries become pure local rerank (~10ms).
- Phrase queries: store positions alongside `tf` in `index_store.ts`.
- More languages: swap `tokenize` per locale.
