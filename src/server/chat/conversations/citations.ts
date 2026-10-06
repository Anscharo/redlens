// A conversation's auto collection: the atlas docs its assistant answers cite,
// derived on read from the stored answers with the same scan the Sources chips
// use (src/lib/citationScan.ts). Nothing is stored, so the collection cannot be
// edited, cannot drift from the thread, and is gone when the conversation is.
import { sql } from "../../db.ts";
import { toUuidArrayLiteral } from "../../pg-array.ts";
import { extractCitedDocs } from "../../../lib/citationScan.ts";

export interface ConversationCollectionOut {
  /** The conversation's id — an auto collection has no identity of its own. */
  id: string;
  name: string;
  /** Cited doc uuids, oldest citation first. */
  ids: string[];
  auto: true;
}

const UNTITLED = "Untitled chat";

/** Unique cited doc uuids across `answers`, in order of first citation. */
export function citedDocIds(answers: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const answer of answers) for (const doc of extractCitedDocs(answer)) ids.add(doc.uuid);
  return [...ids];
}

async function answersOf(conversationId: string): Promise<string[]> {
  const rows = (await sql`
    SELECT content FROM messages
    WHERE conversation_id = ${conversationId} AND role = 'assistant'
    ORDER BY created_at
  `) as { content: string }[];
  return rows.map((r) => r.content);
}

async function collectionOf(row: { id: string; title: string | null }): Promise<ConversationCollectionOut> {
  return { id: row.id, name: row.title ?? UNTITLED, ids: citedDocIds(await answersOf(row.id)), auto: true };
}

export async function getConversationCollection(userId: string, id: string): Promise<ConversationCollectionOut | null> {
  const owned = (await sql`
    SELECT c.id, c.title FROM conversations c WHERE c.id = ${id} AND c.user_id = ${userId}
  `) as { id: string; title: string | null }[];
  return owned.length ? collectionOf(owned[0]) : null;
}

// The share-link read: no owner check, the conversation's own (unguessable) id
// is the token, as a saved collection's id is for /c/<id>. Exposes only what
// ConversationCollectionOut holds — the title, the cited doc ids and the id —
// never a message.
export async function getSharedConversationCollection(id: string): Promise<ConversationCollectionOut | null> {
  const rows = (await sql`
    SELECT c.id, c.title FROM conversations c WHERE c.id = ${id}
  `) as { id: string; title: string | null }[];
  return rows.length ? collectionOf(rows[0]) : null;
}

// One query for the whole list page (no N+1). Only answers that contain an
// atlas link are read: the rest cannot cite anything, and most of a thread's
// bytes are prose. `conversationIds` come from the caller's own owned list.
export async function citationCounts(conversationIds: readonly string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!conversationIds.length) return counts;
  const rows = (await sql`
    SELECT conversation_id, content FROM messages
    WHERE conversation_id = ANY(${toUuidArrayLiteral(conversationIds)}::uuid[])
      AND role = 'assistant' AND content LIKE '%/atlas/%'
    ORDER BY created_at
  `) as { conversation_id: string; content: string }[];
  const byConversation = new Map<string, string[]>();
  for (const r of rows) {
    const answers = byConversation.get(r.conversation_id);
    if (answers) answers.push(r.content);
    else byConversation.set(r.conversation_id, [r.content]);
  }
  for (const [id, answers] of byConversation) counts.set(id, citedDocIds(answers).length);
  return counts;
}
