// The SSE body of POST /api/chat. Owns the chat slot from the moment it is
// constructed: its `finally` releases it, whatever happens inside.
import { makeOpenrouterStream, makeOpenrouterJson } from "../llm.ts";
import { runVerifiedChat, sanitizeDone, type HarnessDone } from "../chat-orchestrator.ts";
import { summarizeFacts } from "../../facts/registry.ts";
import { compactTurn } from "../compact-turn.ts";
import { isContextOverflowError, noteContextOverflow } from "../context-overflow.ts";
import { attachRecall } from "../tool-recall.ts";
import type { RecallToolCall } from "../tool-recall-card.ts";
import { config } from "../../config.ts";
import { releaseChatSlot } from "../concurrency.ts";
import { captureError } from "../../posthog-node.ts";
import { summarizeTeachings } from "../teach/inject.ts";
import { persistAssistant, titleIfDue } from "./persist.ts";
import { runTeachTurn } from "./teach-turn.ts";
import { replayAfter, usedAfter, type ChatTurn } from "./turn.ts";
import { chatToolContext } from "../conversation-access.ts";

export type Send = (e: { type: string } & Record<string, unknown>) => void;
type PreparedTurn = NonNullable<ChatTurn["turn"]>;

// Facts ran before the model did, and they shape the answer — so say so
// rather than letting injected context look like the model knowing
// things. Both surfaces the client already has: a trace row per fact,
// and a stage the ticker/checklist shows like any other step.
// Teachings ride the same ticker so a recalled note is never silent.
function sendRecalled({ facts, teachings }: PreparedTurn, send: Send): void {
  const recalled = [
    ...(facts?.used ?? []),
    ...(teachings ? [{ id: "teachings", summary: summarizeTeachings(teachings.length) }] : []),
  ];
  if (recalled.length === 0) return;
  send({
    type: "facts",
    facts: recalled,
    bytes: (facts?.content.length ?? 0) + (teachings ? teachings.reduce((n, t) => n + t.content.length, 0) : 0),
  });
  send({ type: "status", stage: "recalling", detail: summarizeFacts({ content: "", counts: {}, used: recalled }) });
}

// runVerifiedChat = runChat wrapped in the reliability harness (status
// events, deterministic checks, verifier audit — model slots are env-gated,
// unset = pass-through). done carries the internal transcript/checksMeta;
// sanitizeDone strips them off the wire. Every other event is forwarded
// as-is; the client renders a stage checklist and reveals the answer on
// `answer_final` (see chat-orchestrator.ts).
async function forwardHarness(t: ChatTurn, turn: PreparedTurn, send: Send) {
  let done: HarnessDone | null = null;
  let carded: RecallToolCall[] = [];
  const chatStream = makeOpenrouterStream(t.obs, turn.models);
  for await (const ev of runVerifiedChat({
    ix: t.ix, messages: turn.messages, stream: chatStream, jsonCall: makeOpenrouterJson(t.obs),
    question: t.body.message, signal: t.req.signal, obs: t.obs, maxIterations: turn.maxIterations,
    toolCtx: { ...chatToolContext(t.userId, t.req.signal, t.scope, t.obs), largeRead: turn.largeRead },
  })) {
    if (ev.type !== "done") {
      send(ev);
      continue;
    }
    done = ev as HarnessDone;
    // Lookup cards are minted ONCE here, before the number that counts them
    // goes on the wire, and the same carded calls are what persistAssistant
    // stores — so the size the meter reports is the size the next turn
    // actually replays.
    carded = done.toolCalls.length ? attachRecall(done.toolCalls, done.transcript) : [];
    send({ ...sanitizeDone(done), contextUsed: usedAfter(t, done.content, carded, done.checksMeta) });
  }
  return { done, carded };
}

async function runAnswerTurn(t: ChatTurn, turn: PreparedTurn, send: Send): Promise<void> {
  sendRecalled(turn, send);
  const { done, carded } = await forwardHarness(t, turn, send);
  // Don't persist an empty assistant row for an aborted turn.
  if (!done || t.req.signal.aborted) return;
  await persistAssistant(t.userId, t.convId, { ...done, toolCalls: carded }, Date.now() - t.startedAt, t.obs);
  // Compact here rather than before the first token: this summary is for the
  // NEXT turn, so nobody is waiting on it. Unawaited for the same reason
  // titling is, and only after persistence because the answer it summarizes
  // past is only stored on this branch.
  void compactTurn({
    convId: t.convId, rows: replayAfter(t, done.content, carded, done.checksMeta), summary: t.summary,
    call: makeOpenrouterJson(t.obs, "atlas-chat-summary"), obs: t.obs,
  }).catch((err) => captureError(err, t.obs, { stage: "compact_summary" }));
  titleIfDue(t, done.content);
}

// A provider that rejects the request for length is the one error we can act
// on: noteContextOverflow flags the conversation so its next turn compacts the
// prefix even though our estimate said it fit, AND returns the user-facing
// wording, so what we promise and what the next turn does cannot drift apart.
// Everything else forwards its message.
function reportStreamError(t: ChatTurn, err: unknown, send: Send): void {
  if (t.req.signal.aborted) return;
  captureError(err, t.obs, { stage: "stream_handler" });
  const message = isContextOverflowError(err)
    ? noteContextOverflow(t.convId, { forcedThisTurn: t.forcedCompaction, compactionEnabled: !!config.chatSummaryModel })
    : (err as Error).message;
  send({ type: "error", message });
}

export function chatEventStream(t: ChatTurn): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send: Send = (e) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      // Slot ownership has passed to this stream — everything below,
      // including the first send() calls, runs inside the try so a throw
      // from ANY of it (including a client already gone, enqueue throwing)
      // still hits the finally and releases the slot.
      try {
        send({ type: "meta", conversationId: t.convId, tier: t.route.tier });
        if (t.teachCmd) await runTeachTurn(t, t.teachCmd, send);
        // Past the /teach branch every turn ran prepareTurn.
        else await runAnswerTurn(t, t.turn!, send);
      } catch (err) {
        reportStreamError(t, err, send);
      } finally {
        releaseChatSlot(t.userId);
        controller.close();
      }
    },
  });
}

export function sseResponse(stream: ReadableStream<Uint8Array>, refresh: string | undefined): Response {
  const headers = new Headers({
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  if (refresh) headers.append("set-cookie", refresh);
  return new Response(stream, { headers });
}
