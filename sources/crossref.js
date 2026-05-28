const PER_PAGE = 20;
const MAX = 100;

function stripJats(s) {
  return s.replace(/<jats:[^>]+>/g, "").replace(/<\/jats:[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

async function fetchPage(query, rows, offset, signal) {
  const url = new URL("https://api.crossref.org/works");
  url.search = new URLSearchParams({
    query, rows: String(rows), offset: String(offset),
    select: "DOI,title,abstract,author,published-print,URL,container-title,publisher"
  }).toString();
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`crossref ${res.status}`);
  const json = await res.json();
  return (json.message?.items ?? []).map((it, i) => {
    const title = (it.title?.[0] ?? "").trim();
    const authors = (it.author ?? []).slice(0, 3).map(a => a.family ?? a.name ?? "").filter(Boolean).join(", ");
    const year = it["published-print"]?.["date-parts"]?.[0]?.[0] ?? "";
    const venue = it["container-title"]?.[0] ?? it.publisher ?? "";
    const abs = stripJats(it.abstract ?? "");
    const meta = [authors, year, venue].filter(Boolean).join(" · ");
    return {
      title,
      url: it.URL ?? `https://doi.org/${it.DOI}`,
      snippet: meta + (abs ? ` — ${abs.slice(0, 200)}` : ""),
      rank: offset + i
    };
  });
}

export const crossref = {
  name: "crossref",
  weight: 0.8,
  defaultCount: 20,
  async search(query, signal, opts = {}) {
    const want = Math.min(opts.count ?? this.defaultCount, MAX);
    const batches = Math.ceil(want / PER_PAGE);
    const settled = await Promise.allSettled(
      Array.from({ length: batches }, (_, i) => fetchPage(query, PER_PAGE, i * PER_PAGE, signal))
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
