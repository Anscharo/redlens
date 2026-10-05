// Consuming one streamed model request. The main loop's rounds and the
// one-shot no-tools attempts (compose guard, repetition rewrite) read chunks
// through the same streamRound, so reasoning, repetition, usage and generation
// id are handled identically on both paths.
import { CHAT_TOOLS } from "../tools/llm-tools.ts";
import { isRepetitionLoop } from "../repetition-guard.ts";
import { EARLY_ANSWER_NUDGE, FINAL_TURN_INSTRUCTION } from "./steers.ts";
import type { ChatEvent, Chunk, LoopCtx, Msg, PendingCall, RoundOutput, StreamAcc } from "./types.ts";

// OpenRouter normalises a provider's "thinking" trace onto `delta.reasoning`
// (a string), but some providers send `delta.reasoning_content` instead, and
// some send a `reasoning_details` array of parts. The OpenAI SDK's
// ChatCompletionChunk/delta type declares none of these — this is the one
// place that casts through the unknown shapes, so every chunk-consuming path
// reads reasoning identically and can never drift.
export function reasoningDelta(delta: unknown): string {
  if (!delta || typeof delta !== "object") return "";
  const d = delta as { reasoning?: unknown; reasoning_content?: unknown; reasoning_details?: unknown };
  if (typeof d.reasoning === "string") return d.reasoning;
  if (typeof d.reasoning_content === "string") return d.reasoning_content;
  if (Array.isArray(d.reasoning_details)) {
    let out = "";
    for (const part of d.reasoning_details) {
      if (!part || typeof part !== "object") continue;
      const p = part as { text?: unknown; summary?: unknown };
      if (typeof p.text === "string") out += p.text;
      else if (typeof p.summary === "string") out += p.summary;
    }
    return out;
  }
  return "";
}

type ToolCallDeltas = NonNullable<Chunk["choices"][number]["delta"]["tool_calls"]>;

function accumulateToolCalls(pending: Map<number, PendingCall>, deltas: ToolCallDeltas | undefined): void {
  for (const tc of deltas ?? []) {
    const slot = pending.get(tc.index) ?? { id: "", name: "", args: "" };
    if (tc.id) slot.id = tc.id;
    if (tc.function?.name) slot.name += tc.function.name;
    if (tc.function?.arguments) slot.args += tc.function.arguments;
    pending.set(tc.index, slot);
  }
}

// include_usage emits ONE usage chunk per request, and the loop makes one
// request per tool round — so ACCUMULATE across rounds (overwriting would
// record only the final round and undercount the rate-limit gate 2–3× on
// tool-heavy answers). contextTokens is the opposite: overwritten, because it
// is the real per-request context size and only the LAST request's value
// describes the context the shipped answer was produced against — including a
// compose or repetition-rewrite request, whose prompt IS the current context.
function noteUsage(chunk: Chunk, acc: StreamAcc): void {
  if (!chunk.usage) return;
  acc.usageIn += chunk.usage.prompt_tokens ?? 0;
  acc.usageOut += chunk.usage.completion_tokens ?? 0;
  if (chunk.usage.prompt_tokens) acc.contextTokens = chunk.usage.prompt_tokens;
}

// OpenRouter exposes the generation id as the chunk id (gen-…); the cost
// reconciler later looks this up. Multi-round answers have one gen-id per
// round and only the last is kept, so async cost backfill undercounts
// multi-round cost.
function noteGenerationId(chunk: Chunk, acc: StreamAcc): void {
  if (typeof chunk.id === "string" && chunk.id.startsWith("gen-")) acc.generationId = chunk.id;
}

/** Appends answer text; true when it tripped the repetition handbrake (and aborted the request). */
function appendDegenerates(out: RoundOutput, text: string, ac: AbortController): boolean {
  out.content += text;
  if (!isRepetitionLoop(out.content)) return false;
  out.degenerated = true;
  ac.abort();
  return true;
}

