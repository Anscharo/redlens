// How a turn ends: the terminal `done` event, the repetition handbrake, the
// promised-tool guard and the compose guard. Each guard is one-shot: a second
// failure ships as-is (or empty) rather than looping retries.
import { captureEvent } from "../../posthog-node.ts";
import { announcesUnmadeToolCall } from "../announcement.ts";
import { isRepetitionLoop } from "../repetition-guard.ts";
import { COMPOSE_STEER, PROMISED_TOOL_STEER, REPETITION_STEER } from "./steers.ts";
import { forcedTextAttempt } from "./stream-round.ts";
import type { ChatEvent, LoopCtx, RoundOutput } from "./types.ts";

export function doneEvent(ctx: LoopCtx, content: string, lengthCapped: boolean): Extract<ChatEvent, { type: "done" }> {
  return {
    type: "done",
    content,
    usage: { input: ctx.usageIn, output: ctx.usageOut },
    contextTokens: ctx.contextTokens,
    generationId: ctx.generationId,
    toolCalls: ctx.toolCalls,
    lengthCapped,
    transcript: content ? [...ctx.msgs, { role: "assistant", content }] : [...ctx.msgs],
  };
}

// Repetition handbrake: wipe whatever streamed, rewrite once with no tools.
// The bad draft never enters msgs. A second degeneration ships empty rather
// than looping retries (same one-shot policy as the compose guard).
export async function* finishAfterRepetition(ctx: LoopCtx, iter: number, draft: string): AsyncGenerator<ChatEvent> {
  captureEvent("chat_loop_repetition", ctx.opts.obs, { iter, chars: draft.length });
  yield { type: "clear", reason: "degenerate" };
  const rewritten = yield* forcedTextAttempt(ctx, REPETITION_STEER);
  let finalContent = rewritten.content;
  let capped = rewritten.lengthCapped;
  if (rewritten.degenerated || isRepetitionLoop(finalContent)) {
    captureEvent("chat_loop_repetition_retry_failed", ctx.opts.obs, { chars: finalContent.length });
    yield { type: "clear", reason: "degenerate" };
    finalContent = "";
    capped = false;
  }
  yield doneEvent(ctx, finalContent, capped);
}

// Promised-tool guard (chat/announcement.ts): the round wrote an
// announcement — "one moment while I search the atlas" — and called no
// tool, so accepting it as the final answer ships a promise. Buy one more
// round WITH tools instead. Deliberately narrow: only when the whole turn
// has retrieved nothing (a turn that already searched has evidence, so its
// prose is an answer), only when a round remains, and only once — a second
// announcement ships as-is, the same one-shot policy the compose and
// repetition guards use. Anything checkable in the text short-circuits
// announcesUnmadeToolCall before the embedding, which is what keeps
// features/glossary answers — legitimately tool-free — out of scope.
function promisedToolUnkept(ctx: LoopCtx, last: boolean, round: RoundOutput): boolean {
  return (
    !ctx.promisedToolRetried &&
    !last &&
    ctx.toolCalls.length === 0 &&
    !ctx.opts.signal?.aborted &&
    // A cut-off generation is a hard failure the orchestrator already reports
    // (lengthCapped); its truncated tail is not an announcement, and retrying
    // would swallow the signal.
    round.finishReason !== "length" &&
    announcesUnmadeToolCall(round.content)
  );
}

/** True when the guard fired and the loop should run one more round. */
export function* retryPromisedTool(ctx: LoopCtx, iter: number, last: boolean, round: RoundOutput): Generator<ChatEvent, boolean> {
  if (!promisedToolUnkept(ctx, last, round)) return false;
  ctx.promisedToolRetried = true;
  captureEvent("chat_loop_promised_tool", ctx.opts.obs, { iter, chars: round.content.length });
  // At iter === max - 2 the replay lands on `last`, where toolChoice is
  // "none" and the steer's "call the tool NOW" is unreachable. Not a bug and
  // not reachable at the default budget: the steer's second clause ("answer
  // it directly and completely instead") is what the model follows there,
  // and FINAL_TURN_INSTRUCTION already forbids describing further searches.
  // Same reason the client already understands: prose the model set aside
  // to go on searching. The reader never sees it (the answer only reveals
  // at `answer_final`/`done`), so this clear is a no-op for them and the
  // turn just spends one more round.
  yield { type: "clear", reason: "tool_round" };
  ctx.pendingSteer = PROMISED_TOOL_STEER;
  return true;
}

// Otherwise the streamed content is the final answer. If the round came
// back EMPTY (not aborted), the compose guard buys exactly one more
// no-tools attempt before the turn is allowed to end — an empty second
// attempt ships as-is rather than retrying forever. A compose that itself
// degenerates into a repetition loop is cleared the same way.
export async function* finishWithAnswer(ctx: LoopCtx, iter: number, round: RoundOutput): AsyncGenerator<ChatEvent> {
  let finalContent = round.content;
  let capped = round.finishReason === "length";
  if (!finalContent.trim() && !ctx.opts.signal?.aborted) {
    const composed = yield* forcedTextAttempt(ctx, COMPOSE_STEER);
    if (composed.degenerated || isRepetitionLoop(composed.content)) {
      captureEvent("chat_loop_repetition", ctx.opts.obs, { iter, chars: composed.content.length, stage: "compose" });
      yield { type: "clear", reason: "degenerate" };
      finalContent = "";
      capped = false;
    } else {
      finalContent = composed.content;
      capped = composed.lengthCapped;
    }
  }
  yield doneEvent(ctx, finalContent, capped);
}
