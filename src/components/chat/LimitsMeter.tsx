import { useEffect, useRef, useState } from "react";
import { ContextPie } from "./ContextPie";
import { HOT_PCT } from "../../lib/formatTokens";
import { buildLimits, pickDisplayed, summaryLine, type Limit } from "./limits";
import type { UsageWindow, CommonsPool } from "./api";

// Re-exported for RateLimitNote, which shows the same "resets in <X>" phrasing
// for the token-window 429 lock.
export { humanizeReset } from "./limits";

// All three limits, one row each, always — an unknown one shows "—" rather
// than being omitted, so the set of things being tracked stays visible.
function LimitsPopover({ limits }: { limits: Limit[] }) {
  return (
    <div className="rlc-limits-popover" aria-label="Usage limits">
      {limits.map((l) => (
        <div className="rlc-limits-popover-row" key={l.key}>
          <span className="rlc-limits-popover-label">
            {l.label} <span className="rlc-limits-popover-scope">· {l.scope}</span>
          </span>
          <span className="rlc-limits-popover-value">
            {l.pct === null ? "—" : `${Math.round(l.pct)}%${l.pctSuffix ?? ""} · ${l.tooltipDetail ?? l.detail}`}
          </span>
        </div>
      ))}
    </div>
  );
}

// Bottom row of the composer: a one-line summary of the displayed limit on the
// left, and a pie (filled with that same fraction, in that limit's color) on
// the right. Clicking the pie click-toggles a popover listing all three limits.
// Replaces the old always-on CommonsNote + gated UsageNote + pie-in-the-
// composer-row.
export function LimitsMeter({
  usage,
  commons,
  contextTokens,
  contextWindowTokens,
}: {
  usage: UsageWindow | null;
  commons: CommonsPool | null;
  contextTokens: number | null;
  contextWindowTokens: number | null;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const limits = buildLimits(usage, commons, contextTokens, contextWindowTokens);
  const displayed = pickDisplayed(limits);
  const summary = displayed ? summaryLine(displayed) : null;
  const hot = displayed !== null && displayed.pct !== null && displayed.pct >= HOT_PCT;

  // Light-dismiss for the popover: any pointerdown OUTSIDE the meter (or
  // Escape) closes it. Clicks INSIDE the root are left entirely to the pie
  // button's own toggle. Listeners exist only while open. A JS listener is the
  // one thing CSS can't do here — outside-dismiss has no CSS equivalent.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="rlc-limits" ref={rootRef}>
      {open && <LimitsPopover limits={limits} />}
      <div className="rlc-limits-row">
        {summary && (
          <span className="rlc-limits-summary" data-hot={hot}>
            {summary}
          </span>
        )}
        <ContextPie
          pct={displayed?.pct ?? null}
          color={displayed?.color}
          label={summary ? `${summary} — limits` : "Usage limits"}
          open={open}
          onToggle={() => setOpen((o) => !o)}
        />
      </div>
    </div>
  );
}
