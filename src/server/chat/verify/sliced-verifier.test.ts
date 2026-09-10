// Sliced-verifier orchestration tests: the two concurrent slices, the
// conditional confirm gate, and merge semantics (no false green).
import { test, expect } from "bun:test";
import type OpenAI from "openai";
import { config } from "../../config.ts";
import type { JsonCall } from "../llm.ts";
import { buildIndexes } from "../../retrieval/indexes.ts";
import type { AtlasNode } from "../../../types.ts";
import type { CheckReport } from "./verify-checks.ts";
import { computeOverall } from "./verifier.ts";
import { runSlicedVerifier, sliceModels, SLICES } from "./sliced-verifier.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

// Empty synthetic index: most tests here don't exercise the absence contract.
const ix = buildIndexes([], [], [], {});

// Non-empty index for the param-table absence tests: one known parameter
// (Keel's USDS Mint Maximum) to refute against.
function node(p: Partial<AtlasNode> & { id: string; doc_no: string; title: string; content: string }): AtlasNode {
  return { type: "Core", depth: 3, parentId: null, order: 0, addressRefs: [], ...p };
}
const keelOwner = node({ id: "keel-owner", doc_no: "T.1", title: "Keel", type: "Instance", depth: 2, content: "" });
const keelParam = node({
  id: "keel-param",
  doc_no: "T.1.1",
  title: "USDS Mint Maximum",
  parentId: "keel-owner",
  content: ["The maximum amount of USDS that can be minted is specified in the document herein.", "", "- `maxAmount`: 10,000 USDS"].join("\n"),
});
const paramIx = buildIndexes([keelOwner, keelParam], [], [], {});

const CLEAN_CHECKS = {} as CheckReport;

// Identifies which of the two concurrent slice calls (or the trailing confirm
// call) a JsonCall invocation is, by content — the same dispatch strategy
// the orchestrator's own tests use.
function identify(messages: Msg[]): "refute" | "overreach" | "confirm" | "unmatched" {
  const sys = typeof messages[0]?.content === "string" ? messages[0].content : "";
  if (sys.includes("CONTRADICTS")) return "refute";
  if (sys.includes("ADJUDICATE")) return "overreach";
  if (sys.includes("first auditor")) return "confirm";
  return "unmatched";
}

function dispatchCall(scripts: { refute?: string; overreach?: string; confirm?: string }, calls: { model: string; role: string }[] = []): JsonCall {
  return async ({ model, messages }) => {
    const role = identify(messages as Msg[]);
    calls.push({ model, role });
    const text = role === "unmatched" ? "{}" : (scripts[role] ?? "{}");
    return { text, usage: { input: 10, output: 5 }, generationId: `gen-${role}`, latencyMs: 5 };
  };
}

test("SLICES is the two concurrent auditors — refute and overreach; confirm runs separately", () => {
  expect(SLICES).toEqual(["refute", "overreach"]);
});

test("sliceModels: overrides parse with whitespace, unnamed slices (incl. confirm) fall back", () => {
  const pm = config.chatVerifierModel;
  const ps = config.chatVerifierSliceModels;
  config.chatVerifierModel = "fallback/model";
  config.chatVerifierSliceModels = "refute=a/one, overreach = b/two";
  try {
    expect(sliceModels()).toEqual({ refute: "a/one", overreach: "b/two", confirm: "fallback/model" });
  } finally {
    config.chatVerifierModel = pm;
    config.chatVerifierSliceModels = ps;
  }
});

test("nothing parsed → null verdict (unverified)", async () => {
  const calls: { model: string; role: string }[] = [];
  const run = await runSlicedVerifier({
    call: dispatchCall({ refute: "not json", overreach: "not json" }, calls),
    models: { refute: "m", overreach: "m", confirm: "m" },
    ix, question: "q", answer: "The answer.", evidence: [], checks: CLEAN_CHECKS,
  });
  expect(run.verdict).toBeNull();
  expect(computeOverall(null, run.verdict)).toBe("unverified");
  // No candidates ever produced → confirm never called.
  expect(calls.map((c) => c.role).sort()).toEqual(["overreach", "refute"]);
});

