// Rate-limit window tests. The bucket boundary logic (bucketBounds) is pure +
// deterministic, tested directly below. getWindowUsage's token SUM is
// DB-backed — mocked here (mirrors chat.test.ts/conversations.test.ts's
// mock.module("../db.ts"/"./db.ts") convention: register the mock BEFORE any
// static/dynamic import of the module under test, since bun:test loads every
// test file's module-level code before running any file's tests). Run under
// `bun test`.
import { afterAll, afterEach, beforeAll, describe, expect, it, test } from "bun:test";
import { toUuidArrayLiteral, fromUuidArray } from "./pg-array.ts";
import { mock } from "bun:test";

type Row = Record<string, unknown>;
let queryLog: { text: string; values: unknown[] }[] = [];
let nextRows: Row[] = [];

function sqlMockFn(strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]> {
  queryLog.push({ text: strings.join("¶"), values });
  return Promise.resolve(nextRows);
}

mock.module("./db.ts", () => ({
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

const { bucketBounds, getWindowUsage, handleUsage } = await import("./rate-limit.ts");
const { config } = await import("./config.ts");
const { signSession, SESSION_COOKIE } = await import("./session.ts");

const TWO_H = 120 * 60 * 1000;

test("2h bucket aligns to the wall clock (epoch-aligned)", () => {
  const now = Date.UTC(2026, 5, 1, 9, 30, 0); // 09:30 UTC
  const { startMs, resetsAtMs } = bucketBounds(now, TWO_H);
  expect(new Date(startMs).getUTCHours()).toBe(8); // bucket 08:00–10:00
  expect(new Date(startMs).getUTCMinutes()).toBe(0);
  expect(new Date(resetsAtMs).getUTCHours()).toBe(10);
  expect(resetsAtMs - startMs).toBe(TWO_H);
});

test("now sits inside [start, reset)", () => {
  const now = Date.UTC(2026, 5, 1, 9, 30, 0);
  const { startMs, resetsAtMs } = bucketBounds(now, TWO_H);
  expect(startMs).toBeLessThanOrEqual(now);
  expect(resetsAtMs).toBeGreaterThan(now);
});

test("on a boundary, the bucket starts exactly at now", () => {
  const now = Date.UTC(2026, 5, 1, 8, 0, 0);
  expect(bucketBounds(now, TWO_H).startMs).toBe(now);
});

test("an instant just before a boundary still maps to the current bucket", () => {
  const now = Date.UTC(2026, 5, 1, 9, 59, 59);
  const { startMs, resetsAtMs } = bucketBounds(now, TWO_H);
  expect(new Date(startMs).getUTCHours()).toBe(8);
  expect(new Date(resetsAtMs).getUTCHours()).toBe(10);
});

// Quota-reclaim exploit fix (migration 017_usage_events.sql): getWindowUsage
// used to SUM messages.input_tokens/output_tokens + message_checks.input_
// tokens/output_tokens, joined back to the user via conversations.user_id —
// both cascade-deleted by DELETE /api/chat/conversations/:id, so a
// rate-limited user could delete history to reclaim quota. It now reads a
// single append-only ledger (usage_events) that a conversation/message delete
// cannot touch (conversation_id there is ON DELETE SET NULL, never CASCADE).
describe("getWindowUsage", () => {
  afterEach(() => {
    queryLog = [];
    nextRows = [];
  });

  it("reads usage_events, not messages/message_checks", async () => {
    nextRows = [{ tokens: 0 }];
    await getWindowUsage("user-1", Date.UTC(2026, 5, 1, 9, 30, 0));
    expect(queryLog).toHaveLength(1);
    const { text } = queryLog[0];
    expect(text).toContain("FROM usage_events");
    expect(text).not.toContain("messages");
    expect(text).not.toContain("conversations");
  });

  it("filters by user_id and the bucket's start timestamp", async () => {
    nextRows = [{ tokens: 0 }];
    const now = Date.UTC(2026, 5, 1, 9, 30, 0);
    const { startMs } = bucketBounds(now, TWO_H); // matches the 120min default window
    await getWindowUsage("user-42", now);
    expect(queryLog[0].values).toEqual(["user-42", new Date(startMs)]);
  });

  it("sums the ledger's input_tokens + output_tokens into `tokens`", async () => {
    nextRows = [{ tokens: 12345 }];
    const usage = await getWindowUsage("user-1");
    expect(usage.tokens).toBe(12345);
  });

  it("treats an empty result as zero usage (COALESCE, not a crash)", async () => {
    nextRows = [];
    const usage = await getWindowUsage("user-1");
    expect(usage.tokens).toBe(0);
    expect(usage.exceeded).toBe(false);
  });
});

// GET /api/usage — the chat widget's usage meter. contextWindowTokens is the
// context-size indicator's meter ceiling (config.chatContextWindowTokens),
// added top-level alongside the existing `window` block.
describe("handleUsage", () => {
  const origJwtSecret = config.jwtSecret;
  const origManagementKey = config.openrouterManagementKey;
  beforeAll(() => {
    config.jwtSecret = "test-secret-0123456789abcdef0123456789abcdef";
    // Unset → fetchCommons short-circuits to null with no network call (see
    // credits.ts): the `global` block is irrelevant to this contract.
    config.openrouterManagementKey = "";
  });
  afterAll(() => {
    config.jwtSecret = origJwtSecret;
    config.openrouterManagementKey = origManagementKey;
  });
  afterEach(() => {
    queryLog = [];
    nextRows = [];
  });

  async function authedReq(): Promise<Request> {
    const cookie = await signSession({ id: "user-1", provider: "github" });
    return new Request("http://x/api/usage", { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } });
  }

  it("401s without a session", async () => {
    const res = await handleUsage(new Request("http://x/api/usage"));
    expect(res.status).toBe(401);
  });

  it("response carries top-level contextWindowTokens from config.chatContextWindowTokens", async () => {
    nextRows = [{ tokens: 0 }];
    const res = await handleUsage(await authedReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { window: unknown; contextWindowTokens: number };
    expect(body.contextWindowTokens).toBe(config.chatContextWindowTokens);
    expect(body.window).toBeDefined();
  });

  it("contextWindowTokens reflects a reconfigured value (not hardcoded)", async () => {
    nextRows = [{ tokens: 0 }];
    const prev = config.chatContextWindowTokens;
    // Deliberately ≠ the default (200_000) — proves handleUsage reads config
    // live rather than the test coincidentally matching a hardcoded value.
    config.chatContextWindowTokens = 1_000_000;
    try {
      const res = await handleUsage(await authedReq());
      const body = (await res.json()) as { contextWindowTokens: number };
      expect(body.contextWindowTokens).toBe(1_000_000);
    } finally {
      config.chatContextWindowTokens = prev;
    }
  });
});
