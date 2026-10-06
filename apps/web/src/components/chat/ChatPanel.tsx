import { useState } from "react";
import { SignInButtons } from "./SignInButtons";
import { AnchoredResizeHandle } from "./AnchoredResizeHandle";
import { ChatHeader } from "./ChatHeader";
import { PanelThread } from "./PanelThread";
import { PanelComposer } from "./PanelComposer";
import { ChatPanelProvider, useChatPanelValue } from "./chatPanelContext";
import { usePersistedDraft } from "./usePersistedDraft";
import { useStickToBottom } from "./useStickToBottom";
import type { PageContextView } from "./pageContext";
import type { Placement } from "./types";
import type { ChatSession } from "./useChatSession";

export interface ChatPanelProps {
  /** The conversation state, owned by ChatWidget so it survives the panel closing. */
  session: ChatSession;
  onClose: () => void;
  context: PageContextView;
  /** Opens an atlas document behind a citation link. */
  onAtlas: (uuid: string) => void;
  placement: Placement;
  onTogglePlacement: () => void;
}

// The open chat: header, thread, composer. The session, page context and
// send path reach the thread and composer through ChatPanelProvider.
//
// The thread follows the newest turn — but only while the reader is still at
// the bottom; once they scroll away it holds absolutely still and the pill
// reports the new text instead. `resetKey` re-follows on a wholesale content
// swap (conversation switch, new chat, a deleted current chat) — which
// ChatWidget can trigger from outside this panel.
// New chat moves keyboard focus into the composer, since its button
// disappears the moment the thread empties and focus would otherwise fall to
// the body. A counter, not a boolean: every press must re-focus, even back to
// back. The action is null while the thread is already empty.
function useNewChat(session: ChatSession) {
  const [focusKey, setFocusKey] = useState(0);
  const newChat = () => {
    session.newChat();
    setFocusKey((n) => n + 1);
  };
  return [focusKey, session.messages.length === 0 ? null : newChat] as const;
}

export function ChatPanel({ session, onClose, context, onAtlas, placement, onTogglePlacement }: ChatPanelProps) {
  const { draft, setDraft, clear } = usePersistedDraft();
  const [composerFocus, newChat] = useNewChat(session);
  const resetKey = `${session.conversationId}|${session.loadingHistory}`;
  const scroll = useStickToBottom({ follow: session.messages, streaming: session.streaming, resetKey });
  const panel = useChatPanelValue(session, context, clear, scroll.stick);
  return (
    <ChatPanelProvider value={panel}>
      <section className="rlc-panel" data-place={placement} role="dialog" aria-label="Atlas agent">
        <ChatHeader
          title={session.title}
          onNewChat={newChat}
          onClose={onClose}
          placement={placement}
          onTogglePlacement={onTogglePlacement}
        />
        <PanelThread scroll={scroll} onAtlas={onAtlas} />
        {session.authed ? (
          <PanelComposer draft={draft} onDraftChange={setDraft} focusKey={composerFocus} />
        ) : (
          <SignInButtons variant="composer" source="chat" />
        )}
        {placement === "anchored" && <AnchoredResizeHandle />}
      </section>
    </ChatPanelProvider>
  );
}
