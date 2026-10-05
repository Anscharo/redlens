// The model lanes after `answer_final`: chip marks, coverage, quote attribution
// and the audit. All start concurrently; emit order is fixed by HarnessEvent.
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

// Provenance comes from the RAW transcript, not the audit's `evidence`: that
// array is budget-evicted, so a doc read early could look unretrieved.
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

// Skipped for a turn ruled small talk: no facts were expected. Marked handled
// at creation because nothing awaits it until marks and audit settle.
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

// Wrapped in an object because an async generator awaits a promise it returns.
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
  // Marks it handled while other lanes resolve; resolveAudit's await still rethrows.
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

// Reconciles the WIRE event only; the reload path (conversations/detail.ts)
// uses the same agreedContradictionsFrom so the two cannot diverge. The
// persisted citation_check row stays unreconciled as the lane's calibration record.
async function* emitMarks(ctx: HarnessCtx, marks: ReturnType<typeof startMarks>, verdict: Verdict | null): AsyncGenerator<HarnessEvent> {
  const cm = await resolveCitationMarks(marks.promise, marks.model);
  if (cm.event) {
    const reconciled = withoutDisputedMarks(cm.event.marks, agreedContradictionsFrom(verdict));
    if (Object.keys(reconciled).length > 0) yield { ...cm.event, marks: reconciled };
  }
  if (cm.meta) ctx.checksMeta.push(cm.meta);
}

async function* emitCoverage(ctx: HarnessCtx, coverage: ReturnType<typeof startCoverage>): AsyncGenerator<HarnessEvent> {
  const cov = await resolveAnswerCoverage(coverage.promise, coverage.model);
  if (cov.event) yield cov.event;
  if (cov.meta) ctx.checksMeta.push(cov.meta);
}

// Resolution order is load-bearing: quotes first (`gate` mode changes
// `checks`), then the audit (marks reconcile against its verdict, see disputes.ts).
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
  // Deterministic-only turns stay quiet unless something failed.
  if (ctx.verifierModel !== "" || checks.failed) yield verifyEvent(overall, verdict, checks);
  yield finishDone(ctx, input.done);
}
