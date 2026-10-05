import { useEffect, useRef } from "react";
import { useChatOpenOptional } from "../../lib/chatOpen";
import type { ChatSession } from "./useChatSession";

// Cross-route command channel (src/lib/chatOpen.tsx): another page (e.g. a
// conversation list row) asked to open a specific conversation here, or
// deleted one. Both compare by `nonce`, not `conversationId` — re-clicking
// the SAME conversation after minimizing must still re-fire, which an id-only
// comparison would swallow as "no change". A delete of the conversation
// loaded here resets to a fresh chat: the row is gone from the DB, so the
// next send would otherwise POST a dead id (useChatStream's
// conversation_not_found branch is the second line of defense, for a delete
// that happened in another tab).
export function useChatOpenChannel(session: ChatSession, setOpen: (open: boolean) => void) {
  const chatOpen = useChatOpenOptional();
  const request = chatOpen?.request ?? null;
  const deleted = chatOpen?.deleted ?? null;
  const lastHandledNonceRef = useRef(0);
  const lastHandledDeleteRef = useRef(0);
  const { openConversation, newChat, conversationId } = session;
  useEffect(() => {
    if (!request || request.nonce === lastHandledNonceRef.current) return;
    lastHandledNonceRef.current = request.nonce;
    setOpen(true);
    void openConversation(request.conversationId, request.title);
  }, [request, openConversation, setOpen]);
  useEffect(() => {
    if (!deleted || deleted.nonce === lastHandledDeleteRef.current) return;
    lastHandledDeleteRef.current = deleted.nonce;
    if (deleted.conversationId === conversationId) newChat();
  }, [deleted, conversationId, newChat]);
}
