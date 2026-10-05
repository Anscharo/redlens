// ── Conversationalist pass (answer streams at full speed) ────────────────
// runChat behind the streaming citation gate, with live status events and
// the per-paragraph checks riding along. The loop's own `done` is held back:
// the harness emits its own terminal done after the post-answer pass.
import { runChat, type ChatEvent, type RoundInfo } from "../chat-loop.ts";
import { gatedChat } from "../verify/stream-link-gate.ts";
import { describeCall } from "./status-copy.ts";
import type { HarnessCtx } from "./context.ts";
import type { DoneEvent, HarnessEvent } from "./types.ts";

// Real progress, not a route-side inference: a burst is the run of tokens
// since the last tool_call (or since the stream started), and the FIRST
// token of each burst is preceded by a "synthesizing" status so the client
// can show it as a stage rather than silence before the draft appears.
interface Burst {
  announced: boolean;
  sawToolCall: boolean;
}

function onRoundEnd(ctx: HarnessCtx): (info: RoundInfo) => void {
  return (info) => {
    ctx.checker.record(info);
    for (const r of info.results) {
      ctx.gate.texts.push(r.content);
      ctx.gate.results.push({ name: r.name, content: r.content });
    }
    ctx.linkGate.invalidate();
  };
}

function loopEvents(ctx: HarnessCtx): AsyncGenerator<ChatEvent> {
  const { opts } = ctx;
  return gatedChat(
    runChat({
      ix: opts.ix, messages: opts.messages, stream: opts.stream, signal: opts.signal, maxIterations: ctx.max,
      onRoundEnd: onRoundEnd(ctx), obs: opts.obs, jsonCall: opts.jsonCall, userQuestion: opts.question,
    }),
    ctx.linkGate.makeGate,
  );
}

// "Writing an answer from the evidence" is only TRUE when there is evidence.
// A turn that called no tools and had nothing injected is small talk or a
// conversational reply, and that copy reads as a false claim under a row
// with no Sources and no lookups beneath it. `historyEntries` is this turn's
// pre-stream material (the facts and /teach rounds; the dispute round is
// deliberately not evidence — see verifier.ts's classifyToolSource),
// sawToolCall covers anything looked up mid-stream, and prevEvidence covers
// a turn grounded in EARLIER TURNS rather than a lookup — that one has no
// tool round and nothing injected, yet is genuinely written from evidence
// (its own later statuses say "against the conversation so far"). Together
// these are `grounded`'s definition at the post-answer pass, just computed
// live. Deliberately NOT the small-talk judge: that runs after the answer,
// long after this status has to be sent.
function synthesizingStatus(ctx: HarnessCtx, burst: Burst): HarnessEvent {
  burst.announced = true;
  const grounded = burst.sawToolCall || ctx.historyEntries.length > 0 || ctx.prevEvidence !== null;
  return { type: "status", stage: "synthesizing", detail: grounded ? "Writing an answer from the evidence…" : "Responding…" };
}

function* onToolCall(ctx: HarnessCtx, burst: Burst, ev: Extract<ChatEvent, { type: "tool_call" }>): Generator<HarnessEvent> {
  burst.sawToolCall = true; // this burst has evidence behind it
  ctx.paragraphs.reset(); // the buffered draft is being set aside
  burst.announced = false; // next generation round re-announces
  yield { type: "status", stage: "querying", detail: describeCall(ev.name, ev.args) };
  yield ev;
}

function* forwardEvent(ctx: HarnessCtx, burst: Burst, ev: ChatEvent): Generator<HarnessEvent> {
  if (ev.type === "tool_call") return yield* onToolCall(ctx, burst, ev);
  if (ev.type === "clear") {
    ctx.paragraphs.reset(); // the buffered draft is being set aside
    yield ev;
    return;
  }
  if (ev.type === "token" && !burst.announced) yield synthesizingStatus(ctx, burst);
  yield ev;
  if (ev.type === "token") yield* ctx.paragraphs.push(ev.text);
  yield* ctx.paragraphs.drain();
}

/** Streams the answer; returns the loop's done (null only if the loop never sent one). */
export async function* streamAnswer(ctx: HarnessCtx): AsyncGenerator<HarnessEvent, DoneEvent | null> {
  const burst: Burst = { announced: false, sawToolCall: false };
  for await (const ev of loopEvents(ctx)) {
    // Flush the trailing paragraph before returning — still inside the
    // streaming loop, ahead of the bypass/checks-off exits, so it fires on
    // every turn with a non-empty draft regardless of what happens to the
    // answer afterward.
    if (ev.type === "done") {
      yield* ctx.paragraphs.flushTail();
      return ev;
    }
    yield* forwardEvent(ctx, burst, ev);
  }
  return null;
}
