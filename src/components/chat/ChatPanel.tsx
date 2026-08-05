import { useEffect, useRef, useState } from "react";
import { SparkMark } from "./glyphs";
import { Message } from "./Message";
import { Composer } from "./Composer";
import { SignInButtons } from "./SignInButtons";
import { ChatHeader } from "./ChatHeader";
import { ChatEmptyState, STARTERS } from "./ChatEmptyState";
import { usePrefs } from "./usePrefs";
import { track } from "../../lib/analytics";
import type { PageContextView } from "./pageContext";
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
  const { prefs } = usePrefs();
  const [draft, setDraft] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);

  // Draft persistence: restore on mount, mirror to localStorage.
  useEffect(() => {
    setDraft(localStorage.getItem(DRAFT_KEY) ?? "");
  }, []);
  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, draft);
  }, [draft]);

  // Stick to the bottom as turns/tokens arrive.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "instant" });
  }, [messages]);

  const doSend = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    // Message content is never sent — only the event + page context.
    track("chat_message_sent", { product: "chat", node_id: context.nodeId, path: context.path });
    setDraft("");
    localStorage.removeItem(DRAFT_KEY);
    const { rateLimited: rl } = await session.send(trimmed, {
      path: context.path,
      nodeId: context.nodeId,
      nodeTitle: context.nodeTitle,
      nodeDocNo: context.nodeDocNo,
      actorSlug: context.actorSlug,
      reportName: context.reportName,
      reportTool: context.reportTool,
      reportFilter: context.reportFilter,
    });
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
            <Message
              key={i}
              msg={m}
              streaming={streaming && i === messages.length - 1}
              showTrace={prefs.traces}
              onAtlas={onAtlas}
            />
          ))
        )}
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
          rateLimit={session.rateLimit}
          onRecheckUsage={() => void session.refresh()}
          error={session.error}
          placeholder={context.placeholder}
          chip={context.chip}
          usage={session.usage}
          commons={session.commons}
        />
      )}
    </section>
  );
}
