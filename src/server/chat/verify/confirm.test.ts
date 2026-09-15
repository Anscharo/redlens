// Confirm-gate unit tests: the prompt carries only the candidates (never the
// evidence), agreement subsets, and fail-toward-silence on garbage/transport
// errors.
import { test, expect } from "bun:test";
import { buildConfirmPrompt, runConfirm } from "./confirm.ts";
import type { JsonCall } from "../llm.ts";
import type { Contradiction } from "./verifier.ts";

const contradiction = (over: Partial<Contradiction> = {}): Contradiction => ({
  answer_span: "a", evidence_span: "b", why: "w", evidence_label: "[E1]", uuid: null, source: "model", agreed: false, ...over,
});

test("buildConfirmPrompt carries only the answer + numbered candidates, never a full evidence dump", () => {
  const candidates = [
    contradiction({ answer_span: "X is 5", evidence_span: "X is 7", why: "count differs" }),
    contradiction({ answer_span: "Y is active", evidence_span: "Y is inactive", why: "status differs" }),
  ];
  const [, user] = buildConfirmPrompt({ answer: "The answer text.", candidates });
  const content = String(user.content);
  expect(content).toContain("1. Answer: \"X is 5\"");
  expect(content).toContain("2. Answer: \"Y is active\"");
  expect(content).toContain("count differs");
  expect(content).toContain("status differs");
});

const call = (text: string): JsonCall => async () => ({ text, usage: { input: 5, output: 2 }, generationId: "g", latencyMs: 3 });

test("runConfirm: a subset agreement maps 1-based candidate numbers to 0-based indexes", async () => {
  const candidates = [contradiction(), contradiction(), contradiction()];
  const run = await runConfirm({ call: call('{"agree":[1,3],"notes":"n"}'), model: "m", answer: "a", candidates });
  expect(run.parsed).toBe(true);
  expect([...run.agreed].sort()).toEqual([0, 2]);
  expect(run.usage).toEqual({ input: 5, output: 2 });
});

test("runConfirm: out-of-range or non-integer entries are dropped, not crashed on", async () => {
  const candidates = [contradiction(), contradiction()];
  const run = await runConfirm({ call: call('{"agree":[0,1,2,99,1.5,"x"],"notes":"n"}'), model: "m", answer: "a", candidates });
  // 0 and 99 are out of the 1..2 range, 1.5 isn't an integer, "x" isn't a
  // number — only 1 and 2 (1-based) survive, mapping to indexes 0 and 1.
  expect([...run.agreed].sort()).toEqual([0, 1]);
});

test("runConfirm: garbage JSON degrades to agree with none, parsed:false", async () => {
  const candidates = [contradiction()];
  const run = await runConfirm({ call: call("not json at all"), model: "m", answer: "a", candidates });
  expect(run.parsed).toBe(false);
  expect(run.agreed.size).toBe(0);
});

test("runConfirm: a missing/malformed `agree` field also degrades to none", async () => {
  const candidates = [contradiction()];
  const run = await runConfirm({ call: call('{"notes":"n"}'), model: "m", answer: "a", candidates });
  expect(run.parsed).toBe(false);
  expect(run.agreed.size).toBe(0);
});

test("runConfirm: a thrown call (transport error) degrades the same way as unparseable, never throws", async () => {
  const boom: JsonCall = async () => {
    throw new Error("provider 500");
  };
  const candidates = [contradiction()];
  const run = await runConfirm({ call: boom, model: "m", answer: "a", candidates });
  expect(run.parsed).toBe(false);
  expect(run.agreed.size).toBe(0);
  expect(run.usage).toBeNull();
});

test("runConfirm: empty candidates never asked to agree on anything", async () => {
  const run = await runConfirm({ call: call('{"agree":[],"notes":""}'), model: "m", answer: "a", candidates: [] });
  expect(run.agreed.size).toBe(0);
  expect(run.parsed).toBe(true);
});
