// Pure agentic chat loop. The LLM is injected (ChatStream), so this whole module
// unit-tests with a fake stream — no network, no API key, no Postgres. The SSE
// handler (/api/chat) wraps a real OpenRouter stream around it and handles
// auth + persistence; this file owns only the tool-calling control flow.
//
// Constraints baked in (see docs/plans/archive/chatbot-plan.md):
//   - hard maxIterations cap (the system-prompt budget is advisory)
//   - final allowed iteration forces tool_choice:"none" → a text answer, never a
//     dangling tool round
//   - aborts mid-stream on signal (orphaned tool rounds burn tokens)
//   - usage + generation id are surfaced for rate-limiting + cost backfill
//
// The phases live under loop/: stream-round.ts reads one request,
// tool-round.ts runs a round's tool calls, finish.ts owns every way a turn
// ends (and the guards that buy one more attempt), steers.ts the transient
// system steers.
import { config } from "../config.ts";
import { modelRound } from "./loop/stream-round.ts";
import { runToolRound, usableCalls } from "./loop/tool-round.ts";
import { doneEvent, finishAfterRepetition, finishWithAnswer, retryPromisedTool } from "./loop/finish.ts";
import type { ChatEvent, LoopCtx, RunChatOpts } from "./loop/types.ts";

export type { ChatStream, ToolCallRecord, ChatEvent, RoundInfo } from "./loop/types.ts";
export { isErrorResult } from "./loop/tool-round.ts";
export { reasoningDelta } from "./loop/stream-round.ts";
export { exportEvidence } from "./loop/export-evidence.ts";

type IterationEnd = "continue" | "finished" | "aborted";

async function* runIteration(ctx: LoopCtx, iter: number): AsyncGenerator<ChatEvent, IterationEnd> {
  const last = iter === ctx.max - 1;
  const round = yield* modelRound(ctx, iter, last);
  if (ctx.opts.signal?.aborted) return "aborted";
  if (round.degenerated) {
    yield* finishAfterRepetition(ctx, iter, round.content);
    return "finished";
  }
  // A tool round. Trust the accumulated `pending` map directly rather than
  // gating on finish_reason === "tool_calls": OpenRouter fans a tier out
  // across several providers (model-router.ts), and not all of them report
  // finish_reason:"tool_calls" for a round that streamed tool_calls deltas —
  // some report "stop". Gating on finish_reason would silently drop those
  // accumulated calls and ship whatever (usually empty) content had streamed
  // as the final answer. The pending-map rule is provider-agnostic on purpose.
  // Still excluded on `last`, the forced-text final iteration
  // (toolChoice:"none"), where a tool round is never valid.
  //
  // finish_reason:"length" means the stream was cut mid-generation — any
  // pending tool call has truncated `arguments` JSON, so executing it would
  // run the tool with wrong/empty args and hide the truncation from the
  // caller. Fall through to the answer path instead, which reports
  // lengthCapped: true (a hard failure).
  const calls = usableCalls(ctx, iter, round);
  if (calls.length > 0 && !last && round.finishReason !== "length") {
    yield* runToolRound(ctx, iter, round.content, calls);
    return "continue";
  }
  if (yield* retryPromisedTool(ctx, iter, last, round)) return "continue";
  yield* finishWithAnswer(ctx, iter, round);
  return "finished";
}

function newLoopCtx(opts: RunChatOpts): LoopCtx {
  return {
    opts,
    msgs: [...opts.messages],
    max: Math.max(1, opts.maxIterations ?? config.chatMaxIterations),
    toolCalls: [],
    promisedToolRetried: false,
    pendingSteer: null,
    usageIn: 0,
    usageOut: 0,
    contextTokens: null,
    generationId: null,
  };
}

export async function* runChat(opts: RunChatOpts): AsyncGenerator<ChatEvent> {
  const ctx = newLoopCtx(opts);
  for (let iter = 0; iter < ctx.max; iter++) {
    if (opts.signal?.aborted) break;
    const end = yield* runIteration(ctx, iter);
    if (end === "finished") return;
    if (end === "aborted") break;
  }
  // Reached only if aborted, or maxIterations somehow exhausted without a text
  // answer. Emit a terminal event so callers can persist + close cleanly.
  yield doneEvent(ctx, "", false);
}
