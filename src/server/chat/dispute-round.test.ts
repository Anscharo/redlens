import { describe, expect, it } from "bun:test";
import { disputeRound, DISPUTE_TOOL_NAME } from "./dispute-round.ts";
import type { AgreedContradiction } from "./verify/disputes.ts";

const c = (over: Partial<AgreedContradiction> = {}): AgreedContradiction => ({
  answer: "They carry out operational activities on behalf of the Prime Agents they serve.",
  evidence: "GovOps actors carry out operational activities on behalf of Executor Agents.",
  why: "Subject mismatch: the sentence says Prime Agents, the atlas text says Executor Agents.",
  uuid: "76405733-0000-0000-0000-000000000000",
  ...over,
});

describe("disputeRound", () => {
  it("returns [] for no contradictions", () => {
    expect(disputeRound([])).toEqual([]);
  });

  it("emits an assistant tool_call followed by a tool result with a matching id", () => {
    const round = disputeRound([c()]);
    expect(round).toHaveLength(2);
    const [assistantMsg, toolMsg] = round;
    expect(assistantMsg.role).toBe("assistant");
    if (assistantMsg.role !== "assistant" || !("tool_calls" in assistantMsg) || !assistantMsg.tool_calls) {
      throw new Error("expected tool_calls");
    }
    expect(assistantMsg.content).toBeNull();
    expect(assistantMsg.tool_calls).toHaveLength(1);
    const call = assistantMsg.tool_calls[0]!;
    if (call.type !== "function") throw new Error("expected function tool call");
    expect(call.function.name).toBe(DISPUTE_TOOL_NAME);
    expect(toolMsg.role).toBe("tool");
    if (toolMsg.role !== "tool") throw new Error("expected tool");
    expect(toolMsg.tool_call_id).toBe(call.id);
  });

  it("includes the uuid verbatim", () => {
    const [, toolMsg] = disputeRound([c({ uuid: "abc-123-uuid" })]);
    if (toolMsg.role !== "tool") throw new Error("expected tool");
    expect(String(toolMsg.content)).toContain("Source document: abc-123-uuid");
  });

  it("omits the Source document line when uuid is null", () => {
    const [, toolMsg] = disputeRound([c({ uuid: null })]);
    if (toolMsg.role !== "tool") throw new Error("expected tool");
    expect(String(toolMsg.content)).not.toContain("Source document:");
  });

  it("frames the flag as a check result, not a ruling, with a pronoun-antecedent caution", () => {
    const [, toolMsg] = disputeRound([c()]);
    if (toolMsg.role !== "tool") throw new Error("expected tool");
    const content = String(toolMsg.content);
    expect(content).toContain("This is a check result, not a ruling, and not retrieved evidence.");
    expect(content).toContain("pronoun antecedents");
    expect(content).toContain("atlas_get");
    expect(content).toContain("Do not restate a flagged sentence unchanged.");
  });

  it("truncates long spans", () => {
    const long = "x".repeat(500);
    const [, toolMsg] = disputeRound([c({ answer: long, evidence: long })]);
    if (toolMsg.role !== "tool") throw new Error("expected tool");
    const content = String(toolMsg.content);
    expect(content).not.toContain(long);
    expect(content).toContain(`${"x".repeat(300)}…`);
  });

  it("uses singular phrasing for one dispute", () => {
    const [, toolMsg] = disputeRound([c()]);
    if (toolMsg.role !== "tool") throw new Error("expected tool");
    expect(String(toolMsg.content)).toContain("1 statement was flagged as disputed by the atlas");
  });

  it("uses plural phrasing for multiple disputes, numbering each entry", () => {
    const [, toolMsg] = disputeRound([c(), c({ uuid: null, why: "Second reason." })]);
    if (toolMsg.role !== "tool") throw new Error("expected tool");
    const content = String(toolMsg.content);
    expect(content).toContain("2 statements were flagged as disputed by the atlas");
    expect(content).toContain("1. Your sentence:");
    expect(content).toContain("2. Your sentence:");
  });
});
