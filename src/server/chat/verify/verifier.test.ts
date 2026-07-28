// Verifier unit tests: canned/garbage JsonCall, degradation to unverified,
// and the code-overrides-model rule for overall.
import { test, expect } from "bun:test";
import type OpenAI from "openai";
import type { JsonCall } from "../llm.ts";
import { parseVerdict, computeOverall, evidenceFromTranscript, priorTurnsEvidence, runVerifier, buildVerifierPrompt, type Verdict } from "./verifier.ts";
import type { CheckReport } from "./verify-checks.ts";
import type { RoundTelemetry } from "./round-checks.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const cleanChecks: CheckReport = { citations: [], invalidCitations: [], invalidDocNos: [], docNoMismatches: [], bareAtlasLinks: [], uncitedParagraphs: 0, ungroundedQuotes: [], ungroundedAddresses: [], untracedNumbers: [], lowOverlapCitations: [], lengthCapped: false, failed: false };
const failedChecks: CheckReport = { ...cleanChecks, invalidCitations: ["00000000-dead-beef-0000-000000000000"], failed: true };
const telemetry: RoundTelemetry = { rounds: 1, toolCalls: 1, emptyResults: 0, errorResults: 0, repeatedQueries: 0, notes: [] };

const fakeCall = (text: string): JsonCall => async () => ({ text, usage: { input: 10, output: 5 }, generationId: "gen-v", latencyMs: 42 });

test("parseVerdict: fenced JSON with surrounding prose is salvaged; garbage is null", () => {
  const fenced = 'Sure!\n```json\n{"claims":[{"claim":"x","status":"supported"}],"ruling_issued":false}\n```';
  expect(parseVerdict(fenced)?.claims[0]?.status).toBe("supported");
  expect(parseVerdict("not json at all")).toBeNull();
  expect(parseVerdict('{"claims":"wrong-shape"}')).toBeNull();
});

test("computeOverall: model can add severity, never remove a deterministic failure", () => {
  const passVerdict: Verdict = { claims: [{ claim: "x", status: "supported", evidence: [], cited_uuid: null, note: null }], invented_facts: [], ruling_issued: false, confidence: 0.9, feedback: "" };
  // Deterministic failure is un-appealable, even with a glowing verdict.
  expect(computeOverall(failedChecks, passVerdict)).toBe("fail");
  expect(computeOverall(cleanChecks, passVerdict)).toBe("pass");
  expect(computeOverall(cleanChecks, null)).toBe("unverified");
  expect(computeOverall(cleanChecks, { ...passVerdict, claims: [{ claim: "y", status: "unsupported", evidence: [], cited_uuid: null, note: null }] })).toBe("warn");
  expect(computeOverall(cleanChecks, { ...passVerdict, claims: [{ claim: "y", status: "contradicted", evidence: [], cited_uuid: null, note: null }] })).toBe("fail");
  expect(computeOverall(cleanChecks, { ...passVerdict, ruling_issued: true })).toBe("fail");
  // An empty audit (JSON-degraded `{}` → claims:[]) is unverified, not a green pass.
  expect(computeOverall(cleanChecks, { ...passVerdict, claims: [] })).toBe("unverified");
});

test("invented_facts upgrades severity but never fails a clean claim table", () => {
  const supported = { claim: "x", status: "supported" as const, evidence: [], cited_uuid: null, note: null };
  const unsupported = { claim: "y", status: "unsupported" as const, evidence: [], cited_uuid: null, note: null };
  const base: Verdict = { claims: [supported], invented_facts: [], ruling_issued: false, confidence: 0.9, feedback: "" };
  // The production false failure: every claim supported, but the auditor wrote a
  // wording critique into the free-text channel. That is not a fabrication.
  const nitpick = ["the phrasing conflates role with authorization mechanism", "the phrasing is slightly stronger than the evidence warrants"];
  expect(computeOverall(cleanChecks, { ...base, invented_facts: nitpick })).toBe("pass");
  // With a claim-level counterpart it IS a fabrication report: warn → fail.
  expect(computeOverall(cleanChecks, { ...base, claims: [supported, unsupported] })).toBe("warn");
  expect(computeOverall(cleanChecks, { ...base, claims: [supported, unsupported], invented_facts: ["a retainer of 250,000 USDS appears in no source"] })).toBe("fail");
  // A contradicted claim still fails on its own, invented_facts or not.
  expect(computeOverall(cleanChecks, { ...base, claims: [{ ...supported, status: "contradicted" }], invented_facts: [] })).toBe("fail");
});

