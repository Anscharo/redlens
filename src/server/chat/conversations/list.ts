// GET /api/chat/conversations — the signed-in user's conversation list.
import { sql } from "../../db.ts";
// The list estimates its context figure in SQL rather than loading every row,
// so it divides by CHARS_PER_TOKEN; the detail route computes contextUsedTokens
// exactly (see detail.ts).
import { CHARS_PER_TOKEN, CONTEXT_OVERHEAD_TOKENS } from "../context-compact.ts";
import { citationCounts } from "./citations.ts";

export interface ConversationListOut {
  id: string;
  title: string | null;
  updatedAt: string;
  messageCount: number;
  // How full this conversation's REPLAY is — the rows a turn would send plus
  // the standing prefix, estimated in SQL (see listConversations). Not the
  // measured prompt_tokens of a past round: that counts one turn's tool
  // results, which never come back, so it would fall as often as it rose. The
  // measured value is still stored per message for cost and calibration.
  contextTokens: number;
  // Always true here: the list estimates rather than loading every row's
  // lookup cards. The UI renders it with a "~".
  contextEstimated: boolean;
  // Distinct atlas docs the conversation's answers cite — the size of its auto
  // collection (GET .../:id/collection), counted by the same scan.
  citationCount: number;
}

interface ListRow {
  id: string;
  title: string | null;
  updated_at: string | Date;
  message_count: number;
  replay_chars: number;
}

// One aggregate per conversation. replay_chars counts only the rows a turn
// would REPLAY: everything after the compaction cursor, plus the summary that
// stands in for what came before — summing every row would count messages
// already compacted away, so a compacted conversation would read as its
// pre-compaction size forever. The cursor LATERAL resolves one row by
// primary key per conversation, not per message, because it is correlated on
// c.summary_upto_id rather than on m.
async function listRows(userId: string): Promise<ListRow[]> {
  return (await sql`
    SELECT t.id, t.title, t.updated_at, t.message_count, t.replay_chars
    FROM (
      SELECT c.id, c.title, c.updated_at, count(m.id)::int AS message_count,
        COALESCE(sum(length(m.content)) FILTER (WHERE cut.at IS NULL OR m.created_at > cut.at), 0)::int
          + COALESCE(length(c.summary), 0)::int AS replay_chars
      FROM conversations c
      JOIN messages m ON m.conversation_id = c.id
      LEFT JOIN LATERAL (SELECT cm.created_at AS at FROM messages cm WHERE cm.id = c.summary_upto_id) cut ON true
      WHERE c.user_id = ${userId}
        AND EXISTS (SELECT 1 FROM messages a WHERE a.conversation_id = c.id AND a.role = 'assistant')
      GROUP BY c.id, c.title, c.updated_at, c.summary
      ORDER BY c.updated_at DESC
      LIMIT 100
    ) t
    ORDER BY t.updated_at DESC
  `) as ListRow[];
}

function toListOut(r: ListRow, citations: ReadonlyMap<string, number>): ConversationListOut {
  return {
    id: r.id, title: r.title, updatedAt: new Date(r.updated_at).toISOString(), messageCount: r.message_count,
    // Replayed text / 4, plus the standing prefix — the same shape as
    // contextUsedTokens, which the detail route and the live meter compute
    // exactly. Approximated here because the exact figure needs every row's
    // lookup cards loaded, and this is a list of up to 100 conversations: it
    // omits those cards and the summary's replay wrapper, so it reads a little
    // low on a tool-heavy thread. Always an estimate, hence contextEstimated.
    contextTokens: Math.ceil(r.replay_chars / CHARS_PER_TOKEN) + CONTEXT_OVERHEAD_TOKENS,
    contextEstimated: true,
    citationCount: citations.get(r.id) ?? 0,
  };
}

// One query, no N+1 (unlike listCollections' per-row itemsFor()) — a user's
// conversation count grows unbounded, a per-row follow-up query wouldn't.
// The EXISTS is NOT redundant with the JOIN: a plain JOIN only filters
// ZERO-message conversations, which barely occur. What actually accumulates
// is "user asked, stream died, no reply" — a rate-limited turn leaves no row
// at all (429 returns before resolveConversation), but an ABORTED turn
// leaves a row with exactly ONE message (the user insert; persistAssistant
// is skipped on abort) — messageCount=1, and a plain JOIN returns it happily.
// That junk would list under the raw slice(0,60) seed forever (titling only
// fires after persistAssistant). EXISTS(...role='assistant') is what hides
// it. The JOIN stays alongside it only because messageCount is displayed.
export async function listConversations(userId: string): Promise<ConversationListOut[]> {
  const rows = await listRows(userId);
  const citations = await citationCounts(rows.map((r) => r.id));
  return rows.map((r) => toListOut(r, citations));
}
