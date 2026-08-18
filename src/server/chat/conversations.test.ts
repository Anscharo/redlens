// conversations.ts unit tests. Mocks ./db.ts COMPLETELY (mirrors
// collections.test.ts's convention) with a tiny in-memory "database" that
// actually implements the list query's JOIN+EXISTS semantics in JS (not just
// canned rows) — that's the only way to real-behaviorally test "a
// conversation with no assistant message is excluded". session.ts is NOT
// mocked — a real signed JWT (mirrors collections.test.ts) drives the
// auth-gated routes. Since there's no POST/create endpoint here (unlike
// collections), tests seed the fake conversations/messages arrays directly.
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { SignJWT } from "jose";

interface Conv { id: string; user_id: string; title: string | null; title_source: string; updated_at: string }
interface StoredMsg {
  id: string; conversation_id: string; role: string; content: string; created_at: string; tool_calls: unknown;
  context_tokens: number | null;
}

let conversations: Conv[] = [];
let msgs: StoredMsg[] = [];
let queryLog: { text: string; values: unknown[] }[] = [];
let idCounter = 0;
function nowIso(): string {
  idCounter++; // nudges created_at/updated_at strictly forward for ORDER BY assertions
  return new Date(Date.now() + idCounter).toISOString();
}

// The newest assistant message's context_tokens for a conversation — mirrors
// the LATERAL/subselect both real queries use (newest by created_at DESC).
function newestAssistantContextTokens(convId: string): number | null {
  const assistants = msgs
    .filter((m) => m.conversation_id === convId && m.role === "assistant")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return assistants[0]?.context_tokens ?? null;
}

function execTag(strings: TemplateStringsArray, ...values: unknown[]) {
  const text = strings.join("?").replace(/\s+/g, " ").trim();
  queryLog.push({ text, values });

  if (text.includes("FROM conversations c") && text.includes("JOIN messages m")) {
    // Value order mirrors the template: the LEAST() budget param precedes the
    // WHERE user_id param.
    const [budget, userId] = values as [number, string];
    const rows = conversations
      .filter((c) => c.user_id === userId)
      .filter((c) => msgs.some((m) => m.conversation_id === c.id && m.role === "assistant"))
      .map((c) => {
        const convMsgs = msgs.filter((m) => m.conversation_id === c.id);
        return {
          id: c.id, title: c.title, updated_at: c.updated_at,
          message_count: convMsgs.length,
          context_tokens: newestAssistantContextTokens(c.id),
          history_chars: Math.min(convMsgs.reduce((s, m) => s + m.content.length, 0), budget),
        };
      })
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 100);
    return Promise.resolve(rows);
  }
  if (text.includes("FROM conversations c WHERE c.id") && text.includes("AND c.user_id")) {
    const [id, userId] = values as [string, string];
    const c = conversations.find((x) => x.id === id && x.user_id === userId);
    return Promise.resolve(
      c ? [{ id: c.id, title: c.title, updated_at: c.updated_at, context_tokens: newestAssistantContextTokens(c.id) }] : [],
    );
  }
  if (text.includes("FROM messages WHERE conversation_id") && text.includes("LIMIT 200")) {
    const [id] = values as [string];
    const rows = msgs
      .filter((m) => m.conversation_id === id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 200)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((m) => ({ role: m.role, content: m.content, created_at: m.created_at, tool_calls: m.tool_calls }));
    return Promise.resolve(rows);
  }
  if (text.includes("UPDATE conversations SET title") && text.includes("title_source = 'user'")) {
    const [title, id, userId] = values as [string, string, string];
    const c = conversations.find((x) => x.id === id && x.user_id === userId);
    if (!c) return Promise.resolve([]);
    c.title = title;
    c.title_source = "user"; // updated_at intentionally untouched
    return Promise.resolve([{ id: c.id, title: c.title, updated_at: c.updated_at }]);
  }
  if (text.includes("DELETE FROM conversations WHERE id") && text.includes("RETURNING id")) {
    const [id, userId] = values as [string, string];
    const idx = conversations.findIndex((x) => x.id === id && x.user_id === userId);
    if (idx === -1) return Promise.resolve([]);
    const [removed] = conversations.splice(idx, 1);
    msgs = msgs.filter((m) => m.conversation_id !== removed.id);
    return Promise.resolve([{ id: removed.id }]);
  }
  throw new Error(`conversations.test.ts: unmocked query: ${text}`);
}

mock.module("../db.ts", () => ({
  sql: execTag,
  dbTarget: () => "mock-db",
  waitForDb: () => Promise.resolve(),
  toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
  toUuidArrayLiteral: (ids: readonly string[]) => `{${ids.join(",")}}`,
  fromUuidArray: (v: unknown) => Array.isArray(v) ? v.map(String) : [],
}));

