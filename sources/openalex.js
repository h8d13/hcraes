// OpenAlex `search=` runs a ~4s ranking pass over the full corpus per
// request, and throttles concurrent searches hard (4 parallel pages -> ~30s).
// So fetch everything in ONE request: PER_PAGE === MAX -> a single batch.
// (OpenAlex allows per_page up to 200.)
const MAX = 100;
const PER_PAGE = MAX;

// OpenAlex stores abstracts as an inverted index (word -> [positions]).
// Rebuild the linear text, capped by the caller.
function fromInverted(idx) {
  if (!idx) return "";
  const words = [];
  for (const [w, positions] of Object.entries(idx)) {
    for (const p of positions) words[p] = w;
  }
  return words.join(" ").replace(/\s+/g, " ").trim();
}

async function fetchPage(query, perPage, page, signal) {
  const url = new URL("https://api.openalex.org/works");
  url.search = new URLSearchParams({
    search: query, per_page: String(perPage), page: String(page)
  }).toString();
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`openalex ${res.status}`);
  const json = await res.json();
  const startRank = (page - 1) * perPage;
  return (json.results ?? []).map((w, i) => {
    const authors = (w.authorships ?? []).slice(0, 3).map(a => a.author?.display_name).filter(Boolean).join(", ");
    const year = w.publication_year ?? "";
    const venue = w.primary_location?.source?.display_name ?? "";
    const abs = fromInverted(w.abstract_inverted_index);
    const meta = [authors, year, venue].filter(Boolean).join(" · ");
    return {
      title: w.title ?? w.display_name ?? "",
      url: w.doi ?? w.primary_location?.landing_page_url ?? w.id,
      snippet: meta + (abs ? ` — ${abs.slice(0, 200)}` : ""),
      rank: startRank + i
    };
  });
}

export const openalex = {
  name: "openalex",
  weight: 0.85,
  defaultCount: 25,
  async search(query, signal, opts = {}) {
    const want = Math.min(opts.count ?? this.defaultCount, MAX);
    const batches = Math.ceil(want / PER_PAGE);
    const settled = await Promise.allSettled(
      Array.from({ length: batches }, (_, i) => fetchPage(query, PER_PAGE, i + 1, signal))
    );
    const out = [];
    const errors = [];
    for (const s of settled) {
      if (s.status === "fulfilled") out.push(...s.value);
      else errors.push(s.reason?.message ?? String(s.reason));
    }
    out.sort((a, b) => a.rank - b.rank);
    if (out.length === 0 && errors.length > 0) throw new Error(errors[0]);
    return out.slice(0, want);
  }
};
