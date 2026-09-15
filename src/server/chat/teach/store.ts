// Postgres access for chat_teachings. Retrieval is scoped to user_id — never
// leak one user's notes into another user's turn.
import { createHash } from "node:crypto";
import { sql, toVectorLiteral } from "../../db.ts";
import { config } from "../../config.ts";
import { embedBatch } from "../../retrieval/embed.ts";

export interface TeachingRow {
  id: string;
  subject: string | null;
  content: string;
  embedding?: number[] | null;
}

export function teachingHash(content: string): string {
  const normalized = content.trim().replace(/\s+/g, " ");
  return createHash("sha256").update(normalized).digest("hex");
}

export async function countTeachingsToday(userId: string): Promise<number> {
  const rows = (await sql`
    SELECT count(*)::int AS n FROM chat_teachings
    WHERE user_id = ${userId} AND created_at > now() - interval '1 day'
  `) as { n: number }[];
  return rows[0]?.n ?? 0;
}

export async function findAcceptedByHash(userId: string, hash: string): Promise<{ id: string } | null> {
  const rows = (await sql`
    SELECT id FROM chat_teachings
    WHERE user_id = ${userId} AND content_hash = ${hash} AND status = 'accepted'
    LIMIT 1
  `) as { id: string }[];
  return rows[0] ?? null;
}

export async function insertTeaching(row: {
  userId: string;
  conversationId: string | null;
  content: string;
  subject: string;
  status: "accepted" | "rejected";
  rejectReason: string | null;
  contentHash: string;
  reviewModel: string | null;
  review: unknown;
}): Promise<{ id: string }> {
  const inserted = (await sql`
    INSERT INTO chat_teachings (
      user_id, conversation_id, content, subject, status, reject_reason,
      content_hash, review_model, review
    ) VALUES (
      ${row.userId}, ${row.conversationId}, ${row.content}, ${row.subject},
      ${row.status}, ${row.rejectReason}, ${row.contentHash}, ${row.reviewModel},
      ${row.review}::jsonb
    )
    RETURNING id
  `) as { id: string }[];
  if (!inserted[0]) throw new Error("chat_teachings insert returned no id");
  return inserted[0];
}

// Cap on how many of one user's notes we load per turn. Matching then ranks.
export const TEACH_FETCH_CAP = 200;

export async function listAcceptedTeachings(userId: string): Promise<TeachingRow[]> {
  const rows = (await sql`
    SELECT id, subject, content
    FROM chat_teachings
    WHERE user_id = ${userId} AND status = 'accepted'
    ORDER BY created_at DESC
    LIMIT ${TEACH_FETCH_CAP}
  `) as TeachingRow[];
  return rows;
}

// Lexical SQL lane: teachings whose tsvector matches the question, used as an
// extra recall set when the user has more notes than TEACH_FETCH_CAP. Never
// throws on a junk query — websearch_to_tsquery can reject odd punctuation.
export async function searchTeachingsSql(userId: string, question: string): Promise<TeachingRow[]> {
  const q = question.trim().slice(0, 500);
  if (q.length < 3) return [];
  try {
    const rows = (await sql`
      SELECT id, subject, content
      FROM chat_teachings
      WHERE user_id = ${userId}
        AND status = 'accepted'
        AND tsv @@ websearch_to_tsquery('english', ${q})
      ORDER BY ts_rank(tsv, websearch_to_tsquery('english', ${q})) DESC
      LIMIT 20
    `) as TeachingRow[];
    return rows;
  } catch {
    return [];
  }
}

export async function embedTeaching(id: string, text: string): Promise<void> {
  if (!config.openrouterApiKey) return;
  try {
    const [vec] = await embedBatch([text.slice(0, 8000)]);
    await sql`
      UPDATE chat_teachings
      SET embedding = ${toVectorLiteral(vec)}::vector, updated_at = now()
      WHERE id = ${id}
    `;
  } catch (err) {
    console.warn(`[teach] embed failed for ${id}: ${(err as Error).message}`);
  }
}
