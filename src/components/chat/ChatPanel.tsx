import { useEffect, useRef, useState } from "react";
import { SparkMark, GitHubMark, GoogleMark, DockRightIcon, FloatIcon } from "./glyphs";
import { Message } from "./Message";
import { Composer } from "./Composer";
import { useChatStream } from "./useChatStream";
import { useUsage } from "./useUsage";
import { usePrefs } from "./usePrefs";
import { useAuth } from "./auth";
import type { PageContextView } from "./pageContext";
import type { Placement } from "./ChatWidget";

const STARTERS = [
  "How are Operational Facilitators rewarded, and who signs off on the budget?",
  "What's the difference between a Prime Agent and an Aligned Delegate?",
  "Trace the governance path for an Atlas amendment.",
];

const DRAFT_KEY = "rlc-draft";

export function ChatPanel({
  onClose,
  context,
  onAtlas,
  placement,
  onTogglePlacement,
}: {
  onClose: () => void;
  context: PageContextView;
  onAtlas: (uuid: string) => void;
  placement: Placement;
  onTogglePlacement: () => void;
}) {
  const { user, openAuth } = useAuth();
  const authed = !!user;
  const { prefs } = usePrefs();
  const { usage, refresh } = useUsage(authed);
  const [rateLimited, setRateLimited] = useState(false);
  const { messages, streaming, send, stop } = useChatStream({
    onDone: () => void refresh(),
    onAuthError: openAuth,
  });
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
    setDraft("");
    localStorage.removeItem(DRAFT_KEY);
    const { rateLimited: rl } = await send(trimmed, {
      path: context.path,
      nodeId: context.nodeId,
      nodeTitle: context.nodeTitle,
      nodeDocNo: context.nodeDocNo,
      actorSlug: context.actorSlug,
      reportName: context.reportName,
    });
    if (rl) setRateLimited(true);
    else setRateLimited(false);
  };

  const empty = messages.length === 0;

  const anchored = placement === "anchored";

  return (
    <section className="rlc-panel" data-place={placement} role="dialog" aria-label="Atlas agent">
      <header className="rlc-header">
        <SparkMark size={15} />
        <div>
          <div className="rlc-header-title">Atlas</div>
          <div className="rlc-header-sub">page-aware agent</div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            className="rlc-iconbtn"
            onClick={onTogglePlacement}
            title={anchored ? "Pop out to a floating window" : "Dock to the side"}
            aria-label={anchored ? "Pop out to a floating window" : "Dock to the side"}
          >
            {anchored ? <FloatIcon /> : <DockRightIcon />}
          </button>
          <button className="rlc-iconbtn" onClick={onClose} title="Close" aria-label="Close">
            ×
          </button>
        </div>
      </header>

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
        ) : empty ? (
          <div className="pt-2">
            <div className="flex items-center gap-2 mb-1">
              <SparkMark size={16} />
              <span className="rlc-empty-title">Ask the Atlas</span>
            </div>
            <p className="rlc-empty-body">
              A research agent over the Sky Atlas. It already knows the page you're on — answers cite atlas docs you can
              open inline.
            </p>
            <div className="flex flex-col gap-[7px]">
              {STARTERS.map((s) => (
                <button key={s} className="rlc-starter" onClick={() => void doSend(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
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
        <div className="rlc-composer flex flex-col gap-[7px]">
          <button className="rlc-signin w-full justify-center p-[11px]" onClick={() => openAuth("github")}>
            <GitHubMark /> sign in with github to ask
          </button>
          <button className="rlc-signin w-full justify-center p-[11px]" onClick={() => openAuth("google")}>
            <GoogleMark /> sign in with google to ask
          </button>
        </div>
      ) : (
        <Composer
          draft={draft}
          onDraftChange={setDraft}
          onSend={() => void doSend(draft)}
          onStop={stop}
          streaming={streaming}
          disabled={rateLimited && !streaming}
          placeholder={context.placeholder}
          chip={context.chip}
          usage={usage}
        />
      )}
    </section>
  );
}
