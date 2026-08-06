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

// async, not just Promise-returning: the real driver's query failures always
// surface as a rejected promise (the round trip is inherently async), never
// a synchronous throw. Declaring this `async` gives a handler's `throw`
// (the shorthand tests use for "this query fails") the same rejection
// semantics, so a bare `.catch()` on the call site behaves like production —
// a plain function here would let the throw escape synchronously instead.
async function sqlMockFn(strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]> {
  const text = strings.join("¶");
  queryLog.push({ text, values });
  for (const h of sqlHandlers) {
    const r = h(text, values);
    if (r !== undefined) return r;
  }
  return [];
}

mock.module("../db.ts", () => ({
  sql: sqlMockFn,
  dbTarget: () => "mock-db",
  waitForDb: () => Promise.resolve(),
  toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
}));

// NOTE on title.ts: deliberately NOT mocked via mock.module here. bun:test
// imports every test file's module-level code (running mock.module calls
// immediately) before running any file's hooks/tests, so a mock.module("./
// title.ts", ...) registered here would permanently replace the module for
// the REST OF THE PROCESS — including title.test.ts's own `await
// import("./title.ts")`, which needs the real thing since title.ts is what
// IT tests. (Confirmed empirically: mock.restore() does not undo
// mock.module — that's only for mock.fn()/spyOn — so there is no way to
// "unmock" it later in this file either.) Instead, titling is controlled via
// config.chatTitleModel: left at "" (see beforeAll below) for every
// pre-existing test, which makes titleConversation an immediate no-op (its
// first line is `if (!model) return;`) — zero network calls, so there's
// nothing to race against the per-test fetch mock swaps. The dedicated
// "titling" describe block below temporarily sets a real chatTitleModel and
// drives titleConversation through its REAL implementation end-to-end.

