// Chat reliability harness orchestrator (docs/plans/chat-reliability-harness.md).
// Wraps the pure runChat loop with: live status events, a streaming citation
// gate (invalid links repaired before their tokens reach the client), pipelined
// deterministic round checks, a post-answer verifier audit (stream + badge —
// never gates the answer), and an escalation-only advisor capped at exactly
// ONE recovery cycle.
// Unset model slots degrade to today's behavior; harness flakiness never breaks
// a turn. `transcript`/`checksMeta` are internal — the SSE route strips them
// via sanitizeDone before events reach a client.
import type OpenAI from "openai";
import { runChat, type ChatEvent, type RoundInfo } from "./chat-loop.ts";
import type { ChatStream } from "./chat-loop.ts";
import type { JsonCall } from "./llm.ts";
import type { Indexes } from "../retrieval/indexes.ts";
import { config } from "../config.ts";
import { createRoundChecker, type RoundTelemetry } from "./verify/round-checks.ts";
import { runDeterministicChecks, type CheckReport } from "./verify/verify-checks.ts";
import { createLinkJudge, repairCitations, repairDefinitionBlock, resolveLabelToUuid, type CitationRepair, type LinkJudge } from "./verify/citation-repair.ts";
import { expandReferenceLinks, type ReferenceExpansion } from "./verify/citation-normalize.ts";
import { repairIdentifierLeaks, type IdentifierRepair } from "./verify/identifier-leak.ts";
import { gatedChat } from "./verify/stream-link-gate.ts";
import { createCitationGate } from "./verify/definition-block-gate.ts";
import { computeOverall, evidenceFromTranscript, priorTurnsEvidence, runVerifier, type EvidenceEntry, type Verdict, type VerifyOverall } from "./verify/verifier.ts";
import { atlasDescribe } from "./tools/tools.ts";
import { adviseRecovery, type Recovery } from "./verify/advisor.ts";
import { captureError, type ErrorContext } from "../posthog-node.ts";

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
      ungroundedAddresses: string[];
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
    ungroundedAddresses: checks.ungroundedAddresses,
  };
}

// Reference-style citations — `[text][label]` plus a `[label]: /atlas/<uuid>`
// definition block — are expanded to the canonical inline form BEFORE repair
// and before the deterministic checks, so the whole checking layer keeps
// keying on one shape (docs/plans/reference-citations.md). Repair remains the
// authority; it simply operates on the canonical form, which it has to, since
// a garbled UUID in a reference answer lives in a definition line that is not
// a `[text](href)` link at all.
//
// The repaired result becomes done.content whenever it differs from what the
// model wrote — the comparison at each call site is against the ORIGINAL, not
// the normalized string, so a normalization-only fix still ships. That is a
// deliberate, narrow exception to the "streamed text and done.content must not
// disagree" guard below:
//   • today's inline-only answers normalize byte-identically, so this is a
//     strict no-op and the guard is untouched;
//   • a well-formed reference answer renders identically either way (remark
//     resolves reference links to the same <a href="/atlas/…"> and drops the
//     definition nodes), so the swap is invisible to the user;
//   • where the swap IS visible it is precisely the repair — the two measured
//     malformed shapes otherwise ship as literal brackets in the prose;
//   • and done.content is what the verifier, the advisor digest, the revision
//     steer, the Sources cluster and the persisted message all read, so one
//     canonical shape across those consumers beats byte-fidelity to raw model
//     output.
// Exported for the offline evals (scripts/aux/eval-bakeoff.ts), which must grade
// the string production would SHIP: a reference-style answer has no inline
// citations at all until this runs, so a checker fed the raw model output scores
// every well-formed reference answer as uncited.
export function normalizeAndRepair(content: string, toolTexts: string[], ix: Indexes): { refs: ReferenceExpansion; repair: CitationRepair; identifiers: IdentifierRepair } {
  // A used-but-undeclared label is resolved against this turn's retrieved docs
  // and synthesized as an inline link when it maps uniquely (undefined-label
  // degradation); unresolvable ones the normalizer strips to plain text and
  // reports, and the orchestrator folds those into a hard failure below.
  const judge = createLinkJudge(toolTexts, ix);
  const resolveLabel = (label: string): string | null => {
    const uuid = resolveLabelToUuid(label, judge);
    return uuid ? `/atlas/${uuid}` : null;
  };
  const refs = expandReferenceLinks(content, resolveLabel);
  const repair = repairCitations(refs.content, toolTexts, ix);
  // Last: internal machine handles pasted into prose as pseudo-citations
  // (`(Slug: grove-freezer-multisig)`) become real citations when the handle
  // names a doc retrieved this turn, and vanish otherwise. Folded into
  // repair.content because every call site swaps on that one string.
  const identifiers = repairIdentifierLeaks(repair.content, toolTexts, ix);
  return { refs, repair: { ...repair, content: identifiers.content }, identifiers };
}

