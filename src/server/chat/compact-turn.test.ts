// compactTurn unit tests. Mocks ../db.ts with the queryLog-capturing sql mock
// chat.test.ts/title.test.ts use, and takes advantage of compactTurn's
// injectable `call: JsonCall` so no client or network mocking is needed.
import { afterEach, describe, expect, it, mock } from "bun:test";
import { toUuidArrayLiteral, fromUuidArray } from "../pg-array.ts";
import type { JsonCall } from "./llm.ts";
import { COMPACT_TAIL, clearSummaryFailure, noteSummaryFailure, type ReplayRow } from "./context-compact.ts";
import { clearContextOverflow } from "./context-overflow.ts";

type Row = Record<string, unknown>;
let queryLog: { text: string; values: unknown[] }[] = [];

function sqlMockFn(strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]> {
  queryLog.push({ text: strings.join("¶"), values });
  return Promise.resolve([]);
}

mock.module("../db.ts", () => ({
  sql: sqlMockFn,
  dbTarget: () => "mock-db",
  waitForDb: () => Promise.resolve(),
  toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
  // Real impls, never re-stubbed — see pg-array.ts and
  // scripts/aux/audit-mock-modules.mjs.
  toUuidArrayLiteral,
  fromUuidArray,
}));

const { compactTurn, compactionInFlight } = await import("./compact-turn.ts");

const obs = { distinctId: "c", traceId: "t", properties: {} };
const row = (id: string, role: string, content: string): ReplayRow => ({ id, role, content });
const rows = (n: number, chars = 10): ReplayRow[] =>
  Array.from({ length: n }, (_, i) => row(`m${i}`, i % 2 === 0 ? "user" : "assistant", "x".repeat(chars)));

const summarizes = (text: string): JsonCall => async () => ({
  text: JSON.stringify({ summary: text }),
  usage: { input: 1, output: 1 },
  generationId: "gen-sum",
  latencyMs: 1,
});

/** Never resolves, so the conversation stays mid-compaction for the assertion. */
const hangs = (): JsonCall => () => new Promise(() => {});

afterEach(() => {
  queryLog = [];
});

describe("compactTurn", () => {
  it("stores the summary and its cursor in ONE statement and returns the shortened replay", async () => {
    const conv = "conv-store";
    clearSummaryFailure(conv);
    const input = rows(COMPACT_TAIL + 4);
    const out = await compactTurn({
      convId: conv,
      rows: input,
      summary: null,
      call: summarizes("Earlier: the user asked about thresholds and none was resolved."),
      obs,
      force: true,
    });

    expect(out.summary).toBe("Earlier: the user asked about thresholds and none was resolved.");
    // The replay handed back is shorter than what went in — that is the point.
    expect(out.rows.length).toBeLessThan(input.length);

    const writes = queryLog.filter((q) => q.text.includes("UPDATE conversations"));
    expect(writes).toHaveLength(1);
    // Summary and cursor together, so no reader can see one without the other.
    expect(writes[0].text).toContain("summary_upto_id");
    expect(writes[0].values).toContain(out.summary);
    clearContextOverflow(conv);
  });

  it("does not start a second summarization while one is already running", async () => {
    const conv = "conv-inflight";
    clearSummaryFailure(conv);
    const input = rows(COMPACT_TAIL + 4);

    // First call is still inside the summary call and never settles.
    void compactTurn({ convId: conv, rows: input, summary: null, call: hangs(), obs, force: true });
    expect(compactionInFlight(conv)).toBe(true);

    let secondCalled = false;
    const second = await compactTurn({
      convId: conv,
      rows: input,
      summary: null,
      call: (async () => {
        secondCalled = true;
        return { text: "{}", usage: { input: 1, output: 1 }, generationId: "g", latencyMs: 1 };
      }) as JsonCall,
      obs,
      force: true,
    });

    expect(secondCalled).toBe(false);
    // Unchanged, so the turn replays the full thread rather than losing it.
    expect(second.summary).toBeNull();
    expect(second.rows).toBe(input);
    expect(queryLog.filter((q) => q.text.includes("UPDATE conversations"))).toHaveLength(0);
    // Reported as NOT attempted. chat.ts passes this as `forcedThisTurn`, so a
    // forced compaction skipped for an in-flight one must not spend the single
    // attempt per rejection — otherwise the user is told to start a new chat
    // while the summary that would have fixed the thread is still landing.
    expect(second.attempted).toBe(false);
  });

  it("releases the in-flight flag when the summary call throws, so the next turn may retry", async () => {
    const conv = "conv-throws";
    clearSummaryFailure(conv);
    const boom: JsonCall = async () => {
      throw new Error("provider down");
    };
    const out = await compactTurn({
      convId: conv,
      rows: rows(COMPACT_TAIL + 4),
      summary: null,
      call: boom,
      obs,
      force: true,
    });

    // A leaked flag would disable compaction for this conversation for
    // COMPACTION_IN_FLIGHT_TTL_MS — the thread would then grow unchecked.
    expect(compactionInFlight(conv)).toBe(false);
    expect(out.summary).toBeNull();
    // A call WAS made, it just failed — so this one does spend the attempt.
    expect(out.attempted).toBe(true);
    clearSummaryFailure(conv);
  });

  it("honours the failure cooldown, and force overrides it", async () => {
    const conv = "conv-cooldown";
    clearSummaryFailure(conv);
    // Sized to cross the 90% line on its own, so this exercises the ordinary
    // (unforced) path: 10 rows x 70k chars = 700k chars = 175k tokens at
    // CHARS_PER_TOKEN, +20k overhead = 195k, over 0.9 x 200k. How many CHUNKS
    // that prefix then needs is context-summary.ts's business and is tested
    // there — this asserts only whether a call was made at all.
    const big = rows(COMPACT_TAIL + 4, 70_000);
    noteSummaryFailure(conv);

    let calls = 0;
    const counting: JsonCall = async () => {
      calls++;
      return {
        text: JSON.stringify({ summary: "A summary long enough to be kept by parseSummary." }),
        usage: { input: 1, output: 1 },
        generationId: "g",
        latencyMs: 1,
      };
    };

    const cooling = await compactTurn({ convId: conv, rows: big, summary: null, call: counting, obs });
    expect(calls).toBe(0);
    expect(cooling.rows).toBe(big);
    expect(cooling.attempted).toBe(false);

    const forced = await compactTurn({ convId: conv, rows: big, summary: null, call: counting, obs, force: true });
    expect(calls).toBeGreaterThan(0);
    expect(forced.summary).toBe("A summary long enough to be kept by parseSummary.");
    clearSummaryFailure(conv);
    clearContextOverflow(conv);
  });
});
