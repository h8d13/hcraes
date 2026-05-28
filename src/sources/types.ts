export type RawResult = {
  title: string;
  url: string;
  snippet: string;
  rank: number;
};

export type Trace = {
  fetchWallMs: number;
  readMs: number;
  parseMs: number;
  transformMs: number;
  bytes: number;
  batches: number;
};

export type SearchOpts = {
  count?: number;
  trace?: Trace;
};

export interface Source {
  name: string;
  weight: number;
  defaultCount: number;
  search(query: string, signal: AbortSignal, opts?: SearchOpts): Promise<RawResult[]>;
}
