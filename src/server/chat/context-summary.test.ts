import { describe, expect, it } from "bun:test";
import { parseSummary, renderPrefix, summarizePrefix } from "./context-summary.ts";
import type { JsonCall } from "./llm.ts";
import type { ReplayRow } from "./context-compact.ts";

const row = (id: string, role: string, content: string): ReplayRow => ({ id, role, content });

describe("parseSummary", () => {
  it("reads the JSON summary and rejects a short non-answer", () => {
    expect(parseSummary('{"summary":"Kept the UUID abc."}')).toBe("Kept the UUID abc.");
    expect(parseSummary("nope")).toBeNull();
  });

  it("accepts fenced JSON and falls back to long prose", () => {
    expect(parseSummary('```json\n{"summary":"Fenced."}\n```')).toBe("Fenced.");
    const prose = "The user asked about the freezer and the threshold was not resolved.";
    expect(parseSummary(prose)).toBe(prose);
  });

  it("recovers the summary from a generation cut off mid-string", () => {
    // The 2048-token cap clips this call routinely, and the result is STORED
    // as the thread's prefix — the shared repair must salvage it.
    const cut = '{"summary":"The user asked about the freezer and the threshold was left open';
    expect(parseSummary(cut)).toBe("The user asked about the freezer and the threshold was left open");
  });

  it("rejects a broken JSON envelope instead of storing it as prose", () => {
    expect(parseSummary('{"summary": 12345, "note": "wrong type"}')).toBeNull();
  });
});

describe("renderPrefix", () => {
  it("carries the previous summary and each row's lookup cards", () => {
    const text = renderPrefix("Earlier: the freezer.", [
      { id: "1", role: "user", content: "and the threshold?" },
      {
        id: "2",
        role: "assistant",
        content: "It is seven.",
        toolCalls: [{ name: "atlas_get", args: {}, ok: true, bytes: 1, recall: "atlas_get\n- doc_no=A.2.7" }],
      },
    ]);
    expect(text).toContain("Previous summary:\nEarlier: the freezer.");
    expect(text).toContain("user:\nand the threshold?");
    expect(text).toContain("doc_no=A.2.7");
  });
});

describe("summarizePrefix", () => {
  const ok = (text: string): JsonCall => async () => ({
    text,
    usage: { input: 1, output: 1 },
    generationId: "gen-sum",
    latencyMs: 1,
  });

  it("returns null when the model produces nothing usable", async () => {
    const out = await summarizePrefix(null, [row("1", "user", "q")], ok("nope"), "m", 10_000, 1_000);
    expect(out).toBeNull();
  });

  it("truncates a single row that is larger than the whole budget", async () => {
    let seen = "";
    const call: JsonCall = async (req) => {
      seen = String(req.messages.find((m) => m.role === "user")?.content ?? "");
      return { text: '{"summary":"Compacted the oversized row."}', usage: { input: 1, output: 1 }, generationId: null, latencyMs: 1 };
    };
    const out = await summarizePrefix(null, [row("1", "user", "x".repeat(5_000))], call, "m", 500, 1_000);
    expect(out).toBe("Compacted the oversized row.");
    expect(seen.length).toBe(500);
  });
});
