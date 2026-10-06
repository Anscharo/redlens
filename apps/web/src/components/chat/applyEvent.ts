import type { ChatEvent } from "./api";
import type { ChatMsg } from "./chatTypes";
import { answerEventHandlers } from "./applyAnswerEvents";
import { checkEventHandlers } from "./applyCheckEvents";
import { stageEventHandlers } from "./applyStageEvents";

export type ChatEventOf<K extends ChatEvent["type"]> = Extract<ChatEvent, { type: K }>;

/** One pure handler per SSE event type that changes the assistant message. */
export type MessageEventHandlers = {
  [K in ChatEvent["type"]]?: (m: ChatMsg, ev: ChatEventOf<K>) => ChatMsg;
};

// Every message-level event handler, keyed by event type. Adding an event
// that changes the message is one handler in one of the files above (or a new
// file spread in here) — `applyEvent` itself never changes.
//
// `meta` and `error` are deliberately absent: they touch hook-level state
// (conversationId, the error banner), not the message, and pass through
// unchanged. `export`'s download/track side effects run in the hook
// (streamDispatch.ts) before its handler only records the artifact.
export const MESSAGE_EVENT_HANDLERS: MessageEventHandlers = {
  ...answerEventHandlers,
  ...stageEventHandlers,
  ...checkEventHandlers,
};

// Pure per-message event application: looks the event's handler up in the
// table and returns the message unchanged when there is none.
export function applyEvent(m: ChatMsg, ev: ChatEvent): ChatMsg {
  const handler = MESSAGE_EVENT_HANDLERS[ev.type] as ((m: ChatMsg, ev: ChatEvent) => ChatMsg) | undefined;
  return handler ? handler(m, ev) : m;
}