test("refute unparsed + overreach clean → refuteParsed:false, computeOverall unverified", async () => {
  const run = await runSlicedVerifier({
    call: dispatchCall({ refute: "not json", overreach: '{"ruling_issued":false,"notes":""}' }),
    models: { refute: "m", overreach: "m", confirm: "m" },
    ix, question: "q", answer: "The answer.", evidence: [], checks: CLEAN_CHECKS,
  });
  expect(run.verdict?.refuteParsed).toBe(false);
  expect(computeOverall(null, run.verdict)).toBe("unverified");
});

test("a ruling alone (no candidates) → warn, and confirm is never called", async () => {
  const calls: { model: string; role: string }[] = [];
  const run = await runSlicedVerifier({
    call: dispatchCall({ refute: '{"contradictions":[],"not_found":[],"notes":""}', overreach: '{"ruling_issued":true,"notes":"adjudicated"}' }, calls),
    models: { refute: "m", overreach: "m", confirm: "m" },
    ix, question: "q", answer: "The answer.", evidence: [], checks: CLEAN_CHECKS,
  });
  expect(run.verdict?.ruling_issued).toBe(true);
  expect(computeOverall(null, run.verdict)).toBe("warn");
  expect(calls.some((c) => c.role === "confirm")).toBe(false);
});

test("confirm runs only when there is ≥1 candidate: 2 calls clean, 3 calls with a candidate", async () => {
  const cleanCalls: { model: string; role: string }[] = [];
  await runSlicedVerifier({
    call: dispatchCall({ refute: '{"contradictions":[],"not_found":[],"notes":""}', overreach: '{"ruling_issued":false,"notes":""}' }, cleanCalls),
    models: { refute: "m", overreach: "m", confirm: "m" },
    ix, question: "q", answer: "The answer.", evidence: [], checks: CLEAN_CHECKS,
  });
  expect(cleanCalls).toHaveLength(2);

  const withCandidateCalls: { model: string; role: string }[] = [];
  const answer = "X is 5.";
  const evidence = [{ label: "[E1]", tool: "atlas_get", args: "{}", content: "X is 7." }];
  const refuteText = JSON.stringify({ contradictions: [{ answer_span: "X is 5.", evidence_span: "X is 7.", why: "value differs" }], not_found: [], notes: "" });
  await runSlicedVerifier({
    call: dispatchCall({ refute: refuteText, overreach: '{"ruling_issued":false,"notes":""}', confirm: '{"agree":[],"notes":""}' }, withCandidateCalls),
    models: { refute: "m", overreach: "m", confirm: "m" },
    ix, question: "q", answer, evidence, checks: CLEAN_CHECKS,
  });
  expect(withCandidateCalls).toHaveLength(3);
  expect(withCandidateCalls.some((c) => c.role === "confirm")).toBe(true);
});

test("an AGREED contradiction → fail; a disagreed one still carries the candidate in the verdict (agreed:false) but computeOverall → pass", async () => {
  const answer = "X is 5.";
  const evidence = [{ label: "[E1]", tool: "atlas_get", args: "{}", content: "X is 7." }];
  const refuteText = JSON.stringify({ contradictions: [{ answer_span: "X is 5.", evidence_span: "X is 7.", why: "value differs" }], not_found: [], notes: "" });

  const agreedRun = await runSlicedVerifier({
    call: dispatchCall({ refute: refuteText, overreach: '{"ruling_issued":false,"notes":""}', confirm: '{"agree":[1],"notes":""}' }),
    models: { refute: "m", overreach: "m", confirm: "m" },
    ix, question: "q", answer, evidence, checks: CLEAN_CHECKS,
  });
  expect(agreedRun.verdict?.contradictions[0].agreed).toBe(true);
  expect(computeOverall(null, agreedRun.verdict)).toBe("fail");
  expect(agreedRun.verdict?.confirm).toEqual({ ran: true, model: "m", candidates: 1, agreed: 1, parsed: true });

  const disagreedRun = await runSlicedVerifier({
    call: dispatchCall({ refute: refuteText, overreach: '{"ruling_issued":false,"notes":""}', confirm: '{"agree":[],"notes":""}' }),
    models: { refute: "m", overreach: "m", confirm: "m" },
    ix, question: "q", answer, evidence, checks: CLEAN_CHECKS,
  });
  expect(disagreedRun.verdict?.contradictions[0].agreed).toBe(false);
  expect(computeOverall(null, disagreedRun.verdict)).toBe("pass");
});

