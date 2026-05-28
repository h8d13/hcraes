const PER_PAGE = 20;
const MAX = 60;

async function fetchPage(query, perPage, page, signal) {
  const url = new URL("https://gitlab.com/api/v4/projects");
  url.search = new URLSearchParams({
    search: query, per_page: String(perPage), page: String(page),
    order_by: "star_count", sort: "desc"
  }).toString();
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`gitlab ${res.status}`);
  const json = await res.json();
  const startRank = (page - 1) * perPage;
  return (json ?? []).map((r, i) => ({
    title: r.path_with_namespace,
    url: r.web_url,
    snippet: `${r.description ?? ""} (${(r.star_count ?? 0).toLocaleString()}★)`,
    rank: startRank + i
  }));
}

export const gitlab = {
  name: "gitlab",
  weight: 0.7,
  defaultCount: 10,
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
