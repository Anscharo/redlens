// chat.ts: the pure byte-cap check (messageExceedsLimit) plus handleChat, the
// full POST /api/chat endpoint — auth, rate-limit gate, conversation
// persistence, SSE streaming. handleChat needs a session + DB, so this file
// mocks ../db.ts (mirrors auth.test.ts's pattern: mock.module BEFORE any
// static/dynamic import of the module under test, since chat.ts — and
// rate-limit.ts, which it calls indirectly via getWindowUsage — both import
// "../db.ts"/"./db.ts", same resolved file). Everything else runs for real:
// session.ts (pure JWT, no DB) with config.jwtSecret set so a real signed
// cookie authenticates; the real in-memory indexes (loadIndexes/setIndexes);
// and the real llm.ts client, with only the network boundary (global fetch)
// mocked via the same shared dispatcher llm.test.ts installs (see its
// comment — required because the openai client singleton is process-wide).
import { afterAll, afterEach, beforeAll, describe, expect, it, mock, test } from "bun:test";

type Row = Record<string, unknown>;
type SqlHandler = (text: string, values: unknown[]) => Row[] | undefined;

let queryLog: { text: string; values: unknown[] }[] = [];
let sqlHandlers: SqlHandler[] = [];

function sqlMockFn(strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]> {
  const text = strings.join("¶");
  queryLog.push({ text, values });
  for (const h of sqlHandlers) {
    const r = h(text, values);
    if (r !== undefined) return Promise.resolve(r);
  }
  return Promise.resolve([]);
}

mock.module("../db.ts", () => ({
  sql: sqlMockFn,
  dbTarget: () => "mock-db",
  waitForDb: () => Promise.resolve(),
  toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
}));

// Dynamic imports: everything that (transitively) reaches "../db.ts" must be
// imported AFTER the mock.module registration above, or it captures the real
// module (static imports are hoisted before any module-body code runs).
const { messageExceedsLimit, MAX_MESSAGE_BYTES, handleChat } = await import("./chat.ts");
const { config } = await import("../config.ts");
const { signSession, SESSION_COOKIE } = await import("../session.ts");
const { loadIndexes, setIndexes } = await import("../retrieval/indexes.ts");

test("a normal-sized message is not rejected", () => {
  expect(messageExceedsLimit("What does the atlas say about facilitators?")).toBe(false);
});

test("a message exactly at the limit is not rejected", () => {
  expect(messageExceedsLimit("a".repeat(MAX_MESSAGE_BYTES))).toBe(false);
});

test("a message one byte over the limit is rejected", () => {
  expect(messageExceedsLimit("a".repeat(MAX_MESSAGE_BYTES + 1))).toBe(true);
});

test("a multi-MB message is rejected (the bug: first oversized request always landed)", () => {
  expect(messageExceedsLimit("x".repeat(5_000_000))).toBe(true);
});

test("byte length, not char length, is what's capped (multi-byte UTF-8 counts more)", () => {
  const emoji = "😀".repeat(Math.ceil(MAX_MESSAGE_BYTES / 4) + 10);
  expect(emoji.length * 1).toBeLessThan(Buffer.byteLength(emoji, "utf8"));
  expect(messageExceedsLimit(emoji)).toBe(true);
});

