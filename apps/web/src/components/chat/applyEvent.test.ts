import { describe, expect, it } from "vitest";
import { applyEvent } from "./applyEvent";
import type { ChatMsg } from "./chatTypes";

function baseMsg(overrides: Partial<ChatMsg> = {}): ChatMsg {
  return {
    role: "assistant",
    content: "",
    draft: "",
    generated: false,
    trace: [],
    rounds: 0,
    sources: [],
    done: false,
    ...overrides,
  };
}

describe("applyEvent token/reasoning", () => {
  it("token accumulates onto draft, not content, and clears statusLine", () => {
    const m = applyEvent(baseMsg({ statusLine: "querying…" }), { type: "token", text: "Hello " });
    expect(m.draft).toBe("Hello ");
    expect(m.content).toBe("");
    expect(m.statusLine).toBeNull();
  });

  it("reasoning accumulates onto its own field, never draft/content", () => {
    let m = baseMsg();
    m = applyEvent(m, { type: "reasoning", text: "Let me check " });
    m = applyEvent(m, { type: "reasoning", text: "the atlas." });
    expect(m.reasoning).toBe("Let me check the atlas.");
    expect(m.draft).toBe("");
    expect(m.content).toBe("");
  });
});

describe("applyEvent answer_final / done", () => {
  it("answer_final sets content, marks generated, and clears draft", () => {
    const m = applyEvent(baseMsg({ draft: "partial" }), { type: "answer_final", content: "The final answer." });
    expect(m.content).toBe("The final answer.");
    expect(m.generated).toBe(true);
    expect(m.draft).toBe("");
  });

  it("done reveals the answer even when no answer_final preceded it (early exit)", () => {
    const m = applyEvent(baseMsg({ draft: "partial" }), {
      type: "done",
      content: "Early exit answer.",
      usage: { input: 1, output: 1 },
      generationId: null,
      toolCalls: [],
    });
    expect(m.content).toBe("Early exit answer.");
    expect(m.generated).toBe(true);
    expect(m.draft).toBe("");
    expect(m.done).toBe(true);
  });

  it("done resolves a stranded 'checking' verify so it doesn't spin forever", () => {
    const m = applyEvent(
      baseMsg({ verify: { status: "checking", contradictions: [], notFound: [], rulingIssued: false, invalidCitations: [], invalidDocNos: [], docNoMismatches: [], ungroundedQuotes: [], ungroundedAddresses: [], ungroundedCitationValues: [], paramMismatches: [], completenessFailures: [], missingExternalDisclaimer: false, mscCitedAsAtlas: [], lengthCapped: false } }),
      { type: "done", content: "ok", usage: { input: 1, output: 1 }, generationId: null, toolCalls: [] },
    );
    expect(m.verify).toBeUndefined();
  });
});

describe("applyEvent clear", () => {
  it("degenerate wipes the draft entirely", () => {
    const m = applyEvent(baseMsg({ draft: "the the the" }), { type: "clear", reason: "degenerate" });
    expect(m.draft).toBe("");
    expect(m.superseded ?? []).toEqual([]);
  });

  it("tool_round moves the draft into superseded, stamped with the current round", () => {
    const m = applyEvent(baseMsg({ draft: "a preamble", rounds: 2 }), { type: "clear", reason: "tool_round" });
    expect(m.draft).toBe("");
    expect(m.superseded).toEqual([{ text: "a preamble", reason: "tool_round", round: 2 }]);
  });

  it("a whitespace-only draft leaves no superseded entry", () => {
    const m = applyEvent(baseMsg({ draft: "   \n  " }), { type: "clear", reason: "tool_round" });
    expect(m.draft).toBe("");
    expect(m.superseded ?? []).toEqual([]);
  });

  it("folds leaked tool-call markup into reasoning and keeps only the prose as superseded", () => {
    const m = applyEvent(
      baseMsg({
        draft: 'Let me look that up.\n<tool_call>\n{"name":"atlas_query","arguments":{}}\n</tool_call>',
        rounds: 1,
      }),
      { type: "clear", reason: "tool_round" },
    );
    expect(m.superseded).toEqual([{ text: "Let me look that up.", reason: "tool_round", round: 1 }]);
    expect(m.reasoning).toContain("<tool_call>");
  });
});

