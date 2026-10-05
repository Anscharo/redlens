// One verified turn's state, built before the conversationalist streams: the
// evidence the streaming gate and the per-paragraph checks read, the
// per-paragraph refuter, and the concurrent small-talk judge.
import { config } from "../../config.ts";
import { createRoundChecker } from "../verify/round-checks.ts";
import { isUncheckableAnswer } from "../verify/smalltalk.ts";
import { judgeSmalltalkJev } from "../verify/smalltalk-jev.ts";
import { evidenceFromResults, evidenceFromTranscript, priorTurnsEvidence, type EvidenceEntry } from "../verify/verifier.ts";
import { sliceModels } from "../verify/sliced-verifier.ts";
import { createParagraphRefuter, type ParagraphRefuter } from "../verify/paragraph-refute.ts";
import { createLinkGate, type GateEvidence, type StreamGate } from "./link-gate.ts";
import { ParagraphTracker, paragraphEvidenceFrom } from "./paragraphs.ts";
import { refuteEvidenceBuilder, schemaEvidence } from "./evidence.ts";
import type { CheckRowMeta, DoneEvent, HarnessDone, VerifiedChatOpts } from "./types.ts";

export interface HarnessCtx {
  opts: VerifiedChatOpts;
  max: number;
  checker: ReturnType<typeof createRoundChecker>;
  // This turn's pre-stream material (the facts and /teach rounds). Lookup
  // cards from earlier turns are in `opts.messages` but evidenceFromTranscript
  // skips `rcall_` ids, so a card never becomes gate evidence — quoting still
  // requires a retrieval on this turn.
  historyEntries: EvidenceEntry[];
  gate: GateEvidence;
  linkGate: StreamGate;
  paragraphs: ParagraphTracker;
  verifierModel: string;
  paragraphMode: boolean;
  prevEvidence: EvidenceEntry | null;
  refuteEvidence: (turnEvidence: EvidenceEntry[], auditedText: string) => EvidenceEntry[];
  smalltalkJudgeModel: string;
  judgePromise: ReturnType<typeof judgeSmalltalkJev> | null;
  checksMeta: CheckRowMeta[];
}

type RefuteState = Pick<HarnessCtx, "verifierModel" | "paragraphMode" | "prevEvidence" | "refuteEvidence">;

// ── Per-paragraph refutation (CHAT_REFUTE_MODE="paragraph", the default) ──
// Runs the `refute` model audit per paragraph as it closes, instead of once
// over the finished answer (docs/chat-system.md §6.1) — the recall lever
// (per-paragraph reading catches contradictions a whole-answer read stays
// silent on) and the latency lever (the verdict is mostly ready by
// generation end). Created before streaming, not lazily at verification time,
// so submissions happen as paragraphs close — `settle()` at verification
// time then mostly collects work already done. Gated on chatVerifyChecks too
// (not just a configured model) so CHAT_VERIFY_CHECKS=0 spends nothing, same
// bar the whole-answer audit is held to.
function refuteState(opts: VerifiedChatOpts): RefuteState {
  const verifierModel = opts.jsonCall ? config.chatVerifierModel : "";
  // Prior-turn answers, computed ONCE from the pre-turn message list — the
  // slice this produces is identical whether read from opts.messages now or
  // from done.transcript after the loop (the last `user` message is the same
  // one either way; only tool/assistant messages of THIS turn get appended
  // after it), so the per-paragraph and whole-answer refute evidence share it.
  const prevEvidence = priorTurnsEvidence(opts.messages);
  return {
    verifierModel,
    paragraphMode: config.chatRefuteMode === "paragraph" && !!verifierModel && config.chatVerifyChecks,
    prevEvidence,
    // schemaEvidence once per turn, not once per paragraph: atlasDescribe walks
    // the whole graph and stringifies it, and the result is a pure function of
    // the index — so this keeps ~9 full-corpus scans off the streaming path.
    refuteEvidence: refuteEvidenceBuilder(opts.ix, schemaEvidence(opts.ix), prevEvidence),
  };
}

function createRefuter(opts: VerifiedChatOpts, historyEntries: EvidenceEntry[], gate: GateEvidence, refute: RefuteState): ParagraphRefuter | null {
  if (!refute.paragraphMode) return null;
  // Named history tool results (name preserved, unlike the gate's flat
  // strings) so evidenceFromResults can classify the prefetch round by name —
  // losing that name would silently drop both its [REFERENCE] class and its
  // budget-eviction exemption for every per-paragraph call.
  const historyResults = historyEntries.map((e) => ({ name: e.tool, content: e.content }));
  return createParagraphRefuter({
    call: opts.jsonCall!, model: sliceModels().refute, ix: opts.ix, question: opts.question,
    evidence: (paragraphText) => refute.refuteEvidence(evidenceFromResults([...historyResults, ...gate.results]), paragraphText),
    signal: opts.signal, timeoutMs: config.chatVerifierSliceTimeoutMs,
    concurrency: config.chatRefuteConcurrency, maxParagraphs: config.chatRefuteMaxParagraphs, obs: opts.obs,
  });
}

// ── Small-talk judge (concurrent — never blocks the answer) ──────────────
// Fired alongside the conversationalist, not after it, so its ruling has
// resolved by the time the stream ends; measured over paired message_checks
// rows it is never the slower of the two, so it is not on the critical path.
//
// ONE question-side gate: the message itself must contain nothing
// groundable ("what is A.1.6?" needs no judge to be ruled factual).
// judgeSmalltalkJev never rejects (fail-closed internally), so an unconsumed
// promise is safe to abandon, and it owns its own 5s deadline across retries.
//
// Every user message gets the judge, first turn or later: over real
// later-turn messages the two classes stay as separable as on first turns,
// and follow-up-shaped phrasings ("is that everything?", "so, thoughts?")
// score well under the 0.65 threshold. The judgment stays MESSAGE-ONLY:
// Jev's accuracy degrades as irrelevant state grows, and judging the words
// alone already errs toward auditing, which is the safe direction. The
// bypass's other conditions (zero tools, uncheckable ANSWER) do the heavy
// lifting on later turns.
function startSmalltalkJudge(opts: VerifiedChatOpts, model: string) {
  return model && isUncheckableAnswer(opts.question)
    ? judgeSmalltalkJev({ question: opts.question, model, signal: opts.signal, obs: opts.obs })
    : null;
}

export function createHarnessCtx(opts: VerifiedChatOpts): HarnessCtx {
  const checker = createRoundChecker();
  const historyEntries = evidenceFromTranscript(opts.messages, Infinity);
  const gate: GateEvidence = { texts: historyEntries.map((e) => e.content), results: [] };
  const refute = refuteState(opts);
  const refuter = createRefuter(opts, historyEntries, gate, refute);
  const paragraphs = new ParagraphTracker({
    ix: opts.ix, question: opts.question, evidence: paragraphEvidenceFrom(historyEntries, gate), refuter, obs: opts.obs,
  });
  const smalltalkJudgeModel = config.chatSmalltalkJudgeModel;
  return {
    opts, max: Math.max(1, opts.maxIterations ?? config.chatMaxIterations), checker, historyEntries, gate,
    linkGate: createLinkGate(opts.ix, opts.obs, gate), paragraphs, ...refute,
    smalltalkJudgeModel, judgePromise: startSmalltalkJudge(opts, smalltalkJudgeModel), checksMeta: [],
  };
}

/** The harness's terminal done: the loop's done plus every check row this turn wrote. */
export const finishDone = (ctx: HarnessCtx, d: DoneEvent): HarnessDone => ({ ...d, checksMeta: ctx.checksMeta });
