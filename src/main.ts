import { InvertedIndex, type Doc } from "./index_store.ts";
import { search } from "./search.ts";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";

function loadDocs(dir: string): Doc[] {
  const docs: Doc[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (!statSync(path).isFile()) continue;
    docs.push({ id: basename(name), text: readFileSync(path, "utf8") });
  }
  return docs;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("usage: node src/main.ts <query>");
    console.error("       indexes ./data/*, runs query, prints ranked hits");
    process.exit(1);
  }
  const query = args.join(" ");

  const idx = new InvertedIndex();
  for (const doc of loadDocs("data")) idx.add(doc);

  if (idx.N === 0) {
    console.error("no docs in ./data");
    process.exit(2);
  }

  const hits = search(idx, query);
  if (hits.length === 0) {
    console.log("no hits");
    return;
  }
  for (const h of hits) {
    console.log(`${h.score.toFixed(3)}\t${h.docId}\t${h.snippet}`);
  }
}

main();
