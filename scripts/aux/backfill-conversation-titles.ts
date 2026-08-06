#!/usr/bin/env bun
// One-shot backfill for conversations that predate the turn-1/4/10 chat.ts
// auto-titling (src/server/chat/title.ts). Every conversation already in
// Postgres when this feature ships is past turn 10 and will otherwise carry
// its title_source='seed' fallback (message.slice(0,60)) forever — since the
// whole point of /conversations is surfacing that saved history, it must not
// ship un-retitled. Reuses titleConversation() (src/server/chat/title.ts) so
// there is exactly one titling prompt/parse path, not two to keep in sync.
//
//   bun scripts/aux/backfill-conversation-titles.ts
//
// Idempotent-ish: re-running only touches rows still at title_source='seed'
// (already-'auto' or 'user' rows are excluded by the WHERE below, and
// titleConversation's own UPDATE guard additionally protects 'user' rows).
import { sql, waitForDb } from "../../src/server/db.ts";
import { titleConversation, buildTitleTranscript } from "../../src/server/chat/title.ts";
import { config } from "../../src/server/config.ts";

if (!config.chatTitleModel) {
  console.error("CHAT_TITLE_MODEL resolves empty — titling is disabled; nothing to backfill.");
  process.exit(1);
}

await waitForDb();

const candidates = (await sql`
  SELECT c.id FROM conversations c
  WHERE c.title_source = 'seed'
    AND EXISTS (SELECT 1 FROM messages a WHERE a.conversation_id = c.id AND a.role = 'assistant')
  ORDER BY c.updated_at DESC
`) as { id: string }[];

console.log(`backfill-conversation-titles: ${candidates.length} conversation(s) at title_source='seed'`);

let retitled = 0;
let skipped = 0;
for (const { id } of candidates) {
  const history = (await sql`
    SELECT role, content FROM messages WHERE conversation_id = ${id} ORDER BY created_at
  `) as { role: string; content: string }[];
  const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
  if (!lastAssistant) {
    skipped++; // guarded by the EXISTS above; defensive only
    continue;
  }
  // buildTitleTranscript's `history` param must NOT include the just-produced
  // answer (it's appended separately as the second arg) — unlike chat.ts's
  // pre-persist window, this row set is the FULL conversation, so the
  // duplicate has to be filtered out here or the last answer is repeated
  // (once windowed in full, once truncated) in the titling prompt.
  const priorHistory = history.filter((m) => m !== lastAssistant);
  await titleConversation(id, buildTitleTranscript(priorHistory, lastAssistant.content));
  const [row] = (await sql`SELECT title_source FROM conversations WHERE id = ${id}`) as { title_source: string }[];
  if (row?.title_source === "auto") retitled++;
  else skipped++; // LLM/timeout failure, or renamed to 'user' mid-run
}

console.log(`backfill-conversation-titles: retitled ${retitled}, skipped ${skipped}`);
await sql.end();