const { handleConversations } = await import("./conversations.ts");
const { config } = await import("../config.ts");
const { signSession, SESSION_COOKIE } = await import("../session.ts");

afterAll(() => {
  mock.restore();
});

const origSecret = config.jwtSecret;
beforeAll(() => {
  config.jwtSecret = "test-secret-0123456789abcdef0123456789abcdef";
});
afterAll(() => {
  config.jwtSecret = origSecret;
});

beforeEach(() => {
  conversations = [];
  msgs = [];
  queryLog = [];
  idCounter = 0;
});

async function authed(userId = "user-1"): Promise<string> {
  return await signSession({ id: userId, provider: "github" });
}

// signSession always signs a full 7-day TTL, far outside the 24h refresh
// threshold in session.ts — so a normal token never triggers the sliding-
// window refresh branch. Mint one close to expiry directly to exercise it.
async function nearExpiryToken(userId = "user-1"): Promise<string> {
  return await new SignJWT({ provider: "github" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(config.jwtSecret));
}

function req(path: string, init: RequestInit & { cookie?: string } = {}): Request {
  const { cookie, headers, ...rest } = init;
  const h = new Headers(headers);
  if (cookie) h.set("cookie", `${SESSION_COOKIE}=${cookie}`);
  return new Request(`http://x${path}`, { ...rest, headers: h });
}

function seedConversation(over: Partial<Conv> & { id: string; user_id: string }): Conv {
  const c: Conv = { title: null, title_source: "seed", updated_at: nowIso(), ...over };
  conversations.push(c);
  return c;
}

function seedMessage(over: Partial<StoredMsg> & { conversation_id: string; role: string }): StoredMsg {
  const m: StoredMsg = { id: `msg-${msgs.length}`, content: "hi", created_at: nowIso(), tool_calls: null, context_tokens: null, ...over };
  msgs.push(m);
  return m;
}

describe("handleConversations auth gate", () => {
  it("401s every route without a session", async () => {
    const res = await handleConversations(req("/api/chat/conversations"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });
});

describe("GET /api/chat/conversations (list)", () => {
  it("excludes a conversation with no assistant message", async () => {
    const token = await authed();
    seedConversation({ id: "c-answerless", user_id: "user-1" });
    seedMessage({ conversation_id: "c-answerless", role: "user" }); // aborted turn: user only

    seedConversation({ id: "c-answered", user_id: "user-1" });
    seedMessage({ conversation_id: "c-answered", role: "user" });
    seedMessage({ conversation_id: "c-answered", role: "assistant" });

    const res = await handleConversations(req("/api/chat/conversations", { cookie: token }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; messageCount: number }[];
    expect(body.map((c) => c.id)).toEqual(["c-answered"]);
    expect(body[0].messageCount).toBe(2);
  });

  it("orders updated_at DESC", async () => {
    const token = await authed();
    seedConversation({ id: "c-older", user_id: "user-1" });
    seedMessage({ conversation_id: "c-older", role: "assistant" });
    seedConversation({ id: "c-newer", user_id: "user-1" });
    seedMessage({ conversation_id: "c-newer", role: "assistant" });

    const res = await handleConversations(req("/api/chat/conversations", { cookie: token }));
    const body = (await res.json()) as { id: string }[];
    expect(body.map((c) => c.id)).toEqual(["c-newer", "c-older"]);
  });

  it("caps the list at 100", async () => {
    const token = await authed();
    for (let i = 0; i < 105; i++) {
      seedConversation({ id: `c-${i}`, user_id: "user-1" });
      seedMessage({ conversation_id: `c-${i}`, role: "assistant" });
    }
    const res = await handleConversations(req("/api/chat/conversations", { cookie: token }));
    const body = (await res.json()) as unknown[];
    expect(body.length).toBe(100);
  });

  it("only lists the current user's conversations", async () => {
    const token = await authed("user-1");
    seedConversation({ id: "mine", user_id: "user-1" });
    seedMessage({ conversation_id: "mine", role: "assistant" });
    seedConversation({ id: "theirs", user_id: "user-2" });
    seedMessage({ conversation_id: "theirs", role: "assistant" });

    const res = await handleConversations(req("/api/chat/conversations", { cookie: token }));
    const body = (await res.json()) as { id: string }[];
    expect(body.map((c) => c.id)).toEqual(["mine"]);
  });

  it("forwards session.refresh as a Set-Cookie when the session is near expiry", async () => {
    const token = await nearExpiryToken();
    const res = await handleConversations(req("/api/chat/conversations", { cookie: token }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).not.toBeNull();
  });

  it("carries the newest assistant message's contextTokens per row", async () => {
    const token = await authed();
    seedConversation({ id: "c-1", user_id: "user-1" });
    seedMessage({ conversation_id: "c-1", role: "user" });
    seedMessage({ conversation_id: "c-1", role: "assistant", context_tokens: 4_200 });
    // A later assistant reply supersedes the earlier one's context_tokens.
    seedMessage({ conversation_id: "c-1", role: "assistant", context_tokens: 9_100 });

    const res = await handleConversations(req("/api/chat/conversations", { cookie: token }));
    const body = (await res.json()) as { id: string; contextTokens: number | null; contextEstimated: boolean }[];
    expect(body.find((c) => c.id === "c-1")!.contextTokens).toBe(9_100);
    expect(body.find((c) => c.id === "c-1")!.contextEstimated).toBe(false);
  });

  it("falls back to an estimate (flagged) for legacy rows with no measured context", async () => {
    const token = await authed();
    seedConversation({ id: "c-legacy", user_id: "user-1" });
    seedMessage({ conversation_id: "c-legacy", role: "user", content: "a".repeat(1_000) });
    // Legacy row (predates the column, or no usage chunk was ever seen): null.
    seedMessage({ conversation_id: "c-legacy", role: "assistant", content: "b".repeat(7_000), context_tokens: null });

    const res = await handleConversations(req("/api/chat/conversations", { cookie: token }));
    const body = (await res.json()) as { id: string; contextTokens: number | null; contextEstimated: boolean }[];
    const row = body.find((c) => c.id === "c-legacy")!;
    // 8,000 chars of stored text / 4 chars-per-token.
    expect(row.contextTokens).toBe(2_000);
    expect(row.contextEstimated).toBe(true);
  });

  it("caps the estimate at the windowHistory replay budget", async () => {
    const token = await authed();
    seedConversation({ id: "c-huge", user_id: "user-1" });
    // 40k chars stored, but only 24k (the replay budget) can ever re-enter
    // context — the estimate must reflect the cap, not the raw size.
    seedMessage({ conversation_id: "c-huge", role: "user", content: "q".repeat(10_000) });
    seedMessage({ conversation_id: "c-huge", role: "assistant", content: "a".repeat(30_000), context_tokens: null });

    const res = await handleConversations(req("/api/chat/conversations", { cookie: token }));
    const body = (await res.json()) as { id: string; contextTokens: number | null; contextEstimated: boolean }[];
    expect(body.find((c) => c.id === "c-huge")!.contextTokens).toBe(6_000); // 24_000 / 4
  });
});

describe("GET /api/chat/conversations/:id (detail)", () => {
  it("404s for another user's conversation", async () => {
    const token = await authed("user-1");
    seedConversation({ id: "not-mine", user_id: "user-2" });
    const res = await handleConversations(req("/api/chat/conversations/not-mine", { cookie: token }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("returns messages including toolCalls", async () => {
    const token = await authed();
    seedConversation({ id: "c-1", user_id: "user-1", title: "A Title" });
    seedMessage({ conversation_id: "c-1", role: "user", content: "question" });
    seedMessage({
      conversation_id: "c-1", role: "assistant", content: "answer",
      tool_calls: [{ name: "atlas_search", args: { q: "x" }, ok: true, bytes: 42 }],
    });

    const res = await handleConversations(req("/api/chat/conversations/c-1", { cookie: token }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; title: string; messages: { role: string; content: string; toolCalls: unknown }[] };
    expect(body.title).toBe("A Title");
    expect(body.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(body.messages[1].toolCalls).toEqual([{ name: "atlas_search", args: { q: "x" }, ok: true, bytes: 42 }]);
  });

  it("carries top-level contextTokens from the newest assistant message", async () => {
    const token = await authed();
    seedConversation({ id: "c-1", user_id: "user-1" });
    seedMessage({ conversation_id: "c-1", role: "user" });
    seedMessage({ conversation_id: "c-1", role: "assistant", context_tokens: 3_000 });
    seedMessage({ conversation_id: "c-1", role: "assistant", context_tokens: 7_500 });

    const res = await handleConversations(req("/api/chat/conversations/c-1", { cookie: token }));
    const body = (await res.json()) as { contextTokens: number | null };
    expect(body.contextTokens).toBe(7_500);
  });

  it("contextTokens is null when no assistant message has one", async () => {
    const token = await authed();
    seedConversation({ id: "c-2", user_id: "user-1" });
    seedMessage({ conversation_id: "c-2", role: "user" });
    seedMessage({ conversation_id: "c-2", role: "assistant" });

    const res = await handleConversations(req("/api/chat/conversations/c-2", { cookie: token }));
    const body = (await res.json()) as { contextTokens: number | null };
    expect(body.contextTokens).toBeNull();
  });
});

describe("PATCH /api/chat/conversations/:id (rename)", () => {
  it("400s on invalid JSON", async () => {
    const token = await authed();
    seedConversation({ id: "c-1", user_id: "user-1" });
    const res = await handleConversations(
      req("/api/chat/conversations/c-1", { method: "PATCH", cookie: token, body: "{bad" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
  });

  it("400s on an empty/whitespace title", async () => {
    const token = await authed();
    seedConversation({ id: "c-1", user_id: "user-1" });
    const res = await handleConversations(
      req("/api/chat/conversations/c-1", { method: "PATCH", cookie: token, body: JSON.stringify({ title: "   " }) }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "empty_title" });
  });

  it("400s when the title exceeds the length cap", async () => {
    const token = await authed();
    seedConversation({ id: "c-1", user_id: "user-1" });
    const res = await handleConversations(
      req("/api/chat/conversations/c-1", { method: "PATCH", cookie: token, body: JSON.stringify({ title: "x".repeat(121) }) }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "title_too_long" });
  });

  it("404s a conversation that doesn't exist or isn't owned", async () => {
    const token = await authed();
    const res = await handleConversations(
      req("/api/chat/conversations/nope", { method: "PATCH", cookie: token, body: JSON.stringify({ title: "x" }) }),
    );
    expect(res.status).toBe(404);
  });

  it("renames, sets title_source='user', and does NOT touch updated_at", async () => {
    const token = await authed();
    const created = seedConversation({ id: "c-1", user_id: "user-1", title: "old", updated_at: "2020-01-01T00:00:00.000Z" });

    const res = await handleConversations(
      req("/api/chat/conversations/c-1", { method: "PATCH", cookie: token, body: JSON.stringify({ title: "new title" }) }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string; updatedAt: string };
    expect(body.title).toBe("new title");
    // updated_at is unchanged from the seeded value — the PATCH SQL never sets it.
    expect(body.updatedAt).toBe(new Date(created.updated_at).toISOString());
    expect(conversations.find((c) => c.id === "c-1")!.title_source).toBe("user");

    // Assert on the emitted SQL directly too — the whole point of the rule.
    // The RETURNING clause legitimately mentions updated_at (to report it
    // back); what must be absent is a SET on it.
    const patchQuery = queryLog.find((q) => q.text.includes("UPDATE conversations SET title"));
    expect(patchQuery).toBeDefined();
    expect(patchQuery!.text).not.toContain("SET updated_at");
    expect(patchQuery!.text).not.toMatch(/updated_at\s*=\s*now\(\)/);
  });
});

describe("DELETE /api/chat/conversations/:id", () => {
  it("deletes an owned conversation and 404s a second delete", async () => {
    const token = await authed();
    seedConversation({ id: "c-1", user_id: "user-1" });
    seedMessage({ conversation_id: "c-1", role: "assistant" });

    const res = await handleConversations(req("/api/chat/conversations/c-1", { method: "DELETE", cookie: token }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(msgs.some((m) => m.conversation_id === "c-1")).toBe(false); // cascaded

    const again = await handleConversations(req("/api/chat/conversations/c-1", { method: "DELETE", cookie: token }));
    expect(again.status).toBe(404);
  });

  // Quota-reclaim exploit fix (migration 017_usage_events.sql): delete used
  // to be able to reset a rate-limited user's quota by cascading away the
  // messages/message_checks rows getWindowUsage summed. deleteConversation
  // (conversations.ts) issues exactly one statement — DELETE FROM
  // conversations — and never reaches into usage_events itself; the ledger's
  // safety comes from its schema (conversation_id is ON DELETE SET NULL,
  // never CASCADE — see the migration), not from application code. This
  // guards against a regression where someone "helpfully" adds explicit
  // usage_events cleanup to deleteConversation, which would reopen the hole.
  it("emits no query touching usage_events — the ledger's safety is the FK, not app code", async () => {
    const token = await authed();
    seedConversation({ id: "c-1", user_id: "user-1" });
    seedMessage({ conversation_id: "c-1", role: "assistant" });

    await handleConversations(req("/api/chat/conversations/c-1", { method: "DELETE", cookie: token }));
    expect(queryLog.some((q) => q.text.includes("usage_events"))).toBe(false);
  });
});

describe("unmatched method", () => {
  it("405s an unsupported method on the base route", async () => {
    const token = await authed();
    const res = await handleConversations(req("/api/chat/conversations", { method: "PUT", cookie: token }));
    expect(res.status).toBe(405);
  });

  it("405s POST on the :id route", async () => {
    const token = await authed();
    seedConversation({ id: "c-1", user_id: "user-1" });
    const res = await handleConversations(req("/api/chat/conversations/c-1", { method: "POST", cookie: token }));
    expect(res.status).toBe(405);
  });
});
