const BATCH = 30;
const MAX = 100;

export function makeStack(name, site, opts = {}) {
  const { weight = 0.9, defaultCount = 30 } = opts;

  async function fetchPage(query, pagesize, page, signal) {
    const url = new URL("https://api.stackexchange.com/2.3/search/advanced");
    url.search = new URLSearchParams({
      q: query, site, order: "desc", sort: "relevance",
      pagesize: String(pagesize), page: String(page)
    }).toString();
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`${name} ${res.status}`);
    const json = await res.json();
    const startRank = (page - 1) * pagesize;
    return (json.items ?? []).map((q, i) => {
      const ans = q.is_answered ? "✓" : "?";
      const tags = q.tags.slice(0, 4).join(",");
      return {
        title: q.title.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
        url: q.link,
        snippet: `[${q.score}↑ ${ans} ${q.answer_count} ans, ${q.view_count.toLocaleString()} views, ${tags}]`,
        rank: startRank + i
      };
    });
  }

  return {
    name,
    weight,
    defaultCount,
    async search(query, signal, callOpts = {}) {
      const want = Math.min(callOpts.count ?? this.defaultCount, MAX);
      const batches = Math.ceil(want / BATCH);
      const settled = await Promise.allSettled(
        Array.from({ length: batches }, (_, i) => fetchPage(query, BATCH, i + 1, signal))
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
}

export const stackexchange = makeStack("stack", "stackoverflow");
export const superuser = makeStack("superuser", "superuser");
export const askubuntu = makeStack("askubuntu", "askubuntu");
export const unixse = makeStack("unix.se", "unix.stackexchange");
