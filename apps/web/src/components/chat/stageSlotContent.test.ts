import { describe, it, expect, vi } from "vitest";
import { stageSlotContent } from "./stageSlotContent";
import type { ChatMsg, StageLogEntry, VerifyState } from "./chatTypes";

// hasFindings lives beside the component that renders them; the mock keeps
// this (React-free) test off posthog-js, which that module pulls in.
vi.mock("../../lib/analytics", () => ({ track: vi.fn() }));

function baseMsg(over: Partial<ChatMsg> = {}): ChatMsg {
  return {
    role: "assistant",
    content: "",
    draft: "",
    generated: false,
    trace: [],
    rounds: 0,
    sources: [],
    done: false,
    stageLog: [],
    ...over,
  };
}

const entry = (over: Partial<StageLogEntry>): StageLogEntry => ({
  stage: "querying",
  details: [],
  at: 0,
  round: 1,
  ...over,
});

const cleanVerify: VerifyState = {
  status: "pass",
  contradictions: [],
  notFound: [],
  rulingIssued: false,
  invalidCitations: [],
  invalidDocNos: [],
  docNoMismatches: [],
  ungroundedQuotes: [],
  ungroundedAddresses: [],
  ungroundedCitationValues: [],
  paramMismatches: [],
  completenessFailures: [],
  missingExternalDisclaimer: false,
  mscCitedAsAtlas: [],
  lengthCapped: false,
};

describe("stageSlotContent / recalling", () => {
  it("takes only the fact rows from trace, regardless of round", () => {
    const msg = baseMsg({
      trace: [
        { name: "glossary", args: {}, ok: true, bytes: null, kind: "fact", summary: "2 definitions", round: 0 },
        { name: "atlas_get", args: {}, ok: true, bytes: 5, round: 1 },
      ],
    });
    const content = stageSlotContent(msg, entry({ stage: "recalling", round: 0 }));
    expect(content).toEqual({ kind: "trace", rows: [msg.trace[0]] });
  });

  it("is null when there are no fact rows", () => {
    expect(stageSlotContent(baseMsg(), entry({ stage: "recalling", round: 0 }))).toBeNull();
  });
});

describe("stageSlotContent / querying", () => {
  it("takes only tool rows for that entry's round, excluding facts and other rounds", () => {
    const msg = baseMsg({
      trace: [
        { name: "glossary", args: {}, ok: true, bytes: null, kind: "fact", summary: "def", round: 0 },
        { name: "atlas_get", args: { id: "r1" }, ok: true, bytes: 5, round: 1 },
        { name: "atlas_query", args: { id: "r2" }, ok: true, bytes: 5, round: 2 },
      ],
    });
    const content = stageSlotContent(msg, entry({ stage: "querying", round: 1 }));
    expect(content).toEqual({ kind: "trace", rows: [msg.trace[1]] });
  });

  it("is null for a round that made no tool calls", () => {
    expect(stageSlotContent(baseMsg(), entry({ stage: "querying", round: 1 }))).toBeNull();
  });
});

