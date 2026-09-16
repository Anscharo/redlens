// Rank a user's accepted teachings against the current question.
//
// Three lanes, any one of which can keep a row:
//   1. lexical — significant-token overlap (and the SQL tsvector lane that
//      feeds extra rows into this set)
//   2. ternlight — 384-dim cosine of question vs subject+content. The note's
//      vector is embedded ONCE, at accept (store.ts, migration 031); per turn
//      only the QUESTION is embedded and Postgres returns the cosine as
//      ternlight_sim. A row written before 031 is embedded here on its first
//      match and written back, so it too is computed exactly once.
// (030's 1024-dim OpenRouter vector was never read by anything and was dropped
// in 031 — the notebook is one space, ternlight, on-device.)
//
// A row is injected ONLY when a lane clears its floor — a direct term match
// (lex) or semantic overlap (ternlight). There is deliberately no "small
// notebook injects in full" shortcut: it made every note ride every turn, so
// an MSC note showed up under "what jobs are there in sky" and "hello there"
// (observed 2026-09-16), and the stage ticker read as if the chat always
// recalled something.
import { onDeviceCosine, onDeviceEmbed } from "../../facts/similarity.ts";
import { listAcceptedTeachings, searchTeachingsSql, storeTernlight, type TeachingRow } from "./store.ts";

/** The one text both the write-time embed and any fallback embed use, so the
 *  stored vector and a freshly computed one are the same vector. */
export function teachingEmbedText(subject: string | null | undefined, content: string): string {
  return `${subject ?? ""} ${content}`;
}

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
    const blob = teachingEmbedText(r.subject, r.content);
    const lex = lexScore(qTokens, tokensOf(blob));
    // SQL-computed cosine from the stored vector wins; embedding here is the
    // fallback for a row that has none (pre-031, or a unit-test row).
    let ternlight: number | null = typeof r.ternlight_sim === "number" ? r.ternlight_sim : null;
    if (ternlight === null && qVec) {
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

// Rows with no stored vector (pre-031) get one computed here and written
// back, fire-and-forget — the write must never fail the turn.
export function backfillTernlight(rows: TeachingRow[], qVec: Float32Array | null): TeachingRow[] {
  if (!qVec) return rows;
  const seen = new Set<string>();
  return rows.map((r) => {
    if (typeof r.ternlight_sim === "number" || seen.has(r.id)) return r;
    seen.add(r.id);
    const tVec = onDeviceEmbed(teachingEmbedText(r.subject, r.content));
    if (!tVec) return r;
    void storeTernlight(r.id, Array.from(tVec)).catch((err) => {
      console.warn(`[teach] ternlight backfill failed for ${r.id}: ${(err as Error).message}`);
    });
    return { ...r, ternlight_sim: onDeviceCosine(qVec, tVec) };
  });
}

export async function matchTeachings(userId: string, question: string): Promise<RankedTeaching[]> {
  const qVec = onDeviceEmbed(question); // the ONLY embed on the hot path
  const qArr = qVec ? Array.from(qVec) : null;
  const [recent, sqlHits] = await Promise.all([
    listAcceptedTeachings(userId, qArr),
    searchTeachingsSql(userId, question, qArr),
  ]);
  const rows = backfillTernlight([...sqlHits, ...recent], qVec);
  return selectTeachings(rankTeachings(question, rows));
}
