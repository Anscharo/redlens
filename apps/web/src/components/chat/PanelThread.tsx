import { SparkMark } from "./glyphs";
import { Message } from "./Message";
import { ChatEmptyState, STARTERS } from "./ChatEmptyState";
import { ContextLine } from "./ContextPie";
import { NewMessagesPill } from "./NewMessagesPill";
import { ratioPct } from "../../lib/formatTokens";
import { useChatPanel } from "./chatPanelContext";
import { useOpenConversationCollection } from "../../hooks/useOpenConversationCollection";
import type { useStickToBottom } from "./useStickToBottom";

function SignedOutIntro() {
  return (
    <div className="pt-2">
      <div className="flex items-center gap-2 mb-1">
        <SparkMark size={16} />
        <span className="rlc-empty-title">Sign in to ask the Atlas</span>
      </div>
      <p className="rlc-empty-body">
        The agent reads the page you're on and cites atlas docs as it answers. Conversations are saved to your
        account. Sign in with GitHub or Google to start.
      </p>
      <div className="rlc-starters-locked">
        {STARTERS.map((s) => (
          <button key={s} className="rlc-starter" disabled>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

interface ThreadBodyProps {
  onAtlas: (uuid: string) => void;
  onAnswerReveal: (el: HTMLElement) => void;
}

// What the thread holds: a sign-in prompt, a loading line, the empty state,
// or the turns.
function ThreadBody({ onAtlas, onAnswerReveal }: ThreadBodyProps) {
  const { session, page, send } = useChatPanel();
  const { messages, streaming, conversationId } = session;
  const { open, failed } = useOpenConversationCollection();
  const collection = conversationId ? { onView: () => void open(conversationId), failed } : undefined;
  if (!session.authed) return <SignedOutIntro />;
  if (session.loadingHistory) return <p className="pt-2 rlc-empty-body">Loading conversation…</p>;
  if (messages.length === 0) {
    return <ChatEmptyState authed={session.authed} context={page} onSend={send} onOpenConversation={session.openConversation} />;
  }
  return messages.map((m, i) => (
    <Message
      key={i}
      msg={m}
      streaming={streaming && i === messages.length - 1}
      onAtlas={onAtlas}
      onAnswerReveal={onAnswerReveal}
      collection={collection}
    />
  ));
}

export interface PanelThreadProps {
  /** The thread's follow-the-bottom handle (useStickToBottom). */
  scroll: ReturnType<typeof useStickToBottom>;
  onAtlas: (uuid: string) => void;
}

// The wrap (not the scrollable thread itself) hosts the context line:
// absolute children of a scroller move with its content, so the line must
// anchor to a non-scrolling box that exactly spans the thread.
export function PanelThread({ scroll, onAtlas }: PanelThreadProps) {
  const { session } = useChatPanel();
  return (
    <div className="rlc-thread-wrap">
      <ContextLine pct={ratioPct(session.contextTokens, session.contextWindow)} />
      <div className="rlc-thread" ref={scroll.threadRef}>
        <ThreadBody onAtlas={onAtlas} onAnswerReveal={scroll.showFrom} />
      </div>
      {scroll.pending && <NewMessagesPill onClick={scroll.jumpToBottom} streaming={session.streaming} />}
    </div>
  );
}
