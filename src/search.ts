import { tokenize } from "./tokenizer.ts";
import { InvertedIndex } from "./index_store.ts";

export type Hit = { docId: string; score: number; snippet: string };

const K1 = 1.5;
const B = 0.75;

export function search(idx: InvertedIndex, query: string, limit = 10): Hit[] {
  const terms = tokenize(query);
  const scores = new Map<string, number>();

  for (const term of terms) {
    const postings = idx.postings.get(term);
    if (!postings) continue;
    const df = postings.length;
    const idf = Math.log(1 + (idx.N - df + 0.5) / (df + 0.5));

    for (const p of postings) {
      const dl = idx.docLen.get(p.docId) ?? 0;
      const norm = 1 - B + B * (dl / (idx.avgDocLen || 1));
      const tfScore = (p.tf * (K1 + 1)) / (p.tf + K1 * norm);
      scores.set(p.docId, (scores.get(p.docId) ?? 0) + idf * tfScore);
    }
  }

  const hits: Hit[] = [];
  for (const [docId, score] of scores) {
    const doc = idx.docs.get(docId)!;
    hits.push({ docId, score, snippet: snippet(doc.text, terms) });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

function snippet(text: string, terms: string[], width = 80): string {
  const lower = text.toLowerCase();
  let bestPos = 0;
  for (const t of terms) {
    const pos = lower.indexOf(t);
    if (pos >= 0) { bestPos = pos; break; }
  }
  const start = Math.max(0, bestPos - 20);
  const end = Math.min(text.length, start + width);
  return (start > 0 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : "");
}
