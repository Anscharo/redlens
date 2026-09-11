import { useState, type ComponentProps } from "react";

export type ReasoningBlockProps = ComponentProps<"div"> & {
  /** Accumulated reasoning/"thinking" text streamed for this turn. */
  text: string;
};

// Renders the model's reasoning trace. This no longer sits at the top of
// every turn: StageSlot.tsx renders it inside the "synthesizing" stage
// row's slot (shown once that row is clicked open, and only on the FIRST
// synthesizing entry, so a turn that synthesizes more than once doesn't
// repeat it) — beta feedback originally asked for it to render as soon as
// it's available, which the slot placement still honors (it shows the
// moment its stage row is live, not only once the turn finishes).
//
// Open by default: "immediately" means visible without a click. It's still
// collapsible (a button + aria-expanded pattern, mirroring the trace rows'
// own collapsed-summary control), so a long trace doesn't dominate the
// message once the reader has seen enough — and the open body additionally
// caps its own height with a scroll container (chat.css) rather than
// growing the whole message for a very long trace.
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
