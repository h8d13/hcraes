function normalizeUrl(u) {
  try {
    const url = new URL(u);
    url.hash = "";
    const path = url.pathname.replace(/\/$/, "");
    return `${url.protocol}//${url.host.toLowerCase()}${path}${url.search}`;
  } catch {
    return u;
  }
}

export function rrf(perSource, sources, k = 60) {
  const weights = new Map(sources.map(s => [s.name, s.weight]));
  const agg = new Map();
  for (const [name, results] of perSource) {
    const w = weights.get(name) ?? 1;
    for (const r of results) {
      const key = normalizeUrl(r.url);
      const cur = agg.get(key);
      const contrib = w / (k + r.rank + 1);
      if (cur) {
        cur.score += contrib;
        if (!cur.sources.includes(name)) cur.sources.push(name);
        if (r.snippet.length > cur.snippet.length) cur.snippet = r.snippet;
      } else {
        agg.set(key, { title: r.title, url: key, snippet: r.snippet, score: contrib, sources: [name] });
      }
    }
  }
  return [...agg.values()].sort((a, b) => b.score - a.score);
}
