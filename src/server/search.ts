// Search: lexical (minisearch, in-memory) + semantic (pgvector) + RRF merge.
// Both legs return id+rank+score; callers resolve full nodes from the doc map.
import { type Indexes } from "./indexes.ts";
import { sql, toVectorLiteral } from "./db.ts";
import { embedQuery } from "./embed.ts";
import { config } from "./config.ts";

const RRF_K = 60;

export interface Hit {
  id: string;
  rank: number;
  score: number;
  source: "lexical" | "semantic";
}

export interface MergedHit {
  id: string;
  sources: string[];
  rrf_score: number;
  score: number;
}

// Match the frontend lexical search (src/workers/search.worker.ts): prefix on,
// fuzzy OFF by default (it dilutes exact term/ID/address lookups — the strength
// of lexical mode), same boosts and OR combine.
export function runLexical(ix: Indexes, query: string, type: string | undefined, k: number): Hit[] {
  const results = ix.mini.search(query, {
    boost: { title: 10, doc_no: 5, type: 2 },
    prefix: true,
    fuzzy: false,
    combineWith: "OR",
    filter: type ? (r) => (r as { type?: string }).type === type : undefined,
  });
  return results.slice(0, k).map((r, i) => ({ id: r.id as string, rank: i, score: r.score, source: "lexical" }));
}

export async function runSemantic(
  _ix: Indexes,
  query: string,
  type: string | undefined,
  k: number,
): Promise<Hit[]> {
  if (!config.openrouterApiKey) return []; // no key → semantic leg silently empty
  const vec = await embedQuery(query);
  const lit = toVectorLiteral(vec);
  const overFetch = type ? Math.min(k * 4, 200) : k;
  const rows = (await sql.unsafe(
    `SELECT m.id, m.type, 1 - (e.embedding <=> $1::vector) AS score
     FROM atlas_doc_embeddings e JOIN atlas_doc_meta m ON m.id = e.doc_id
     ORDER BY e.embedding <=> $1::vector LIMIT $2`,
    [lit, overFetch],
  )) as { id: string; type: string; score: number }[];

  const out: Hit[] = [];
  for (const r of rows) {
    if (type && r.type !== type) continue;
    out.push({ id: r.id, rank: out.length, score: r.score, source: "semantic" });
    if (out.length >= k) break;
  }
  return out;
}

export function rrfMerge(lex: Hit[], sem: Hit[]): MergedHit[] {
  const acc = new Map<string, MergedHit>();
  const bump = (h: Hit) => {
    const inc = 1 / (RRF_K + h.rank + 1);
    const prev = acc.get(h.id);
    if (prev) {
      prev.rrf_score += inc;
      if (!prev.sources.includes(h.source)) prev.sources.push(h.source);
    } else {
      acc.set(h.id, { id: h.id, sources: [h.source], rrf_score: inc, score: h.score });
    }
  };
  for (const h of lex) bump(h);
  for (const h of sem) bump(h);
  return [...acc.values()].sort((a, b) => b.rrf_score - a.rrf_score);
}

// Substring snippet around the first matched query term (minisearch gives no
// FTS5-style snippet). Falls back to the head of the content.
export function buildSnippet(content: string, query: string, len = 240): string {
  if (!content) return "";
  const terms = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const lc = content.toLowerCase();
  let at = -1;
  for (const t of terms) {
    if (t.length < 2) continue;
    const i = lc.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return content.slice(0, len).trim() + (content.length > len ? "…" : "");
  const start = Math.max(0, at - len / 4);
  const slice = content.slice(start, start + len).trim();
  return (start > 0 ? "…" : "") + slice + (start + len < content.length ? "…" : "");
}

// Phrase parsing is shared with the frontend reader (one source of truth):
// "double" → case-insensitive phrase, 'single' → case-sensitive phrase.
export { extractPhrases } from "../lib/searchHighlight.ts";

// Exact-phrase post-filter shared by atlas_search + atlas_query: a doc must
// contain every case-insensitive phrase and every case-sensitive phrase.
export function matchesPhrases(title: string, content: string, phrases: string[], casePhrases: string[]): boolean {
  const hay = `${title}\n${content}`;
  const hayLower = hay.toLowerCase();
  return phrases.every((p) => hayLower.includes(p.toLowerCase())) && casePhrases.every((p) => hay.includes(p));
}
