import { apiUrl } from "./api";
import type { ChatMsg } from "./chatTypes";
import { readRefusal, type StreamHandlers } from "./chatRefusal";
import type { PageContext } from "./pageContext";
import { pumpSseEvents } from "./sseFrames";
import type { StreamCore } from "./streamCore";
import { dispatchStreamEvent } from "./streamDispatch";
import { createToolRoundTracker } from "./toolRounds";
import type { SendResult } from "./types";

function emptyMsg(role: ChatMsg["role"], content: string, done: boolean): ChatMsg {
  return { role, content, draft: "", generated: done, trace: [], rounds: 0, sources: [], done, stageLog: [] };
}

// Appends the user's turn and an empty assistant turn to fill, and takes over
// the abort handle from any earlier stream.
function beginTurn(core: StreamCore, text: string): AbortController {
  core.setError(null);
  core.abortRef.current?.abort();
  const ctrl = new AbortController();
  core.abortRef.current = ctrl;
  core.setMessages((prev) => [...prev, emptyMsg("user", text, true), emptyMsg("assistant", "", false)]);
  core.setStreaming(true);
  return ctrl;
}

function postChat(message: string, conversationId: string | null, pageContext: PageContext | undefined, signal: AbortSignal) {
  return fetch(apiUrl("chat"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, conversationId: conversationId ?? undefined, pageContext }),
    signal,
  });
}

// Rounds are bumped BEFORE the first tool_call of a batch dispatches, so that
// tool_call's trace row carries the new round.
function readTurnEvents(core: StreamCore, body: ReadableStream<Uint8Array>): Promise<void> {
  const rounds = createToolRoundTracker();
  return pumpSseEvents(body, (ev) => {
    if (rounds.opensRound(ev)) core.patchLast((m) => ({ ...m, rounds: m.rounds + 1 }));
    dispatchStreamEvent(core, ev);
  });
}

// AbortError (user pressed stop / closed) is expected — not an error.
function failTurn(core: StreamCore, err: unknown) {
  if ((err as Error).name === "AbortError") return;
  core.setError((err as Error).message);
  core.finalizeLast({ failed: true });
}

function endTurn(core: StreamCore, ctrl: AbortController, handlers: StreamHandlers) {
  if (core.abortRef.current === ctrl) core.abortRef.current = null;
  core.setStreaming(false);
  handlers.onDone?.();
}

/** Inputs to one send: the text, the page it was asked from, and the hook state it runs against. */
export interface TurnRequest {
  text: string;
  pageContext?: PageContext;
  streaming: boolean;
  handlers: StreamHandlers;
}

// POSTs one turn and streams its events onto the last message. When the
// stream ends, a terminal event ("done"/"error") has already marked the
// message done and finalizeIfPending no-ops; if the connection was simply cut
// (proxy, server crash mid-turn) nothing else ever would, and the progress
// checklist — which renders on `!done` — would pulse forever behind an
// already-re-enabled input. `failed` only surfaces copy when the answer is
// empty (Message.tsx); a partially streamed draft just freezes as-is.
export async function sendTurn(core: StreamCore, { text, pageContext, streaming, handlers }: TurnRequest): Promise<SendResult> {
  const trimmed = text.trim();
  if (!trimmed || streaming) return {};
  const ctrl = beginTurn(core, trimmed);
  try {
    const res = await postChat(trimmed, core.convIdRef.current, pageContext, ctrl.signal);
    const refused = await readRefusal(res, core, handlers);
    if (refused) return refused;
    if (!res.ok || !res.body) throw new Error(`chat request failed (${res.status})`);
    await readTurnEvents(core, res.body);
    core.finalizeIfPending();
  } catch (err) {
    failTurn(core, err);
  } finally {
    endTurn(core, ctrl, handlers);
  }
  return {};
}