describe("applyEvent status", () => {
  it("stamps a new stage row with the current round", () => {
    const m = applyEvent(baseMsg({ rounds: 1 }), { type: "status", stage: "querying", detail: "Searching…" });
    expect(m.stageLog).toEqual([{ stage: "querying", details: ["Searching…"], at: 0, round: 1 }]);
  });

  it("coalesces a same-stage status into the existing row, appending the detail rather than replacing it", () => {
    let m = baseMsg({ rounds: 1 });
    m = applyEvent(m, { type: "status", stage: "querying", detail: "first" });
    m = applyEvent(m, { type: "status", stage: "querying", detail: "second" });
    expect(m.stageLog).toEqual([{ stage: "querying", details: ["first", "second"], at: 0, round: 1 }]);
  });

  it("does not repeat an exact duplicate of the last detail line", () => {
    let m = baseMsg({ rounds: 1 });
    m = applyEvent(m, { type: "status", stage: "querying", detail: "Searching atlas_get…" });
    m = applyEvent(m, { type: "status", stage: "querying", detail: "Searching atlas_get…" });
    expect(m.stageLog).toEqual([{ stage: "querying", details: ["Searching atlas_get…"], at: 0, round: 1 }]);
  });

  it("a new stage starts a fresh row, leaving the previous stage's details intact", () => {
    let m = baseMsg({ rounds: 1 });
    m = applyEvent(m, { type: "status", stage: "querying", detail: "Searching…" });
    m = applyEvent(m, { type: "status", stage: "comparing", detail: "Comparing 2 results…" });
    expect(m.stageLog).toEqual([
      { stage: "querying", details: ["Searching…"], at: 0, round: 1 },
      { stage: "comparing", details: ["Comparing 2 results…"], at: 1, round: 1 },
    ]);
  });

  it("seeds an empty checking verify state on the 'checking' stage", () => {
    const m = applyEvent(baseMsg(), { type: "status", stage: "checking", detail: "Auditing…" });
    expect(m.verify?.status).toBe("checking");
    expect(m.verify?.contradictions).toEqual([]);
  });

  it("does not clobber an already-set verify state on a later 'checking' status", () => {
    let m = baseMsg();
    m = applyEvent(m, { type: "status", stage: "checking" });
    m = applyEvent(m, {
      type: "verify_result",
      overall: "pass",
      contradictions: [],
      invalidCitations: [],
      invalidDocNos: [],
      docNoMismatches: [],
      ungroundedQuotes: [],
      ungroundedAddresses: [],
    });
    m = applyEvent(m, { type: "status", stage: "checking", detail: "again" });
    expect(m.verify?.status).toBe("pass");
  });
});

describe("applyEvent facts / tool_call / tool_result", () => {
  it("facts rows are prepended at round 0", () => {
    const m = applyEvent(baseMsg({ rounds: 3, trace: [{ name: "atlas_query", args: {}, ok: true, bytes: 1, round: 3 }] }), {
      type: "facts",
      facts: [{ id: "glossary", summary: "2 glossary definitions" }],
    });
    expect(m.trace[0]).toMatchObject({ name: "glossary", kind: "fact", round: 0 });
    expect(m.trace[1]).toMatchObject({ name: "atlas_query", round: 3 });
  });

  it("tool_call rows are stamped with the message's current round", () => {
    const m = applyEvent(baseMsg({ rounds: 2 }), { type: "tool_call", name: "atlas_get", args: { id: "x" } });
    expect(m.trace).toEqual([{ name: "atlas_get", args: { id: "x" }, ok: null, bytes: null, round: 2 }]);
  });

  it("tool_result fills the oldest open row for that tool name", () => {
    let m = baseMsg({
      trace: [
        { name: "atlas_get", args: {}, ok: null, bytes: null, round: 1 },
        { name: "atlas_get", args: {}, ok: null, bytes: null, round: 2 },
      ],
    });
    m = applyEvent(m, { type: "tool_result", name: "atlas_get", ok: true, bytes: 50 });
    expect(m.trace[0]).toMatchObject({ ok: true, bytes: 50 });
    expect(m.trace[1]).toMatchObject({ ok: null, bytes: null });
  });
});

