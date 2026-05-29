import { tokenize } from "./tokenizer.js";

const K1 = 1.5;
const B = 0.75;

export class InvertedIndex {
  constructor() {
    this.postings = new Map();
    this.docs = new Map();
    this.docLen = new Map();
    this.lenSum = 0;
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
    this.lenSum += tokens.length;
    this.avgDocLen = this.docLen.size ? this.lenSum / this.docLen.size : 0;
  }

  get N() { return this.docs.size; }
}

// half-interval search: returns true if value exists in numerically-sorted array
export function binarySearchExists(sortedArr, value) {
  let lo = 0, hi = sortedArr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = sortedArr[mid];
    if (v < value) lo = mid + 1;
    else if (v > value) hi = mid - 1;
    else return true;
  }
  return false;
}

// returns Set of docIds (numeric) that appear in EVERY term's posting list
// algorithm: get sorted docId list per term; start with shortest; binary-search each candidate against remaining lists
export function intersectPostings(idx, terms) {
  const stemmed = [...new Set(terms.flatMap(t => tokenize(t)))];
  if (stemmed.length === 0) return null; // no filter to apply
  const lists = [];
  for (const t of stemmed) {
    const ps = idx.postings.get(t);
    if (!ps) return new Set(); // term absent -> intersection empty
    lists.push(ps.map(p => Number(p.docId)).sort((a, b) => a - b));
  }
  lists.sort((a, b) => a.length - b.length);
  let candidates = lists[0];
  for (let i = 1; i < lists.length && candidates.length > 0; i++) {
    candidates = candidates.filter(id => binarySearchExists(lists[i], id));
  }
  return new Set(candidates);
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
