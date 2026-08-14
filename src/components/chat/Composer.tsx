import { useRef, type ChangeEvent, type KeyboardEvent, type ReactNode } from "react";
import { PinIcon, SendIcon } from "./glyphs";

interface ComposerProps {
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  locked?: boolean; // a 429 lock is in force — input disabled, hint shows "locked"
  // Notice slot above the input — ChatPanel composes RateLimitNote/ErrorNote
  // here (and owns the "error is suppressed while rate-limited" policy, since
  // it owns both pieces of state). The composer just provides the position.
  notice?: ReactNode;
  placeholder: string;
  chip: string;
  // True while useChatSession's openConversation() is awaiting its GET — the
  // panel already shows "Loading conversation…" in the thread, but nothing
  // upstream stopped the composer itself from accepting input during that
  // window. Without this, a send fired before hydrate() lands still carries
  // the PREVIOUS conversationId (or none), so it's posted to the wrong
  // conversation instead of the one the user just opened.
  historyLoading?: boolean;
  // Footer slot, rendered below the input — ChatPanel passes the LimitsMeter
  // here. Composition instead of props: the composer doesn't consume any of
  // the meter's data, so it shouldn't have to thread it through.
  children?: ReactNode;
}

// Auto-growing textarea + context chip + send/stop. Enter sends, Shift+Enter
// newlines. While streaming the send button becomes a stop button.
export function Composer({
  draft,
  onDraftChange,
  onSend,
  onStop,
  streaming,
  locked,
  notice,
  placeholder,
  chip,
  historyLoading,
  children,
}: ComposerProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const disabled = !!locked || !!historyLoading;

  const autoGrow = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(120, ta.scrollHeight)}px`;
    onDraftChange(ta.value);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!streaming && draft.trim() && !disabled) {
        onSend();
        if (taRef.current) taRef.current.style.height = "auto";
      }
    }
  };

  return (
    <div className="rlc-composer">
      {notice}
      <div className="rlc-inputwrap">
        <textarea
          ref={taRef}
          className="rlc-textarea"
          rows={1}
          placeholder={placeholder}
          value={draft}
          onChange={autoGrow}
          onKeyDown={onKey}
          disabled={disabled}
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
              disabled={!draft.trim() || disabled}
              title="Send"
              aria-label="Send"
            >
              <SendIcon />
            </button>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}