describe("handleChat", () => {
  const g = globalThis as unknown as { __llmFetchCurrentImpl?: typeof fetch; __llmFetchDispatcher?: typeof fetch };
  let savedJwtSecret: string;
  let savedOpenrouterKey: string;

  afterAll(() => {
    // Restore config mutations so later files don't inherit a truthy
    // openrouterApiKey (which activates embed's network path) — process-global under bun.
    config.jwtSecret = savedJwtSecret;
    config.openrouterApiKey = savedOpenrouterKey;
  });

  beforeAll(() => {
    savedJwtSecret = config.jwtSecret;
    savedOpenrouterKey = config.openrouterApiKey;
    config.jwtSecret ||= "test-jwt-secret";
    config.openrouterApiKey ||= "test-key";
    setIndexes(loadIndexes());
    // Same shared-dispatcher install llm.test.ts performs — idempotent,
    // whichever file's beforeAll runs first wins the install.
    if (!g.__llmFetchDispatcher) {
      g.__llmFetchCurrentImpl = (() => {
        throw new Error("no fetch impl set for this test");
      }) as unknown as typeof fetch;
      g.__llmFetchDispatcher = ((...args: Parameters<typeof fetch>) => g.__llmFetchCurrentImpl!(...args)) as typeof fetch;
      globalThis.fetch = g.__llmFetchDispatcher;
    }
  });

  afterEach(() => {
    queryLog = [];
    sqlHandlers = [];
  });

  function sseAnswer(text: string): typeof fetch {
    const chunks = [
      { id: "gen-h1", choices: [{ index: 0, delta: { content: text }, finish_reason: null }] },
      { id: "gen-h1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      { id: "gen-h1", choices: [], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } },
    ];
    const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
    return (async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(body));
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      )) as unknown as typeof fetch;
  }

  async function authedRequest(body: unknown): Promise<Request> {
    const cookie = await signSession({ id: "user-1", provider: "github" });
    return new Request("http://x/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${cookie}` },
      body: JSON.stringify(body),
    });
  }

  // Default handlers for a fully happy path: ownership check finds the convo,
  // history is just the just-inserted user message, rate window has headroom.
  function installHappyHandlers(opts: { convId?: string; tokens?: number } = {}) {
    const convId = opts.convId ?? "conv-1";
    sqlHandlers.push((text) => {
      if (text.includes("SUM(COALESCE")) return [{ tokens: opts.tokens ?? 0 }];
      if (text.includes("conversations WHERE id")) return [{ id: convId }];
      if (text.includes("INSERT INTO conversations")) return [{ id: convId }];
      if (text.includes("SELECT role, content FROM messages")) return [{ role: "user", content: "hi" }];
      if (text.includes("INSERT INTO messages") && text.includes("RETURNING id")) return [{ id: "msg-1" }];
      return undefined;
    });
  }

  it("rejects non-POST methods", async () => {
    const res = await handleChat(new Request("http://x/api/chat", { method: "GET" }));
    expect(res.status).toBe(405);
    expect(((await res.json()) as any).error).toBe("method_not_allowed");
  });

  it("401s when there's no session cookie", async () => {
    const res = await handleChat(
      new Request("http://x/api/chat", { method: "POST", body: JSON.stringify({ message: "hi" }) }),
    );
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).error).toBe("unauthenticated");
  });

  it("400s on invalid JSON", async () => {
    const cookie = await signSession({ id: "user-1", provider: "github" });
    const res = await handleChat(
      new Request("http://x/api/chat", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=${cookie}` },
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe("invalid_json");
  });

  it("400s on an empty/whitespace-only message", async () => {
    const res = await handleChat(await authedRequest({ message: "   " }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe("empty_message");
  });

  it("400s on an oversized message before touching the DB or rate limiter", async () => {
    const res = await handleChat(await authedRequest({ message: "x".repeat(MAX_MESSAGE_BYTES + 1) }));
    expect(res.status).toBe(400);
    const j = await res.json() as any;
    expect(j.error).toBe("message_too_large");
    expect(j.limitBytes).toBe(MAX_MESSAGE_BYTES);
    expect(queryLog).toHaveLength(0);
  });

  it("429s with rate_limited when the user's token window is exceeded", async () => {
    sqlHandlers.push((text) => {
      if (text.includes("SUM(COALESCE")) return [{ tokens: config.rateLimitTokensPerWindow }];
      return undefined;
    });
    const res = await handleChat(await authedRequest({ message: "hi" }));
    expect(res.status).toBe(429);
    const j = await res.json() as any;
    expect(j.error).toBe("rate_limited");
    expect(j.tokensUsed).toBe(config.rateLimitTokensPerWindow);
    expect(res.headers.get("retry-after")).not.toBeNull();
  });

  it("404s conversation_not_found when the given conversationId isn't owned by the caller", async () => {
    sqlHandlers.push((text) => {
      if (text.includes("SUM(COALESCE")) return [{ tokens: 0 }];
      if (text.includes("conversations WHERE id")) return []; // not found / not owned
      return undefined;
    });
    const res = await handleChat(await authedRequest({ message: "hi", conversationId: "someone-elses-convo" }));
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error).toBe("conversation_not_found");
  });

  it("streams a plain-text answer end to end and persists the assistant message", async () => {
    installHappyHandlers();
    await g.__llmFetchDispatcher; // dispatcher already installed in beforeAll
    const prevImpl = g.__llmFetchCurrentImpl!;
    g.__llmFetchCurrentImpl = sseAnswer("Hello from the atlas.");
    try {
      const res = await handleChat(await authedRequest({ message: "What is the Accessibility Scope?" }));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/event-stream");
      const text = await res.text();
      const events = text
        .split("\n\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => JSON.parse(l.slice("data: ".length)));

      expect(events[0].type).toBe("meta");
      expect(events[0].conversationId).toBe("conv-1");
      const done = events.find((e) => e.type === "done");
      expect(done).toBeDefined();
      expect(done.content).toBe("Hello from the atlas.");
      // Internal harness fields must be stripped off the wire by sanitizeDone.
      expect(done.transcript).toBeUndefined();
      expect(done.checksMeta).toBeUndefined();

      // Assistant message got persisted with the streamed content + usage.
      const assistantInsert = queryLog.find(
        (q) => q.text.includes("INSERT INTO messages") && q.text.includes("'assistant'"),
      );
      expect(assistantInsert).toBeDefined();
      expect(assistantInsert!.values).toContain("Hello from the atlas.");
      // The conversation totals update ran too.
      expect(queryLog.some((q) => q.text.includes("UPDATE conversations"))).toBe(true);
    } finally {
      g.__llmFetchCurrentImpl = prevImpl;
    }
  });

  it("opens a new conversation when no conversationId is supplied", async () => {
    installHappyHandlers({ convId: "brand-new-convo" });
    const prevImpl = g.__llmFetchCurrentImpl!;
    g.__llmFetchCurrentImpl = sseAnswer("Sure.");
    try {
      const res = await handleChat(await authedRequest({ message: "hello there" }));
      expect(res.status).toBe(200);
      const text = await res.text();
      const meta = JSON.parse(text.split("\n\n")[0].slice("data: ".length));
      expect(meta.conversationId).toBe("brand-new-convo");
      expect(queryLog.some((q) => q.text.includes("INSERT INTO conversations"))).toBe(true);
    } finally {
      g.__llmFetchCurrentImpl = prevImpl;
    }
  });
});
