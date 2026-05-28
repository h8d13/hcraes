const BATCH = 100;
const MAX = 1000;

function stripHtml(s) {
  return s.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

async function fetchPage(query, limit, offset, signal) {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query", list: "search", srsearch: query,
    srlimit: String(limit), sroffset: String(offset),
    format: "json", origin: "*"
  }).toString();
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`wiki ${res.status}`);
  const json = await res.json();
  return (json.query?.search ?? []).map((h, i) => ({
    title: h.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, "_"))}`,
    snippet: stripHtml(h.snippet),
    rank: offset + i
  }));
}

export const wikipedia = {
  name: "wikipedia",
  weight: 1.0,
  defaultCount: 100,
  async search(query, signal, opts = {}) {
    const want = Math.min(opts.count ?? this.defaultCount, MAX);
    const batches = Math.ceil(want / BATCH);
    const settled = await Promise.allSettled(
      Array.from({ length: batches }, (_, i) => fetchPage(query, BATCH, i * BATCH, signal))
    );
    const out = [];
    for (const s of settled) if (s.status === "fulfilled") out.push(...s.value);
    out.sort((a, b) => a.rank - b.rank);
    return out.slice(0, want);
  }
};