// Reads one request to its end, yielding reasoning and answer tokens. A
// mid-stream repetition loop aborts the provider call through `ac` (a local
// controller, so the user's signal is not treated as cancelled) and reports
// degenerated:true. Tool-call deltas are accumulated; a forced-text caller
// ignores them.
export async function* streamRound(
  stream: AsyncIterable<Chunk>, acc: StreamAcc, userSignal: AbortSignal | undefined, ac: AbortController,
): AsyncGenerator<ChatEvent, RoundOutput> {
  const out: RoundOutput = { content: "", finishReason: null, degenerated: false, pending: new Map() };
  for await (const chunk of stream) {
    if (userSignal?.aborted) break;
    noteGenerationId(chunk, acc);
    const choice = chunk.choices?.[0];
    const reasoning = reasoningDelta(choice?.delta);
    if (reasoning) yield { type: "reasoning", text: reasoning };
    if (choice?.delta?.content) {
      if (appendDegenerates(out, choice.delta.content, ac)) break;
      yield { type: "token", text: choice.delta.content };
    }
    accumulateToolCalls(out.pending, choice?.delta?.tool_calls);
    if (choice?.finish_reason) out.finishReason = choice.finish_reason;
    noteUsage(chunk, acc);
  }
  return out;
}

/** Opens a request whose signal also fires on a local abort. */
function openStream(ctx: LoopCtx, messages: Msg[], toolChoice: "auto" | "none", ac: AbortController) {
  const signal = ctx.opts.signal ? AbortSignal.any([ctx.opts.signal, ac.signal]) : ac.signal;
  return ctx.opts.stream({ messages, tools: CHAT_TOOLS, toolChoice, signal });
}

// One-shot no-tools text attempt (compose guard / repetition rewrite). Yields
// tokens like a normal answer round; tool-call deltas a model emits anyway
// are ignored. The steer rides only the request, never lands in msgs.
export async function* forcedTextAttempt(
  ctx: LoopCtx, steer: string,
): AsyncGenerator<ChatEvent, { content: string; lengthCapped: boolean; degenerated: boolean }> {
  const ac = new AbortController();
  const stream = openStream(ctx, [...ctx.msgs, { role: "system", content: steer }], "none", ac);
  const out = yield* streamRound(stream, ctx, ctx.opts.signal, ac);
  return { content: out.content, lengthCapped: out.finishReason === "length", degenerated: out.degenerated };
}

// Transient per-turn steering, never pushed onto msgs (not persisted, not
// resent): the final forced-text turn gets the answer-now instruction; any
// mid-loop turn after the first tool round gets the early-answer nudge.
// pendingSteer (the promised-tool retry) outranks the positional steers: the
// replay is iter > 0, and EARLY_ANSWER_NUDGE tells the model to answer
// instead of calling more tools — the exact opposite of what this retry is
// for. Consumed once, so the round after the replay steers normally again.
function takeSteer(ctx: LoopCtx, iter: number, last: boolean): string | null {
  const steer = ctx.pendingSteer ?? (last ? FINAL_TURN_INSTRUCTION : iter > 0 ? EARLY_ANSWER_NUDGE : null);
  ctx.pendingSteer = null;
  return steer;
}

/** One main-loop request: tools offered unless this is the final iteration. */
export async function* modelRound(ctx: LoopCtx, iter: number, last: boolean): AsyncGenerator<ChatEvent, RoundOutput> {
  const steer = takeSteer(ctx, iter, last);
  const turnMsgs: Msg[] = steer ? [...ctx.msgs, { role: "system", content: steer }] : ctx.msgs;
  // Per-round controller so a mid-stream repetition trip can abort the
  // provider call without treating the user's signal as cancelled.
  const roundAc = new AbortController();
  return yield* streamRound(openStream(ctx, turnMsgs, last ? "none" : "auto", roundAc), ctx, ctx.opts.signal, roundAc);
}
