import { useState, type ComponentProps } from "react";

export type ReasoningBlockProps = ComponentProps<"div"> & {
  /** Accumulated reasoning/"thinking" text streamed for this turn. */
  text: string;
};

// Renders the model's reasoning trace above the answer. Message.tsx hoists
// this above the per-delivery-mode content branches (thinking placeholder /
// staged checklist / stopped / failed / answer) so it shows regardless of
// which one is active — beta feedback: "render them immediately even if not
// in streaming mode", and a reasoning block that only appears in one branch
// is the bug that note is guarding against.
//
// Open by default (unlike ToolTrace, which starts closed): "immediately"
// means visible without a click. It's still collapsible, mirroring
// ToolTrace's button + aria-expanded pattern, so a long trace doesn't
// dominate the message once the reader has seen enough — and the open body
// additionally caps its own height with a scroll container (chat.css) rather
// than growing the whole message for a very long trace.
export function ReasoningBlock({ text, ...props }: ReasoningBlockProps) {
  const [open, setOpen] = useState(true);
  if (!text) return null;
  return (
    <div className="rlc-reasoning" {...props}>
      <button className="rlc-reasoning-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="rlc-reasoning-caret" data-open={open} aria-hidden="true">
          ▾
        </span>
        <span>thinking</span>
      </button>
      {open && <div className="rlc-reasoning-body">{text}</div>}
    </div>
  );
}