// Dynamic imports: everything that (transitively) reaches "../db.ts" must be
// imported AFTER the mock.module registration above, or it captures the real
// module (static imports are hoisted before any module-body code runs).
const { messageExceedsLimit, MAX_MESSAGE_BYTES, handleChat, persistAssistant } = await import("./chat.ts");
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
  let savedTitleModel: string;

  afterAll(() => {
    // Restore config mutations so later files don't inherit a truthy
    // openrouterApiKey (which activates embed's network path) — process-global under bun.
    config.jwtSecret = savedJwtSecret;
    config.openrouterApiKey = savedOpenrouterKey;
    config.chatTitleModel = savedTitleModel;
  });

  beforeAll(() => {
    savedJwtSecret = config.jwtSecret;
    savedOpenrouterKey = config.openrouterApiKey;
    savedTitleModel = config.chatTitleModel;
    config.jwtSecret ||= "test-jwt-secret";
    config.openrouterApiKey ||= "test-key";
    // Off by default for every pre-existing test (see the file-header note on
    // title.ts): titleConversation's first line is `if (!model) return;`, so
    // this makes it an unconditional no-op — no network call, nothing to race
    // against the per-test fetch mock swaps below. The "titling" describe
    // block turns it back on for its own tests.
    config.chatTitleModel = "";
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

  // Builds the mocked streaming chat-completion Response body (shared by
  // sseAnswer below and the titling suite's combined dispatcher).
  function sseResponse(text: string): Response {
    const chunks = [
      { id: "gen-h1", choices: [{ index: 0, delta: { content: text }, finish_reason: null }] },
      { id: "gen-h1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      { id: "gen-h1", choices: [], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } },
    ];
    const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(body));
          controller.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  }

  function sseAnswer(text: string): typeof fetch {
    return (async () => sseResponse(text)) as unknown as typeof fetch;
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
  // history is just the just-inserted user message (plus `priorAssistants`
  // synthetic prior assistant rows, for the turn-count titling tests), rate
  // window has headroom.
  function installHappyHandlers(opts: { convId?: string; tokens?: number; priorAssistants?: number } = {}) {
    const convId = opts.convId ?? "conv-1";
    const history = [
      { role: "user", content: "hi" },
      ...Array.from({ length: opts.priorAssistants ?? 0 }, () => ({ role: "assistant", content: "prior answer" })),
    ];
    sqlHandlers.push((text) => {
      if (text.includes("FROM usage_events")) return [{ tokens: opts.tokens ?? 0 }];
      if (text.includes("conversations WHERE id")) return [{ id: convId }];
      if (text.includes("INSERT INTO conversations")) return [{ id: convId }];
      if (text.includes("SELECT role, content FROM messages")) return history;
      if (text.includes("UPDATE conversations SET updated_at")) return [];
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
      if (text.includes("FROM usage_events")) return [{ tokens: config.rateLimitTokensPerWindow }];
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
      if (text.includes("FROM usage_events")) return [{ tokens: 0 }];
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

  it("bumps conversations.updated_at on the user message insert", async () => {
    installHappyHandlers();
    const prevImpl = g.__llmFetchCurrentImpl!;
    g.__llmFetchCurrentImpl = sseAnswer("Hello.");
    try {
      await handleChat(await authedRequest({ message: "hi" }));
      expect(queryLog.some((q) => q.text.includes("UPDATE conversations SET updated_at = now() WHERE id"))).toBe(true);
    } finally {
      g.__llmFetchCurrentImpl = prevImpl;
    }
  });

  // Runs titleConversation through its REAL implementation end to end (not a
  // stub — see the file-header note on why title.ts can't be mock.module'd
  // here). The chat-completion stream and the titling call both go through
  // the SAME shared fetch dispatcher, so this dispatcher tells them apart by
  // request shape (the stream sets `stream:true`; the titling call is
  // OpenAI's non-streaming JSON mode) and answers each appropriately,
  // capturing the titling call's request body for assertions.
  describe("titling", () => {
    beforeAll(() => {
      config.chatTitleModel = "test/title-model";
    });
    afterAll(() => {
      config.chatTitleModel = "";
    });

    function titlingFetchImpl(answerText: string, titleCalls: { model: string; messages: unknown[] }[]): typeof fetch {
      return (async (_url: unknown, init?: RequestInit) => {
        const parsed = init?.body ? (JSON.parse(init.body as string) as { stream?: boolean; model: string; messages: unknown[] }) : ({} as any);
        if (parsed.stream) return sseResponse(answerText);
        // Non-streaming JSON-mode call — the titling call (the verifier is
        // the only other JSON-mode caller in chat.ts, and it stays off here
        // since config.chatVerifierModel defaults to "").
        titleCalls.push(parsed);
        return new Response(
          JSON.stringify({
            id: "gen-title-1",
            choices: [{ message: { content: '{"title":"A Generated Title"}' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch;
    }

    async function runTurn(priorAssistants: number): Promise<{ model: string; messages: unknown[] }[]> {
      // sqlHandlers is a shared queue with no per-call scoping (afterEach only
      // resets it BETWEEN it() blocks) — reset it explicitly here so a test
      // that calls runTurn more than once (e.g. "does not fire on turn 2 or
      // 3") doesn't have its second call still matched by the first call's
      // stale handler.
      sqlHandlers = [];
      installHappyHandlers({ priorAssistants });
      const prevImpl = g.__llmFetchCurrentImpl!;
      const titleCalls: { model: string; messages: unknown[] }[] = [];
      g.__llmFetchCurrentImpl = titlingFetchImpl("An answer.", titleCalls);
      try {
        const res = await handleChat(await authedRequest({ message: "a question" }));
        await res.text(); // drains the SSE stream itself
        // The titling call is genuinely fire-and-forget, several real async
        // ticks deep (callWithTimeout → the JsonCall → the openai SDK's own
        // internal awaits before it calls fetch) — unlike a directly-injected
        // stub, those ticks aren't guaranteed to have all resolved by the time
        // res.text() settles. Flush a macrotask so they do.
        await new Promise((resolve) => setTimeout(resolve, 20));
        return titleCalls;
      } finally {
        g.__llmFetchCurrentImpl = prevImpl;
      }
    }

    it("fires on turn 1 (priorAssistants=0)", async () => {
      const calls = await runTurn(0);
      expect(calls.length).toBe(1);
      expect(calls[0].model).toBe("test/title-model");
    });

    it("does not fire on turn 2 or 3", async () => {
      expect((await runTurn(1)).length).toBe(0);
      expect((await runTurn(2)).length).toBe(0);
    });

    it("fires on turn 4 (priorAssistants=3)", async () => {
      expect((await runTurn(3)).length).toBe(1);
    });

    it("does not fire on turns 5 through 9", async () => {
      for (const priorAssistants of [4, 5, 6, 7, 8]) {
        expect((await runTurn(priorAssistants)).length).toBe(0);
      }
    });

    it("fires on turn 10 (priorAssistants=9)", async () => {
      expect((await runTurn(9)).length).toBe(1);
    });

    it("does not fire on turn 11 or later", async () => {
      expect((await runTurn(10)).length).toBe(0);
    });

    it("is unawaited — a real provider failure on the titling call doesn't affect the SSE stream", async () => {
      installHappyHandlers({ priorAssistants: 0 });
      const prevImpl = g.__llmFetchCurrentImpl!;
      // The streaming answer succeeds; the titling call gets a real HTTP
      // failure. titleConversation's own try/catch must swallow this
      // entirely (see title.test.ts) — this test's job is only to confirm
      // that failure never reaches the client-visible stream.
      g.__llmFetchCurrentImpl = (async (_url: unknown, init?: RequestInit) => {
        const parsed = init?.body ? (JSON.parse(init.body as string) as { stream?: boolean }) : ({} as any);
        if (parsed.stream) return sseResponse("Fine despite titling failing.");
        return new Response("internal error", { status: 500 });
      }) as unknown as typeof fetch;
      try {
        const res = await handleChat(await authedRequest({ message: "a question" }));
        expect(res.status).toBe(200);
        const text = await res.text();
        const events = text
          .split("\n\n")
          .filter((l) => l.startsWith("data: "))
          .map((l) => JSON.parse(l.slice("data: ".length)));
        const done = events.find((e) => e.type === "done");
        expect(done).toBeDefined();
        expect(done.content).toBe("Fine despite titling failing.");
      } finally {
        g.__llmFetchCurrentImpl = prevImpl;
      }
    });

    // "req.signal is not forwarded to titleConversation" is not re-verified
    // dynamically here (the earlier mock.module-based version could inspect
    // the exact JS arguments; the real-network version above can't, since
    // callWithTimeout always wraps whatever signal it's given into a NEW
    // AbortSignal.any(...) before it ever reaches fetch — there's nothing
    // meaningfully different to observe at the HTTP layer whether or not
    // chat.ts had passed req.signal through). The guarantee instead comes
    // from chat.ts's fixed 3-argument call site (convId, transcript, obs)
    // plus TypeScript arity checking on titleConversation's declared
    // 4-parameter signature (convId, transcript, obs?, call?) — a 5th
    // positional argument, or stuffing a signal into `obs` (typed
    // ErrorContext, which has no signal field), is a compile error, not
    // something that needs a runtime test.
  });
});

// Quota-reclaim exploit fix (migration 017_usage_events.sql): a rate-limited
// user used to be able to DELETE /api/chat/conversations/:id to cascade away
// the messages/message_checks rows getWindowUsage SUMmed, resetting their
// window. usage_events is the append-only ledger that delete can't touch.
// persistAssistant is called directly here (not through the full HTTP +
// streaming + harness path handleChat exercises above) — getting a non-null
// checksMeta token count out of the real verifier/advisor flow would require
// standing up the same kind of network-mock machinery as the "titling" block,
// just to prove a one-line summation; a direct call is the precise tool.
describe("persistAssistant — usage ledger", () => {
  afterEach(() => {
    queryLog = [];
    sqlHandlers = [];
  });

  function installPersistHandlers() {
    sqlHandlers.push((text) => {
      if (text.includes("INSERT INTO messages") && text.includes("RETURNING id")) return [{ id: "msg-1" }];
      if (text.includes("UPDATE conversations")) return [];
      if (text.includes("INSERT INTO message_checks")) return [];
      if (text.includes("INSERT INTO usage_events")) return [];
      return undefined;
    });
  }

  it("inserts exactly one usage_events row per turn, summing done.usage AND the harness (checksMeta) tokens", async () => {
    installPersistHandlers();
    const done = {
      type: "done",
      content: "answer",
      usage: { input: 100, output: 40 },
      generationId: "gen-1",
      toolCalls: [],
      lengthCapped: false,
      transcript: [],
      checksMeta: [
        // A verifier row (real tokens) — this is the harness spend that must
        // NOT be dropped by only summing done.usage.
        {
          kind: "verify", model: "verifier/model", action: null, verdict: null,
          overall: "pass", inputTokens: 30, outputTokens: 10,
          generationId: "gen-verify", latencyMs: 50,
        },
        // A deterministic round_checks row — always present, always
        // null-tokened; must contribute 0, not NaN/throw.
        {
          kind: "round_checks", model: null, action: null, verdict: null,
          overall: null, inputTokens: null, outputTokens: null,
          generationId: null, latencyMs: null,
        },
      ],
    };

    await persistAssistant("user-1", "conv-1", done as any, 123);

    const usageInserts = queryLog.filter((q) => q.text.includes("INSERT INTO usage_events"));
    expect(usageInserts).toHaveLength(1);
    // (input: 100 + 30 = 130, output: 40 + 10 = 50) — not just done.usage's 100/40.
    expect(usageInserts[0].values).toEqual(["user-1", "conv-1", 130, 50]);
  });

  it("still inserts a usage_events row (zero harness tokens) when checksMeta is empty", async () => {
    installPersistHandlers();
    const done = {
      type: "done", content: "answer", usage: { input: 7, output: 3 },
      generationId: "gen-2", toolCalls: [], lengthCapped: false, transcript: [], checksMeta: [],
    };
    await persistAssistant("user-1", "conv-2", done as any, 10);
    const usageInserts = queryLog.filter((q) => q.text.includes("INSERT INTO usage_events"));
    expect(usageInserts).toHaveLength(1);
    expect(usageInserts[0].values).toEqual(["user-1", "conv-2", 7, 3]);
  });

  // Regression for the mid-turn-delete race: DELETE /api/chat/conversations/:id
  // can land between the `meta` SSE event (which ships convId immediately) and
  // this function running. messages.conversation_id is NOT NULL + ON DELETE
  // CASCADE, so once the conversation is gone the messages insert FK-fails.
  // usage_events must still be written — and written BEFORE that failing
  // insert is even attempted — or the delete becomes a way to dodge the
  // token charge for the turn that was just streamed to the client.
  it("still records usage_events when the conversation was deleted mid-turn (messages insert FK-fails)", async () => {
    sqlHandlers.push((text) => {
      if (text.includes("INSERT INTO usage_events")) return [];
      if (text.includes("INSERT INTO messages") && text.includes("RETURNING id")) {
        throw new Error("insert or update on table \"messages\" violates foreign key constraint");
      }
      return undefined;
    });
    const done = {
      type: "done", content: "answer", usage: { input: 50, output: 20 },
      generationId: "gen-3", toolCalls: [], lengthCapped: false, transcript: [], checksMeta: [],
    };

    await persistAssistant("user-1", "conv-deleted", done as any, 10);

    const usageInserts = queryLog.filter((q) => q.text.includes("INSERT INTO usage_events"));
    expect(usageInserts).toHaveLength(1);
    expect(usageInserts[0].values).toEqual(["user-1", "conv-deleted", 50, 20]);
    // No checks/UPDATE writes — there's no messages row to hang them off.
    expect(queryLog.some((q) => q.text.includes("UPDATE conversations"))).toBe(false);
  });

  // Tighter race: the conversation is already gone by the time even the
  // usage_events insert runs (its own conv_id FK fails). Falls back to a
  // conversation_id=NULL row — provenance-only field, see migration 017 —
  // rather than losing the quota charge entirely.
  it("falls back to a conversation_id=NULL usage_events row when even that insert FK-fails", async () => {
    let usageAttempts = 0;
    sqlHandlers.push((text) => {
      if (text.includes("INSERT INTO usage_events")) {
        usageAttempts++;
        if (usageAttempts === 1) {
          throw new Error("insert or update on table \"usage_events\" violates foreign key constraint");
        }
        return [];
      }
      if (text.includes("INSERT INTO messages") && text.includes("RETURNING id")) {
        throw new Error("insert or update on table \"messages\" violates foreign key constraint");
      }
      return undefined;
    });
    const done = {
      type: "done", content: "answer", usage: { input: 12, output: 8 },
      generationId: "gen-4", toolCalls: [], lengthCapped: false, transcript: [], checksMeta: [],
    };

    await persistAssistant("user-1", "conv-gone", done as any, 10);

    const usageInserts = queryLog.filter((q) => q.text.includes("INSERT INTO usage_events"));
    expect(usageInserts).toHaveLength(2);
    expect(usageInserts[1].values).toEqual(["user-1", null, 12, 8]);
  });
});
