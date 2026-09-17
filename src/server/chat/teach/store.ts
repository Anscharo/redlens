// Postgres access for chat_teachings. Retrieval is scoped to user_id — never
// leak one user's notes into another user's turn.
import { createHash } from "node:crypto";
import { sql, toVectorLiteral } from "../../db.ts";

export interface TeachingRow {
  id: string;
  subject: string | null;
  content: string;
  /** Cosine of the stored on-device vector vs the question, computed in SQL.
   *  NULL when the row predates migration 031 (or no question vector). */
  ternlight_sim?: number | null;
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
  /** On-device vector, embedded ONCE here at write time (migration 031). */
  ternlight?: number[] | null;
}): Promise<{ id: string }> {
  const tl = row.ternlight && row.ternlight.length > 0 ? toVectorLiteral(row.ternlight) : null;
  const inserted = (await sql`
    INSERT INTO chat_teachings (
      user_id, conversation_id, content, subject, status, reject_reason,
      content_hash, review_model, review, ternlight_embedding
    ) VALUES (
      ${row.userId}, ${row.conversationId}, ${row.content}, ${row.subject},
      ${row.status}, ${row.rejectReason}, ${row.contentHash}, ${row.reviewModel},
      ${row.review}::jsonb, ${tl}::vector
    )
    ON CONFLICT (user_id, content_hash) WHERE status = 'accepted' DO NOTHING
    RETURNING id
  `) as { id: string }[];
  if (inserted[0]) return inserted[0];
  // A concurrent identical /teach won the race (migration 032's partial unique
  // index): answer with the row that exists rather than failing the turn.
  const existing = row.status === "accepted" ? await findAcceptedByHash(row.userId, row.contentHash) : null;
  if (!existing) throw new Error("chat_teachings insert returned no id");
  return existing;
}

// Cap on how many of one user's notes we load per turn. Matching then ranks.
export const TEACH_FETCH_CAP = 200;

// `qVec` is the question's on-device vector; Postgres returns each row's
// cosine against it as ternlight_sim (NULL when either side is NULL), so the
// hot path never re-embeds a note. NULL qVec means ternlight failed to load.
export async function listAcceptedTeachings(userId: string, qVec: number[] | null = null): Promise<TeachingRow[]> {
  const q = qVec ? toVectorLiteral(qVec) : null;
  const rows = (await sql`
    SELECT id, subject, content, 1 - (ternlight_embedding <=> ${q}::vector) AS ternlight_sim
    FROM chat_teachings
    WHERE user_id = ${userId} AND status = 'accepted'
    ORDER BY created_at DESC
    LIMIT ${TEACH_FETCH_CAP}
  `) as TeachingRow[];
  return rows;
}

// Backfill for rows written before migration 031: the read path computed the
// vector once (match.ts), so store it and never compute it again.
export async function storeTernlight(id: string, vec: number[]): Promise<void> {
  await sql`
    UPDATE chat_teachings
    SET ternlight_embedding = ${toVectorLiteral(vec)}::vector, updated_at = now()
    WHERE id = ${id} AND ternlight_embedding IS NULL
  `;
}

// Lexical SQL lane: teachings whose tsvector matches the question, used as an
// extra recall set when the user has more notes than TEACH_FETCH_CAP. Never
// throws on a junk query — websearch_to_tsquery can reject odd punctuation.
export async function searchTeachingsSql(userId: string, question: string, qVec: number[] | null = null): Promise<TeachingRow[]> {
  const q = question.trim().slice(0, 500);
  if (q.length < 3) return [];
  const v = qVec ? toVectorLiteral(qVec) : null;
  try {
    const rows = (await sql`
      SELECT id, subject, content, 1 - (ternlight_embedding <=> ${v}::vector) AS ternlight_sim
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
