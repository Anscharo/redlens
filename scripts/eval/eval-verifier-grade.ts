// Grades one answer against one saved run's evidence with the production
// refutation-only verifier, for eval-verifier.ts.
import { config } from "../../src/server/config.ts";
import { openrouterJson } from "../../src/server/chat/llm.ts";
import type { loadIndexes } from "../../src/server/retrieval/indexes.ts";
import { runDeterministicChecks } from "../../src/server/chat/verify/verify-checks.ts";
import { computeOverall, type Verdict, type VerifyOverall } from "../../src/server/chat/verify/verifier.ts";
import { runSlicedVerifier, sliceModels } from "../../src/server/chat/verify/sliced-verifier.ts";
import { createParagraphRefuter } from "../../src/server/chat/verify/paragraph-refute.ts";
import { createParagraphSegmenter } from "../../src/server/chat/verify/paragraphs.ts";
import type { SavedRun } from "./eval-verifier-mutations.ts";

export interface Graded { overall: VerifyOverall; verdict: Verdict | null; discarded: number }
export interface GradeContext { mode: "answer" | "paragraph"; ix: ReturnType<typeof loadIndexes> }

type Checks = ReturnType<typeof runDeterministicChecks>;
type Models = ReturnType<typeof sliceModels>;

// The production per-paragraph refuter itself (not a second pool) — segmented
// with the SAME createParagraphSegmenter production streams through, fed the
// run's fixed evidence for every paragraph (there is no live gateResults/history
// to grow mid-stream here).
async function gradeParagraphs(ctx: GradeContext, models: Models, run: SavedRun, answer: string, checks: Checks): Promise<Graded> {
  const refuter = createParagraphRefuter({
    call: openrouterJson, model: models.refute, ix: ctx.ix, question: run.question,
    evidence: () => run.evidence, timeoutMs: config.chatVerifierSliceTimeoutMs,
    concurrency: 3, maxParagraphs: config.chatRefuteMaxParagraphs,
  });
  const seg = createParagraphSegmenter();
  let index = 0;
  for (const p of seg.push(answer)) refuter.submit(index++, p);
  const tail = seg.flush();
  if (tail) refuter.submit(index++, tail);
  const settleStart = Date.now();
  const paragraphRefutes = await refuter.settle(config.chatVerifierSliceTimeoutMs);
  const settleMs = Date.now() - settleStart;
  const res = await runSlicedVerifier({
    call: openrouterJson, models, ix: ctx.ix, question: run.question, answer, evidence: run.evidence, checks,
    paragraphRefutes, settleMs,
  });
  // No `refute` slice exists in paragraph mode — the miss-attribution
  // discard count lives on the merged verdict instead.
  const discarded = res.verdict?.paragraphs?.discarded ?? 0;
  return { overall: computeOverall(checks, res.verdict), verdict: res.verdict, discarded };
}

// `model`, when set, becomes CHAT_VERIFIER_MODEL for the duration of the call
// so sliceModels() routes every role (refute/overreach/confirm) to it, unless
// CHAT_VERIFIER_SLICE_MODELS overrides a role explicitly.
export async function grade(ctx: GradeContext, model: string | null, run: SavedRun, answer: string): Promise<Graded> {
  const checks = runDeterministicChecks(answer, run.evidence.map((e) => e.content), ctx.ix, {
    question: run.question,
    evidence: run.evidence,
  });
  if (!model) return { overall: checks.failed ? "fail" : "unverified", verdict: null, discarded: 0 };
  const prev = config.chatVerifierModel;
  config.chatVerifierModel = model;
  try {
    if (ctx.mode === "paragraph") return await gradeParagraphs(ctx, sliceModels(), run, answer, checks);
    const res = await runSlicedVerifier({
      call: openrouterJson, models: sliceModels(), ix: ctx.ix,
      question: run.question, answer, evidence: run.evidence, checks,
    });
    const discarded = res.slices.find((sl) => sl.slice === "refute")?.discarded ?? 0;
    return { overall: computeOverall(checks, res.verdict), verdict: res.verdict, discarded };
  } finally {
    config.chatVerifierModel = prev;
  }
}
