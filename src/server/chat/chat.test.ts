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
import { toUuidArrayLiteral, fromUuidArray } from "../pg-array.ts";

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
  // Real impls, never re-stubbed: `Array.isArray("{uuid,uuid}")` is false, so a
  // hand-rolled stub silently returns [] for what Bun.sql actually hands back.
  // See pg-array.ts; enforced by scripts/aux/audit-mock-modules.mjs.
  toUuidArrayLiteral,
  fromUuidArray,
}));

// NOTE on title.ts: deliberately NOT mocked via mock.module here. A
// mock.module("./title.ts", ...) registered here would permanently replace the
// module for every test file bun loads AFTER this one — potentially including
// title.test.ts's own `await import("./title.ts")`, which needs the real thing
// since title.ts is what IT tests. Two things verified empirically on bun
// 1.3.11: mock.restore() does NOT undo mock.module (that's only for
// mock.fn()/spyOn), so there is no way to "unmock" it later in this file; and
// bun does not order test files alphabetically — it walks them in directory
// order, which differs between checkouts — so "title.test.ts happens to run
// first here" is luck, not a guarantee. Instead, titling is controlled via
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
  let savedJudgeModel: string;

  afterAll(() => {
    // Restore config mutations so later files don't inherit a truthy
    // openrouterApiKey (which activates embed's network path) — process-global under bun.
    config.jwtSecret = savedJwtSecret;
    config.openrouterApiKey = savedOpenrouterKey;
    config.chatTitleModel = savedTitleModel;
    config.chatSmalltalkJudgeModel = savedJudgeModel;
  });

  beforeAll(() => {
    savedJwtSecret = config.jwtSecret;
    savedOpenrouterKey = config.openrouterApiKey;
    savedTitleModel = config.chatTitleModel;
    savedJudgeModel = config.chatSmalltalkJudgeModel;
    config.jwtSecret ||= "test-jwt-secret";
    config.openrouterApiKey ||= "test-key";
    // Off by default for every pre-existing test (see the file-header note on
    // title.ts): titleConversation's first line is `if (!model) return;`, so
    // this makes it an unconditional no-op — no network call, nothing to race
    // against the per-test fetch mock swaps below. The "titling" describe
    // block turns it back on for its own tests.
    config.chatTitleModel = "";
    // Same reason, judge slot (defaults ON in config): a concurrent
    // smalltalk-judge call on a marker-free first message would consume one
    // of a test's scripted SSE rounds. Bypass behavior is covered in
    // chat-orchestrator.test.ts, not here.
    config.chatSmalltalkJudgeModel = "";
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

  // Chunk-array SSE builder for scripting multi-event rounds (staged-delivery
  // tests): each entry is one `data:` frame, closed with [DONE].
  function sseChunksResponse(chunks: unknown[]): Response {
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

  // Each call to fetch returns the NEXT queued round's SSE response (one
  // round = one HTTP request in chat-loop.ts) — the last round repeats if
  // fetch is called more times than there are rounds. Lets a test script a
  // tool round followed by an answer round through the REAL openai client.
  function multiRoundSse(rounds: unknown[][]): typeof fetch {
    let i = 0;
    return (async () => sseChunksResponse(rounds[Math.min(i++, rounds.length - 1)])) as unknown as typeof fetch;
  }

  async function events(res: Response): Promise<any[]> {
    const text = await res.text();
    return text
      .split("\n\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => JSON.parse(l.slice("data: ".length)));
  }

  // Facts inject knowledge before the model runs (src/server/facts). The turn
  // has to SAY so: a trace row per fact, and a stage the ticker shows.
  describe("facts", () => {
    it("announces the facts that fired, and the recall as a stage", async () => {
      installHappyHandlers();
      const prevImpl = g.__llmFetchCurrentImpl!;
      g.__llmFetchCurrentImpl = sseAnswer("You can read the atlas.");
      try {
        const res = await handleChat(await authedRequest({ message: "what can this app do?" }));
        const evs = await events(res);
        const facts = evs.find((e) => e.type === "facts");
        expect(facts.facts.map((s: { id: string }) => s.id)).toContain("features");
        expect(facts.facts.find((s: { id: string }) => s.id === "features").summary).toBe("the app's features guide");
        expect(facts.bytes).toBeGreaterThan(0);
        const recalled = evs.find((e) => e.type === "status" && e.stage === "recalling");
        expect(recalled.detail).toContain("Recalled");
        // Announced before any answer content, so the ticker leads with it.
        expect(evs.indexOf(facts)).toBeLessThan(evs.findIndex((e) => e.type === "token" || e.type === "done"));
      } finally {
        g.__llmFetchCurrentImpl = prevImpl;
      }
    });

    it("stays silent when no fact fires", async () => {
      installHappyHandlers();
      const prevImpl = g.__llmFetchCurrentImpl!;
      g.__llmFetchCurrentImpl = sseAnswer("Hi.");
      try {
        const res = await handleChat(await authedRequest({ message: "hello" }));
        const evs = await events(res);
        expect(evs.some((e) => e.type === "facts")).toBe(false);
        expect(evs.some((e) => e.stage === "recalling")).toBe(false);
      } finally {
        g.__llmFetchCurrentImpl = prevImpl;
      }
    });
  });

  describe("delivery mode", () => {
    it("meta carries the effective delivery mode, defaulting to streaming", async () => {
      installHappyHandlers();
      const prevImpl = g.__llmFetchCurrentImpl!;
      g.__llmFetchCurrentImpl = sseAnswer("Hi.");
      try {
        const res = await handleChat(await authedRequest({ message: "hello" }));
        const [meta] = await events(res);
        expect(meta.delivery).toBe("streaming");
      } finally {
        g.__llmFetchCurrentImpl = prevImpl;
      }
    });

    it("body.delivery overrides the configured default", async () => {
      installHappyHandlers();
      const prevImpl = g.__llmFetchCurrentImpl!;
      g.__llmFetchCurrentImpl = sseAnswer("Hi.");
      try {
        const res = await handleChat(await authedRequest({ message: "hello", delivery: "staged" }));
        const [meta] = await events(res);
        expect(meta.delivery).toBe("staged");
      } finally {
        g.__llmFetchCurrentImpl = prevImpl;
      }
    });

    it("staged mode, simple turn (no tools): no tokens, exactly one synthesizing status, finalizing right before done", async () => {
      installHappyHandlers();
      const prevImpl = g.__llmFetchCurrentImpl!;
      g.__llmFetchCurrentImpl = sseAnswer("Hi there.");
      try {
        const res = await handleChat(await authedRequest({ message: "hello", delivery: "staged" }));
        const evs = await events(res);
        expect(evs.some((e) => e.type === "token")).toBe(false);
        expect(evs.filter((e) => e.type === "status" && e.stage === "synthesizing")).toHaveLength(1);
        const doneIdx = evs.findIndex((e) => e.type === "done");
        expect(evs[doneIdx - 1]).toMatchObject({ type: "status", stage: "finalizing" });
        expect(evs[doneIdx].content).toBe("Hi there.");
      } finally {
        g.__llmFetchCurrentImpl = prevImpl;
      }
    });

    it("an invalid body.delivery falls back to the configured default instead of erroring", async () => {
      installHappyHandlers();
      const prevImpl = g.__llmFetchCurrentImpl!;
      g.__llmFetchCurrentImpl = sseAnswer("Hi.");
      try {
        const res = await handleChat(await authedRequest({ message: "hello", delivery: "yolo" }));
        expect(res.status).toBe(200);
        const [meta] = await events(res);
        expect(meta.delivery).toBe("streaming"); // config default, unchanged by the bogus value
      } finally {
        g.__llmFetchCurrentImpl = prevImpl;
      }
    });

    it("config.chatDeliveryMode supplies the default when body omits delivery", async () => {
      installHappyHandlers();
      const prevMode = config.chatDeliveryMode;
      config.chatDeliveryMode = "staged";
      const prevImpl = g.__llmFetchCurrentImpl!;
      g.__llmFetchCurrentImpl = sseAnswer("Hi.");
      try {
        const res = await handleChat(await authedRequest({ message: "hello" }));
        const [meta] = await events(res);
        expect(meta.delivery).toBe("staged");
      } finally {
        g.__llmFetchCurrentImpl = prevImpl;
        config.chatDeliveryMode = prevMode;
      }
    });

    it("streaming mode (default) emits token events end to end with no synthesizing/finalizing statuses", async () => {
      installHappyHandlers();
      const prevImpl = g.__llmFetchCurrentImpl!;
      g.__llmFetchCurrentImpl = sseAnswer("Hello from the atlas.");
      try {
        const res = await handleChat(await authedRequest({ message: "What's new?", delivery: "streaming" }));
        const evs = await events(res);
        const tokenText = evs.filter((e) => e.type === "token").map((e) => e.text).join("");
        expect(tokenText).toBe("Hello from the atlas.");
        expect(evs.some((e) => e.type === "clear")).toBe(false);
        expect(evs.some((e) => e.type === "status" && (e.stage === "synthesizing" || e.stage === "finalizing"))).toBe(false);
        expect(evs.find((e) => e.type === "done").content).toBe("Hello from the atlas.");
      } finally {
        g.__llmFetchCurrentImpl = prevImpl;
      }
    });

    it("staged mode suppresses token+clear, announces one synthesizing status per generation burst, and finalizes right before done", async () => {
      installHappyHandlers();
      // Round 1: pre-tool content ("Thinking...", discarded via `clear`) then a
      // tool call — a real, no-network tool (see chat-orchestrator.test.ts's
      // use of the same call). Round 2: the final answer, no more tools.
      const round1 = [
        { id: "gen-r1", choices: [{ index: 0, delta: { content: "Thinking..." }, finish_reason: null }] },
        {
          id: "gen-r1",
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "atlas_describe", arguments: "{}" } }] },
              finish_reason: null,
            },
          ],
        },
        { id: "gen-r1", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
        { id: "gen-r1", choices: [], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } },
      ];
      const round2 = [
        { id: "gen-r2", choices: [{ index: 0, delta: { content: "Final answer." }, finish_reason: null }] },
        { id: "gen-r2", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
        { id: "gen-r2", choices: [], usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 } },
      ];
      const prevImpl = g.__llmFetchCurrentImpl!;
      g.__llmFetchCurrentImpl = multiRoundSse([round1, round2]);
      try {
        const res = await handleChat(await authedRequest({ message: "Describe the atlas structure using a lookup.", delivery: "staged" }));
        const evs = await events(res);

        expect(evs.some((e) => e.type === "token")).toBe(false);
        expect(evs.some((e) => e.type === "clear")).toBe(false);

        const synthIdx = evs.map((e, i) => (e.type === "status" && e.stage === "synthesizing" ? i : -1)).filter((i) => i >= 0);
        expect(synthIdx).toHaveLength(2); // one per burst: pre-tool noise, then the real answer

        const toolCallIdx = evs.findIndex((e) => e.type === "tool_call");
        expect(toolCallIdx).toBeGreaterThan(-1);
        expect(synthIdx[0]).toBeLessThan(toolCallIdx); // burst 1 announced before the tool round
        expect(synthIdx[1]).toBeGreaterThan(toolCallIdx); // burst 2 announced after it (tool_call reset the burst)

        const doneIdx = evs.findIndex((e) => e.type === "done");
        expect(doneIdx).toBeGreaterThan(0);
        expect(evs[doneIdx - 1]).toMatchObject({ type: "status", stage: "finalizing" });
        expect(evs[doneIdx].content).toBe("Final answer.");
      } finally {
        g.__llmFetchCurrentImpl = prevImpl;
      }
    });
  });

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
  function installHappyHandlers(
    opts: { convId?: string; tokens?: number; priorAssistants?: number; userText?: string } = {},
  ) {
    const convId = opts.convId ?? "conv-1";
    const history = [
      // userText lets the titling suite stamp a per-turn marker into the first
      // user row: buildTitleTranscript carries that row through verbatim, so
      // the marker reaches the titling request body and a captured call can be
      // attributed to the exact turn that produced it (see runTurn below).
      { role: "user", content: opts.userText ?? "hi" },
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
      // contextTokens survives sanitizeDone onto the wire (sseResponse's fixture
      // usage chunk carries prompt_tokens: 5) — the pinned wire contract's SSE point.
      expect(done.contextTokens).toBe(5);
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
    type TitleCall = { model: string; messages: unknown[] };

    // ONE cumulative capture for the whole block, installed for the block's
    // lifetime rather than swapped per turn. The previous per-turn swap was
    // the source of a real flake: titling is fire-and-forget, so a turn that
    // DID fire could have its call land after its own runTurn() returned and
    // be recorded against the NEXT turn's freshly-installed array — turning
    // "turn 4 fires" into "turn 5 also fired". Under CPU contention that
    // reproduced on ~10/12 full-suite runs. Every call now lands in one list
    // and is attributed by the per-turn marker it carries, so a late arrival
    // can only ever be credited to the turn that actually produced it.
    const allTitleCalls: TitleCall[] = [];
    let prevImpl: typeof fetch | undefined;
    let turnSeq = 0;

    beforeAll(() => {
      config.chatTitleModel = "test/title-model";
      prevImpl = g.__llmFetchCurrentImpl;
      g.__llmFetchCurrentImpl = (async (_url: unknown, init?: RequestInit) => {
        const parsed = init?.body
          ? (JSON.parse(init.body as string) as { stream?: boolean; model: string; messages: unknown[] })
          : ({} as any);
        if (parsed.stream) return sseResponse("An answer.");
        // Non-streaming JSON-mode call — the titling call (the verifier is
        // the only other JSON-mode caller in chat.ts, and it stays off here
        // since config.chatVerifierModel defaults to "").
        allTitleCalls.push(parsed);
        return new Response(
          JSON.stringify({
            id: "gen-title-1",
            choices: [{ message: { content: '{"title":"A Generated Title"}' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch;
    });
    afterAll(() => {
      config.chatTitleModel = "";
      g.__llmFetchCurrentImpl = prevImpl;
    });

    function callsFor(marker: string): TitleCall[] {
      return allTitleCalls.filter((c) => JSON.stringify(c.messages).includes(marker));
    }

    // Drive one turn and return its marker. The marker is stamped into the
    // first user row of the mocked history, which buildTitleTranscript carries
    // verbatim into the titling request body.
    async function runTurn(priorAssistants: number): Promise<string> {
      const marker = `turn-marker-${++turnSeq}`;
      // sqlHandlers is a shared queue with no per-call scoping (afterEach only
      // resets it BETWEEN it() blocks) — reset it explicitly here so a test
      // that calls runTurn more than once (e.g. "does not fire on turn 2 or
      // 3") doesn't have its second call still matched by the first call's
      // stale handler.
      sqlHandlers = [];
      installHappyHandlers({ priorAssistants, userText: marker, convId: `conv-${marker}` });
      const res = await handleChat(await authedRequest({ message: "a question" }));
      await res.text(); // drains the SSE stream itself
      return marker;
    }

    // Poll (no fixed sleep) until this turn's titling call shows up. The call
    // is several real async ticks deep — callWithTimeout → the JsonCall → the
    // openai SDK's own internal awaits before it reaches fetch — and on a
    // loaded runner those ticks can take far longer than any constant we'd
    // hardcode, so wait on the condition instead of on the clock.
    async function awaitTitleCall(marker: string, timeoutMs = 10_000): Promise<TitleCall[]> {
      const deadline = Date.now() + timeoutMs;
      while (callsFor(marker).length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      return callsFor(marker);
    }

    // Proving a turn did NOT title can't be done by waiting a fixed interval —
    // that only proves "not yet". Instead use a barrier: run a control turn
    // that MUST title and wait for its call. chat.ts invokes
    // `void titleConversation(...)` synchronously before the SSE stream
    // closes, so a titling chain for the turn under test would already have
    // started before res.text() resolved — strictly before the control turn
    // began. Both chains are the same shape, so once the control's call has
    // landed, the turn's would have landed too if it were ever coming.
    async function expectNoTitle(priorAssistants: number) {
      const marker = await runTurn(priorAssistants);
      const control = await runTurn(0);
      expect(await awaitTitleCall(control)).toHaveLength(1);
      expect(callsFor(marker)).toHaveLength(0);
    }

    it("fires on turn 1 (priorAssistants=0)", async () => {
      const calls = await awaitTitleCall(await runTurn(0));
      expect(calls.length).toBe(1);
      expect(calls[0].model).toBe("test/title-model");
    });

    it("does not fire on turn 2 or 3", async () => {
      await expectNoTitle(1);
      await expectNoTitle(2);
    });

    it("fires on turn 4 (priorAssistants=3)", async () => {
      expect(await awaitTitleCall(await runTurn(3))).toHaveLength(1);
    });

    it("does not fire on turns 5 through 9", async () => {
      for (const priorAssistants of [4, 5, 6, 7, 8]) {
        await expectNoTitle(priorAssistants);
      }
    });

    it("fires on turn 10 (priorAssistants=9)", async () => {
      expect(await awaitTitleCall(await runTurn(9))).toHaveLength(1);
    });

    it("does not fire on turn 11 or later", async () => {
      await expectNoTitle(10);
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

  it("persists context_tokens on the messages row — the LAST round's prompt_tokens, not the cumulative usage.input", async () => {
    installPersistHandlers();
    const done = {
      type: "done",
      content: "answer",
      usage: { input: 3_000, output: 40 }, // cumulative across rounds
      contextTokens: 1_900, // last round only — what the shown answer actually saw
      generationId: "gen-ctx",
      toolCalls: [],
      lengthCapped: false,
      transcript: [],
      checksMeta: [],
    };

    await persistAssistant("user-1", "conv-ctx", done as any, 50);

    const msgInsert = queryLog.find((q) => q.text.includes("INSERT INTO messages") && q.text.includes("RETURNING id"));
    expect(msgInsert).toBeDefined();
    expect(msgInsert!.text).toContain("context_tokens");
    expect(msgInsert!.values).toEqual(["conv-ctx", "answer", null, 3_000, 40, 1_900, "gen-ctx", 50]);
  });

  it("persists context_tokens as null when the turn never saw a usage chunk", async () => {
    installPersistHandlers();
    const done = {
      type: "done", content: "answer", usage: { input: 0, output: 0 }, contextTokens: null,
      generationId: null, toolCalls: [], lengthCapped: false, transcript: [], checksMeta: [],
    };

    await persistAssistant("user-1", "conv-nulled", done as any, 5);

    const msgInsert = queryLog.find((q) => q.text.includes("INSERT INTO messages") && q.text.includes("RETURNING id"));
    expect(msgInsert!.values).toEqual(["conv-nulled", "answer", null, 0, 0, null, null, 5]);
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
