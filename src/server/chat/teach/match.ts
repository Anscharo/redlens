// Rank a user's accepted teachings against the current question.
//
// Three lanes, any one of which can keep a row:
//   1. lexical — significant-token overlap (and the SQL tsvector lane that
//      feeds extra rows into this set)
//   2. ternlight — on-device 384-dim cosine of question vs subject+content
//   3. (stored pgvector is filled asynchronously; the hot path does not wait
//      on an OpenRouter query embed)
//
// A row is injected ONLY when a lane clears its floor — a direct term match
// (lex) or semantic overlap (ternlight). There is deliberately no "small
// notebook injects in full" shortcut: it made every note ride every turn, so
// an MSC note showed up under "what jobs are there in sky" and "hello there"
// (observed 2026-09-16), and the stage ticker read as if the chat always
// recalled something.
import { onDeviceCosine, onDeviceEmbed } from "../../facts/similarity.ts";
import { listAcceptedTeachings, searchTeachingsSql, type TeachingRow } from "./store.ts";

export const TEACH_MAX_INJECT = 5;
export const TEACH_LEX_FLOOR = 0.12;
export const TEACH_TERNLIGHT_FLOOR = 0.32;

const STOP = new Set([
  "the", "and", "for", "that", "this", "with", "from", "have", "has", "had",
  "are", "was", "were", "been", "being", "not", "but", "you", "your", "what",
  "which", "who", "how", "where", "when", "why", "can", "could", "should",
  "would", "about", "into", "than", "then", "them", "they", "their", "there",
  "atlas", "document", "documents", "please", "just",
]);

export function tokensOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/)) {
    if (w.length < 3 || STOP.has(w)) continue;
    out.add(w);
  }
  return out;
}

function lexScore(q: Set<string>, t: Set<string>): number {
  if (q.size === 0 || t.size === 0) return 0;
  let shared = 0;
  for (const w of q) if (t.has(w)) shared++;
  if (shared === 0) return 0;
  return shared / Math.sqrt(q.size * t.size);
}

export interface RankedTeaching extends TeachingRow {
  score: number;
  lex: number;
  ternlight: number | null;
}

export function rankTeachings(question: string, rows: TeachingRow[]): RankedTeaching[] {
  const qTokens = tokensOf(question);
  const qVec = onDeviceEmbed(question);
  const seen = new Set<string>();
  const unique: TeachingRow[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    unique.push(r);
  }

  const ranked: RankedTeaching[] = unique.map((r) => {
    const blob = `${r.subject ?? ""} ${r.content}`;
    const lex = lexScore(qTokens, tokensOf(blob));
    let ternlight: number | null = null;
    if (qVec) {
      const tVec = onDeviceEmbed(blob);
      if (tVec) ternlight = onDeviceCosine(qVec, tVec);
    }
    const score = Math.max(lex, ternlight ?? 0);
    return { ...r, score, lex, ternlight };
  });

  ranked.sort((a, b) => b.score - a.score || b.lex - a.lex);
  return ranked;
}

export function selectTeachings(ranked: RankedTeaching[]): RankedTeaching[] {
  return ranked
    .filter((r) => r.lex >= TEACH_LEX_FLOOR || (r.ternlight ?? 0) >= TEACH_TERNLIGHT_FLOOR)
    .slice(0, TEACH_MAX_INJECT);
}

export async function matchTeachings(userId: string, question: string): Promise<RankedTeaching[]> {
  const [recent, sqlHits] = await Promise.all([
    listAcceptedTeachings(userId),
    searchTeachingsSql(userId, question),
  ]);
  return selectTeachings(rankTeachings(question, [...sqlHits, ...recent]));
}