describe("applyEvent paragraph_check", () => {
  it("appends checks in index order", () => {
    let m = baseMsg();
    m = applyEvent(m, { type: "paragraph_check", index: 0, text: "First paragraph.", findings: [] });
    m = applyEvent(m, { type: "paragraph_check", index: 1, text: "Second paragraph.", findings: ["unsupported figure"] });
    expect(m.paragraphChecks).toEqual([
      { index: 0, text: "First paragraph.", findings: [], model: "pending" },
      { index: 1, text: "Second paragraph.", findings: ["unsupported figure"], model: "pending" },
    ]);
  });

  it("a re-emitted index replaces that entry in place rather than appending", () => {
    let m = baseMsg();
    m = applyEvent(m, { type: "paragraph_check", index: 0, text: "Draft wording.", findings: ["flagged"] });
    m = applyEvent(m, { type: "paragraph_check", index: 1, text: "Second.", findings: [] });
    m = applyEvent(m, { type: "paragraph_check", index: 0, text: "Repaired wording.", findings: [] });
    expect(m.paragraphChecks).toEqual([
      { index: 0, text: "Repaired wording.", findings: [], model: "pending" },
      { index: 1, text: "Second.", findings: [], model: "pending" },
    ]);
  });

  it("tool_round clear carries the checks onto the superseded draft, then resets", () => {
    let m = baseMsg({ draft: "a preamble", rounds: 1 });
    m = applyEvent(m, { type: "paragraph_check", index: 0, text: "a preamble", findings: ["flagged"] });
    m = applyEvent(m, { type: "clear", reason: "tool_round" });
    expect(m.superseded).toEqual([
      {
        text: "a preamble",
        reason: "tool_round",
        round: 1,
        checks: [{ index: 0, text: "a preamble", findings: ["flagged"], model: "pending" }],
      },
    ]);
    expect(m.paragraphChecks).toEqual([]);
  });

  it("degenerate clear wipes checks without creating a superseded draft", () => {
    let m = baseMsg({ draft: "the the the" });
    m = applyEvent(m, { type: "paragraph_check", index: 0, text: "the the the", findings: [] });
    m = applyEvent(m, { type: "clear", reason: "degenerate" });
    expect(m.paragraphChecks).toEqual([]);
    expect(m.superseded ?? []).toEqual([]);
  });

  it("paragraph_check sets model to pending", () => {
    const m = applyEvent(baseMsg(), { type: "paragraph_check", index: 0, text: "First paragraph.", findings: [] });
    expect(m.paragraphChecks).toEqual([{ index: 0, text: "First paragraph.", findings: [], model: "pending" }]);
  });

  it("paragraph_refute upserts ok when parsed with zero candidates", () => {
    let m = baseMsg();
    m = applyEvent(m, { type: "paragraph_check", index: 0, text: "First paragraph.", findings: [] });
    m = applyEvent(m, { type: "paragraph_refute", index: 0, parsed: true, candidates: 0 });
    expect(m.paragraphChecks).toEqual([{ index: 0, text: "First paragraph.", findings: [], model: "ok" }]);
  });

  it("paragraph_refute upserts candidate when parsed with >=1 candidates", () => {
    let m = baseMsg();
    m = applyEvent(m, { type: "paragraph_check", index: 0, text: "First paragraph.", findings: [] });
    m = applyEvent(m, { type: "paragraph_refute", index: 0, parsed: true, candidates: 2 });
    expect(m.paragraphChecks).toEqual([{ index: 0, text: "First paragraph.", findings: [], model: "candidate" }]);
  });

  it("paragraph_refute upserts failed when the model call did not parse", () => {
    let m = baseMsg();
    m = applyEvent(m, { type: "paragraph_check", index: 0, text: "First paragraph.", findings: [] });
    m = applyEvent(m, { type: "paragraph_refute", index: 0, parsed: false, candidates: 0 });
    expect(m.paragraphChecks).toEqual([{ index: 0, text: "First paragraph.", findings: [], model: "failed" }]);
  });

  it("paragraph_refute arriving before its paragraph_check creates the row, and the later check keeps the model state", () => {
    let m = baseMsg();
    m = applyEvent(m, { type: "paragraph_refute", index: 0, parsed: true, candidates: 1 });
    expect(m.paragraphChecks).toEqual([{ index: 0, text: "", findings: [], model: "candidate" }]);
    m = applyEvent(m, { type: "paragraph_check", index: 0, text: "First paragraph.", findings: [] });
    expect(m.paragraphChecks).toEqual([{ index: 0, text: "First paragraph.", findings: [], model: "candidate" }]);
  });

  it("tool_round clear carries the model state onto the superseded draft's checks", () => {
    let m = baseMsg({ draft: "a preamble", rounds: 1 });
    m = applyEvent(m, { type: "paragraph_check", index: 0, text: "a preamble", findings: [] });
    m = applyEvent(m, { type: "paragraph_refute", index: 0, parsed: true, candidates: 0 });
    m = applyEvent(m, { type: "clear", reason: "tool_round" });
    expect(m.superseded).toEqual([
      { text: "a preamble", reason: "tool_round", round: 1, checks: [{ index: 0, text: "a preamble", findings: [], model: "ok" }] },
    ]);
  });

  it("survives answer_final, but done clears a mark still stuck on pending", () => {
    let m = baseMsg();
    m = applyEvent(m, { type: "paragraph_check", index: 0, text: "Only paragraph.", findings: [] });
    m = applyEvent(m, { type: "answer_final", content: "Only paragraph." });
    expect(m.paragraphChecks).toEqual([{ index: 0, text: "Only paragraph.", findings: [], model: "pending" }]);
    m = applyEvent(m, {
      type: "done",
      content: "Only paragraph.",
      usage: { input: 1, output: 1 },
      generationId: null,
      toolCalls: [],
    });
    // No paragraph_refute ever arrived (e.g. CHAT_REFUTE_MODE=answer, or an
    // older server) — `model` is REMOVED, not set to "failed": nothing
    // failed, the mode simply didn't run.
    expect(m.paragraphChecks).toEqual([{ index: 0, text: "Only paragraph.", findings: [] }]);
    expect(m.paragraphChecks?.[0]).not.toHaveProperty("model");
  });

  it("verify_result clears a mark still stuck on pending (the normal ordering — verify_result precedes done)", () => {
    let m = baseMsg();
    m = applyEvent(m, { type: "paragraph_check", index: 0, text: "Only paragraph.", findings: [] });
    m = applyEvent(m, {
      type: "verify_result",
      overall: "pass",
      contradictions: [],
      invalidCitations: [],
      invalidDocNos: [],
      docNoMismatches: [],
      ungroundedQuotes: [],
      ungroundedAddresses: [],
    });
    expect(m.paragraphChecks).toEqual([{ index: 0, text: "Only paragraph.", findings: [] }]);
    expect(m.paragraphChecks?.[0]).not.toHaveProperty("model");
  });

  it("clears a candidate mark at verify_result — confirm has resolved, including on a pass", () => {
    let m = baseMsg();
    m = applyEvent(m, { type: "paragraph_check", index: 0, text: "Second.", findings: [] });
    m = applyEvent(m, { type: "paragraph_refute", index: 0, parsed: true, candidates: 1 });
    expect(m.paragraphChecks).toEqual([{ index: 0, text: "Second.", findings: [], model: "candidate" }]);
    m = applyEvent(m, {
      type: "verify_result",
      overall: "pass",
      contradictions: [],
      invalidCitations: [],
      invalidDocNos: [],
      docNoMismatches: [],
      ungroundedQuotes: [],
      ungroundedAddresses: [],
    });
    expect(m.paragraphChecks).toEqual([{ index: 0, text: "Second.", findings: [] }]);
    expect(m.paragraphChecks?.[0]).not.toHaveProperty("model");
  });

  it("clears a candidate mark at verify_result on fail too — agreed contradictions live on the badge", () => {
    let m = baseMsg();
    m = applyEvent(m, { type: "paragraph_check", index: 0, text: "Bad.", findings: [] });
    m = applyEvent(m, { type: "paragraph_refute", index: 0, parsed: true, candidates: 1 });
    m = applyEvent(m, {
      type: "verify_result",
      overall: "fail",
      contradictions: [{ answer: "Bad.", evidence: "Good.", why: "differs", uuid: null }],
      invalidCitations: [],
      invalidDocNos: [],
      docNoMismatches: [],
      ungroundedQuotes: [],
      ungroundedAddresses: [],
    });
    expect(m.paragraphChecks).toEqual([{ index: 0, text: "Bad.", findings: [] }]);
    expect(m.paragraphChecks?.[0]).not.toHaveProperty("model");
  });

  it("does not touch a resolved model mark (ok/failed) at verify_result or done", () => {
    let m = baseMsg();
    m = applyEvent(m, { type: "paragraph_check", index: 0, text: "First.", findings: [] });
    m = applyEvent(m, { type: "paragraph_refute", index: 0, parsed: true, candidates: 0 });
    m = applyEvent(m, { type: "paragraph_check", index: 2, text: "Third.", findings: [] });
    m = applyEvent(m, { type: "paragraph_refute", index: 2, parsed: false, candidates: 0 });
    m = applyEvent(m, {
      type: "verify_result",
      overall: "pass",
      contradictions: [],
      invalidCitations: [],
      invalidDocNos: [],
      docNoMismatches: [],
      ungroundedQuotes: [],
      ungroundedAddresses: [],
    });
    m = applyEvent(m, {
      type: "done",
      content: "x",
      usage: { input: 1, output: 1 },
      generationId: null,
      toolCalls: [],
    });
    expect(m.paragraphChecks).toEqual([
      { index: 0, text: "First.", findings: [], model: "ok" },
      { index: 2, text: "Third.", findings: [], model: "failed" },
    ]);
  });

  it("clears a candidate mark at done when verify_result never arrived, including on a superseded draft", () => {
    let m = baseMsg({ draft: "a preamble", rounds: 1 });
    m = applyEvent(m, { type: "paragraph_check", index: 0, text: "a preamble", findings: [] });
    m = applyEvent(m, { type: "paragraph_refute", index: 0, parsed: true, candidates: 1 });
    m = applyEvent(m, { type: "clear", reason: "tool_round" });
    expect(m.superseded?.[0].checks?.[0]?.model).toBe("candidate");
    m = applyEvent(m, { type: "paragraph_check", index: 0, text: "final para", findings: [] });
    m = applyEvent(m, { type: "paragraph_refute", index: 0, parsed: true, candidates: 1 });
    m = applyEvent(m, {
      type: "done",
      content: "final",
      usage: { input: 1, output: 1 },
      generationId: null,
      toolCalls: [],
    });
    expect(m.paragraphChecks).toEqual([{ index: 0, text: "final para", findings: [] }]);
    expect(m.superseded?.[0].checks).toEqual([{ index: 0, text: "a preamble", findings: [] }]);
  });

  it("clears a superseded draft's pending mark at done, without touching a resolved ok/failed one", () => {
    let m = baseMsg({ draft: "a preamble", rounds: 1 });
    m = applyEvent(m, { type: "paragraph_check", index: 0, text: "a preamble", findings: [] });
    m = applyEvent(m, { type: "clear", reason: "tool_round" });
    expect(m.superseded?.[0].checks).toEqual([{ index: 0, text: "a preamble", findings: [], model: "pending" }]);
    m = applyEvent(m, {
      type: "done",
      content: "final",
      usage: { input: 1, output: 1 },
      generationId: null,
      toolCalls: [],
    });
    expect(m.superseded?.[0].checks).toEqual([{ index: 0, text: "a preamble", findings: [] }]);
    expect(m.superseded?.[0].checks?.[0]).not.toHaveProperty("model");
  });
});

describe("applyEvent meta/error passthrough", () => {
  it("returns the message unchanged for meta and error (handled by the hook)", () => {
    const m = baseMsg({ content: "x" });
    expect(applyEvent(m, { type: "meta", conversationId: "c1" })).toBe(m);
    expect(applyEvent(m, { type: "error", message: "boom" })).toBe(m);
  });
});
