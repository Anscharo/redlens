// The judged half of the small-talk bypass: one Jev Noul on the user's
// message, asking whether a reply to it needs any factual content. The
// deterministic half (which messages and answers qualify at all) is
// smalltalk.ts. This is the FINAL gate on skipping the audit, and it is
// fail-closed everywhere — a timeout, a transport error or an answer of the
// wrong type all rule "not small talk", which keeps the full audit.
//
// Replaced a chat-model classifier (google/gemma-4-26b-a4b-it, prompted for
// {"smalltalk": bool}) on 2026-09-22; see docs/plans/jev-typesafe.md §A0 for
// the bakeoff. Two structural differences carried the decision, beyond the
// accuracy gap:
//   1. There is no JSON to parse, so the old `chat_smalltalk_judge_unparseable`
//      failure mode cannot occur — a malformed answer is not representable.
//   2. The ruling arrives as P(yes), not a boolean, so the threshold is OURS.
//      The bypass is fail-closed by design, so the operating point is picked
//      from the dangerous-error direction: no factual message may be ruled
//      small talk.
import { askJev, noulOf } from "../../jev.ts";
import { captureError, type ErrorContext } from "../../posthog-node.ts";

export interface SmalltalkJevRun {
  smalltalk: boolean;
  /** Raw P(pure conversation). null when the call failed — never coerced to 0. */
  p: number | null;
  usage: { input: number; output: number } | null;
  costUsd: number | null;
  generationId: string | null;
  latencyMs: number | null;
}

// Jev reads LITERALLY, which is the whole risk in this seat: the dangerous
// class is a casual phrasing that looks like a courtesy but asks for facts
// ("what's new?", "any updates?", "help"). Those go in `false` verbatim,
// because the model cannot infer our product's reading of them from the
// bare words. The wording mirrors the retired chat-model prompt sentence for
// sentence, so the bakeoff compared two arms answering the SAME question
// rather than two differently-worded ones.
export const SMALLTALK_QUESTION = {
  type: "noul" as const,
  instructions:
    "The message in `message` is pure conversation whose reply needs no factual content. It was sent to a research assistant for the Sky ecosystem governance atlas.",
  criteria: {
    true:
      "Pure conversation only: a greeting, thanks, a farewell, a courtesy, an emoji, or a connectivity test such as \"are you there?\" or \"test\".",
    false:
      "Anything that expects facts, definitions, numbers, procedures, opinions, or any information about the Sky ecosystem or the atlas — including the assistant's own capabilities. Casual, brief or conversational phrasings still count as expecting facts: \"what's new?\", \"any updates?\", \"what changed?\", \"help\", \"what can you do?\", \"who are you?\", and a greeting with a question attached (\"hey, quick question — who approves budgets?\") are all false. When the message could go either way, false.",
  },
};

// DO NOT "strengthen" the false criterion with a clause about follow-ups
// ("a message referring back to something said earlier… is also false").
// It was written, measured and reverted on 2026-09-22: it read as the obvious
// hardening for the multi-turn expansion and it made the model WORSE. The
// wording above separates the two classes by 0.50/0.76; with the follow-up
// clause added the gap narrowed to 0.58/0.69, squeezing the shipped threshold
// from both sides at once. Accuracy stayed 100% either way, which is exactly
// why accuracy is not the metric to tune on here — the margin is.
// The criterion already handles follow-ups without being told: "is that
// everything?" scores 0.45, "so, thoughts?" 0.25, "what else?" 0.16.

// Default operating point, set by the bakeoff (scripts/aux/
// eval-smalltalk-judge.ts, 420 calls over 84 labeled cases, 2026-09-22): the
// two classes came back FULLY SEPARABLE, twice, with identical bounds —
// highest P(smalltalk) on a factual case 0.52, lowest on a small-talk case
// 0.75. This sits in the middle of that gap rather than on either edge, so
// neither side has to move first for a misruling to occur.
//
// Deliberately NOT the sweep's own "lowest threshold with 0 dangerous" (0.55):
// that point is 0.03 above the worst factual case and would convert any drift
// straight into the dangerous direction. The gap is the margin; spend half.
export const SMALLTALK_JEV_THRESHOLD = 0.65;

export async function judgeSmalltalkJev(params: {
  question: string;
  model?: string;
  threshold?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  obs?: ErrorContext;
}): Promise<SmalltalkJevRun> {
  // askJev's own timeoutMs is PER ATTEMPT, and it retries a 5xx three times
  // with backoff — so passing it alone would turn a "5000ms" judge into a
  // ~20s one, and the orchestrator awaits this promise before finishing the
  // turn. The deadline is therefore owned HERE and handed down as a signal:
  // askJev checks `params.signal?.aborted` before every retry, so an expired
  // deadline ends the loop instead of extending it. Same division as
  // retrieval/embed.ts (per-attempt) vs search.ts (external deadline).
  const deadlineMs = params.timeoutMs ?? 5000;
  const deadline = AbortSignal.timeout(deadlineMs);
  const signal = params.signal ? AbortSignal.any([params.signal, deadline]) : deadline;
  try {
    const run = await askJev({
      state: { message: params.question.slice(0, 2000) },
      questions: { smalltalk: SMALLTALK_QUESTION },
      model: params.model,
      signal,
      timeoutMs: deadlineMs,
    });
    const p = noulOf(run, "smalltalk");
    return {
      // null p (wrong answer type) is a failure, not a "no" — but it lands on
      // the same fail-closed outcome either way.
      smalltalk: p !== null && p >= (params.threshold ?? SMALLTALK_JEV_THRESHOLD),
      p,
      usage: run.usage,
      costUsd: run.cost,
      generationId: run.generationId,
      latencyMs: run.latencyMs,
    };
  } catch (err) {
    captureError(err, params.obs, { stage: "smalltalk_judge_jev", model: params.model });
    return { smalltalk: false, p: null, usage: null, costUsd: null, generationId: null, latencyMs: null };
  }
}
