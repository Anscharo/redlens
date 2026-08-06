import { useRef, type ChangeEvent, type KeyboardEvent } from "react";
import { PinIcon, SendIcon } from "./glyphs";
import { UsageNote } from "./UsageNote";
import { CommonsNote } from "./CommonsNote";
import { ErrorNote } from "./ErrorNote";
import { RateLimitNote } from "./RateLimitNote";
import type { UsageWindow, CommonsPool } from "./api";
import type { RateLimitState } from "./types";

interface ComposerProps {
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  rateLimit: RateLimitState | null; // non-null while a 429 lock is in force
  onRecheckUsage: () => void; // "Check now" on the commons lock — hits /api/usage, never /api/chat
  error: string | null; // last failed-turn message (suppressed while rateLimit is set)
  placeholder: string;
  chip: string;
  usage: UsageWindow | null;
  commons: CommonsPool | null;
  // True while useChatSession's openConversation() is awaiting its GET — the
  // panel already shows "Loading conversation…" in the thread, but nothing
  // upstream stopped the composer itself from accepting input during that
  // window. Without this, a send fired before hydrate() lands still carries
  // the PREVIOUS conversationId (or none), so it's posted to the wrong
  // conversation instead of the one the user just opened.
  historyLoading?: boolean;
}

// Auto-growing textarea + context chip + send/stop. Enter sends, Shift+Enter
// newlines. While streaming the send button becomes a stop button.
export function Composer({
  draft,
  onDraftChange,
  onSend,
  onStop,
  streaming,
  rateLimit,
  onRecheckUsage,
  error,
  placeholder,
  chip,
  usage,
  commons,
  historyLoading,
}: ComposerProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const locked = !!rateLimit || !!historyLoading;

  const autoGrow = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(120, ta.scrollHeight)}px`;
    onDraftChange(ta.value);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!streaming && draft.trim() && !locked) {
        onSend();
        if (taRef.current) taRef.current.style.height = "auto";
      }
    }
  };

  return (
    <div className="rlc-composer">
      {rateLimit ? <RateLimitNote rateLimit={rateLimit} onRecheck={onRecheckUsage} /> : <ErrorNote message={error} />}
      <div className="rlc-inputwrap">
        <textarea
          ref={taRef}
          className="rlc-textarea"
          rows={1}
          placeholder={placeholder}
          value={draft}
          onChange={autoGrow}
          onKeyDown={onKey}
          disabled={locked}
        />
        <div className="rlc-composer-row">
          <span className="rlc-chip">
            <span className="rlc-chip-icon">
              <PinIcon size={10} />
            </span>
            <span className="rlc-chip-label">{chip}</span>
          </span>
          <span className="rlc-hint">
            {streaming ? "streaming…" : historyLoading ? "loading…" : locked ? "locked" : "↵ to send"}
          </span>
          {streaming ? (
            <button className="rlc-stop" onClick={onStop} title="Stop generating" aria-label="Stop">
              <span className="rlc-stop-glyph" />
            </button>
          ) : (
            <button
              className="rlc-send"
              onClick={() => {
                onSend();
                if (taRef.current) taRef.current.style.height = "auto";
              }}
              disabled={!draft.trim() || locked}
              title="Send"
              aria-label="Send"
            >
              <SendIcon />
            </button>
          )}
        </div>
      </div>
      <CommonsNote commons={commons} />
      <UsageNote usage={usage} />
    </div>
  );
}
