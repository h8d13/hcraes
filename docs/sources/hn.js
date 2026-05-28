const BATCH = 100;
const MAX = 1000;

async function fetchPage(query, hitsPerPage, page, signal) {
  const url = new URL("https://hn.algolia.com/api/v1/search");
  url.search = new URLSearchParams({
    query, hitsPerPage: String(hitsPerPage), page: String(page), tags: "story"
  }).toString();
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`hn ${res.status}`);
  const json = await res.json();
  return (json.hits ?? [])
    .filter(h => h.title)
    .map((h, i) => ({
      title: h.title,
      url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
      snippet: (h.story_text ?? "").slice(0, 200),
      rank: page * hitsPerPage + i
    }));
}

export const hackerNews = {
  name: "hn",
  weight: 0.6,
  defaultCount: 50,
  async search(query, signal, opts = {}) {
    const want = Math.min(opts.count ?? this.defaultCount, MAX);
    const batches = Math.ceil(want / BATCH);
    const settled = await Promise.allSettled(
      Array.from({ length: batches }, (_, i) => fetchPage(query, BATCH, i, signal))
    );
    const out = [];
    for (const s of settled) if (s.status === "fulfilled") out.push(...s.value);
    out.sort((a, b) => a.rank - b.rank);
    return out.slice(0, want);
  }
};
