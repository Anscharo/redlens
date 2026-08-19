import { HOT_PCT } from "../../lib/formatTokens";

const R = 6; // SVG circle radius — a 14px box with a 2px stroke
const CIRCUMFERENCE = 2 * Math.PI * R;

interface ContextPieProps {
  pct: number | null; // 0–100; null = unknown (no limit fraction known yet)
  label: string; // full aria-label/title text, built by the caller
  color?: string; // arc stroke — LimitsMeter passes the displayed limit's color
  open: boolean; // details popover toggled open
  onToggle: () => void;
}

// Cursor-style meter: a tiny clickable donut. Generalized from the original
// context-only pie — LimitsMeter is its only consumer now, and fills it with
// whichever limit it is currently showing (context by default; see
// pickDisplayed). The arc COLOR identifies that limit rather than encoding
// severity, so the caller owns it: a hot/red override here would repaint every
// limit the same shade in exactly the near-full states where knowing WHICH one
// is filling matters most. pct null renders an empty track, still clickable —
// there's no known limit yet, not nothing to show.
export function ContextPie({ pct, label, color = "var(--accent)", open, onToggle }: ContextPieProps) {
  const known = pct !== null;
  // Only draw the filled arc once there's a nonzero share — otherwise
  // strokeLinecap="round" paints a stray dot at pct 0.
  const filled = known && pct > 0;

  return (
    <button type="button" className="rlc-ctxpie" aria-pressed={open} aria-label={label} title={label} onClick={onToggle}>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r={R} fill="none" stroke="var(--border)" strokeWidth="2" />
        {filled && (
          <circle
            cx="7"
            cy="7"
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            transform="rotate(-90 7 7)"
          />
        )}
      </svg>
    </button>
  );
}

// Thin bottom-anchored fill along the left edge of the conversation area —
// always the CONTEXT pct specifically, unlike the pie, which meters whichever
// limit is currently binding. Hidden entirely (not an empty 0% sliver) when
// unknown — there's nothing to show, as opposed to "context measured at 0".
export function ContextLine({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  return (
    <div className="rlc-ctxline" aria-hidden="true">
      <div className="rlc-ctxline-fill" data-hot={pct >= HOT_PCT} style={{ height: `${pct}%` }} />
    </div>
  );
}