describe("stageSlotContent / synthesizing", () => {
  const twoPasses = [entry({ stage: "synthesizing", at: 0, round: 1 }), entry({ stage: "synthesizing", at: 3, round: 2 })];

  it("gives the reasoning to the FIRST synthesizing pass only", () => {
    const msg = baseMsg({ reasoning: "thinking it through", generated: true, stageLog: twoPasses });
    expect(stageSlotContent(msg, twoPasses[0])).toMatchObject({ reasoning: "thinking it through" });
    expect(stageSlotContent(msg, twoPasses[1])).toBeNull();
  });

  it("takes that round's superseded drafts only", () => {
    const msg = baseMsg({
      generated: true,
      superseded: [
        { text: "round 1 preamble", reason: "tool_round", round: 1 },
        { text: "round 2 preamble", reason: "tool_round", round: 2 },
      ],
    });
    const content = stageSlotContent(msg, entry({ stage: "synthesizing", round: 1 }));
    expect(content).toMatchObject({ kind: "synthesis", drafts: [{ text: "round 1 preamble" }] });
  });

  it("gives the live draft to the LAST pass only, while the answer isn't generated yet", () => {
    const msg = baseMsg({ draft: "the answer so far", generated: false, stageLog: twoPasses });
    expect(stageSlotContent(msg, twoPasses[0])).toBeNull();
    expect(stageSlotContent(msg, twoPasses[1])).toMatchObject({ draft: "the answer so far" });
  });

  it("drops the live draft once the answer has been generated", () => {
    const msg = baseMsg({ draft: "stale draft text", generated: true, stageLog: [twoPasses[0]] });
    expect(stageSlotContent(msg, twoPasses[0])).toBeNull();
  });

  it("never carries paragraph checks — those belong to the checking row", () => {
    const msg = baseMsg({
      draft: "the answer so far",
      paragraphChecks: [{ index: 0, text: "the answer so far", findings: [] }],
      stageLog: twoPasses,
    });
    for (const pass of twoPasses) {
      expect(stageSlotContent(msg, pass)).not.toMatchObject({ kind: "checks" });
    }
  });
});

describe("stageSlotContent / comparing", () => {
  it("carries the paragraph checks when the turn has no Verifying row (deterministic-only)", () => {
    const msg = baseMsg({
      generated: true,
      paragraphChecks: [{ index: 0, text: "final paragraph", findings: [] }],
      stageLog: [entry({ stage: "synthesizing", at: 0, round: 1 }), entry({ stage: "comparing", at: 1, round: 1 })],
    });
    expect(stageSlotContent(msg, msg.stageLog![1])).toMatchObject({ kind: "checks", checks: msg.paragraphChecks });
  });

  it("is null when a Verifying row exists — the checks live there instead", () => {
    const stageLog = [entry({ stage: "comparing", at: 1, round: 1 }), entry({ stage: "checking", at: 2, round: 1 })];
    const msg = baseMsg({
      generated: true,
      paragraphChecks: [{ index: 0, text: "final paragraph", findings: [] }],
      stageLog,
    });
    expect(stageSlotContent(msg, stageLog[0])).toBeNull();
    expect(stageSlotContent(msg, stageLog[1])).toMatchObject({ kind: "checks", checks: msg.paragraphChecks });
  });

  it("is null on a turn with no paragraph checks at all", () => {
    expect(stageSlotContent(baseMsg(), entry({ stage: "comparing", round: 1 }))).toBeNull();
  });
});

describe("stageSlotContent / checking", () => {
  it("carries the whole-answer findings once verify resolves with something to report", () => {
    const verify: VerifyState = { ...cleanVerify, status: "fail", rulingIssued: true };
    const content = stageSlotContent(baseMsg({ verify }), entry({ stage: "checking", round: 1 }));
    expect(content).toMatchObject({ kind: "checks", findings: verify });
  });

  it("is null for a clean verdict — an empty findings box looks like a mistake", () => {
    expect(stageSlotContent(baseMsg({ verify: cleanVerify }), entry({ stage: "checking", round: 1 }))).toBeNull();
  });

  it("is null while verify is still checking", () => {
    const msg = baseMsg({ verify: { ...cleanVerify, status: "checking", rulingIssued: true } });
    expect(stageSlotContent(msg, entry({ stage: "checking", round: 1 }))).toBeNull();
  });

  it("is null when verify was never set", () => {
    expect(stageSlotContent(baseMsg(), entry({ stage: "checking", round: 1 }))).toBeNull();
  });
});

describe("stageSlotContent / unknown stage", () => {
  it("is null, so a stage this client doesn't know renders as a plain row", () => {
    const msg = baseMsg({ trace: [{ name: "atlas_get", args: {}, ok: true, bytes: 5, round: 1 }] });
    expect(stageSlotContent(msg, entry({ stage: "polishing", round: 1 }))).toBeNull();
  });
});
