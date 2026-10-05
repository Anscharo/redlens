import { PinIcon, SendIcon } from "./glyphs";

/** The page-context chip in the composer row. */
export function ContextChip({ label }: { label: string }) {
  return (
    <span className="rlc-chip">
      <span className="rlc-chip-icon">
        <PinIcon size={10} />
      </span>
      <span className="rlc-chip-label">{label}</span>
    </span>
  );
}

/** While streaming the send button becomes a stop button. */
export function StopButton({ onStop }: { onStop: () => void }) {
  return (
    <button className="rlc-stop" onClick={onStop} title="Stop generating" aria-label="Stop">
      <span className="rlc-stop-glyph" />
    </button>
  );
}

export function SendButton({ onSend, disabled }: { onSend: () => void; disabled: boolean }) {
  return (
    <button className="rlc-send" onClick={onSend} disabled={disabled} title="Send" aria-label="Send">
      <SendIcon />
    </button>
  );
}
