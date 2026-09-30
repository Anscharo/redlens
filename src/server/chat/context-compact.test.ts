import { describe, expect, it } from "bun:test";
import type { JsonCall } from "./llm.ts";
import {
  COMPACT_RATIO,
  COMPACT_TAIL,
  CONTEXT_OVERHEAD_TOKENS,
  clearSummaryFailure,
  compactForReplay,
  noteSummaryFailure,
  SUMMARY_FAILURE_COOLDOWN_MS,
  summaryCoolingDown,
  historyReplay,
  needsCompaction,
  planCompaction,
  replayTokens,
  rowsAfterCursor,
  SUMMARY_ACK,
  summaryReplay,
  COMPACT_TAIL_FORCED,
  type ReplayRow,
} from "./context-compact.ts";
import { evidenceFromTranscript, priorTurnsEvidence } from "./verify/verifier.ts";

const row = (id: string, role: string, content: string): ReplayRow => ({ id, role, content });

describe("historyReplay", () => {
  it("keeps a long early answer verbatim", () => {
    const early = "Lead.\n\n" + "detail ".repeat(500);
    const msgs = historyReplay([
      row("1", "user", "q"),
      row("2", "assistant", early),
      row("3", "user", "follow up"),
    ]);
    expect(msgs.map((m) => m.content).join("\n")).toContain(early);
    expect(msgs.map((m) => m.content).join("\n")).not.toContain("truncated");
  });

  it("expands a stored lookup card ahead of the answer", () => {
    const msgs = historyReplay([
      {
        id: "2",
        role: "assistant",
        content: "The address is on ethereum.",
        toolCalls: [{
          name: "atlas_get_address",
          args: { address: "0xabc" },
          ok: true,
          bytes: 10,
          recall: "atlas_get_address\n- address=0xabc",
          recall_id: "rcall_fixed",
        }],
      },
    ]);
    expect(msgs.map((m) => m.role)).toEqual(["assistant", "tool", "assistant"]);
    expect(msgs[1]).toMatchObject({ role: "tool", tool_call_id: "rcall_fixed" });
    expect(msgs[2]).toMatchObject({ role: "assistant", content: "The address is on ethereum." });
  });
});

describe("needsCompaction", () => {
  it("stays quiet under 90% of the window and fires at the line", () => {
    const rows = Array.from({ length: COMPACT_TAIL + 2 }, (_, i) => row(String(i), i % 2 ? "assistant" : "user", "q"));
    const window = 1_000;
    const overhead = 100;
    expect(needsCompaction(null, rows, window, overhead)).toBe(false);
    const fat = rows.map((r, i) => (i === 0 ? { ...r, content: "x".repeat(4_000) } : r));
    const tokens = replayTokens(null, fat) + overhead;
    expect(tokens).toBeGreaterThanOrEqual(window * COMPACT_RATIO);
    expect(needsCompaction(null, fat, window, overhead)).toBe(true);
  });

  it("does not compact a tail-only thread even when one message is large", () => {
    const rows = [row("1", "user", "x".repeat(50_000))];
    expect(needsCompaction(null, rows, 1_000, 0)).toBe(false);
  });

  it("counts the standing overhead toward the line", () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(String(i), "user", "short"));
    const tokens = replayTokens(null, rows);
    const window = Math.floor((tokens + CONTEXT_OVERHEAD_TOKENS) / COMPACT_RATIO);
    expect(needsCompaction(null, rows, window)).toBe(true);
    expect(needsCompaction(null, rows, window * 2)).toBe(false);
  });
});

describe("planCompaction", () => {
  it("folds the prefix and keeps the tail, including the current question", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`id-${i}`, i % 2 ? "assistant" : "user", `m${i}`));
    const plan = planCompaction(rows);
    expect(plan).not.toBeNull();
    expect(plan!.tail).toHaveLength(COMPACT_TAIL);
    expect(plan!.tail.at(-1)?.content).toBe("m9");
    expect(plan!.fold).toHaveLength(10 - COMPACT_TAIL);
    expect(plan!.uptoId).toBe("id-3");
  });

  it("returns null without an id to point the cursor at", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));
    expect(planCompaction(rows)).toBeNull();
  });
});