test("the checks block carries the soft wrong-doc signal to the judge", () => {
  const prompt = buildVerifierPrompt({
    question: "q", answer: "a", evidence: [], telemetry,
    checks: { ...cleanChecks, lowOverlapCitations: ['A.1.6 Some Doc ← "an unrelated sentence"'] },
  });
  const user = prompt[1].content as string;
  expect(user).toContain('claims_with_low_word_overlap_vs_cited_doc=A.1.6 Some Doc ← "an unrelated sentence"');
  // Absent → explicitly "none", so the judge never reads silence as a signal.
  expect(buildVerifierPrompt({ question: "q", answer: "a", evidence: [], telemetry, checks: cleanChecks })[1].content as string)
    .toContain("claims_with_low_word_overlap_vs_cited_doc=none");
});

test("evidenceFromTranscript labels tool results in order and budgets newest-first", () => {
  const transcript: Msg[] = [
    { role: "user", content: "q" },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "atlas_search", arguments: '{"q":"a"}' } }] },
    { role: "tool", tool_call_id: "c1", content: "A".repeat(100) },
    { role: "assistant", content: null, tool_calls: [{ id: "c2", type: "function", function: { name: "atlas_get", arguments: '{"id":"x"}' } }] },
    { role: "tool", tool_call_id: "c2", content: "B".repeat(100) },
    { role: "assistant", content: "answer" },
  ];
  const all = evidenceFromTranscript(transcript, 1000);
  expect(all.map((e) => e.label)).toEqual(["[E1]", "[E2]"]);
  expect(all[0].tool).toBe("atlas_search");
  expect(all[1].tool).toBe("atlas_get");
  // Tight budget keeps the NEWEST entry (truncating it if needed), drops older.
  const tight = evidenceFromTranscript(transcript, 50);
  expect(tight).toHaveLength(1);
  expect(tight[0].tool).toBe("atlas_get");
  expect(tight[0].content.length).toBeLessThanOrEqual(50 + "…[truncated]".length);
});

test("runVerifier degrades to a null verdict on transport failure", async () => {
  const boom: JsonCall = async () => {
    throw new Error("provider 500");
  };
  const run = await runVerifier({ call: boom, model: "m", question: "q", answer: "a", evidence: [], checks: cleanChecks, telemetry });
  expect(run.verdict).toBeNull();
  expect(run.usage).toBeNull();
});

test("runVerifier carries usage + generation id from the JSON call", async () => {
  const run = await runVerifier({
    call: fakeCall('{"claims":[],"invented_facts":[],"ruling_issued":false,"confidence":1,"feedback":""}'),
    model: "m", question: "q", answer: "a", evidence: [], checks: cleanChecks, telemetry,
  });
  expect(run.verdict).not.toBeNull();
  expect(run.usage).toEqual({ input: 10, output: 5 });
  expect(run.generationId).toBe("gen-v");
});

test("priorTurnsEvidence folds earlier assistant answers into one entry, newest-first budget", () => {
  const transcript: Msg[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "q1" },
    { role: "assistant", content: "answer one" },
    { role: "user", content: "q2" },
    { role: "assistant", content: "answer two" },
    { role: "user", content: "q3 (current turn)" },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "atlas_search", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c1", content: "{}" },
  ];
  const e = priorTurnsEvidence(transcript);
  expect(e?.label).toBe("[E-prev]");
  expect(e?.content).toBe("answer one\n---\nanswer two");
  // Budget keeps the newest prior answer when both don't fit.
  expect(priorTurnsEvidence(transcript, 12)?.content).toBe("answer two");
  // First turn of a conversation → no entry.
  expect(priorTurnsEvidence([{ role: "user", content: "q" }])).toBeNull();
  // Tool-call assistant messages and empties never count as prior answers.
  expect(priorTurnsEvidence([
    { role: "assistant", content: "" },
    { role: "user", content: "q" },
  ])).toBeNull();
});
