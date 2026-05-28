import { tokenize, stem } from "./tokenizer.ts";
import { InvertedIndex } from "./index_store.ts";
import { search } from "./search.ts";

let failed = 0;
function eq<T>(name: string, got: T, want: T): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "ok" : "FAIL"}\t${name}`);
  if (!ok) {
    console.log(`  want: ${JSON.stringify(want)}`);
    console.log(`  got:  ${JSON.stringify(got)}`);
    failed++;
  }
}
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "ok" : "FAIL"}\t${name}`);
  if (!cond) failed++;
}

eq("stem ing", stem("running"), "runn");
eq("stem ed", stem("jumped"), "jump");
eq("stem s", stem("cats"), "cat");
eq("stem ss preserved", stem("pass"), "pass");

eq("tokenize drops stopwords", tokenize("The cat and a dog"), ["cat", "dog"]);
eq("tokenize lowers + strips punct", tokenize("Hello, WORLD!"), ["hello", "world"]);

const idx = new InvertedIndex();
idx.add({ id: "a", text: "the quick brown fox jumps over the lazy dog" });
idx.add({ id: "b", text: "a fast brown dog runs through the forest" });
idx.add({ id: "c", text: "lorem ipsum dolor sit amet consectetur" });

eq("N=3", idx.N, 3);
assert("df brown == 2", idx.df("brown") === 2);
assert("df forest == 1", idx.df("forest") === 1);
assert("df missing == 0", idx.df("nonexistent") === 0);

const hits = search(idx, "brown dog");
assert("brown dog returns 2 hits", hits.length === 2);
assert("hits sorted desc", hits[0].score >= hits[1].score);
assert("no hit for c", !hits.find(h => h.docId === "c"));

const empty = search(idx, "xyzzy plugh");
eq("no match returns []", empty, []);

console.log(failed === 0 ? "\nall pass" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
