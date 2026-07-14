// Chat reliability harness orchestrator (docs/plans/chat-reliability-harness.md).
// Wraps the pure runChat loop with: live status events, pipelined deterministic
// round checks, a post-answer verifier audit (stream + badge — never gates the
// answer), and an escalation-only advisor capped at exactly ONE recovery cycle.
// Unset model slots degrade to today's behavior; harness flakiness never breaks
// a turn. `transcript`/`checksMeta` are internal — the SSE route strips them
// via sanitizeDone before events reach a client.
import type OpenAI from "openai";
import { runChat, type ChatEvent, type RoundInfo } from "./chat-loop.ts";
import type { ChatStream } from "./chat-loop.ts";
import type { JsonCall } from "./llm.ts";
import type { Indexes } from "./indexes.ts";
import { config } from "./config.ts";
import { createRoundChecker, type RoundTelemetry } from "./round-checks.ts";
import { runDeterministicChecks, type CheckReport } from "./verify-checks.ts";
import { repairCitations, type CitationRepair } from "./citation-repair.ts";
import { computeOverall, evidenceFromTranscript, runVerifier, type EvidenceEntry, type Verdict, type VerifyOverall } from "./verifier.ts";
import { atlasDescribe } from "./tools.ts";
import { adviseRecovery, type Recovery } from "./advisor.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type DoneEvent = Extract<ChatEvent, { type: "done" }>;

export interface CheckRowMeta {
  kind: "round_checks" | "verify" | "verify_recheck" | "advisor_recovery";
  model: string | null;
  action: "annotate" | "revised" | null;
  verdict: unknown;
  overall: VerifyOverall | null;
  inputTokens: number | null;
  outputTokens: number | null;
  generationId: string | null;
  latencyMs: number | null;
}

export type HarnessEvent =
  | ChatEvent
  | { type: "status"; stage: "querying" | "reading" | "checking" | "advising" | "revising"; detail?: string }
  | {
      type: "verify_result";
      overall: VerifyOverall;
      confidence: number | null;
      action: "annotate" | "revised" | null;
      claims: { claim: string; status: "supported" | "unsupported" | "contradicted" }[];
      invalidCitations: string[];
      invalidDocNos: string[];
      docNoMismatches: string[];
      ungroundedQuotes: string[];
    };

export type HarnessDone = DoneEvent & { checksMeta: CheckRowMeta[] };

// The wire-safe done: internal evidence/persistence fields removed.
export function sanitizeDone(done: DoneEvent & { checksMeta?: CheckRowMeta[] }): Omit<DoneEvent, "transcript"> {
  const { transcript: _t, checksMeta: _c, ...wire } = done as DoneEvent & { checksMeta?: CheckRowMeta[] };
  return wire;
}

// Human-readable status detail off the tool args — zero model cost.
function describeCall(name: string, args: Record<string, unknown>): string {
  const q = [args.search, args.q, args.query, args.term].find((v) => typeof v === "string" && v.length > 0);
  if (typeof q === "string") return `Searching the atlas for “${q.slice(0, 80)}”…`;
  if (name === "atlas_get") return "Reading documents…";
  return `Consulting ${name}…`;
}

function verifyEvent(
  overall: VerifyOverall,
  verdict: Verdict | null,
  checks: CheckReport,
  action: "annotate" | "revised" | null,
): Extract<HarnessEvent, { type: "verify_result" }> {
  return {
    type: "verify_result",
    overall,
    confidence: verdict?.confidence ?? null,
    action,
    claims: (verdict?.claims ?? []).map((c) => ({ claim: c.claim, status: c.status })),
    invalidCitations: checks.invalidCitations,
    invalidDocNos: checks.invalidDocNos,
    docNoMismatches: checks.docNoMismatches,
    ungroundedQuotes: checks.ungroundedQuotes,
  };
}