describe("rowsAfterCursor", () => {
  it("drops through the folded message and keeps everything after", () => {
    const rows = [row("a", "user", "1"), row("b", "assistant", "2"), row("c", "user", "3")];
    expect(rowsAfterCursor(rows, "b").map((r) => r.id)).toEqual(["c"]);
  });

  it("replays everything when the cursor does not match a row", () => {
    const rows = [row("a", "user", "1")];
    expect(rowsAfterCursor(rows, "missing")).toEqual(rows);
    expect(rowsAfterCursor(rows, null)).toEqual(rows);
  });
});

describe("summaryReplay", () => {
  it("is a stable pair whose acknowledgement the verifier ignores", () => {
    const [user, ack] = summaryReplay("The freezer was discussed.");
    expect(user.role).toBe("user");
    expect(String(user.content)).toContain("The freezer was discussed.");
    expect(ack).toEqual({ role: "assistant", content: SUMMARY_ACK });
    const transcript = [
      user,
      ack,
      { role: "user" as const, content: "what else?" },
    ];
    expect(priorTurnsEvidence(transcript)).toBeNull();
  });
});

describe("compactForReplay", () => {
  const call: JsonCall = async () => ({
    text: '{"summary":"User asked about the freezer. UUID abc. Still open: the threshold."}',
    usage: { input: 10, output: 10 },
    generationId: "gen-sum",
    latencyMs: 1,
  });

  it("replaces the prefix once and leaves the tail verbatim", async () => {
    // Sized like a real thread rather than a toy one: the six rows left
    // verbatim have to fit under the line, or planWithinLine shrinks the tail
    // (covered separately below).
    const rows = Array.from({ length: 8 }, (_, i) => row(`id-${i}`, i % 2 ? "assistant" : "user", "x".repeat(40_000)));
    const window = 80_000;
    expect(needsCompaction(null, rows, window, 0)).toBe(true);
    const out = await compactForReplay({
      rows, summary: null, windowTokens: window, overheadTokens: 0, call, model: "test-model", timeoutMs: 1_000,
    });
    expect(out.compacted).toBe(true);
    expect(out.failed).toBe(false);
    expect(out.summary).toContain("UUID abc");
    expect(out.uptoId).toBe("id-1");
    expect(out.rows.map((r) => r.id)).toEqual(rows.slice(-COMPACT_TAIL).map((r) => r.id));
    expect(out.rows.at(-1)?.content).toBe(rows.at(-1)?.content);
  });

  it("does not call the model under the line", async () => {
    let called = false;
    const boom: JsonCall = async () => {
      called = true;
      throw new Error("should not run");
    };
    const rows = [row("1", "user", "hi"), row("2", "assistant", "hello")];
    const out = await compactForReplay({
      rows, summary: null, windowTokens: 200_000, call: boom, model: "test-model", timeoutMs: 1_000,
    });
    expect(called).toBe(false);
    expect(out.compacted).toBe(false);
    expect(out.rows).toBe(rows);
  });

  it("folds under the line when forced, keeping the shorter tail", async () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(`id-${i}`, i % 2 ? "assistant" : "user", "short"));
    expect(needsCompaction(null, rows, 200_000)).toBe(false);
    const out = await compactForReplay({
      rows, summary: null, windowTokens: 200_000, call, model: "test-model", timeoutMs: 1_000, force: true,
    });
    expect(out.compacted).toBe(true);
    expect(out.rows).toHaveLength(COMPACT_TAIL_FORCED);
    expect(out.rows.at(-1)?.id).toBe("id-7");
    expect(out.uptoId).toBe("id-5");
  });

  it("folds an oversized prefix oldest-first into one summary", async () => {
    const seen: string[] = [];
    const chunked: JsonCall = async (req) => {
      const user = req.messages.find((m) => m.role === "user");
      seen.push(typeof user?.content === "string" ? user.content : "");
      return {
        text: `{"summary":"chunk-${seen.length}"}`,
        usage: { input: 1, output: 1 },
        generationId: "gen-chunk",
        latencyMs: 1,
      };
    };
    // 12 rows so the six-row tail still fits while the six-row fold is larger
    // than one summarization budget (windowTokens * 0.7 * 4 chars).
    const rows = Array.from({ length: 12 }, (_, i) => row(`id-${i}`, "user", "y".repeat(50_000)));
    const out = await compactForReplay({
      rows, summary: null, windowTokens: 100_000, overheadTokens: 0, call: chunked, model: "m", timeoutMs: 1_000,
    });
    expect(out.compacted).toBe(true);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[1]).toContain("Previous summary:");
    expect(seen[1]).toContain("chunk-1");
    expect(out.summary).toBe(`chunk-${seen.length}`);
    expect(out.rows).toHaveLength(COMPACT_TAIL);
  });

  it("shrinks the tail when the rows it would keep verbatim are over the line themselves", async () => {
    // Ten messages at the per-message cap against a small configured window:
    // folding "everything but six" would leave a prompt the provider rejects
    // again, and no later fold could fix it. The tail shrinks instead, and the
    // question being answered always survives.
    const rows = Array.from({ length: 10 }, (_, i) => row(`id-${i}`, i % 2 ? "assistant" : "user", "x".repeat(28_000)));
    const out = await compactForReplay({
      rows, summary: null, windowTokens: 20_000, overheadTokens: 0, call, model: "test-model", timeoutMs: 1_000,
    });
    expect(out.compacted).toBe(true);
    expect(out.rows.length).toBeLessThan(COMPACT_TAIL);
    expect(out.rows.at(-1)?.id).toBe("id-9");
  });

  it("keeps the full thread when the summary call fails", async () => {
    const fail: JsonCall = async () => {
      throw new Error("timeout");
    };
    const rows = Array.from({ length: 8 }, (_, i) => row(`id-${i}`, "user", "x".repeat(2_000)));
    const out = await compactForReplay({
      rows, summary: "prior", windowTokens: 100, overheadTokens: 0, call: fail, model: "test-model", timeoutMs: 1_000,
    });
    expect(out.compacted).toBe(false);
    expect(out.failed).toBe(true);
    expect(out.rows).toBe(rows);
    expect(out.summary).toBe("prior");
  });

  it("marks an unparseable summary as a failure without dropping the thread", async () => {
    const junk: JsonCall = async () => ({
      text: "nope",
      usage: { input: 1, output: 1 },
      generationId: "gen-junk",
      latencyMs: 1,
    });
    const rows = Array.from({ length: 8 }, (_, i) => row(`id-${i}`, "user", "x".repeat(2_000)));
    const out = await compactForReplay({
      rows, summary: null, windowTokens: 100, overheadTokens: 0, call: junk, model: "test-model", timeoutMs: 1_000,
    });
    expect(out.failed).toBe(true);
    expect(out.compacted).toBe(false);
    expect(out.rows).toBe(rows);
  });
});

