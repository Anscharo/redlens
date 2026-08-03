import { useState } from "react";

type StatusPillProps = {
  color: string;
  title?: string;
  children: React.ReactNode;
} & (
  | { as?: "span"; onClick?: never }
  | { as: "button"; onClick: () => void }
);

/**
 * The footer's status chips. As a `span` it just reports (offline); as a
 * `button` it also acts — and every action it offers is "reload into the new
 * version", which is slow: applyUpdate waits on the service worker to activate
 * and take control before the reload it triggers, and a plain reload still has
 * to fetch a fresh document. Nothing on screen moved in the meantime, so the
 * click read as dropped and people clicked again.
 *
 * So the button owns the ↻ glyph rather than taking it inside `children`: on
 * click it starts spinning and the pill goes disabled, which is the only
 * acknowledgement available before the page goes away. It never stops — every
 * path out of this state is a navigation. If the update fails to apply, the
 * pill stays spinning rather than lying that it's ready to try again; a plain
 * reload (or the next visit) is the recovery, same as before.
 *
 * `is-applying` goes on the button, not the glyph, because reduced motion
 * dims the whole pill in place of the spin (index.css).
 */
export function StatusPill({ as = "span", color, title, children, onClick }: StatusPillProps) {
  const [applying, setApplying] = useState(false);
  const style: React.CSSProperties = {
    fontSize: "10px",
    lineHeight: "24px",
    color,
    background: "var(--tan)",
    fontWeight: 600,
    letterSpacing: "0.02em",
  };
  if (as === "button") {
    return (
      <button
        type="button"
        onClick={() => {
          // Flip the flag BEFORE the handler: React flushes state synchronously
          // at the end of a discrete event like this one, so the spin is on
          // screen by the time the reload comes back.
          setApplying(true);
          onClick();
        }}
        title={title}
        disabled={applying}
        aria-busy={applying || undefined}
        className={`status-pill mono px-3 whitespace-nowrap hover:underline cursor-pointer disabled:cursor-default${
          applying ? " is-applying" : ""
        }`}
        style={style}
      >
        {children}{" "}
        <span className="status-pill-glyph" aria-hidden="true">
          ↻
        </span>
      </button>
    );
  }
  return (
    <span title={title} className="mono px-3 whitespace-nowrap" style={style}>
      {children}
    </span>
  );
}