// Repair the answer's atlas links in code, then fold unrepairable (stripped)
// links back into the report as hard failures — the link is gone from the
// shipped text, but a fabricated citation still means an unsupported claim.
function repairedChecks(content: string, toolTexts: string[], ix: Indexes, repair: CitationRepair): CheckReport {
  const checks = runDeterministicChecks(content, toolTexts, ix);
  if (repair.stripped.length === 0) return checks;
  return {
    ...checks,
    invalidCitations: [...checks.invalidCitations, ...repair.stripped.map((s) => s.target)],
    failed: true,
  };
}

const toolTextsOf = (transcript: Msg[]): string[] =>
  transcript.filter((m) => m.role === "tool" && typeof m.content === "string").map((m) => m.content as string);

// The live schema the system prompt hands the model (doc counts, type + edge
// vocabularies) is legitimate knowledge it never retrieves via tools — without
// this entry the verifier flags TRUE schema facts ("the atlas has ~N docs")
// as invented.
const schemaEvidence = (ix: Indexes): EvidenceEntry => ({
  label: "[E0]",
  tool: "atlas_schema",
  args: "(live schema, injected into the assistant's system prompt)",
  content: JSON.stringify(atlasDescribe(ix)),
});

// One line per hard deterministic failure — fed to the advisor and the revision
// steer so recovery targets the exact fabrication, not just "audit failed".
function describeCheckFailures(checks: CheckReport): string[] {
  return [
    ...checks.invalidCitations.map((u) => `cited doc ${u} does not exist in the atlas — cite only docs retrieved this turn`),
    ...checks.invalidDocNos.map((d) => `document number ${d} does not exist in the atlas — remove it or replace it with the real number from the tool results`),
    ...checks.docNoMismatches.map((m) => `misattributed citation: ${m}`),
    ...checks.ungroundedQuotes.map((q) => `quoted text not found in any retrieved source: "${q.slice(0, 80)}"`),
  ];
}

function retrievalTrouble(t: RoundTelemetry): boolean {
  return t.emptyResults + t.errorResults >= config.chatAdvisorTriggerEmptyResults || t.repeatedQueries >= 2;
}

// Corrective-run steering per advisor action. The revision run's base is the
// full turn transcript (incl. the flagged answer), so the model sees all
// evidence gathered; `requery` gets one extra tool round, others get none.
function revisionSteer(recovery: Recovery, feedback: string): { steer: string; maxIterations: number } {
  const fb = feedback ? ` Audit feedback: ${feedback}` : "";
  switch (recovery.action) {
    case "requery": {
      const calls = recovery.calls.map((c) => `${c.name}(${JSON.stringify(c.args)})`).join("; ");
      return {
        steer: `Your previous answer failed a verification audit.${fb} ${recovery.guidance} Make exactly these tool calls first: ${calls || "the minimal calls that fill the gap"} — then write the corrected final answer with citations.`,
        maxIterations: 2,
      };
    }
    case "rewrite":
      return {
        steer: `Your previous answer failed a verification audit.${fb} ${recovery.guidance} Rewrite the complete answer now using ONLY the evidence already gathered above — remove or correct every flagged claim, keep everything that was supported, cite sources as instructed.`,
        maxIterations: 1,
      };
    case "decline":
      return {
        steer: `Your previous answer failed a verification audit.${fb} ${recovery.guidance} The atlas does not support an answer here: write an honest, brief response saying so, naming exactly what was checked and found. No speculation.`,
        maxIterations: 1,
      };
  }
}

