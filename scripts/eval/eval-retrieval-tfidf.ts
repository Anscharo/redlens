// The offline TF-IDF backend: the eval's substitute for a neural embedding when
// no OPENROUTER_API_KEY is set.
//
// A proxy for GROUPING architecture only — it scores whether a unit's text
// contains the query's words, which is what makes it useful for comparing
// policies without spend, and useless as a stand-in for the neural bakeoff.
import type { EmbedUnit } from "../../src/server/retrieval/embed-units.ts";

/** One pool entry, as every ranking stage in the eval passes them around. */
export interface Scored {
  id: string;
  text: string;
  score: number;
}

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

export function bm25Rerank(query: string, pool: Scored[]): Scored[] {
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

export function rankTfidf(query: string, units: EmbedUnit[], vecs: Map<string, number>[], idf: Map<string, number>, k: number): Scored[] {
  const qv = tfidfVec(tokenize(query), idf);
  return units
    .map((u, i) => ({ id: u.anchorId, text: u.text, score: cosine(qv, vecs[i]!) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