describe("summary failure cooldown", () => {
  it("skips another attempt until the cooldown elapses, then forgets it", () => {
    const conv = "conv-summary-backoff-wait";
    clearSummaryFailure(conv);
    expect(summaryCoolingDown(conv, 1_000)).toBe(false);
    noteSummaryFailure(conv, 1_000);
    expect(summaryCoolingDown(conv, 1_000 + 60_000)).toBe(true);
    expect(summaryCoolingDown(conv, 1_000 + SUMMARY_FAILURE_COOLDOWN_MS)).toBe(false);
    expect(summaryCoolingDown(conv, 1_000 + SUMMARY_FAILURE_COOLDOWN_MS + 1)).toBe(false);
  });

  it("a cleared failure is eligible immediately", () => {
    const conv = "conv-summary-backoff-clear";
    noteSummaryFailure(conv, 5_000);
    clearSummaryFailure(conv);
    expect(summaryCoolingDown(conv, 5_001)).toBe(false);
  });
});

describe("verifier and recall cards", () => {
  it("does not treat a replayed lookup card as atlas evidence", () => {
    const transcript = [
      { role: "user" as const, content: "q" },
      {
        role: "assistant" as const,
        content: null,
        tool_calls: [{ id: "rcall_fixed", type: "function" as const, function: { name: "atlas_get", arguments: "{}" } }],
      },
      { role: "tool" as const, tool_call_id: "rcall_fixed", content: "atlas_get\n- id=abc\nRe-call atlas_get for the full result before quoting it." },
      { role: "assistant" as const, content: "answer" },
    ];
    expect(evidenceFromTranscript(transcript)).toEqual([]);
  });

  it("does not treat a hyphen-free recall id as atlas evidence", () => {
    const id = "rcall0123456789abcdef0123";
    const transcript = [
      { role: "user" as const, content: "q" },
      {
        role: "assistant" as const,
        content: null,
        tool_calls: [{ id, type: "function" as const, function: { name: "atlas_get", arguments: "{}" } }],
      },
      { role: "tool" as const, tool_call_id: id, content: "atlas_get\n- id=abc\nRe-call atlas_get for the full result before quoting it." },
      { role: "assistant" as const, content: "answer" },
    ];
    expect(evidenceFromTranscript(transcript)).toEqual([]);
  });
});
