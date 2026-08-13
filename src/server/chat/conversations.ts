// /api/chat/conversations — list/read/rename/delete a user's chat history.
// Auth-gated, ownership scoped via WHERE user_id (mirrors collections.ts).
// Conversations themselves are created only by POST /api/chat
// (resolveConversation in chat.ts) — there is no POST here.
import { sql } from "../db.ts";
import { getSessionUser } from "../session.ts";
import { json } from "../http.ts";
import { HISTORY_BUDGET_CHARS } from "./chat-history.ts";

// Rough chars-per-token for the estimated-context fallback below. Estimation
// only — measured rows never touch it.
const CHARS_PER_TOKEN = 4;

interface ConversationListOut {
  id: string;
  title: string | null;
  updatedAt: string;
  messageCount: number;
  // The newest assistant message's context_tokens — the real per-round
  // context size (see migration 020), not the cumulative input_tokens. For
  // legacy conversations that predate the column (no measured value on any
  // row), this falls back to an ESTIMATE — stored message chars, capped at
  // the windowHistory replay budget, over CHARS_PER_TOKEN — flagged below.
  contextTokens: number | null;
  // True when contextTokens is the estimate, not a measured prompt size —
  // the UI renders it with a "~".
  contextEstimated: boolean;
}

interface MessageOut {
  role: string;
  content: string;
  createdAt: string;
  toolCalls: unknown;
}

interface ConversationDetailOut {
  id: string;
  title: string | null;
  updatedAt: string;
  // MEASURED-only, unlike the list: the newest assistant message's
  // context_tokens, null when unmeasured — deliberately NO estimate fallback
  // here. This value seeds the live panel's context meter/edge line, which
  // turns red near full; showing a chars/4 guess there as a hot warning would
  // mislead, whereas the list card renders its estimate as a muted "~" note.
  contextTokens: number | null;
  messages: MessageOut[];
}

// Server-side safety cap on a renamed title (the UI enforces a tighter
// 48-char maxLength; this guards a direct authenticated PATCH).
const MAX_TITLE_LEN = 120;

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
async function listConversations(userId: string): Promise<ConversationListOut[]> {
  // Aggregate + LIMIT first, then the LATERAL over the surviving ≤100 rows —
  // joined before the GROUP BY, its execution count would be plan-dependent
  // (potentially once per message row); this shape caps it at 100 regardless
  // of what the planner picks.
  const rows = (await sql`
    SELECT t.id, t.title, t.updated_at, t.message_count, t.history_chars, last.context_tokens
    FROM (
      SELECT c.id, c.title, c.updated_at, count(m.id)::int AS message_count,
        LEAST(COALESCE(sum(length(m.content)), 0), ${HISTORY_BUDGET_CHARS})::int AS history_chars
      FROM conversations c
      JOIN messages m ON m.conversation_id = c.id
      WHERE c.user_id = ${userId}
        AND EXISTS (SELECT 1 FROM messages a WHERE a.conversation_id = c.id AND a.role = 'assistant')
      GROUP BY c.id, c.title, c.updated_at
      ORDER BY c.updated_at DESC
      LIMIT 100
    ) t
    LEFT JOIN LATERAL (
      SELECT lm.context_tokens FROM messages lm
      WHERE lm.conversation_id = t.id AND lm.role = 'assistant'
      ORDER BY lm.created_at DESC LIMIT 1
    ) last ON true
    ORDER BY t.updated_at DESC
  `) as { id: string; title: string | null; updated_at: string | Date; message_count: number; context_tokens: number | null; history_chars: number }[];
  return rows.map((r) => ({
    id: r.id, title: r.title, updatedAt: new Date(r.updated_at).toISOString(), messageCount: r.message_count,
    // history_chars is already capped at the replay budget, so the estimate
    // is "what replaying this conversation's text could cost", not its raw
    // size — an upper bound that ignores truncation of old turns, and a
    // lower bound in that it excludes the system prompt and tool results.
    contextTokens: r.context_tokens ?? Math.ceil(r.history_chars / CHARS_PER_TOKEN),
    contextEstimated: r.context_tokens == null,
  }));
}

