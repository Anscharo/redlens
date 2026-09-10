// Verifier unit tests: computeOverall's severity table for the refutation-only
// Verdict shape, plus evidence assembly (evidenceFromTranscript / priorTurnsEvidence)
// which is unchanged by the redesign.
import { test, expect } from "bun:test";
import type OpenAI from "openai";
import { computeOverall, evidenceFromTranscript, priorTurnsEvidence, type Contradiction, type Verdict } from "./verifier.ts";
import type { CheckReport } from "./verify-checks.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const cleanChecks: CheckReport = { citations: [], invalidCitations: [], invalidDocNos: [], docNoMismatches: [], bareAtlasLinks: [], uncitedParagraphs: 0, ungroundedQuotes: [], ungroundedAddresses: [], ungroundedCitationValues: [], untracedNumbers: [], lowOverlapCitations: [], paramMismatches: [], completenessFailures: [], missingExternalDisclaimer: false, mscCitedAsAtlas: [], lengthCapped: false, failed: false };
const failedChecks: CheckReport = { ...cleanChecks, invalidCitations: ["00000000-dead-beef-0000-000000000000"], failed: true };

const contradiction = (over: Partial<Contradiction> = {}): Contradiction => ({
  answer_span: "a", evidence_span: "b", why: "w", evidence_label: "[E1]", uuid: null, source: "model", agreed: false, ...over,
});
const verdict = (over: Partial<Verdict> = {}): Verdict => ({
  contradictions: [], not_found: [], ruling_issued: false, notes: "", refuteParsed: true, confirm: null, ...over,
});

test("computeOverall: a deterministic check failure is un-appealable, even with a clean verdict", () => {
  expect(computeOverall(failedChecks, verdict())).toBe("fail");
});

test("computeOverall: no verdict at all → unverified", () => {
  expect(computeOverall(cleanChecks, null)).toBe("unverified");
});

test("computeOverall: a clean, parsed refute backbone → pass", () => {
  expect(computeOverall(cleanChecks, verdict())).toBe("pass");
});

test("computeOverall: the refute backbone never parsed, nothing else wrong → unverified, not a green pass", () => {
  expect(computeOverall(cleanChecks, verdict({ refuteParsed: false }))).toBe("unverified");
});

test("computeOverall: an AGREED contradiction fails on its own", () => {
  expect(computeOverall(cleanChecks, verdict({ contradictions: [contradiction({ agreed: true })] }))).toBe("fail");
});

test("computeOverall: an unagreed candidate is a hard non-event — it must never reach the reader, so pass with nothing else wrong", () => {
  expect(computeOverall(cleanChecks, verdict({ contradictions: [contradiction({ agreed: false })] }))).toBe("pass");
});

test("computeOverall: an overreach ruling alone is warn, even with zero contradictions", () => {
  expect(computeOverall(cleanChecks, verdict({ ruling_issued: true }))).toBe("warn");
});

test("computeOverall: any agreed contradiction beats a ruling straight to fail", () => {
  expect(computeOverall(cleanChecks, verdict({ ruling_issued: true, contradictions: [contradiction({ agreed: true })] }))).toBe("fail");
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
  expect(all[0].sourceClass).toBe("atlas");
  expect(all[1].sourceClass).toBe("atlas");
  // Tight budget keeps the NEWEST entry (truncating it if needed), drops older.
  const tight = evidenceFromTranscript(transcript, 50);
  expect(tight).toHaveLength(1);
  expect(tight[0].tool).toBe("atlas_get");
  expect(tight[0].content.length).toBeLessThanOrEqual(50 + "…[truncated]".length);
});

test("evidenceFromTranscript marks ask_external_msc as external", () => {
  const transcript: Msg[] = [
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "ask_external_msc", arguments: '{"view":"month"}' } }] },
    { role: "tool", tool_call_id: "c1", content: '{"not_atlas":true}' },
  ];
  const all = evidenceFromTranscript(transcript, 1000);
  expect(all[0]!.sourceClass).toBe("external");
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

// The prefetch round is seeded before the model runs, so it is always the
// OLDEST tool entry — exactly what newest-first budgeting drops first. Losing
// it makes the verifier judge an answer against evidence missing the material
// the answer was built from.
test("prefetch evidence survives budget pressure that evicts newer tool results", () => {
  const transcript = [
    { role: "assistant", content: null, tool_calls: [{ id: "call_prefetch", type: "function", function: { name: "atlas_prefetch", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_prefetch", content: "PREFETCH-FACT-CONTENT" },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "atlas_query", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c1", content: "x".repeat(5000) },
    { role: "assistant", content: null, tool_calls: [{ id: "c2", type: "function", function: { name: "atlas_query", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c2", content: "y".repeat(5000) },
  ] as never;

  const kept = evidenceFromTranscript(transcript, 200);
  const prefetch = kept.find((e) => e.tool === "atlas_prefetch");
  expect(prefetch).toBeDefined();
  expect(prefetch?.content).toBe("PREFETCH-FACT-CONTENT");
  // Labels stay contiguous after the reserve/evict partition.
  expect(kept.map((e) => e.label)).toEqual(kept.map((_, i) => `[E${i + 1}]`));
});
