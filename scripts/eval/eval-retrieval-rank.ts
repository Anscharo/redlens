// Ranking primitives for eval-retrieval.ts: TF-IDF, BM25 rerank, rank fusion, the
// keyword query rewrite and small numeric helpers. All pure; no flags or state.
import type { EmbedUnit } from "../../src/server/retrieval/embed-units.ts";

export type PoolRow = { id: string; text: string; score: number };

export function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= 2);
}

export function idfMap(docs: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const toks of docs) {
    for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = docs.length;
  const idf = new Map<string, number>();
  for (const [t, c] of df) idf.set(t, Math.log((n + 1) / (c + 1)) + 1);
  return idf;
}

export function tfidfVec(toks: string[], idf: Map<string, number>): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
  const v = new Map<string, number>();
  let n = 0;
  for (const [t, c] of tf) {
    const w = (c / toks.length) * (idf.get(t) ?? 0);
    v.set(t, w);
    n += w * w;
  }
  const norm = Math.sqrt(n) || 1;
  for (const [t, w] of v) v.set(t, w / norm);
  return v;
}

export function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let s = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const [t, w] of small) s += w * (large.get(t) ?? 0);
  return s;
}

export const dot = (a: number[], b: number[]) => {
  let d = 0;
  for (let j = 0; j < a.length; j++) d += a[j]! * b[j]!;
  return d;
};

export function bm25Rerank(query: string, pool: PoolRow[]): PoolRow[] {
  const q = tokenize(query);
  return [...pool]
    .map((p) => {
      const toks = tokenize(p.text);
      let s = 0;
      for (const t of q) s += toks.includes(t) ? 1 : 0;
      return { ...p, score: s + p.score * 0.01 };
    })
    .sort((a, b) => b.score - a.score);
}

export function rankTfidf(query: string, units: EmbedUnit[], vecs: Map<string, number>[], idf: Map<string, number>, k: number): PoolRow[] {
  const qv = tfidfVec(tokenize(query), idf);
  return units
    .map((u, i) => ({ id: u.anchorId, text: u.text, score: cosine(qv, vecs[i]!) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export function rrfFuse(lexIds: string[], semIds: string[], k: number, moreIds: string[] = []): string[] {
  const acc = new Map<string, number>();
  const bump = (ids: string[]) => {
    ids.forEach((id, rank) => acc.set(id, (acc.get(id) ?? 0) + 1 / (60 + rank + 1)));
  };
  bump(lexIds);
  bump(semIds);
  bump(moreIds);
  return [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([id]) => id);
}

export function pctTimes(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i]!;
}

// Local copy of search.ts's residualQuery (importing search.ts would drag in Bun's
// SQL and the whole server DB layer for a pure string helper).
export function residualQueryText(query: string, anchorTitles: string[]): string {
  const strip = new Set<string>();
  for (const t of anchorTitles) for (const w of t.toLowerCase().match(/[a-z0-9]+/g) ?? []) strip.add(w);
  const kept = (query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !strip.has(w));
  return kept.length ? kept.join(" ") : query;
}

// The search box's own log (PostHog `atlas_search`, a 180-day window) is one to
// three content words with almost no question in it. 128 of the 139 non-control
// queries the generator writes start with a question word and run 8-13 words. The
// rewrite drops question and function words and the template verbs, keeps the
// content words in order, and lowercases, so "which chain does Ethereum Mainnet -
// SparkLend USDS run on" becomes "ethereum mainnet - sparklend usds chain".
const KEYWORD_STOP = new Set([
  "what", "which", "who", "whom", "whose", "how", "where", "when", "why", "does", "do", "did", "is", "are", "was",
  "were", "be", "can", "could", "should", "would", "will", "the", "a", "an", "of", "on", "in", "into", "under", "with",
  "for", "to", "from", "by", "at", "its", "it", "this", "that", "these", "those", "there", "and", "or", "much", "many",
  "quickly", "run", "keep", "track", "covered", "specify", "specifies", "put", "integrate", "integrates", "integrated",
]);
export function keywordQuery(q: string): string {
  const kept = q.split(/\s+/).filter((w) => !KEYWORD_STOP.has(w.toLowerCase().replace(/[?,.]+$/, "")));
  return (kept.length ? kept : q.split(/\s+/)).join(" ").toLowerCase();
}
