import { wikipedia } from "../sources/wikipedia.js";
import { hackerNews } from "../sources/hn.js";
import { github } from "../sources/github.js";
import { gitlab, gitlabAlpine } from "../sources/gitlab.js";
import { stackexchange, superuser, askubuntu, unixse } from "../sources/stack.js";
import { crossref } from "../sources/crossref.js";
import { openalex } from "../sources/openalex.js";
import { archive } from "../sources/archive.js";
import { rrf } from "./fusion.js";
import { InvertedIndex, bm25Search, intersectPostings } from "./bm25.js";
import { parseQuery } from "./query.js";

export const SOURCES = [wikipedia, hackerNews, github, gitlab, gitlabAlpine, stackexchange, superuser, askubuntu, unixse, crossref, openalex, archive];
const TIMEOUT_MS = 6000;

async function withTimeout(p, ms, ctrl) {
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await p; } finally { clearTimeout(t); }
}

function localRerank(query, fused) {
  if (fused.length === 0) return fused;
  const parsed = parseQuery(query);

  const idx = new InvertedIndex();
  for (let i = 0; i < fused.length; i++) {
    const h = fused[i];
    idx.add({ id: String(i), text: `${h.title} ${h.title} ${h.snippet}` });
  }

  let candidateIds = null;
  if (parsed.required.length > 0) {
    // null = required terms all stemmed away (e.g. `a AND the`): no posting
    // filter to apply, so fall through and score them as free terms.
    candidateIds = intersectPostings(idx, parsed.required);
    if (candidateIds && candidateIds.size === 0) return [];
  }
  if (parsed.phrases.length > 0) {
    const phraseFilter = new Set();
    for (let i = 0; i < fused.length; i++) {
      if (candidateIds && !candidateIds.has(i)) continue;
      const text = `${fused[i].title} ${fused[i].snippet}`.toLowerCase();
      if (parsed.phrases.every(p => text.includes(p))) phraseFilter.add(i);
    }
    candidateIds = phraseFilter;
    if (candidateIds.size === 0) return [];
  }

  const scoreInput = [...parsed.required, ...parsed.freeTerms, ...parsed.phrases].join(" ") || query;
  const ranked = bm25Search(idx, scoreInput, fused.length);
  const filtered = candidateIds === null ? ranked : ranked.filter(r => candidateIds.has(parseInt(r.docId, 10)));
  return filtered.map(r => ({ ...fused[parseInt(r.docId, 10)], score: r.score }));
}

export async function* runSearchStream(query, depth, enabled = SOURCES) {
  const t0 = performance.now();
  const perSource = new Map();
  const used = enabled.length > 0 ? enabled : SOURCES;

  const tagged = used.map(s => {
    const ctrl = new AbortController();
    const start = performance.now();
    return withTimeout(s.search(query, ctrl.signal, { count: depth }), TIMEOUT_MS, ctrl)
      .then(results => ({ name: s.name, ok: true, ms: performance.now() - start, results }))
      .catch(e => ({ name: s.name, ok: false, ms: performance.now() - start, results: [], err: e?.message ?? String(e) }));
  });

  const remaining = new Set(tagged.map(p => ({ p })));
  while (remaining.size > 0) {
    const arr = [...remaining];
    const winner = await Promise.race(arr.map(x => x.p.then(v => ({ x, v }))));
    remaining.delete(winner.x);
    perSource.set(winner.v.name, winner.v.results);
    yield { type: "source", ...winner.v };
  }

  const t1 = performance.now();
  const fused = rrf(perSource, used);
  const t2 = performance.now();
  const hits = localRerank(query, fused);
  const t3 = performance.now();

  yield { type: "final", hits, uniqueCount: fused.length,
    timings: { fanOutMs: t1 - t0, rrfMs: t2 - t1, rerankMs: t3 - t2, totalMs: t3 - t0 } };
}
