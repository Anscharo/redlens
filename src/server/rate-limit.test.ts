// Rate-limit window tests. The bucket boundary logic (bucketBounds) is pure +
// deterministic, tested directly below. getWindowUsage's token SUM is
// DB-backed — mocked here (mirrors chat.test.ts/conversations.test.ts's
// mock.module("../db.ts"/"./db.ts") convention: register the mock BEFORE any
// static/dynamic import of the module under test, since bun:test loads every
// test file's module-level code before running any file's tests). Run under
// `bun test`.
import { afterEach, describe, expect, it, test } from "bun:test";
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
}));

const { bucketBounds, getWindowUsage } = await import("./rate-limit.ts");

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
