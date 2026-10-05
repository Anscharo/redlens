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

// No audit runs here — but the streaming gate already repaired links in the
// token stream, and the client treats done.content as authoritative. Without
// the same repair applied to done.content, the client swaps the repaired
// stream back to the invalid link at completion (the exact bug this gate
// exists to prevent). Verification being off must not lose the repair.
// Aborted/empty answers have nothing meaningful to repair, so skip them.
// Normalization runs here too: with checks off this is the only thing
// standing between a malformed reference citation and the user.
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
// Skips the audit for pure greetings — behind deterministic conditions plus
// the concurrent judge, every one fail-closed toward auditing:
//   1. the judge fired at all (model configured + the question itself
//      contains nothing groundable);
//   2. zero tool rounds — the conversationalist itself judged no atlas was
//      needed (the system prompt tells it plain conversation is tool-free);
//   3. the answer contains nothing checkable — no doc numbers, links
//      (markdown or bare autolink), reference labels, addresses, figures,
//      or slug/code spans (smalltalk.ts) — a zero-tool answer that cites
//      or quantifies is exactly the hallucination case the verifier exists
//      for;
//   4. the judge, given the USER MESSAGE, rules it expects no factual
//      content. This closes the hole the answer-side predicate can't see:
//      "is the fee governance-controlled?" answered with a marker-free
//      "Yes." Judge failure/timeout/garbage = not small talk = full audit.
// On bypass the answer returns immediately — no comparing/checking ticker,
// no verify chip. Citation repair is provably a no-op here (condition 3
// rejects every link/label shape), so it is skipped too. The judge call is
// always recorded in checksMeta when it fired — even if the ruling is
// discarded because tools ran or the answer is checkable — so its tokens
// land in message_checks and count toward the rate-limit window like every
// other harness call. The state is tiny (one message + the question's
// criteria, ~340 input tokens, output free) but it is still a billed call.
// `ruledSmalltalk` outlives the bypass: a turn the judge ruled small talk that
// still goes on to the full audit (a tool ran, or the answer carries a link)
// also skips the answer-coverage check.
async function smalltalkRuling(ctx: HarnessCtx, judgePromise: NonNullable<HarnessCtx["judgePromise"]>, done: DoneEvent) {
  const judge = await judgePromise; // long since resolved — it raced the whole answer
  ctx.checksMeta.push({
    kind: "smalltalk_judge", model: ctx.smalltalkJudgeModel,
    // The raw probability is recorded alongside the ruling: the threshold is
    // ours, so a future move needs the distribution, not just the verdict.
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

// Reference-link normalization, then citation repair, on the FULL tool texts
// (the verifier evidence budget doesn't apply to free string scans). The
// streaming gate already applied the same judge to the token stream, so this
// pass normally agrees with what streamed — it is the authority and the
// record (repaired/stripped feed the checks), and done.content stays
// authoritative client-side for the rare case where the gate had to flush a
// malformed link raw.
//
// This is pure post-processing of an answer that has ALREADY streamed to the
// client. A throw here must never lose that answer: it returns null and the
// caller degrades to "skip verification" (same as the config-off path) with
// whatever repair already landed in `held.done`, rather than letting the
// exception propagate out and skip persistAssistant entirely.
function repairAndCheck(ctx: HarnessCtx, held: { done: DoneEvent }, evidence: EvidenceEntry[]) {
  const telemetry = ctx.checker.telemetry();
  try {
    const toolTexts = toolTextsOf(held.done.transcript);
    const repaired = normalizeAndRepair(held.done.content, toolTexts, ctx.opts.ix);
    if (repaired.repair.content !== held.done.content) held.done = { ...held.done, content: repaired.repair.content };
    // Kept so the quote-attribution lane can reuse the same atlas/external split
    // the deterministic checks were run against, rather than re-deriving it.
    const split = splitFromTranscript(held.done.transcript);
    const checks = repairedChecks(held.done.content, toolTexts, ctx.opts.ix, held.done.lengthCapped, { question: ctx.opts.question, evidence }, split);
    ctx.checksMeta.push(roundChecksRow(telemetry, repaired, checks, ctx.paragraphs.counts));
    return { checks, split };
  } catch (err) {
    captureError(err, ctx.opts.obs, { stage: "citation_repair_or_checks" });
    return null;
  }
}

// Entering verification is progress worth surfacing — but only when there is
// something to name as the basis: this turn's retrievals, or earlier turns
// of the conversation. With neither (a tool-free answer that still carries
// groundable content — pure small talk exited before this) the audit still
// runs, silently — announcing a comparison against nothing is worse than no
// ticker at all, and the verdict badge is the outcome channel either way.
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
  // done.content is final past this point — deterministic repair has already
  // run and rewrites are gone, so the client reveals the answer now and lets
  // the verify badge trail rather than waiting on the audit.
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
    // Same backstop as every other exit: a miss-shaped answer that the judge
    // happened to rule small talk still gets the /teach invitation.
    yield finishDone(ctx, applyTeachHint(done));
    return;
  }
  yield* verifyAnswer(ctx, done, ruling.ruledSmalltalk);
}
