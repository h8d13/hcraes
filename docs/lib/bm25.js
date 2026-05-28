import { tokenize } from "./tokenizer.js";

const K1 = 1.5;
const B = 0.75;

export class InvertedIndex {
  constructor() {
    this.postings = new Map();
    this.docs = new Map();
    this.docLen = new Map();
    this.avgDocLen = 0;
  }

  add(doc) {
    if (this.docs.has(doc.id)) throw new Error(`duplicate doc id: ${doc.id}`);
    const tokens = tokenize(doc.text);
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [term, count] of tf) {
      const list = this.postings.get(term) ?? [];
      list.push({ docId: doc.id, tf: count });
      this.postings.set(term, list);
    }
    this.docs.set(doc.id, doc);
    this.docLen.set(doc.id, tokens.length);
    let sum = 0;
    for (const len of this.docLen.values()) sum += len;
    this.avgDocLen = this.docLen.size ? sum / this.docLen.size : 0;
  }

  get N() { return this.docs.size; }
}

export function bm25Search(idx, query, limit = Infinity) {
  const terms = tokenize(query);
  const scores = new Map();
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
  const hits = [];
  for (const [docId, score] of scores) hits.push({ docId, score });
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
