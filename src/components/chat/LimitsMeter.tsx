import { useEffect, useRef, useState } from "react";
import { ContextPie } from "./ContextPie";
import { formatTokens, ratioPct, HOT_PCT } from "../../lib/formatTokens";
import type { UsageWindow, CommonsPool } from "./api";

// Exported for RateLimitNote, which shows the same "resets in <X>" phrasing
// for the token-window 429 lock.
export function humanizeReset(resetsAt: string): string {
  const ms = Date.parse(resetsAt) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "soon";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.round(mins / 60);
  return `${hrs} hour${hrs === 1 ? "" : "s"}`;
}

interface Limit {
  key: "context" | "time" | "commons";
  label: string;
  // The three limits have three different SCOPES — context is this one
  // conversation, the time window sums the user's usage across ALL their
  // conversations (usage_events is keyed by user, not conversation), and the
  // credits pool is account-wide across all users. Popover-only, so the
  // bottom-row summary stays short.
  scope: string;
  pct: number | null; // 0–100; null = unknown
  detail: string | null; // short form, used in the bottom-row summary
  pctSuffix?: string; // only commons sets it (" used", matching its old copy)
  tooltipDetail?: string; // only commons differs from `detail` in the popover
}

// The three limits a chat turn can hit, each as a 0–100 fullness fraction.
// null means unknown (missing/zero denominator) — never treated as 0.
function buildLimits(
  usage: UsageWindow | null,
  commons: CommonsPool | null,
  contextTokens: number | null,
  contextWindowTokens: number | null,
): Limit[] {
  const ctxKnown = contextTokens !== null && contextWindowTokens !== null;
  // A drained pool (total <= 0) is the hard-gate state chat.ts pauses everyone
  // for — treat it as 100% full, not unknown.
  const commonsPct = commons ? (commons.total > 0 ? ratioPct(commons.used, commons.total) : 100) : null;

  return [
    {
      key: "context",
      label: "context window",
      scope: "this chat",
      pct: ratioPct(contextTokens, contextWindowTokens),
      detail: ctxKnown ? `${formatTokens(contextTokens)} / ${formatTokens(contextWindowTokens)}` : null,
    },
    {
      key: "time",
      label: "time limit",
      scope: "all your chats",
      pct: ratioPct(usage?.tokens ?? null, usage?.limit ?? null),
      detail: usage && usage.limit > 0 ? `resets in ${humanizeReset(usage.resetsAt)}` : null,
    },
    {
      key: "commons",
      label: "shared credits",
      scope: "all users",
      pct: commonsPct,
      detail: commons ? `$${commons.remaining.toFixed(2)} left` : null,
      pctSuffix: " used",
      tooltipDetail: commons ? `$${commons.remaining.toFixed(2)} left of $${commons.total.toFixed(2)}` : undefined,
    },
  ];
}

// The BINDING limit — whichever known fraction is closest to full. Strict `>`
// so an exact tie keeps the earlier (context > time > commons) entry.
function pickBinding(limits: Limit[]): Limit | null {
  const known = limits.filter((l): l is Limit & { pct: number } => l.pct !== null);
  if (known.length === 0) return null;
  return known.reduce((best, l) => (l.pct > best.pct ? l : best));
}

function summaryLine(l: Limit): string {
  return `${l.label} · ${Math.round(l.pct as number)}%${l.pctSuffix ?? ""} · ${l.detail}`;
}

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

// Bottom row of the composer: a one-line summary of the binding limit on the
// left, and a pie (filled with that same binding fraction) on the right.
// Clicking the pie click-toggles a popover listing all three limits. Replaces
// the old always-on CommonsNote + gated UsageNote + pie-in-the-composer-row.
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
  const binding = pickBinding(limits);
  const summary = binding ? summaryLine(binding) : null;
  const hot = binding !== null && binding.pct !== null && binding.pct >= HOT_PCT;

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
          pct={binding?.pct ?? null}
          label={summary ? `${summary} — limits` : "Usage limits"}
          open={open}
          onToggle={() => setOpen((o) => !o)}
        />
      </div>
    </div>
  );
}
