import { performance } from "node:perf_hooks";
import type { Source, RawResult } from "./types.ts";

const UA = "hcraes/0.1";
const PER_PAGE = 10;
const MAX = 30;

type RepoItem = {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
};

async function fetchPage(query: string, perPage: number, page: number, signal: AbortSignal): Promise<{ results: RawResult[]; bytes: number; readMs: number; parseMs: number; transformMs: number }> {
  const url = new URL("https://api.github.com/search/repositories");
  url.search = new URLSearchParams({
    q: query, per_page: String(perPage), page: String(page)
  }).toString();

  const headers: Record<string, string> = {
    "user-agent": UA,
    "accept": "application/vnd.github+json",
    "x-github-api-version": "2022-11-28"
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(url, { signal, headers });
  const t1 = performance.now();
  if (!res.ok) throw new Error(`github ${res.status}${res.status === 403 ? " (rate limit)" : ""}`);
  const body = await res.text();
  const t2 = performance.now();
  const json = JSON.parse(body) as { items?: RepoItem[] };
  const t3 = performance.now();

  const startRank = (page - 1) * perPage;
  const results = (json.items ?? []).map((r, i): RawResult => {
    const stars = r.stargazers_count.toLocaleString();
    const lang = r.language ? `[${r.language}] ` : "";
    return {
      title: r.full_name,
      url: r.html_url,
      snippet: `${lang}${r.description ?? ""} (${stars}★)`,
      rank: startRank + i
    };
  });
  const t4 = performance.now();
  return { results, bytes: body.length, readMs: t2 - t1, parseMs: t3 - t2, transformMs: t4 - t3 };
}

export const github: Source = {
  name: "github",
  weight: 0.9,
  defaultCount: 10,
  async search(query, signal, opts = {}) {
    const want = Math.min(opts.count ?? this.defaultCount, MAX);
    const batches = Math.ceil(want / PER_PAGE);
    const trace = opts.trace;

    const wallStart = performance.now();
    const settled = await Promise.allSettled(
      Array.from({ length: batches }, (_, i) => fetchPage(query, PER_PAGE, i + 1, signal))
    );
    const fetchWallMs = performance.now() - wallStart;

    const out: RawResult[] = [];
    let bytes = 0, readMs = 0, parseMs = 0, transformMs = 0;
    const errors: string[] = [];
    for (const s of settled) {
      if (s.status === "fulfilled") {
        out.push(...s.value.results);
        bytes += s.value.bytes;
        readMs += s.value.readMs;
        parseMs += s.value.parseMs;
        transformMs += s.value.transformMs;
      } else {
        errors.push(s.reason?.message ?? String(s.reason));
      }
    }
    out.sort((a, b) => a.rank - b.rank);
    if (trace) Object.assign(trace, { fetchWallMs, readMs, parseMs, transformMs, bytes, batches });
    if (out.length === 0 && errors.length > 0) throw new Error(errors[0]);
    return out.slice(0, want);
  }
};
