// title.ts unit tests: parseTitle (pure), buildTitleTranscript (pure), and
// titleConversation (mocks ../db.ts the way chat.test.ts does — a
// queryLog-capturing sql mock — and takes advantage of titleConversation's
// injectable `call: JsonCall` param, mirroring verify/verifier.test.ts's
// fakeCall pattern, so no OpenAI client / network mocking is needed here).
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from "bun:test";

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
  toUuidArrayLiteral: (ids: readonly string[]) => `{${ids.join(",")}}`,
}));

const { parseTitle, buildTitleTranscript, titleConversation } = await import("./title.ts");
const { config } = await import("../config.ts");
import type { JsonCall } from "./llm.ts";

afterAll(() => {
  mock.restore();
});

const origTitleModel = config.chatTitleModel;
beforeAll(() => {
  config.chatTitleModel = "test/title-model";
});
afterAll(() => {
  config.chatTitleModel = origTitleModel;
});

afterEach(() => {
  queryLog = [];
  sqlHandlers = [];
});

describe("parseTitle", () => {
  it("parses bare JSON", () => {
    expect(parseTitle('{"title":"Facilitator Rewards Overview"}')).toBe("Facilitator Rewards Overview");
  });

  it("parses fenced JSON", () => {
    expect(parseTitle('```json\n{"title":"Facilitator Rewards Overview"}\n```')).toBe("Facilitator Rewards Overview");
  });

  it("falls back to raw text when the response isn't JSON", () => {
    expect(parseTitle("Facilitator Rewards Overview")).toBe("Facilitator Rewards Overview");
  });

  it("strips wrapping quotes", () => {
    expect(parseTitle('"Facilitator Rewards Overview"')).toBe("Facilitator Rewards Overview");
    expect(parseTitle("'Facilitator Rewards Overview'")).toBe("Facilitator Rewards Overview");
  });

  it("truncates to 6 words", () => {
    expect(parseTitle('{"title":"This Is A Very Long Title With Many Extra Words"}')).toBe("This Is A Very Long Title");
  });

  it("returns null for garbage/empty input", () => {
    expect(parseTitle("")).toBeNull();
    expect(parseTitle("   ")).toBeNull();
    expect(parseTitle('{"title":""}')).toBeNull();
  });
});

describe("buildTitleTranscript", () => {
  it("joins role: content lines", () => {
    const t = buildTitleTranscript([{ role: "user", content: "What is the Accessibility Scope?" }], "It is a core scope.");
    expect(t).toContain("user: What is the Accessibility Scope?");
    expect(t).toContain("assistant: It is a core scope.");
  });

  it("keeps the first user message even when a long history would push it out of the window", () => {
    const history = [
      { role: "user", content: "the very first question that anchors the topic" },
      ...Array.from({ length: 20 }, (_, i) => ({ role: i % 2 === 0 ? "assistant" : "user", content: "x".repeat(300) })),
    ];
    const t = buildTitleTranscript(history, "final answer");
    expect(t).toContain("the very first question that anchors the topic");
  });

  it("stays under the ~2k cap for a long, verbose conversation", () => {
    const history = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "word ".repeat(500), // ~2500 chars per message
    }));
    const t = buildTitleTranscript(history, "word ".repeat(500));
    expect(t.length).toBeLessThanOrEqual(2_500);
  });

  it("stays capped when a later (non-first) turn is oversized", () => {
    // windowHistory always admits its NEWEST row unconditionally (the
    // kept.length===0 escape on its first loop iteration), and that newest
    // row is whatever the caller's most recent message is. In chat.ts's real
    // call site, `history` includes the just-inserted current-turn user
    // message, which is allowed up to MAX_MESSAGE_BYTES (28_000) — so a turn
    // AFTER the first one (where the oversized message isn't firstUser, and
    // therefore isn't caught by the 200-char anchor slice) is the case that
    // actually exercises windowHistory's unconditional-admission gap. A
    // single-message conversation would NOT exercise this: with only one
    // message, it's always classified as firstUser and capped by
    // FIRST_USER_MAX_CHARS before windowHistory ever sees it.
    const history = [
      { role: "user", content: "short first question" },
      { role: "assistant", content: "short reply" },
      { role: "user", content: "x".repeat(28_000) }, // this turn's oversized question
    ];
    const t = buildTitleTranscript(history, "a short answer");
    expect(t.length).toBeLessThanOrEqual(2_500);
  });
});

describe("titleConversation", () => {
  const fakeCall = (text: string): JsonCall =>
    async () => ({ text, usage: { input: 10, output: 5 }, generationId: "gen-t", latencyMs: 5 });

  it("no-ops when the model slot is empty", async () => {
    const saved = config.chatTitleModel;
    config.chatTitleModel = "";
    try {
      const boom: JsonCall = async () => {
        throw new Error("should never be called");
      };
      await titleConversation("conv-1", "user: hi\n\nassistant: hello", undefined, boom);
      expect(queryLog.some((q) => q.text.includes("UPDATE conversations SET title"))).toBe(false);
    } finally {
      config.chatTitleModel = saved;
    }
  });

  it("guards the UPDATE with title_source <> 'user'", async () => {
    await titleConversation("conv-1", "user: hi\n\nassistant: hello", undefined, fakeCall('{"title":"Accessibility Scope Basics"}'));
    const update = queryLog.find((q) => q.text.includes("UPDATE conversations SET title"));
    expect(update).toBeDefined();
    expect(update!.text).toContain("title_source <> 'user'");
    expect(update!.text).toContain("title_source = 'auto'");
  });

  it("swallows a transport throw without rejecting", async () => {
    const boom: JsonCall = async () => {
      throw new Error("provider 500");
    };
    await expect(titleConversation("conv-1", "user: hi", undefined, boom)).resolves.toBeUndefined();
    expect(queryLog.some((q) => q.text.includes("UPDATE conversations SET title"))).toBe(false);
  });

  it("swallows a timeout without rejecting", async () => {
    const saved = config.chatTitleTimeoutMs;
    config.chatTitleTimeoutMs = 5;
    const hang: JsonCall = () => new Promise(() => {}); // never resolves
    try {
      await expect(titleConversation("conv-1", "user: hi", undefined, hang)).resolves.toBeUndefined();
    } finally {
      config.chatTitleTimeoutMs = saved;
    }
    expect(queryLog.some((q) => q.text.includes("UPDATE conversations SET title"))).toBe(false);
  });

  it("never writes a message_checks row", async () => {
    await titleConversation("conv-1", "user: hi", undefined, fakeCall('{"title":"Accessibility Scope Basics"}'));
    expect(queryLog.some((q) => q.text.includes("message_checks"))).toBe(false);
  });

  it("leaves the title alone when the response is unparseable", async () => {
    await titleConversation("conv-1", "user: hi", undefined, fakeCall("   "));
    expect(queryLog.some((q) => q.text.includes("UPDATE conversations SET title"))).toBe(false);
  });
});
