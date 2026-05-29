const PER_PAGE = 25;
const MAX = 100;

const FIELDS = ["identifier", "title", "description", "creator", "year"];

// description arrives as a string or an array of strings; flatten + strip.
function toText(d) {
  const s = Array.isArray(d) ? d.join(" ") : (d ?? "");
  return String(s).replace(/\s+/g, " ").trim();
}

async function fetchPage(query, perPage, page, signal) {
  const url = new URL("https://archive.org/advancedsearch.php");
  url.searchParams.set("q", query);
  for (const f of FIELDS) url.searchParams.append("fl[]", f);
  url.searchParams.set("rows", String(perPage));
  url.searchParams.set("page", String(page));
  url.searchParams.set("output", "json");
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`archive ${res.status}`);
  const json = await res.json();
  const startRank = (page - 1) * perPage;
  return (json.response?.docs ?? []).map((d, i) => {
    const creator = toText(d.creator);
    const meta = [creator, d.year].filter(Boolean).join(" · ");
    const desc = toText(d.description);
    return {
      title: Array.isArray(d.title) ? d.title[0] : (d.title ?? d.identifier),
      url: `https://archive.org/details/${encodeURIComponent(d.identifier)}`,
      snippet: meta + (desc ? ` — ${desc.slice(0, 200)}` : ""),
      rank: startRank + i
    };
  });
}

export const archive = {
  name: "archive.org",
  weight: 0.5,
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
