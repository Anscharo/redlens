import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

// Cross-route command channel: lets any page (e.g. a conversation list row)
// tell the (unconditionally-mounted) ChatWidget "open this conversation"
// without a custom DOM event (untyped, awkward to test) or a `?chat=<id>`
// URL param (pollutes shareable URLs, conflates a widget concern with route
// state) — see the chat-conversation-memory plan §5.
//
// Deliberately tiny: `request` only changes on a click, never on a token
// stream, so mounting this at the top of the tree (next to SelectionProvider
// in main.tsx) costs nothing — nothing under ChatWidget's token-streaming hot
// path reads from here.
export interface OpenRequest {
  conversationId: string;
  title: string | null;
  // Load-bearing. Re-clicking the SAME conversation after minimizing must
  // still re-fire the effect that consumes `request` in ChatWidget — without
  // a monotonically-increasing field, a second click on an unchanged id
  // could be indistinguishable from a no-op re-render to a naive consumer
  // (e.g. one that diffs by conversationId). Bumping a counter makes "the
  // user asked again" unambiguous regardless of how the consumer compares.
  nonce: number;
}

// The reverse direction: a page deleted a conversation, and the widget may be
// sitting on it. Carries its own nonce for the same reason OpenRequest does.
export interface DeletedSignal {
  conversationId: string;
  nonce: number;
}

interface ChatOpenState {
  request: OpenRequest | null;
  openChat: (conversationId: string, title?: string | null) => void;
  deleted: DeletedSignal | null;
  notifyDeleted: (conversationId: string) => void;
}

const ChatOpenContext = createContext<ChatOpenState | null>(null);

export function ChatOpenProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<OpenRequest | null>(null);
  const [deleted, setDeleted] = useState<DeletedSignal | null>(null);
  const nonceRef = useRef(0);

  const openChat = useCallback((conversationId: string, title: string | null = null) => {
    nonceRef.current += 1;
    setRequest({ conversationId, title, nonce: nonceRef.current });
  }, []);

  const notifyDeleted = useCallback((conversationId: string) => {
    nonceRef.current += 1;
    setDeleted({ conversationId, nonce: nonceRef.current });
  }, []);

  return (
    <ChatOpenContext.Provider value={{ request, openChat, deleted, notifyDeleted }}>
      {children}
    </ChatOpenContext.Provider>
  );
}

// Throwing variant, for pages that are only ever rendered inside the provider.
export function useChatOpen(): ChatOpenState {
  const ctx = useChatOpenOptional();
  if (!ctx) throw new Error("useChatOpen must be used within <ChatOpenProvider>");
  return ctx;
}

// Non-throwing variant for ChatWidget, which mounts unconditionally at the app
// root and is also rendered bare in tests: "no provider" must behave exactly
// like "no request has ever come in", not blow up the whole widget.
export function useChatOpenOptional(): ChatOpenState | null {
  return useContext(ChatOpenContext);
}
