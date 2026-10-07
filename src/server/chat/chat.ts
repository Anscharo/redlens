// POST /api/chat — the agentic chat endpoint. Auth-gated, SSE-streamed. Owns
// auth + conversation persistence; everything that shapes the turn before the
// first model call (Jev judgement, tier routing, system prompt, full history,
// facts, /teach notes) lives in prepareTurn (turn-setup.ts). History replay
// and the 90% context compaction live in context-compact.ts (driven by
// compact-turn.ts, with its one summarization call in context-summary.ts and the
// provider-rejection recovery in context-overflow.ts); lookup cards
// for earlier tool calls live in tool-recall.ts. The tool-calling
// control flow in the pure runChat() loop (chat-loop.ts), the LLM stream in llm.ts.
//
// Order: create conversation (if new) + persist the USER message BEFORE
// streaming; persist the ASSISTANT message AFTER the stream completes —
// never partial content.
//
// The phases live under endpoint/: gates.ts (request + quota refusals),
// history.ts (conversation + replayed history), turn.ts (everything decided
// before the stream opens), stream.ts (the SSE body), persist.ts.
import { json } from "../http.ts";
import { config } from "../config.ts";
import { tryAcquireChatSlot, releaseChatSlot } from "./concurrency.ts";
import { concurrencyRefusal, parseChatRequest, quotaRefusal } from "./endpoint/gates.ts";
import { resolveConversation } from "./endpoint/history.ts";
import { conversationScope } from "./conversation-access.ts";
import { prepareChatTurn } from "./endpoint/turn.ts";
import { chatEventStream, sseResponse } from "./endpoint/stream.ts";

export { MAX_MESSAGE_BYTES, messageExceedsLimit } from "./endpoint/gates.ts";
export { persistAssistant } from "./endpoint/persist.ts";

export async function handleChat(req: Request): Promise<Response> {
  const parsed = await parseChatRequest(req);
  if (parsed instanceof Response) return parsed;
  const { session, body } = parsed;
  const userId = session.user.id;

  // Concurrency gate — checked first (in-memory, no DB/network round trip)
  // so a user already at their cap fails fast instead of paying for the
  // token-window query and the commons fetch.
  if (!tryAcquireChatSlot(userId, config.chatMaxConcurrentPerUser)) return concurrencyRefusal();

  // Every acquire above MUST release exactly once. Past this point the ONLY
  // release paths are: this outer `finally` (covers every early return AND
  // any throw below — a DB blip in getWindowUsage/resolveConversation/the
  // INSERT/SELECT/UPDATE would otherwise leak the slot silently) and the
  // stream's own `finally` (endpoint/stream.ts), once ownership has been
  // handed off to it (`streamOwnsSlot`). Nothing below may call
  // releaseChatSlot itself — that would double-release once this wrapper
  // also fires.
  let streamOwnsSlot = false;
  try {
    const refusal = await quotaRefusal(userId);
    if (refusal) return refusal;
    const conv = await resolveConversation(userId, body);
    if (!conv) return json({ error: "conversation_not_found" }, 404);
    const scope = await conversationScope(userId, conv, body.pageContext);
    if ("denied" in scope) return json({ error: scope.denied }, scope.status);
    const turn = await prepareChatTurn(req, userId, conv.id, body, scope);
    const response = sseResponse(chatEventStream(turn), session.refresh);
    streamOwnsSlot = true;
    return response;
  } finally {
    if (!streamOwnsSlot) releaseChatSlot(userId);
  }
}
