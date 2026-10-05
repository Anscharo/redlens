// The model lanes that run after `answer_final`: Sources-chip marks, answer
// coverage, quote attribution and the sliced audit. All four start
// concurrently; they resolve in the order the reconciliation needs, and emit
// in the order the wire contract fixes (see HarnessEvent): citation_marks,
// then answer_coverage, then verify_result, then done.
import { config } from "../../config.ts";
import { computeOverall, type EvidenceEntry, type Verdict } from "../verify/verifier.ts";
import type { CheckReport } from "../verify/verify-checks.ts";
import { sliceModels } from "../verify/sliced-verifier.ts";
import { runCitationMarks } from "../verify/citation-marks.ts";
import { docProvenance } from "../verify/provenance.ts";
import { agreedContradictionsFrom, withoutDisputedMarks } from "../verify/disputes.ts";
import { judgeAnswerCoverage } from "../verify/answer-coverage.ts";
import type { ParagraphRefute } from "../verify/paragraph-refute.ts";
import { checkingDetail, checkingDetailParagraphs } from "./status-copy.ts";
import { resolveAnswerCoverage, resolveCitationMarks, runAudit, verifyEvent } from "./lanes.ts";
import { gateQuotes, quoteAttributionRow, startQuoteLane } from "./quote-lane.ts";
import { finishDone, type HarnessCtx } from "./context.ts";
import type { DoneEvent, HarnessEvent } from "./types.ts";

export interface LaneInput {
  done: DoneEvent;
  checks: CheckReport;
  split: { atlasTexts: string[]; externalTexts: string[] };
  evidence: EvidenceEntry[];
  grounded: boolean;
  ruledSmalltalk: boolean;
}

// Per-doc Sources-chip check (verify/citation-marks.ts). Provenance — what
// this turn actually retrieved, per document (verify/provenance.ts) — decides
// which question each citation gets: the document's own text for one the
// model read, its change record for one the model only saw named, and no
// question at all for one the turn never retrieved. Built from the RAW
// transcript, not from the audit's `evidence`: that array is budgeted to
// chatVerifierEvidenceMaxChars with newest-first eviction, so a document the
// model genuinely read early in a tool-heavy turn can be missing from it, and
// reading provenance there would call it unretrieved.
function startMarks(ctx: HarnessCtx, done: DoneEvent) {
  const { opts } = ctx;
  const model = config.chatCitationCheckModel;
  const promise = model
    ? runCitationMarks({
        answer: done.content, ix: opts.ix, model,
        jsonCall: opts.jsonCall, confirmModel: opts.jsonCall ? sliceModels().confirm : undefined,
        provenance: docProvenance(done.transcript, opts.ix),
        signal: opts.signal, obs: opts.obs,
      })
    : null;
  return { model, promise };
}

// "Did it answer the question?" (verify/answer-coverage.ts). Nothing earlier
// than answer_final reaches here, so the small-talk bypass and the checks-off
// / aborted / empty exits never run it. A turn the judge RULED small talk but
// that still gets audited is skipped too: the message expected no facts, so
// "did it answer?" has no meaning there (and that shape was never measured).
// It judges done.content as shown — including a /teach hint, which was not
// in the measured corpus. Fail-open by construction (it never rejects), but
// nothing awaits it until the marks and the audit settle — marked handled at
// creation all the same, for the same reason as the audit promise.
function startCoverage(ctx: HarnessCtx, done: DoneEvent, ruledSmalltalk: boolean) {
  const { opts } = ctx;
  const model = config.chatAnswerCoverageModel;
  const promise =
    model && !ruledSmalltalk
      ? judgeAnswerCoverage({ question: opts.question, answer: done.content, model, signal: opts.signal, obs: opts.obs })
      : null;
  promise?.catch(() => {});
  return { model, promise };
}

type Settled = { paragraphRefutes?: ParagraphRefute[]; settleMs?: number };

function checkingStatus(ctx: HarnessCtx, input: LaneInput): HarnessEvent {
  const detail = ctx.paragraphMode
    ? checkingDetailParagraphs(ctx.paragraphs.counts.paragraphs, input.evidence.length)
    : checkingDetail(input.checks.citations.length, input.evidence.length);
  return { type: "status", stage: "checking", detail };
}

