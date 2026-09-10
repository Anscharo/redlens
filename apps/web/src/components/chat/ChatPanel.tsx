import { useEffect, useState } from "react";
import { SparkMark } from "./glyphs";
import { Message } from "./Message";
import { Composer } from "./Composer";
import { SignInButtons } from "./SignInButtons";
import { ChatHeader } from "./ChatHeader";
import { ChatEmptyState, STARTERS } from "./ChatEmptyState";
import { ContextLine } from "./ContextPie";
import { ErrorNote } from "./ErrorNote";
import { LimitsMeter } from "./LimitsMeter";
import { RateLimitNote } from "./RateLimitNote";
import { NewMessagesPill } from "./NewMessagesPill";
import { useStickToBottom } from "./useStickToBottom";
import { track } from "../../lib/analytics";
import { ratioPct } from "../../lib/formatTokens";
import { toPageContext, type PageContextView } from "./pageContext";
import type { Placement } from "./types";
import type { ChatSession } from "./useChatSession";

const DRAFT_KEY = "rlc-draft";

export function ChatPanel({
  session,
  onClose,
  context,
  onAtlas,
  placement,
  onTogglePlacement,
}: {
  session: ChatSession;
  onClose: () => void;
  context: PageContextView;
  onAtlas: (uuid: string) => void;
  placement: Placement;
  onTogglePlacement: () => void;
}) {
  // Only the fields read more than once get a local name; everything else
  // is referenced as session.* at its single call site below.
  const { authed, messages, streaming } = session;
  const [draft, setDraft] = useState("");
  const ctxPct = ratioPct(session.contextTokens, session.contextWindow);

  // Draft persistence: restore on mount, mirror to localStorage.
  useEffect(() => {
    setDraft(localStorage.getItem(DRAFT_KEY) ?? "");
  }, []);
  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, draft);
  }, [draft]);

  // Follow the newest turn — but only while the reader is still at the bottom.
  // Once they scroll away the thread holds absolutely still and the pill below
  // reports the new text instead. `resetKey` re-follows on a wholesale content
  // swap (conversation switch, new chat, a deleted current chat) — which
  // ChatWidget can trigger from outside this panel.
  const { threadRef, pending, stick, jumpToBottom } = useStickToBottom({
    follow: messages,
    streaming,
    resetKey: `${session.conversationId}|${session.loadingHistory}`,
  });

  const doSend = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    // Message content is never sent — only the event + page context.
    track("chat_message_sent", { product: "chat", node_id: context.nodeId, path: context.path });
    setDraft("");
    localStorage.removeItem(DRAFT_KEY);
    // The reader asked for this turn, so follow it down even if they had
    // scrolled up — their own send is the one movement they expect.
    stick();
    const { rateLimited: rl } = await session.send(trimmed, toPageContext(context));
    // send() (useChatStream) always sets `kind` for a real 429; this fallback
    // only guards a caller that omits it (defense in depth, not the normal path).
    session.setRateLimit(rl ? { ...rl, kind: rl.kind ?? (rl.resetsAt ? "token" : "commons") } : null);
  };

  const empty = messages.length === 0;

  return (
    <section className="rlc-panel" data-place={placement} role="dialog" aria-label="Atlas agent">
      <ChatHeader
        title={session.title}
        onNewChat={session.newChat}
        onClose={onClose}
        placement={placement}
        onTogglePlacement={onTogglePlacement}
      />

      {/* The wrap (not the scrollable thread itself) hosts the context line:
          absolute children of a scroller move with its content, so the line
          must anchor to a non-scrolling box that exactly spans the thread. */}
      <div className="rlc-thread-wrap">
        <ContextLine pct={ctxPct} />
        <div className="rlc-thread" ref={threadRef}>
          {!authed ? (
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
          ) : session.loadingHistory ? (
            <p className="pt-2 rlc-empty-body">Loading conversation…</p>
          ) : empty ? (
            <ChatEmptyState
              authed={authed}
              context={context}
              onSend={(s) => void doSend(s)}
              onOpenConversation={session.openConversation}
            />
          ) : (
            messages.map((m, i) => (
              <Message key={i} msg={m} streaming={streaming && i === messages.length - 1} onAtlas={onAtlas} />
            ))
          )}
        </div>
        {pending && <NewMessagesPill onClick={jumpToBottom} streaming={streaming} />}
      </div>

      {!authed ? (
        <SignInButtons variant="composer" source="chat" />
      ) : (
        <Composer
          draft={draft}
          onDraftChange={setDraft}
          onSend={() => void doSend(draft)}
          onStop={session.stop}
          streaming={streaming}
          locked={!!session.rateLimit}
          // The 429 lock note wins over the failed-turn note: a 429 already
          // carries its full explanation, and the stale error would otherwise
          // resurface the instant the lock lifts (policy owned here, next to
          // both pieces of session state — the composer just renders the slot).
          notice={
            session.rateLimit ? (
              <RateLimitNote rateLimit={session.rateLimit} onRecheck={() => void session.refresh()} />
            ) : (
              <ErrorNote message={session.error} />
            )
          }
          placeholder={context.placeholder}
          chip={context.chip}
          historyLoading={session.loadingHistory}
        >
          <LimitsMeter
            usage={session.usage}
            commons={session.commons}
            contextTokens={session.contextTokens}
            contextWindowTokens={session.contextWindow}
          />
        </Composer>
      )}
    </section>
  );
}
