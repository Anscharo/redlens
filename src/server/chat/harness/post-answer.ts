// Everything after the conversationalist's `done`: the checks-off exit, the
// small-talk bypass, deterministic repair + checks, and the hand-off to the
// model lanes (lane-pass.ts). Every exit yields exactly one terminal done.
import { config } from "../../config.ts";
import { captureError, captureEvent } from "../../posthog-node.ts";
import { isUncheckableAnswer } from "../verify/smalltalk.ts";
import { evidenceFromTranscript, type EvidenceEntry } from "../verify/verifier.ts";
import type { CheckReport } from "../verify/verify-checks.ts";
import type { createRoundChecker } from "../verify/round-checks.ts";
import { applyTeachHint, identifiersMeta, normalizeAndRepair, refsMeta, repairedChecks, splitFromTranscript, toolTextsOf } from "./repair.ts";
import { runLanes } from "./lane-pass.ts";
import { finishDone, type HarnessCtx } from "./context.ts";
import type { CheckRowMeta, DoneEvent, HarnessEvent } from "./types.ts";

// No audit, but done.content still gets the repair the streaming gate applied:
// the client treats done.content as authoritative and would revert to the bad link.
function repairUnaudited(ctx: HarnessCtx, done: DoneEvent): DoneEvent {
  if (ctx.opts.signal?.aborted || !done.content.trim()) return done;
  try {
    const { repair } = normalizeAndRepair(done.content, toolTextsOf(done.transcript), ctx.opts.ix);
    if (repair.content !== done.content) done = { ...done, content: repair.content };
  } catch (err) {
    captureError(err, ctx.opts.obs, { stage: "citation_repair_verify_disabled" });
  }
  return applyTeachHint(done);
}

// ── Small-talk bypass ────────────────────────────────────────────────────
// Skips the audit only when the judge fired, no tool ran, the answer has
// nothing checkable (smalltalk.ts), and the judge rules the message expects
// no facts; every failure falls toward auditing. The judge row is always
// recorded so its tokens count toward quota.
async function smalltalkRuling(ctx: HarnessCtx, judgePromise: NonNullable<HarnessCtx["judgePromise"]>, done: DoneEvent) {
  const judge = await judgePromise; // long since resolved — it raced the whole answer
  ctx.checksMeta.push({
    kind: "smalltalk_judge", model: ctx.smalltalkJudgeModel,
    // Raw p kept: moving the threshold needs the distribution.
    verdict: { smalltalk: judge.smalltalk, p: judge.p }, overall: null,
    inputTokens: judge.usage?.input ?? null, outputTokens: judge.usage?.output ?? null,
    generationId: judge.generationId, latencyMs: judge.latencyMs,
  });
  const bypass = done.toolCalls.length === 0 && !done.lengthCapped && isUncheckableAnswer(done.content) && judge.smalltalk;
  return { ruledSmalltalk: judge.smalltalk, bypass };
}

function roundChecksRow(
  telemetry: ReturnType<ReturnType<typeof createRoundChecker>["telemetry"]>,
  repaired: ReturnType<typeof normalizeAndRepair>,
  checks: CheckReport,
  counts: { paragraphs: number; flagged: number },
): CheckRowMeta {
  const { refs, repair, identifiers } = repaired;
  return {
    kind: "round_checks", model: null,
    verdict: {
      telemetry, repair: { repaired: repair.repaired, stripped: repair.stripped, retitled: repair.retitled },
      refs: refsMeta(refs), identifiers: identifiersMeta(identifiers), checks: { ...checks, citations: checks.citations.length },
      incremental: { paragraphs: counts.paragraphs, flagged: counts.flagged },
      refuteMode: config.chatRefuteMode,
    },
    overall: null, inputTokens: null, outputTokens: null, generationId: null, latencyMs: null,
  };
}

// Normalization and repair on the FULL tool texts (no evidence budget). The
// answer has already streamed, so a throw returns null and the caller skips
// verification rather than losing the answer.
function repairAndCheck(ctx: HarnessCtx, held: { done: DoneEvent }, evidence: EvidenceEntry[]) {
  const telemetry = ctx.checker.telemetry();
  try {
    const toolTexts = toolTextsOf(held.done.transcript);
    const repaired = normalizeAndRepair(held.done.content, toolTexts, ctx.opts.ix);
    if (repaired.repair.content !== held.done.content) held.done = { ...held.done, content: repaired.repair.content };
    const split = splitFromTranscript(held.done.transcript);
    const checks = repairedChecks(held.done.content, toolTexts, ctx.opts.ix, held.done.lengthCapped, { question: ctx.opts.question, evidence }, split);
    ctx.checksMeta.push(roundChecksRow(telemetry, repaired, checks, ctx.paragraphs.counts));
    return { checks, split };
  } catch (err) {
    captureError(err, ctx.opts.obs, { stage: "citation_repair_or_checks" });
    return null;
  }
}

// Shown only when there is a basis to compare against; otherwise the audit runs silently.
function comparingStatus(evidenceCount: number): HarnessEvent {
  return {
    type: "status", stage: "comparing",
    detail: evidenceCount > 0 ? "Comparing the draft against what was looked up…" : "Comparing the draft against the conversation so far…",
  };
}

// ── Verification (deterministic always; model audit when configured) ─────
async function* verifyAnswer(ctx: HarnessCtx, done: DoneEvent, ruledSmalltalk: boolean): AsyncGenerator<HarnessEvent> {
  const evidence = evidenceFromTranscript(done.transcript);
  const grounded = evidence.length > 0 || ctx.prevEvidence !== null;
  if (grounded) yield comparingStatus(evidence.length);
  const held = { done };
  const checked = repairAndCheck(ctx, held, evidence);
  if (!checked) {
    yield finishDone(ctx, applyTeachHint(held.done));
    return;
  }
  // done.content is final here, so the client reveals it without waiting on the audit.
  const final = applyTeachHint(held.done);
  yield { type: "answer_final", content: final.content };
  yield* runLanes(ctx, { done: final, checks: checked.checks, split: checked.split, evidence, grounded, ruledSmalltalk });
}

export async function* finishTurn(ctx: HarnessCtx, done: DoneEvent): AsyncGenerator<HarnessEvent> {
  if (!config.chatVerifyChecks || ctx.opts.signal?.aborted || !done.content.trim()) {
    yield finishDone(ctx, repairUnaudited(ctx, done));
    return;
  }
  const ruling = ctx.judgePromise ? await smalltalkRuling(ctx, ctx.judgePromise, done) : { ruledSmalltalk: false, bypass: false };
  if (ruling.bypass) {
    captureEvent("chat_smalltalk_bypass", ctx.opts.obs, { chars: done.content.length });
    yield finishDone(ctx, applyTeachHint(done));
    return;
  }
  yield* verifyAnswer(ctx, done, ruling.ruledSmalltalk);
}
