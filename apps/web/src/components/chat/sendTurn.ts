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

// Bumped before dispatch so the batch's first tool_call row carries the new round.
function readTurnEvents(core: StreamCore, body: ReadableStream<Uint8Array>): Promise<void> {
  const rounds = createToolRoundTracker();
  return pumpSseEvents(body, (ev) => {
    if (rounds.opensRound(ev)) core.patchLast((m) => ({ ...m, rounds: m.rounds + 1 }));
    dispatchStreamEvent(core, ev);
  });
}

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

// finalizeIfPending covers a cut connection with no terminal event, which
// would otherwise leave the progress checklist pulsing forever.
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
