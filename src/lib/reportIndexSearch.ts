// Filter for the /reports index. Two lanes, OR'd:
//
//   1. Lexical — case-insensitive substring (and token-AND) over title,
//      category, and description. A category hit keeps every report in that
//      section, which is what "search over the categories we now have" means.
//      This lane runs in the browser so a name match is instant.
//   2. Semantic — optional extra ids from GET /api/reports/search, which
//      scores the query with on-device ternlight on the server (the same
//      engine chat facts already load). A report in that set is kept even
//      when no field contains the query, so "wallet addresses" can surface
//      On-Chain Addresses. Direct name matches never depend on this lane.
//
// Ranking is catalog order, not score — the index is eleven cards, and
// jumping around as the user types is worse than a stable filter.
import type { ReportIndexCard, ReportIndexSection } from "./reportCatalog";
import { reportEmbedFields } from "./reportCatalog";

// Floor against noise. Measured against this catalog in
// reportIndexSearch.semantic.test.ts (max of title/category/description/full
// embeddings): unrelated strings top out ~0.23, in-vocabulary paraphrases
// of titles clear 0.50, and 0.40 sits in the gap so "zzz-nonexistent" and
// "hello world" never light up a card.
export const SEMANTIC_MIN = 0.4;

/** Strip mode-wrap quotes and lowercase; empty means "show everything". */
export function normalizeReportIndexQuery(query: string): string {
  let t = query.trim();
  if (
    t.length >= 2 &&
    ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
  ) {
    t = t.slice(1, -1).trim();
  }
  return t.toLowerCase();
}

function tokens(q: string): string[] {
  return q.split(/[^a-z0-9]+/).filter(Boolean);
}

function fieldMatch(field: string, q: string, qTokens: string[]): boolean {
  const f = field.toLowerCase();
  if (f.includes(q)) return true;
  const fn = f.replace(/[^a-z0-9]+/g, " ");
  const qn = q.replace(/[^a-z0-9]+/g, " ").trim();
  if (qn && fn.includes(qn)) return true;
  return qTokens.length > 0 && qTokens.every((t) => fn.includes(t));
}

/**
 * Filter the catalog by query. `extraIds` is optional: omit it (or pass ids
 * for a *different* query) and only the lexical lane runs. Same-identity
 * return for a blank query so memoized consumers don't re-render.
 */
export function filterReportSections(
  sections: readonly ReportIndexSection[],
  query: string,
  extraIds?: ReadonlySet<string>,
): ReportIndexSection[] {
  const q = normalizeReportIndexQuery(query);
  if (!q) return sections as ReportIndexSection[];
  const qTokens = tokens(q);
  const out: ReportIndexSection[] = [];
  for (const section of sections) {
    if (fieldMatch(section.title, q, qTokens)) {
      out.push(section);
      continue;
    }
    const reports = section.reports.filter(
      (r) =>
        fieldMatch(r.title, q, qTokens) ||
        fieldMatch(r.description, q, qTokens) ||
        extraIds?.has(r.id) === true,
    );
    if (reports.length > 0) out.push({ ...section, reports });
  }
  return out;
}

export type EmbedFn = (text: string) => Float32Array;
export type CosineFn = (a: Float32Array, b: Float32Array) => number;

/** Cosine similarity for L2-normalized vectors (a dot product). */
export function cosineSim(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  const len = a.length;
  for (let i = 0; i < len; i++) dot += a[i]! * b[i]!;
  return dot;
}

/** Per-card field vectors, with identical strings sharing one embedding. */
export function buildReportFieldVecs(cards: readonly ReportIndexCard[], embed: EmbedFn): Map<string, Float32Array[]> {
  const cache = new Map<string, Float32Array>();
  const vec = (t: string) => {
    let v = cache.get(t);
    if (!v) cache.set(t, (v = embed(t)));
    return v;
  };
  return new Map(cards.map((c) => [c.id, reportEmbedFields(c).map(vec)]));
}

export function scoreReportQuery(
  query: string,
  fieldVecs: ReadonlyMap<string, Float32Array[]>,
  embed: EmbedFn,
  cosineSim: CosineFn,
): Map<string, number> {
  const qv = embed(query);
  const scores = new Map<string, number>();
  for (const [id, vecs] of fieldVecs) {
    let max = -1;
    for (const v of vecs) {
      const s = cosineSim(qv, v);
      if (s > max) max = s;
    }
    scores.set(id, max);
  }
  return scores;
}

/** Ids whose best field-score clears the semantic floor. */
export function hitsFromScores(
  scores: ReadonlyMap<string, number>,
  semanticMin = SEMANTIC_MIN,
): Set<string> {
  const hits = new Set<string>();
  for (const [id, s] of scores) {
    if (s >= semanticMin) hits.add(id);
  }
  return hits;
}

export interface ReportIndexSearchResponse {
  hits: string[];
}
