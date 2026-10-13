import type { ComponentProps, MouseEvent, ReactNode } from "react";
import { useCopyState } from "../../hooks/useCopyState";

type CopyButtonProps = Omit<ComponentProps<"button">, "onClick" | "title" | "children"> & {
  icon: ReactNode;
  /** Idle content; a "copied" word takes its place (same width) after a copy. */
  label: ReactNode;
  title: string;
  /** Resolved at click time so it can read `window` or router state. */
  text: string | (() => string);
  onCopy?: () => void;
};

// A copy-to-clipboard button that owns its click handling, clipboard write and
// "copied" flip. Clicks never reach the row behind it.
export function CopyButton({ icon, label, title, text, onCopy, ...rest }: CopyButtonProps) {
  const { copied, copy } = useCopyState();

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    onCopy?.();
    void copy(typeof text === "function" ? text() : text);
  };

  return (
    <button
      type="button"
      {...rest}
      onClick={handleClick}
      title={copied ? "Copied!" : title}
      className="atlas-copy-btn"
      data-copied={copied ? "true" : undefined}
    >
      {icon}
      <span className="atlas-copy-flip" data-flipped={copied ? "true" : undefined}>
        <span className="label">{label}</span>
        <span className="flipped">copied</span>
      </span>
    </button>
  );
}
