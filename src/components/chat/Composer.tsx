import { useRef, type ChangeEvent, type KeyboardEvent } from "react";
import { PinIcon, SendIcon } from "./glyphs";
import { UsageNote } from "./UsageNote";
import type { UsageWindow } from "./api";

interface ComposerProps {
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled: boolean; // rate-limited
  placeholder: string;
  chip: string;
  usage: UsageWindow | null;
}

// Auto-growing textarea + context chip + send/stop. Enter sends, Shift+Enter
// newlines. While streaming the send button becomes a stop button.
export function Composer({ draft, onDraftChange, onSend, onStop, streaming, disabled, placeholder, chip, usage }: ComposerProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);

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
          <span className="rlc-hint">{streaming ? "streaming…" : "↵ to send"}</span>
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
      <UsageNote usage={usage} />
    </div>
  );
}
