// The conversation a turn writes to, and the history it replays: the user
// message is persisted BEFORE streaming, then the stored rows, the compaction
// cursor and the newest answers' check rows are read back in one round trip.
import { sql } from "../../db.ts";
import { getModel } from "../llm.ts";
import { rowsAfterCursor, type ReplayRow } from "../context-compact.ts";
import type { RecallToolCall } from "../tool-recall-card.ts";
import { reviewNoteFromChecks, type ReviewNote } from "../verify/review-note.ts";
import { REVIEW_LOOKBACK } from "../review-round.ts";
import type { ChatBody } from "./gates.ts";
import type { ResolvedConversation } from "../conversation-access.ts";

/** One message_checks row, carrying the message it belongs to. */
interface CheckRowWithMessage {
  message_id: string;
  kind: string;
  verdict: unknown;
  overall: string | null;
}

export type HistoryRow = { id: string; role: string; content: string; tool_calls: RecallToolCall[] | null };

// Resolve the target conversation: verify ownership of an existing one, or open
// a new row. Returns null if the id was supplied but isn't the caller's.
export async function resolveConversation(userId: string, body: ChatBody): Promise<ResolvedConversation | null> {
  if (body.conversationId) {
    const owned = (await sql`
      SELECT id, private_repos FROM conversations WHERE id = ${body.conversationId} AND user_id = ${userId}
    `) as { id: string; private_repos?: string[] | null }[];
    return owned[0] ? { id: owned[0].id, privateRepos: owned[0].private_repos ?? [] } : null;
  }
  // Pass the RAW object (not JSON.stringify'd) + ::jsonb cast — Bun JSON-encodes
  // the value once for the cast; pre-stringifying double-encodes it into a jsonb
  // string scalar. Matches the jsonb pattern in sync.ts.
  const pc = body.pageContext ?? null;
  const created = (await sql`
    INSERT INTO conversations (user_id, model, page_context, title)
    VALUES (${userId}, ${getModel()}, ${pc}::jsonb, ${body.message.slice(0, 60)})
    RETURNING id
  `) as { id: string }[];
  return { id: created[0].id, privateRepos: [] };
}

const historySelect = (convId: string) =>
  sql`SELECT id, role, content, tool_calls FROM messages WHERE conversation_id = ${convId} ORDER BY created_at`;

// updated_at bump + the compaction cursor in one statement: the summary
// columns live on the row this UPDATE already touches, so reading them back
// costs nothing and saves a fourth round-trip per turn.
const bumpConversation = (convId: string) =>
  sql`UPDATE conversations SET updated_at = now() WHERE id = ${convId} RETURNING summary, summary_upto_id`;

// The check rows the USER SAW, for the newest REVIEW_LOOKBACK answers.
// Deliberately NOT a join onto the history SELECT: message_checks has several
// kinds per message, so joining there would multiply history rows, and
// leaving that query byte-identical keeps its test mock untouched. The LIMIT
// stays inside the subquery — applied to the join it would cap ROWS, not
// answers, and silently drop an answer's findings. The LIMIT in the SUBQUERY
// also asks only about the newest answers themselves: an INNER JOIN written
// flat would skip assistant messages that have NO check row (the small-talk
// bypass writes none) and hand back an OLDER answer's verdict. .catch()
// degrades this ONE query to "no verdict found": a DB hiccup here falls back
// to "no disputes injected" rather than failing the whole turn — the answer
// matters more than the annotation.
const recentCheckRows = (convId: string) =>
  sql`
        SELECT mc.message_id, mc.kind, mc.verdict, mc.overall FROM (
          SELECT id FROM messages
          WHERE conversation_id = ${convId} AND role = 'assistant'
          ORDER BY created_at DESC LIMIT ${REVIEW_LOOKBACK}
        ) m
        JOIN message_checks mc ON mc.message_id = m.id
         AND mc.kind IN ('verify', 'round_checks', 'answer_coverage', 'citation_check')
      `.catch(() => [] as CheckRowWithMessage[]);

// One note per message, built through the same readers the browser uses on
// reload (verify/review-note.ts), so the model and the reader cannot disagree
// about what the badge said.
function reviewNotesByMessage(checkRows: CheckRowWithMessage[]): Map<string, ReviewNote | null> {
  const notesByMessage = new Map<string, ReviewNote | null>();
  for (const row of checkRows) {
    if (notesByMessage.has(row.message_id)) continue;
    notesByMessage.set(row.message_id, reviewNoteFromChecks(checkRows.filter((r) => r.message_id === row.message_id)));
  }
  return notesByMessage;
}

// The updated_at bump runs alongside the history SELECT — independent writes,
// no added latency — so a conversation whose stream later aborts or 429s
// still sorts by its real last-activity time. With rename (conversations.ts)
// deliberately NOT touching updated_at, the invariant `updated_at ≡ last
// message time` holds exactly, served by the existing conversations_user index.
//
// Known, accepted gap: persistChecks runs AFTER the stream's `done`, so a
// user who sends their next message while that write is still in flight gets
// no review round for that one answer — never worse than having none.
export async function loadHistory(convId: string, message: string) {
  await sql`INSERT INTO messages (conversation_id, role, content) VALUES (${convId}, 'user', ${message})`;
  const [historyRows, convState, checkRows] = (await Promise.all([
    historySelect(convId),
    bumpConversation(convId),
    recentCheckRows(convId),
  ])) as [HistoryRow[], { summary: string | null; summary_upto_id: string | null }[], CheckRowWithMessage[]];
  const notesByMessage = reviewNotesByMessage(checkRows);
  const history: ReplayRow[] = rowsAfterCursor(
    historyRows.map((r) => ({
      id: r.id, role: r.role, content: r.content, toolCalls: r.tool_calls,
      review: notesByMessage.get(r.id) ?? null,
    })),
    convState[0]?.summary_upto_id,
  );
  return { historyRows, summary: convState[0]?.summary ?? null, history };
}