export async function* runVerifiedChat(opts: {
  ix: Indexes;
  messages: Msg[];
  stream: ChatStream;
  jsonCall?: JsonCall;
  question: string;
  signal?: AbortSignal;
  maxIterations?: number;
}): AsyncGenerator<HarnessEvent> {
  const max = Math.max(1, opts.maxIterations ?? config.chatMaxIterations);
  const checker = createRoundChecker();
  let roundsUsed = 0;
  const onRoundEnd = (info: RoundInfo) => {
    checker.record(info);
    roundsUsed = Math.max(roundsUsed, info.iter + 1);
  };

  // ── Conversationalist pass (answer streams at full speed) ────────────────
  let done: DoneEvent | null = null;
  for await (const ev of runChat({ ix: opts.ix, messages: opts.messages, stream: opts.stream, signal: opts.signal, maxIterations: max, onRoundEnd })) {
    if (ev.type === "done") {
      done = ev;
      break; // held back — the harness emits its own terminal done
    }
    if (ev.type === "tool_call") yield { type: "status", stage: "querying", detail: describeCall(ev.name, ev.args) };
    yield ev;
  }
  if (!done) return; // loop can only end via done; defensive
  const checksMeta: CheckRowMeta[] = [];
  const finish = (d: DoneEvent): HarnessDone => ({ ...d, checksMeta });

  if (!config.chatVerifyChecks || opts.signal?.aborted || !done.content.trim()) {
    yield finish(done);
    return;
  }

  // ── Verification (deterministic always; model audit when configured) ─────
  // Citation repair runs first, on the FULL tool texts (the verifier evidence
  // budget doesn't apply to free string scans): done.content is authoritative
  // client-side, so repaired links replace the streamed ones at done.
  const telemetry = checker.telemetry();
  const evidence = evidenceFromTranscript(done.transcript);
  const toolTexts = toolTextsOf(done.transcript);
  const repair = repairCitations(done.content, toolTexts, opts.ix);
  if (repair.content !== done.content) done = { ...done, content: repair.content };
  const checks = repairedChecks(done.content, toolTexts, opts.ix, repair);
  checksMeta.push({
    kind: "round_checks", model: null, action: null,
    verdict: { telemetry, repair: { repaired: repair.repaired, stripped: repair.stripped }, checks: { ...checks, citations: checks.citations.length } },
    overall: null, inputTokens: null, outputTokens: null, generationId: null, latencyMs: null,
  });

  const verifierModel = opts.jsonCall ? config.chatVerifierModel : "";
  let verdict: Verdict | null = null;
  if (verifierModel) {
    yield {
      type: "status", stage: "checking",
      detail: `Cross-checking ${checks.citations.length || "the"} cited claim${checks.citations.length === 1 ? "" : "s"} against ${evidence.length} source${evidence.length === 1 ? "" : "s"}…`,
    };
    const run = await runVerifier({
      call: opts.jsonCall!, model: verifierModel, question: opts.question,
      answer: done.content, evidence: [schemaEvidence(opts.ix), ...evidence], checks, telemetry, signal: opts.signal,
    });
    verdict = run.verdict;
    checksMeta.push({
      kind: "verify", model: verifierModel, action: null, verdict: run.verdict,
      overall: computeOverall(checks, run.verdict),
      inputTokens: run.usage?.input ?? null, outputTokens: run.usage?.output ?? null,
      generationId: run.generationId, latencyMs: run.latencyMs,
    });
  }
  const overall = verifierModel ? computeOverall(checks, verdict) : checks.failed ? "fail" : "unverified";

  // ── Escalation gate (all free signals) ────────────────────────────────────
  const exhausted = max > 1 && roundsUsed >= max - 1;
  const advisorModel = opts.jsonCall ? config.chatAdvisorModel : "";
  const troubled = overall === "fail" || overall === "warn" || (overall !== "pass" && (exhausted || retrievalTrouble(telemetry)));
  const escalate = Boolean(advisorModel) && troubled && !opts.signal?.aborted;

  // Deterministic-only turns stay quiet unless something actually failed —
  // a permanent "unverified" chip on every clean answer is noise, not signal.
  const emitVerify = verifierModel !== "" || checks.failed;
  if (emitVerify) yield verifyEvent(overall, verdict, checks, escalate ? null : "annotate");

  if (!escalate) {
    yield finish(done);
    return;
  }

  // ── One recovery cycle, hard cap ──────────────────────────────────────────
  yield { type: "status", stage: "advising", detail: "Answer didn’t fully check out — conferring with advisor…" };
  const digest = evidence.map((e) => `${e.tool}(${e.args.slice(0, 160)}) → ${e.content.slice(0, 200)}`).join("\n");
  const checkFailures = describeCheckFailures(checks);
  const adv = await adviseRecovery({
    call: opts.jsonCall!, model: advisorModel, question: opts.question,
    transcriptDigest: digest || "(no tools were called)", verdict, telemetry, checkFailures, signal: opts.signal,
  });
  checksMeta.push({
    kind: "advisor_recovery", model: advisorModel,
    action: adv.recovery ? "revised" : "annotate",
    verdict: adv.recovery ? { ...adv.recovery, originalAnswer: done.content } : null,
    overall: null, inputTokens: adv.usage?.input ?? null, outputTokens: adv.usage?.output ?? null,
    generationId: adv.generationId, latencyMs: adv.latencyMs,
  });
  if (!adv.recovery) {
    // Advisor unavailable/undecided → annotate-only fallback; badge stays as-is.
    yield finish(done);
    return;
  }

  yield { type: "status", stage: "revising", detail: "Revising with corrections…" };
  yield { type: "clear" };
  const feedback = [verdict?.feedback ?? "", checkFailures.length ? `Deterministic failures: ${checkFailures.join("; ")}.` : ""]
    .filter(Boolean).join(" ");
  const { steer, maxIterations } = revisionSteer(adv.recovery, feedback);
  const revMessages: Msg[] = [...done.transcript, { role: "system", content: steer }];
  let revDone: DoneEvent | null = null;
  for await (const ev of runChat({ ix: opts.ix, messages: revMessages, stream: opts.stream, signal: opts.signal, maxIterations, onRoundEnd })) {
    if (ev.type === "done") {
      revDone = ev;
      break;
    }
    if (ev.type === "tool_call") yield { type: "status", stage: "querying", detail: describeCall(ev.name, ev.args) };
    yield ev;
  }

  // Failed/aborted revision → the original answer stands (done.content is
  // authoritative client-side, so the cleared buffer recovers on done).
  if (!revDone || !revDone.content.trim()) {
    yield finish(done);
    return;
  }

  // ── Re-verify once; the second verdict is final even if amber ─────────────
  const revEvidence = evidenceFromTranscript(revDone.transcript);
  const revToolTexts = toolTextsOf(revDone.transcript);
  const revRepair = repairCitations(revDone.content, revToolTexts, opts.ix);
  if (revRepair.content !== revDone.content) revDone = { ...revDone, content: revRepair.content };
  const revChecks = repairedChecks(revDone.content, revToolTexts, opts.ix, revRepair);
  let revVerdict: Verdict | null = null;
  if (verifierModel && !opts.signal?.aborted) {
    yield { type: "status", stage: "checking", detail: "Re-checking the revised answer…" };
    const rerun = await runVerifier({
      call: opts.jsonCall!, model: verifierModel, question: opts.question,
      answer: revDone.content, evidence: [schemaEvidence(opts.ix), ...revEvidence], checks: revChecks, telemetry: checker.telemetry(), signal: opts.signal,
    });
    revVerdict = rerun.verdict;
    checksMeta.push({
      kind: "verify_recheck", model: verifierModel, action: "revised", verdict: rerun.verdict,
      overall: computeOverall(revChecks, rerun.verdict),
      inputTokens: rerun.usage?.input ?? null, outputTokens: rerun.usage?.output ?? null,
      generationId: rerun.generationId, latencyMs: rerun.latencyMs,
    });
  }
  yield verifyEvent(verifierModel ? computeOverall(revChecks, revVerdict) : revChecks.failed ? "fail" : "unverified", revVerdict, revChecks, "revised");

  yield finish({
    type: "done",
    content: revDone.content,
    usage: { input: done.usage.input + revDone.usage.input, output: done.usage.output + revDone.usage.output },
    generationId: revDone.generationId ?? done.generationId,
    toolCalls: [...done.toolCalls, ...revDone.toolCalls],
    transcript: revDone.transcript,
  });
}