// Reference bookkeeping for the checks row — observability only, never a
// verdict. The remaining `undefinedLabels` here are the ones that could NOT be
// resolved to a retrieved doc (the resolvable ones were already synthesized
// into inline links by normalizeAndRepair); repairedChecks folds these into a
// hard failure. `undefined` so the key vanishes from the persisted JSON on the
// overwhelmingly common turn that uses no reference syntax at all.
function refsMeta(r: ReferenceExpansion) {
  if (r.definitions.size + r.undefinedLabels.length + r.unusedLabels.length === 0) return undefined;
  return { definitions: r.definitions.size, undefinedLabels: r.undefinedLabels, unusedLabels: r.unusedLabels };
}

// Same bookkeeping shape for leaked machine handles: observability only (the
// leak is already gone from the shipped text), `undefined` so the key vanishes
// from the persisted JSON on the turns — nearly all of them — with no leak.
function identifiersMeta(i: IdentifierRepair) {
  if (i.linkified.length + i.removed.length === 0) return undefined;
  return { linkified: i.linkified, removed: i.removed };
}

// Repair the answer's atlas links in code, then fold unrepairable (stripped)
// links back into the report as hard failures — the link is gone from the
// shipped text, but a fabricated citation still means an unsupported claim.
// Unresolvable undefined reference labels (de-linkified to plain text by the
// normalizer) fold in identically: a claim that cited a doc which turned out
// not to resolve is just as unsupported. A length-capped answer (cut off
// mid-generation) is folded the same way: it's not a citation problem, but it
// must equally force `failed` so the escalation gate below sees it and the
// harness attempts a recovery.
function repairedChecks(content: string, toolTexts: string[], ix: Indexes, repair: CitationRepair, lengthCapped: boolean, undefinedLabels: string[] = []): CheckReport {
  const checks = runDeterministicChecks(content, toolTexts, ix);
  if (repair.stripped.length === 0 && undefinedLabels.length === 0 && !lengthCapped) return checks;
  return {
    ...checks,
    invalidCitations: [...checks.invalidCitations, ...repair.stripped.map((s) => s.target), ...undefinedLabels],
    lengthCapped,
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
    ...checks.ungroundedAddresses.map((a) => `address ${a} appears in no tool result this turn — remove it or replace it with an address you actually retrieved`),
    ...checks.ungroundedCitationValues.map((v) => `${v} — cite the value to the document that actually contains it, or drop the figure`),
    ...(checks.lengthCapped ? ["the previous answer was cut off by the output length limit before it finished — write a complete, more concise answer that fits"] : []),
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
  obs?: ErrorContext;
}): AsyncGenerator<HarnessEvent> {
  const max = Math.max(1, opts.maxIterations ?? config.chatMaxIterations);
  const checker = createRoundChecker();
  let roundsUsed = 0;

  // ── Streaming citation gate ───────────────────────────────────────────────
  // The same LinkJudge the post-answer repair pass uses, fed the same evidence
  // (history tool texts + this turn's rounds so far), applied to token events
  // so an invalid link is repaired/de-linkified BEFORE it reaches the client —
  // done.content then matches what streamed instead of swapping it. The judge
  // is rebuilt lazily after each tool round; a gate failure falls back to
  // emitting the link as written, with the post-answer pass as the safety net.
  const gateEvidence: string[] = toolTextsOf(opts.messages);
  let judge: LinkJudge | null = null;
  const renderLink = (title: string, target: string, raw: string): string => {
    try {
      judge ??= createLinkJudge(gateEvidence, opts.ix);
      const v = judge(title, target);
      if (v.action === "repair") return `[${title}](/atlas/${v.to})`;
      if (v.action === "strip") return title;
    } catch (err) {
      captureError(err, opts.obs, { stage: "stream_link_gate" });
    }
    return raw;
  };
  // Reference-style answers stream a definition block first; the gate buffers it
  // and repairs the whole citation table once (same judge, same evidence) before
  // releasing it, so a garbled definition never flashes as a live dead link.
  // A gate failure degrades to emitting the block unrepaired — the post-answer
  // pass is the safety net.
  const repairBlock = (block: string): string => {
    try {
      judge ??= createLinkJudge(gateEvidence, opts.ix);
      return repairDefinitionBlock(block, judge).content;
    } catch (err) {
      captureError(err, opts.obs, { stage: "stream_link_gate" });
      return block;
    }
  };
  const makeGate = () => createCitationGate({ render: renderLink, repairBlock });

  const onRoundEnd = (info: RoundInfo) => {
    checker.record(info);
    roundsUsed = Math.max(roundsUsed, info.iter + 1);
    for (const r of info.results) gateEvidence.push(r.content);
    judge = null; // new evidence — rebuild on the next link
  };

  // ── Conversationalist pass (answer streams at full speed) ────────────────
  let done: DoneEvent | null = null;
  for await (const ev of gatedChat(runChat({ ix: opts.ix, messages: opts.messages, stream: opts.stream, signal: opts.signal, maxIterations: max, onRoundEnd, obs: opts.obs }), makeGate)) {
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
    // No audit runs here — but the streaming gate already repaired links in the
    // token stream, and the client treats done.content as authoritative. Without
    // the same repair applied to done.content, the client swaps the repaired
    // stream back to the invalid link at completion (the exact bug this gate
    // exists to prevent). Verification being off must not lose the repair.
    // Aborted/empty answers have nothing meaningful to repair, so skip them.
    // Normalization runs here too: with checks off this is the only thing
    // standing between a malformed reference citation and the user.
    if (!opts.signal?.aborted && done.content.trim()) {
      try {
        const { repair } = normalizeAndRepair(done.content, toolTextsOf(done.transcript), opts.ix);
        if (repair.content !== done.content) done = { ...done, content: repair.content };
      } catch (err) {
        captureError(err, opts.obs, { stage: "citation_repair_verify_disabled" });
      }
    }
    yield finish(done);
    return;
  }

  // ── Verification (deterministic always; model audit when configured) ─────
  // Reference-link normalization, then citation repair, on the FULL tool texts (the verifier evidence
  // budget doesn't apply to free string scans). The streaming gate already
  // applied the same judge to the token stream, so this pass normally agrees
  // with what streamed — it is the authority and the record (repaired/stripped
  // feed the checks), and done.content stays authoritative client-side for
  // the rare case where the gate had to flush a malformed link raw.
  //
  // Everything from here down is pure post-processing of an answer that has
  // ALREADY streamed to the client (token events are long gone). A throw here
  // must never lose that answer — degrade to "skip verification" (same as the
  // config-off path above) rather than letting the exception propagate out and
  // skip persistAssistant entirely.
  const telemetry = checker.telemetry();
  const evidence = evidenceFromTranscript(done.transcript);
  let toolTexts: string[];
  let checks: CheckReport;
  try {
    toolTexts = toolTextsOf(done.transcript);
    const { refs, repair, identifiers } = normalizeAndRepair(done.content, toolTexts, opts.ix);
    if (repair.content !== done.content) done = { ...done, content: repair.content };
    checks = repairedChecks(done.content, toolTexts, opts.ix, repair, done.lengthCapped, refs.undefinedLabels);
    checksMeta.push({
      kind: "round_checks", model: null, action: null,
      verdict: { telemetry, repair: { repaired: repair.repaired, stripped: repair.stripped }, refs: refsMeta(refs), identifiers: identifiersMeta(identifiers), checks: { ...checks, citations: checks.citations.length } },
      overall: null, inputTokens: null, outputTokens: null, generationId: null, latencyMs: null,
    });
  } catch (err) {
    captureError(err, opts.obs, { stage: "citation_repair_or_checks" });
    yield finish(done);
    return;
  }

  const verifierModel = opts.jsonCall ? config.chatVerifierModel : "";
  // Earlier-turn answers count as grounding for follow-ups (the system prompt
  // says so), so the verifier gets them as one [E-prev] entry alongside the
  // schema — otherwise every "summarize what you said" turn flags unsupported.
  const prevEvidence = priorTurnsEvidence(done.transcript);
  const baseEvidence = (turnEvidence: EvidenceEntry[]) =>
    [schemaEvidence(opts.ix), ...(prevEvidence ? [prevEvidence] : []), ...turnEvidence];
  let verdict: Verdict | null = null;
  if (verifierModel) {
    yield {
      type: "status", stage: "checking",
      detail: `Cross-checking ${checks.citations.length || "the"} cited claim${checks.citations.length === 1 ? "" : "s"} against ${evidence.length} source${evidence.length === 1 ? "" : "s"}…`,
    };
    const run = await runVerifier({
      call: opts.jsonCall!, model: verifierModel, question: opts.question,
      answer: done.content, evidence: baseEvidence(evidence), checks, telemetry, signal: opts.signal, obs: opts.obs,
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
  // A recovery cycle replays the whole turn transcript through the model — the
  // single most expensive operation here — so it is reserved for `fail`, plus
  // the two independent trouble signals below (which still admit `warn` via
  // `overall !== "pass"`). A lone `unsupported` claim used to trigger it: the
  // mildest signal buying the costliest response. `warn` now escalates on its
  // own only once enough claims are unsupported that the answer is substantially
  // ungrounded rather than imprecise in one spot.
  const unsupportedClaims = (verdict?.claims ?? []).filter((c) => c.status === "unsupported").length;
  const troubled =
    overall === "fail" ||
    (overall === "warn" && unsupportedClaims >= config.chatAdvisorTriggerUnsupportedClaims) ||
    (overall !== "pass" && (exhausted || retrievalTrouble(telemetry)));
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
    transcriptDigest: digest || "(no tools were called)", verdict, telemetry, checkFailures, signal: opts.signal, obs: opts.obs,
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
  try {
    for await (const ev of gatedChat(runChat({ ix: opts.ix, messages: revMessages, stream: opts.stream, signal: opts.signal, maxIterations, onRoundEnd, obs: opts.obs }), makeGate)) {
      if (ev.type === "done") {
        revDone = ev;
        break;
      }
      if (ev.type === "tool_call") yield { type: "status", stage: "querying", detail: describeCall(ev.name, ev.args) };
      yield ev;
    }
  } catch (err) {
    // The revision replays the whole transcript, so it can fail where the
    // original didn't (context overflow, provider error). The original answer
    // is already in hand and merely failed an audit — never lose it to a
    // recovery attempt. Harness flakiness must not break a turn, but the
    // failure itself is worth knowing about.
    captureError(err, opts.obs, { stage: "revision_loop" });
    revDone = null;
  }

  // Failed/aborted revision → the original answer stands (done.content is
  // authoritative client-side, so the cleared buffer recovers on done).
  if (!revDone || !revDone.content.trim()) {
    yield finish(done);
    return;
  }

  // ── Re-verify once; the second verdict is final even if amber ─────────────
  // Same rule as the first pass: revDone.content already streamed to the
  // client (via token events during the revision loop above) — a throw here
  // must degrade to "skip the recheck", never lose the revised answer.
  const revEvidence = evidenceFromTranscript(revDone.transcript);
  let revChecks: CheckReport;
  try {
    const revToolTexts = toolTextsOf(revDone.transcript);
    const { refs: revRefs, repair: revRepair } = normalizeAndRepair(revDone.content, revToolTexts, opts.ix);
    if (revRepair.content !== revDone.content) revDone = { ...revDone, content: revRepair.content };
    revChecks = repairedChecks(revDone.content, revToolTexts, opts.ix, revRepair, revDone.lengthCapped, revRefs.undefinedLabels);
  } catch (err) {
    captureError(err, opts.obs, { stage: "revision_citation_repair_or_checks" });
    yield finish(revDone);
    return;
  }
  let revVerdict: Verdict | null = null;
  if (verifierModel && !opts.signal?.aborted) {
    yield { type: "status", stage: "checking", detail: "Re-checking the revised answer…" };
    const rerun = await runVerifier({
      call: opts.jsonCall!, model: verifierModel, question: opts.question,
      answer: revDone.content, evidence: baseEvidence(revEvidence), checks: revChecks, telemetry: checker.telemetry(), signal: opts.signal, obs: opts.obs,
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
    lengthCapped: revDone.lengthCapped, // the revised answer is what's finalized
    transcript: revDone.transcript,
  });
}