// The whole-answer audit, started as a promise and not awaited — the other
// lanes resolve concurrently with it rather than delaying its start. Wrapped
// in an object because an async generator awaits a promise it returns.
async function* startAudit(ctx: HarnessCtx, input: LaneInput): AsyncGenerator<HarnessEvent, { promise: ReturnType<typeof runAudit> } | null> {
  if (!ctx.verifierModel) return null;
  if (input.grounded) yield checkingStatus(ctx, input);
  const settled: Settled = ctx.paragraphMode ? yield* ctx.paragraphs.settle(config.chatVerifierSliceTimeoutMs) : {};
  const { opts } = ctx;
  const promise = runAudit({
    jsonCall: opts.jsonCall!, ix: opts.ix, question: opts.question,
    answer: input.done.content, evidence: ctx.refuteEvidence(input.evidence, input.done.content), checks: input.checks,
    signal: opts.signal, obs: opts.obs, paragraphRefutes: settled.paragraphRefutes, settleMs: settled.settleMs,
  });
  // Nothing awaits the audit while the other lanes resolve, so a rejection in
  // that window would be an UNHANDLED one. This no-op handler only marks it
  // handled; the await in resolveAudit still rethrows.
  promise.catch(() => {});
  return { promise };
}

async function resolveAudit(ctx: HarnessCtx, promise: ReturnType<typeof runAudit>, checks: CheckReport): Promise<Verdict | null> {
  const { run, modelLabel } = await promise;
  ctx.checksMeta.push({
    kind: "verify", model: modelLabel, verdict: run.verdict,
    overall: computeOverall(checks, run.verdict),
    inputTokens: run.usage?.input ?? null, outputTokens: run.usage?.output ?? null,
    generationId: run.generationId, latencyMs: run.latencyMs,
  });
  return run.verdict;
}

// Reconciles the WIRE event only. agreedContradictionsFrom takes a live
// Verdict object here and a persisted message_checks.verdict JSONB payload
// on the reload path (conversations/detail.ts) — the two shapes are
// structurally identical, and using ONE function for both is deliberate so
// the two paths can never diverge on what counts as an agreed contradiction.
// The persisted citation_check row (cm.meta) is left UNRECONCILED on purpose
// — it is the citation lane's own calibration record, exactly like
// Verdict.contradictions stores every validated candidate (agreed and not).
// With no verifier the verdict is null and this is a no-op.
async function* emitMarks(ctx: HarnessCtx, marks: ReturnType<typeof startMarks>, verdict: Verdict | null): AsyncGenerator<HarnessEvent> {
  const cm = await resolveCitationMarks(marks.promise, marks.model);
  if (cm.event) {
    const reconciled = withoutDisputedMarks(cm.event.marks, agreedContradictionsFrom(verdict));
    // Mirrors resolveCitationMarks' own non-empty guard: if reconciliation
    // emptied the marks, emit no event at all.
    if (Object.keys(reconciled).length > 0) yield { ...cm.event, marks: reconciled };
  }
  if (cm.meta) ctx.checksMeta.push(cm.meta);
}

async function* emitCoverage(ctx: HarnessCtx, coverage: ReturnType<typeof startCoverage>): AsyncGenerator<HarnessEvent> {
  const cov = await resolveAnswerCoverage(coverage.promise, coverage.model);
  if (cov.event) yield cov.event;
  if (cov.meta) ctx.checksMeta.push(cov.meta);
}

// RESOLUTION order is load-bearing and differs from emission order: the quote
// lane resolves first (in `gate` mode it changes `checks`, which the verify
// row stores), then the audit (so the marks can be reconciled against its
// verdict — an agreed contradiction sourced to a cited doc withholds that
// doc's ✓, see verify/disputes.ts). Total latency is unaffected: every lane
// was started concurrently above and all are awaited before the final done.
export async function* runLanes(ctx: HarnessCtx, input: LaneInput): AsyncGenerator<HarnessEvent> {
  const marks = startMarks(ctx, input.done);
  const coverage = startCoverage(ctx, input.done, input.ruledSmalltalk);
  const quoteLane = startQuoteLane(ctx, input.done, input.split.atlasTexts);
  const audit = yield* startAudit(ctx, input);
  const quote = quoteLane.promise ? await quoteLane.promise : null;
  const checks = quote && config.chatQuoteAttribution === "gate" ? gateQuotes(input.checks, quoteLane.spans, quote) : input.checks;
  const verdict = audit ? await resolveAudit(ctx, audit.promise, checks) : null;
  yield* emitMarks(ctx, marks, verdict);
  yield* emitCoverage(ctx, coverage);
  if (quote) ctx.checksMeta.push(quoteAttributionRow(quote, quoteLane.spans.length));
  const overall = ctx.verifierModel ? computeOverall(checks, verdict) : checks.failed ? "fail" : "unverified";
  // Deterministic-only turns stay quiet unless something actually failed —
  // a permanent "unverified" chip on every clean answer is noise, not signal.
  if (ctx.verifierModel !== "" || checks.failed) yield verifyEvent(overall, verdict, checks);
  yield finishDone(ctx, input.done);
}