test("a param-table absence candidate needs the owner token, goes through confirm, carries source:param-table", async () => {
  const answer = "The atlas does not specify a USDS mint maximum for Keel.";
  const calls: { model: string; role: string }[] = [];
  const run = await runSlicedVerifier({
    call: dispatchCall({ refute: '{"contradictions":[],"not_found":[],"notes":""}', overreach: '{"ruling_issued":false,"notes":""}', confirm: '{"agree":[1],"notes":""}' }, calls),
    models: { refute: "m", overreach: "m", confirm: "m" },
    ix: paramIx, question: "q", answer, evidence: [], checks: CLEAN_CHECKS,
  });
  expect(calls.some((c) => c.role === "confirm")).toBe(true);
  expect(run.verdict?.contradictions).toHaveLength(1);
  expect(run.verdict?.contradictions[0].source).toBe("param-table");
  expect(run.verdict?.contradictions[0].agreed).toBe(true);
  expect(computeOverall(null, run.verdict)).toBe("fail");
});

test("an absence sentence naming NO owner is never a candidate — confirm never runs", async () => {
  const answer = "The atlas does not specify a governance token vesting cliff.";
  const calls: { model: string; role: string }[] = [];
  await runSlicedVerifier({
    call: dispatchCall({ refute: '{"contradictions":[],"not_found":[],"notes":""}', overreach: '{"ruling_issued":false,"notes":""}' }, calls),
    models: { refute: "m", overreach: "m", confirm: "m" },
    ix: paramIx, question: "q", answer, evidence: [], checks: CLEAN_CHECKS,
  });
  expect(calls.some((c) => c.role === "confirm")).toBe(false);
});

test("usage sums across every call that ran, including the conditional confirm", async () => {
  const answer = "X is 5.";
  const evidence = [{ label: "[E1]", tool: "atlas_get", args: "{}", content: "X is 7." }];
  const refuteText = JSON.stringify({ contradictions: [{ answer_span: "X is 5.", evidence_span: "X is 7.", why: "value differs" }], not_found: [], notes: "" });
  const run = await runSlicedVerifier({
    call: dispatchCall({ refute: refuteText, overreach: '{"ruling_issued":false,"notes":""}', confirm: '{"agree":[],"notes":""}' }),
    models: { refute: "m", overreach: "m", confirm: "m" },
    ix, question: "q", answer, evidence, checks: CLEAN_CHECKS,
  });
  // Three calls (refute + overreach + confirm), each fixture usage {input:10,output:5}.
  expect(run.usage).toEqual({ input: 30, output: 15 });
});

test("confirm outage (unparseable) with a candidate on the table: confirm.parsed:false, computeOverall → unverified (not pass, not fail)", async () => {
  const answer = "X is 5.";
  const evidence = [{ label: "[E1]", tool: "atlas_get", args: "{}", content: "X is 7." }];
  const refuteText = JSON.stringify({ contradictions: [{ answer_span: "X is 5.", evidence_span: "X is 7.", why: "value differs" }], not_found: [], notes: "" });
  const run = await runSlicedVerifier({
    call: dispatchCall({ refute: refuteText, overreach: '{"ruling_issued":false,"notes":""}', confirm: "not json" }),
    models: { refute: "m", overreach: "m", confirm: "m" },
    ix, question: "q", answer, evidence, checks: CLEAN_CHECKS,
  });
  expect(run.verdict?.confirm).toEqual({ ran: true, model: "m", candidates: 1, agreed: 0, parsed: false });
  // The candidate is still on the verdict (agreed:false) as the calibration
  // record, but computeOverall must not read the outage as a considered "no".
  expect(run.verdict?.contradictions[0].agreed).toBe(false);
  expect(computeOverall(null, run.verdict)).toBe("unverified");
});

test("not_found is carried from the refute slice, capped at 5 there", async () => {
  const refuteText = JSON.stringify({ contradictions: [], not_found: ["a", "b", "c", "d", "e", "f"], notes: "" });
  const run = await runSlicedVerifier({
    call: dispatchCall({ refute: refuteText, overreach: '{"ruling_issued":false,"notes":""}' }),
    models: { refute: "m", overreach: "m", confirm: "m" },
    ix, question: "q", answer: "a", evidence: [], checks: CLEAN_CHECKS,
  });
  expect(run.verdict?.not_found).toHaveLength(5);
});
