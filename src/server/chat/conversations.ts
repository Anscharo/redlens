// /api/chat/conversations — list/read/rename/delete a user's chat history.
// Auth-gated, ownership scoped via WHERE user_id (mirrors collections.ts).
// Conversations themselves are created only by POST /api/chat
// (resolveConversation in endpoint/history.ts) — there is no POST here.
// The list lives in conversations/list.ts, the detail read in
// conversations/detail.ts; this file owns the writes and the route table.
import { sql } from "../db.ts";
import { getSessionUser } from "../session.ts";
import { json } from "../http.ts";
import { listConversations } from "./conversations/list.ts";
import { getConversation } from "./conversations/detail.ts";
import { getConversationCollection, getSharedConversationCollection } from "./conversations/citations.ts";
import { UUID_RE } from "../../lib/patterns.ts";

// Server-side safety cap on a renamed title (the UI enforces a tighter
// 48-char maxLength; this guards a direct authenticated PATCH).
const MAX_TITLE_LEN = 120;

async function renameConversation(
  userId: string, id: string, title: string,
): Promise<{ id: string; title: string; updatedAt: string } | null> {
  // Deliberately NO `updated_at = now()` here, unlike updateCollection's
  // unconditional bump — renaming must not reorder a list sorted by last-
  // message time (POST /api/chat bumps updated_at on every user message
  // insert; see endpoint/history.ts). A "consistency" pass that copies
  // updateCollection's pattern would silently break "rename doesn't jump to
  // top" — don't.
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

interface RouteCtx {
  req: Request;
  userId: string;
  id: string;
  refresh: string | undefined;
}

async function readRoute({ userId, id, refresh }: RouteCtx): Promise<Response> {
  const conv = await getConversation(userId, id);
  if (!conv) return json({ error: "not_found" }, 404);
  if ("denied" in conv) return json({ error: conv.denied }, conv.status);
  return json(conv, 200, refresh);
}

async function renameRoute({ req, userId, id, refresh }: RouteCtx): Promise<Response> {
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
  return json(updated, 200, refresh);
}

async function deleteRoute({ userId, id, refresh }: RouteCtx): Promise<Response> {
  const ok = await deleteConversation(userId, id);
  if (!ok) return json({ error: "not_found" }, 404);
  return json({ ok: true }, 200, refresh);
}

// GET /api/chat/conversations/:id/collection — the conversation's auto
// collection. Read-only by construction: derived from the stored answers, with
// no write route (see conversations/citations.ts).
async function collectionRoute({ req, userId, id, refresh }: RouteCtx): Promise<Response> {
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  // `id` binds to a uuid column: a malformed one would throw in the cast.
  const collection = UUID_RE.test(id) ? await getConversationCollection(userId, id) : null;
  if (!collection) return json({ error: "not_found" }, 404);
  return json(collection, 200, refresh);
}

// GET /api/chat/conversations/:id/shared — public (no session) read of the
// collection behind a shared /c/<id> link. Anyone holding the conversation's id
// can read its cited doc ids and title, and nothing else: the conversation
// itself stays owner-only (readRoute). Gated on chat at the route, so it 404s
// where chat does not exist.
export async function handleSharedConversationCollection(req: Request): Promise<Response> {
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const id = new URL(req.url).pathname.match(/^\/api\/chat\/conversations\/([^/]+)\/shared$/)?.[1];
  if (!id || !UUID_RE.test(id)) return json({ error: "not_found" }, 404);
  try {
    const collection = await getSharedConversationCollection(id);
    return collection ? json(collection, 200) : json({ error: "not_found" }, 404);
  } catch {
    return json({ error: "server_error" }, 500);
  }
}

// Methods on /api/chat/conversations/:id. The bare collection path answers GET only.
const ITEM_ROUTES = new Map<string, (ctx: RouteCtx) => Promise<Response>>([
  ["GET", readRoute],
  ["PATCH", renameRoute],
  ["DELETE", deleteRoute],
]);

export async function handleConversations(req: Request): Promise<Response> {
  const session = await getSessionUser(req);
  if (!session) return json({ error: "unauthenticated" }, 401);
  const userId = session.user.id;

  const { pathname } = new URL(req.url);
  const match = pathname.match(/^\/api\/chat\/conversations(?:\/([^/]+)(\/collection)?)?$/);
  const id = match?.[1];

  if (id && match?.[2]) return collectionRoute({ req, userId, id, refresh: session.refresh });
  if (!id && req.method === "GET") return json(await listConversations(userId), 200, session.refresh);
  const route = id ? ITEM_ROUTES.get(req.method) : undefined;
  if (!id || !route) return json({ error: "method_not_allowed" }, 405);
  return route({ req, userId, id, refresh: session.refresh });
}