// DESC-then-resort keeps the NEWEST 200 messages (a plain LIMIT keeps the
// oldest) — display-only; the model's own context is separately bounded by
// windowHistory() in chat-history.ts.
async function getConversation(userId: string, id: string): Promise<ConversationDetailOut | null> {
  const owned = (await sql`
    SELECT c.id, c.title, c.updated_at,
      (SELECT lm.context_tokens FROM messages lm
       WHERE lm.conversation_id = c.id AND lm.role = 'assistant'
       ORDER BY lm.created_at DESC LIMIT 1) AS context_tokens
    FROM conversations c WHERE c.id = ${id} AND c.user_id = ${userId}
  `) as { id: string; title: string | null; updated_at: string | Date; context_tokens: number | null }[];
  if (!owned.length) return null;
  const conv = owned[0];
  const rows = (await sql`
    SELECT * FROM (
      SELECT role, content, created_at, tool_calls
      FROM messages WHERE conversation_id = ${id}
      ORDER BY created_at DESC LIMIT 200
    ) t ORDER BY created_at
  `) as { role: string; content: string; created_at: string | Date; tool_calls: unknown }[];
  return {
    id: conv.id,
    title: conv.title,
    updatedAt: new Date(conv.updated_at).toISOString(),
    contextTokens: conv.context_tokens,
    messages: rows.map((r) => ({
      role: r.role, content: r.content, createdAt: new Date(r.created_at).toISOString(), toolCalls: r.tool_calls,
    })),
  };
}

async function renameConversation(
  userId: string, id: string, title: string,
): Promise<{ id: string; title: string; updatedAt: string } | null> {
  // Deliberately NO `updated_at = now()` here, unlike updateCollection's
  // unconditional bump — renaming must not reorder a list sorted by last-
  // message time (chat.ts bumps updated_at on every user message insert; see
  // that file). A future "consistency" pass that copies updateCollection's
  // pattern would silently break "rename doesn't jump to top" — don't.
  const rows = (await sql`
    UPDATE conversations SET title = ${title}, title_source = 'user'
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING id, title, updated_at
  `) as { id: string; title: string; updated_at: string | Date }[];
  if (!rows.length) return null;
  const r = rows[0];
  return { id: r.id, title: r.title, updatedAt: new Date(r.updated_at).toISOString() };
}

// DELETE cascades messages (and via messages, message_checks) with the
// conversation. That deliberately does NOT refund rate-limit quota: usage is
// accounted in the append-only `usage_events` ledger (017_usage_events.sql),
// whose conversation_id is ON DELETE SET NULL, so the row survives this
// delete and getWindowUsage still counts it. Do not add explicit
// usage_events cleanup here — that would hand a throttled user a way to
// reclaim quota by deleting conversations.
async function deleteConversation(userId: string, id: string): Promise<boolean> {
  const deleted = (await sql`
    DELETE FROM conversations WHERE id = ${id} AND user_id = ${userId} RETURNING id
  `) as { id: string }[];
  return deleted.length > 0;
}

export async function handleConversations(req: Request): Promise<Response> {
  const session = await getSessionUser(req);
  if (!session) return json({ error: "unauthenticated" }, 401);
  const userId = session.user.id;

  const { pathname } = new URL(req.url);
  const id = pathname.match(/^\/api\/chat\/conversations(?:\/([^/]+))?$/)?.[1];

  if (!id && req.method === "GET") {
    return json(await listConversations(userId), 200, session.refresh);
  }

  if (id && req.method === "GET") {
    const conv = await getConversation(userId, id);
    if (!conv) return json({ error: "not_found" }, 404);
    return json(conv, 200, session.refresh);
  }

  if (id && req.method === "PATCH") {
    let body: { title?: string };
    try {
      body = (await req.json()) as { title?: string };
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    const title = body.title?.trim() ?? "";
    if (!title) return json({ error: "empty_title" }, 400);
    if (title.length > MAX_TITLE_LEN) return json({ error: "title_too_long" }, 400);
    const updated = await renameConversation(userId, id, title);
    if (!updated) return json({ error: "not_found" }, 404);
    return json(updated, 200, session.refresh);
  }

  if (id && req.method === "DELETE") {
    const ok = await deleteConversation(userId, id);
    if (!ok) return json({ error: "not_found" }, 404);
    return json({ ok: true }, 200, session.refresh);
  }

  return json({ error: "method_not_allowed" }, 405);
}
