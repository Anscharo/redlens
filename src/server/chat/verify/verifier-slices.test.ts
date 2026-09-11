// verifier-slices.ts: runSlice's dispatch to the refute vs overreach prompt,
// and the shared SLICE_NEEDS_EVIDENCE contract. The refute prompt/parse pair
// itself is tested in refute.test.ts; this file covers overreach (whose
// prompt lives only here) and the dispatch/evidence-gating behaviour.
import { test, expect } from "bun:test";
import type OpenAI from "openai";
import { runSlice, SLICE_NEEDS_EVIDENCE } from "./verifier-slices.ts";
import type { JsonCall } from "../llm.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

test("SLICE_NEEDS_EVIDENCE: only refute reads evidence — overreach and confirm read the answer's stance/candidates only", () => {
  expect(SLICE_NEEDS_EVIDENCE).toEqual({ refute: true, overreach: false, confirm: false });
});

test("overreach carries no evidence in its prompt — it judges stance, not facts", async () => {
  const capture: Msg[][] = [];
  const call: JsonCall = async ({ messages }) => {
    capture.push(messages as Msg[]);
    return { text: '{"ruling_issued":false,"notes":""}', usage: { input: 1, output: 1 }, generationId: "g", latencyMs: 1 };
  };
  await runSlice({
    call, model: "m", slice: "overreach", question: "q", answer: "a",
    evidence: [{ label: "[E1]", tool: "t", args: "", content: "SECRET" }],
  });
  expect(JSON.stringify(capture[0])).not.toContain("SECRET");
  expect(JSON.stringify(capture[0])).toContain("ADJUDICATE");
});

test("overreach parses ruling_issued + notes", async () => {
  const call: JsonCall = async () => ({ text: '{"ruling_issued":true,"notes":"quote"}', usage: { input: 1, output: 1 }, generationId: "g", latencyMs: 1 });
  const r = await runSlice({ call, model: "m", slice: "overreach", question: "q", answer: "a", evidence: [] });
  expect(r.parsed).toBe(true);
  expect(r.rulingIssued).toBe(true);
  expect(r.notes).toBe("quote");
  expect(r.contradictions).toEqual([]);
});

test("overreach tolerates fenced JSON and salvages the object", async () => {
  const call: JsonCall = async () => ({ text: '```json\n{"ruling_issued":false,"notes":"n"}\n```', usage: { input: 1, output: 1 }, generationId: "g", latencyMs: 1 });
  const r = await runSlice({ call, model: "m", slice: "overreach", question: "q", answer: "a", evidence: [] });
  expect(r.parsed).toBe(true);
  expect(r.rulingIssued).toBe(false);
});

test("overreach: unparseable text degrades to parsed:false, never throws", async () => {
  const call: JsonCall = async () => ({ text: "not json at all", usage: { input: 1, output: 1 }, generationId: "g", latencyMs: 1 });
  const r = await runSlice({ call, model: "m", slice: "overreach", question: "q", answer: "a", evidence: [] });
  expect(r.parsed).toBe(false);
  expect(r.rulingIssued).toBe(false);
});

test("refute reaches the refute prompt (delegates to buildRefutePrompt/parseRefute) and validates spans", async () => {
  const evidence = [{ label: "[E1]", tool: "atlas_get", args: "{}", content: "X is 7." }];
  const answer = "X is 5.";
  const call: JsonCall = async ({ messages }) => {
    expect(JSON.stringify(messages)).toContain("CONTRADICTS");
    return {
      text: JSON.stringify({ contradictions: [{ answer_span: answer, evidence_span: "X is 7.", why: "value differs" }], not_found: [], notes: "" }),
      usage: { input: 1, output: 1 }, generationId: "g", latencyMs: 1,
    };
  };
  const r = await runSlice({ call, model: "m", slice: "refute", question: "q", answer, evidence });
  expect(r.parsed).toBe(true);
  expect(r.contradictions).toHaveLength(1);
  expect(r.contradictions[0].evidence_label).toBe("[E1]");
});

test("refute: a fabricated (unlocatable) contradiction is discarded, never kept", async () => {
  const evidence = [{ label: "[E1]", tool: "atlas_get", args: "{}", content: "Totally unrelated content about something else." }];
  const answer = "Spark is a Pioneer.";
  const call: JsonCall = async () => ({
    text: JSON.stringify({ contradictions: [{ answer_span: answer, evidence_span: "Spark has an active Pioneer Chain instance", why: "invented" }], not_found: [], notes: "" }),
    usage: { input: 1, output: 1 }, generationId: "g", latencyMs: 1,
  });
  const r = await runSlice({ call, model: "m", slice: "refute", question: "q", answer, evidence });
  expect(r.contradictions).toHaveLength(0);
  expect(r.discarded).toBe(1);
});

test("confirm never dispatches through runSlice — it always returns the empty base result", async () => {
  const call: JsonCall = async () => {
    throw new Error("runSlice must never call the model for slice='confirm'");
  };
  const r = await runSlice({ call, model: "m", slice: "confirm", question: "q", answer: "a", evidence: [] });
  expect(r.parsed).toBe(false);
  expect(r.contradictions).toEqual([]);
});

test("a call that throws degrades to the unparsed base result, never propagates", async () => {
  const boom: JsonCall = async () => {
    throw new Error("provider 500");
  };
  const r = await runSlice({ call: boom, model: "m", slice: "refute", question: "q", answer: "a", evidence: [] });
  expect(r.parsed).toBe(false);
  expect(r.contradictions).toEqual([]);
});
