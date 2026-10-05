import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { ChatMsg } from "./chatTypes";

/** The raw state setters and refs useChatStream owns. All are stable for the hook's life. */
export interface StreamSetters {
  setMessages: Dispatch<SetStateAction<ChatMsg[]>>;
  setStreaming: (streaming: boolean) => void;
  setError: (error: string | null) => void;
  setConversationId: (id: string | null) => void;
  setContextTokens: (tokens: number | null) => void;
  // send()'s closure over convIdRef.current is what lets a reply land on the
  // right conversation without re-subscribing; `conversationId` state mirrors
  // it so callers can read it reactively.
  convIdRef: MutableRefObject<string | null>;
  abortRef: MutableRefObject<AbortController | null>;
}

/** The stream's state handle: the setters plus the message operations every event path shares. */
export interface StreamCore extends StreamSetters {
  /** Replace the last (assistant) message with `fn(last)`. */
  patchLast: (fn: (m: ChatMsg) => ChatMsg) => void;
  /** Mark the last assistant message done (see finalizeMsg). */
  finalizeLast: (extra?: Partial<ChatMsg>) => void;
  /** Finalize only a still-running turn, as failed (see sendTurn.ts). */
  finalizeIfPending: () => void;
  /** Point the stream at a conversation: the ref and the mirrored state together. */
  setConversation: (id: string | null) => void;
}

export function patchLastMsg(prev: ChatMsg[], fn: (m: ChatMsg) => ChatMsg): ChatMsg[] {
  if (!prev.length) return prev;
  const next = prev.slice();
  next[next.length - 1] = fn(next[next.length - 1]);
  return next;
}

// Terminate an assistant message: mark done, drop the transient status
// ticker, and resolve a still-"checking" verify chip so it can't pulse forever
// when the stream ends by abort/error before verification resolves (the
// "done" event's handler has its own copy of this guard).
export function finalizeMsg(m: ChatMsg, extra: Partial<ChatMsg> = {}): ChatMsg {
  if (m.role !== "assistant") return m;
  return { ...m, done: true, statusLine: null, ...(m.verify?.status === "checking" ? { verify: undefined } : {}), ...extra };
}

export function failIfPending(m: ChatMsg): ChatMsg {
  return m.role !== "assistant" || m.done ? m : { ...m, done: true, statusLine: null, failed: true };
}

export function createStreamCore(s: StreamSetters): StreamCore {
  const patchLast = (fn: (m: ChatMsg) => ChatMsg) => s.setMessages((prev) => patchLastMsg(prev, fn));
  return {
    ...s,
    patchLast,
    finalizeLast: (extra = {}) => patchLast((m) => finalizeMsg(m, extra)),
    finalizeIfPending: () => patchLast(failIfPending),
    setConversation: (id) => {
      s.convIdRef.current = id;
      s.setConversationId(id);
    },
  };
}

// Aborts any in-flight stream FIRST, then swaps the whole thread. patchLast
// mutates whatever array is currently in `messages`, so if the old stream's
// next event were dispatched after messages/convIdRef were already reset but
// before the abort took effect, it would land on the new array and corrupt
// it. Aborting before anything else changes closes that window.
function replaceThread(core: StreamCore, id: string | null, msgs: ChatMsg[], contextTokens: number | null) {
  core.abortRef.current?.abort();
  core.abortRef.current = null;
  core.setConversation(id);
  core.setMessages(msgs);
  core.setError(null);
  core.setStreaming(false);
  core.setContextTokens(contextTokens);
}

export function streamControls(core: StreamCore) {
  return {
    stop: () => {
      core.abortRef.current?.abort();
      core.abortRef.current = null;
      core.setStreaming(false);
      core.finalizeLast();
    },
    reset: () => replaceThread(core, null, [], null),
    // Seeds the stream with a restored conversation (or clears to a fresh chat
    // via hydrate(null, [])). `contextTokens` seeds the pie from the restored
    // conversation's replay size (ConversationDetail.contextTokens, the same
    // quantity a live turn reports as contextUsed — so reopening a chat does
    // not move the meter); null for a fresh chat.
    hydrate: (id: string | null, msgs: ChatMsg[], contextTokens: number | null = null) =>
      replaceThread(core, id, msgs, contextTokens),
  };
}
