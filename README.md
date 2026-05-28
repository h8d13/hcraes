# hcraes

Tiny BM25 + metasearch. Zero deps. Native Node TS.

## Requires

- Node >= 23.6 (unflagged type stripping). Tested on Linux/arch, node 26.

## Modes

- **Local BM25** — index `./data/*.txt`, rank.
- **Web metasearch** — parallel batched fan-out → RRF dedupe → local BM25 rerank. Sources: Wikipedia, HN Algolia, GitHub, Stack Exchange.
- **Web UI** — 2-page server at `:8080`.

## Use

```sh
./scripts/run.sh "brown dog"             # local BM25
./scripts/web.sh "linux kernel"          # CLI metasearch
./scripts/web.sh --depth 300 --top 30 "your query"
./scripts/serve.sh                       # http://localhost:8080 (PORT=N to override)
./scripts/bench.sh                       # full bench
./scripts/test.sh                        # unit tests
```

Output: `score [sources] title / url / snippet`, sorted desc. `[sources]` shows which engines returned the same URL (RRF dedupe).

## Layout

```
src/
  tokenizer / index_store / search / main / tests   local BM25 core
  fusion                                            RRF (k=60), url-normalized dedupe
  pipeline                                          shared runSearch (web.ts + server.ts)
  web / server / bench                              CLIs
  sources/{wikipedia,hn,github,stackexchange}       each batched, zero-dep
scripts/{run,web,serve,bench,test}.sh
data/*.txt
```

## RRF in one line

`score += weight_source / (k + rank + 1)`, k=60. Same URL across sources → scores sum. See `src/fusion.ts`.

## Why parallel batched

Wall time ≈ slowest single batch regardless of depth. 1000 results in ~660ms — same wall as a 10-result single fetch — for 100x more recall. Big pool then BM25-reranked locally (<30ms).

## Extend

- New source: implement `Source` (with batched internals) in `src/sources/`, push into `SOURCES` in `pipeline.ts`.
- Persist fused pool by query hash → repeats become pure local rerank.
- Phrase queries: store positions alongside `tf` in `index_store.ts`.
