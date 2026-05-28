import { tokenize } from "./tokenizer.ts";

export type Doc = { id: string; text: string };
export type Posting = { docId: string; tf: number };

export class InvertedIndex {
  postings: Map<string, Posting[]> = new Map();
  docs: Map<string, Doc> = new Map();
  docLen: Map<string, number> = new Map();
  avgDocLen = 0;

  add(doc: Doc): void {
    if (this.docs.has(doc.id)) throw new Error(`duplicate doc id: ${doc.id}`);
    const tokens = tokenize(doc.text);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

    for (const [term, count] of tf) {
      const list = this.postings.get(term) ?? [];
      list.push({ docId: doc.id, tf: count });
      this.postings.set(term, list);
    }

    this.docs.set(doc.id, doc);
    this.docLen.set(doc.id, tokens.length);
    this.recomputeAvg();
  }

  private recomputeAvg(): void {
    let sum = 0;
    for (const len of this.docLen.values()) sum += len;
    this.avgDocLen = this.docLen.size ? sum / this.docLen.size : 0;
  }

  get N(): number { return this.docs.size; }
  df(term: string): number { return this.postings.get(term)?.length ?? 0; }
}
