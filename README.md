# hcraes

Tiny zero-dep metasearch.

## Sources

Wikipedia, HN (Algolia), GitHub, Stack Exchange. All CORS-enabled JSON APIs, no auth needed.

## How it works

1. **Parallel fan-out** — fires all 4 source searches concurrently
2. **Streaming render** — per-source arrival shown as it lands (`↳ stack @ 290ms · 30 hits in 287ms`)
3. **RRF dedupe** — Reciprocal Rank Fusion (k=60), URL-normalized merge across sources
4. **Local BM25 rerank** — fused pool gets reranked on title+snippet, top-30 paint
5. URL is `?q=...&depth=...` shareable, History API updates on submit

Total: ~250 lines of vanilla JS, ES modules, no build step.

## Layout

```
index.html
app.js                       DOM wiring, streaming render
lib/
  tokenizer.js               lowercase, stopwords, naive stemmer
  bm25.js                    InvertedIndex + BM25 ranker
  fusion.js                  RRF (k=60), URL-normalized dedupe
  pipeline.js                async generator: fan-out + race + fuse + rerank
sources/
  wikipedia.js               srlimit + sroffset, parallel batches
  hn.js                      hitsPerPage + page, parallel batches
  github.js                  per_page + page, 10 results, opt token via localStorage
  stack.js                   pagesize + page, parallel batches
```

## Run locally

Any static server:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Or `npx serve`, VS Code Live Server, etc.

## Add a source

1. Create `sources/yourname.js` exporting `{ name, weight, defaultCount, search(query, signal, opts) }`
2. Return `[{ title, url, snippet, rank }]`
3. Add to `SOURCES` in `lib/pipeline.js`
