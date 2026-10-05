import { createContext, useContext, type ReactNode } from "react";
import { track } from "../../lib/analytics";
import { toPageContext, type PageContextView } from "./pageContext";
import type { ChatSession } from "./useChatSession";

/** What every part of an open panel shares: the session, the page it is on, and how to send. */
export interface ChatPanelValue {
  session: ChatSession;
  page: PageContextView;
  /** Send `text` as the next turn (blank text is ignored). */
  send: (text: string) => void;
}

const ChatPanelContext = createContext<ChatPanelValue | null>(null);

// One send path for every control that starts a turn (composer, starters).
// Only the event + page context are tracked, never the message content. The
// reader asked for this turn, so the thread follows it down even if they had
// scrolled up — their own send is the one movement they expect.
async function sendFromPanel(session: ChatSession, page: PageContextView, beforeSend: () => void, text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  track("chat_message_sent", { product: "chat", node_id: page.nodeId, path: page.path });
  beforeSend();
  const { rateLimited: rl } = await session.send(trimmed, toPageContext(page));
  session.setRateLimit(rl ?? null);
}

/** Builds the panel value. Each send first clears the draft, then re-follows the thread.
 *  Not memoised: the session is a new object every render, so a memo would never hit. */
export function useChatPanelValue(session: ChatSession, page: PageContextView, clearDraft: () => void, follow: () => void): ChatPanelValue {
  const beforeSend = () => {
    clearDraft();
    follow();
  };
  return { session, page, send: (text: string) => void sendFromPanel(session, page, beforeSend, text) };
}

export function ChatPanelProvider({ value, children }: { value: ChatPanelValue; children: ReactNode }) {
  return <ChatPanelContext.Provider value={value}>{children}</ChatPanelContext.Provider>;
}

/** The open panel's shared handle. Throws outside <ChatPanelProvider> — panel parts are meaningless without it. */
export function useChatPanel(): ChatPanelValue {
  const value = useContext(ChatPanelContext);
  if (!value) throw new Error("useChatPanel must be used within <ChatPanelProvider>");
  return value;
}
