const PER_PAGE = 10;
const MAX = 30;

async function fetchPage(query, perPage, page, signal, token) {
  const url = new URL("https://api.github.com/search/repositories");
  url.search = new URLSearchParams({ q: query, per_page: String(perPage), page: String(page) }).toString();
  const headers = {
    "accept": "application/vnd.github+json",
    "x-github-api-version": "2022-11-28"
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, { signal, headers });
  if (!res.ok) throw new Error(`github ${res.status}${res.status === 403 ? " (rate limit, save token in localStorage as GITHUB_TOKEN)" : ""}`);
  const json = await res.json();
  const startRank = (page - 1) * perPage;
  return (json.items ?? []).map((r, i) => {
    const stars = r.stargazers_count.toLocaleString();
    const lang = r.language ? `[${r.language}] ` : "";
    return {
      title: r.full_name,
      url: r.html_url,
      snippet: `${lang}${r.description ?? ""} (${stars}★)`,
      rank: startRank + i
    };
  });
}

export const github = {
  name: "github",
  weight: 0.9,
  defaultCount: 10,
  async search(query, signal, opts = {}) {
    const want = Math.min(opts.count ?? this.defaultCount, MAX);
    const batches = Math.ceil(want / PER_PAGE);
    const token = typeof localStorage !== "undefined" ? localStorage.getItem("GITHUB_TOKEN") : null;
    const settled = await Promise.allSettled(
      Array.from({ length: batches }, (_, i) => fetchPage(query, PER_PAGE, i + 1, signal, token))
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
