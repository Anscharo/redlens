// The three limits a chat turn can hit (context window / rolling token window /
// shared credit pool) and the rule for which one the composer's meter shows.
// Pure — no React — so the selection rule is testable on its own.
import { formatTokens, ratioPct } from "@/lib/formatTokens";
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

export interface Limit {
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
  // Pie arc color. Identity, not severity: the three limits are three
  // different things running out, and the pie is the only place that says
  // which one you're looking at without opening the popover. Deliberately not
  // --error-text for any of them — the app's red means "wrong", and the pie
  // shows a perfectly healthy limit most of the time.
  color: string;
}

// The three limits a chat turn can hit, each as a 0–100 fullness fraction.
// null means unknown (missing/zero denominator) — never treated as 0.
export function buildLimits(
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
      color: "var(--accent)",
    },
    {
      key: "time",
      label: "time limit",
      scope: "all your chats",
      pct: ratioPct(usage?.tokens ?? null, usage?.limit ?? null),
      detail: usage && usage.limit > 0 ? `resets in ${humanizeReset(usage.resetsAt)}` : null,
      color: "var(--warn)",
    },
    {
      key: "commons",
      label: "shared credits",
      scope: "all users",
      pct: commonsPct,
      detail: commons ? `$${commons.remaining.toFixed(2)} left` : null,
      pctSuffix: " used",
      tooltipDetail: commons ? `$${commons.remaining.toFixed(2)} left of $${commons.total.toFixed(2)}` : undefined,
      color: "var(--lilac)",
    },
  ];
}

// The two account-wide limits only take the meter over once they're genuinely
// about to bind. Commons sits far tighter than time because a nearly-drained
// pool still serves turns normally, while the rolling token window starts
// refusing them the moment it fills.
const TIME_TAKEOVER_PCT = 95; // strictly above
const COMMONS_TAKEOVER_PCT = 99.5; // at or above

// The limit the meter DISPLAYS — whichever is most likely to run out first.
// That is the context window by default: it's per-conversation, it fills every
// single turn, and it's the one the user can act on (start a new chat). The
// time window and the shared pool are shared denominators that normally sit
// far from full, so metering them by "highest fraction" just hid this chat's
// own state behind someone else's usage — they only take over past their
// takeover threshold above.
export function pickDisplayed(limits: Limit[]): Limit | null {
  const known = limits.filter((l): l is Limit & { pct: number } => l.pct !== null);
  if (known.length === 0) return null;
  const takeover = known.filter(
    (l) =>
      (l.key === "time" && l.pct > TIME_TAKEOVER_PCT) || (l.key === "commons" && l.pct >= COMMONS_TAKEOVER_PCT),
  );
  // Both past their threshold: the fuller one runs out first. `>=` so a tie
  // keeps commons — a drained pool hard-gates every user, not just this one.
  if (takeover.length > 0) return takeover.reduce((best, l) => (l.pct >= best.pct ? l : best));
  // No takeover: context, unless it's the one limit we don't know yet (a chat
  // with no completed turn), in which case fall back to the fullest known.
  return known.find((l) => l.key === "context") ?? known.reduce((best, l) => (l.pct > best.pct ? l : best));
}

export function summaryLine(l: Limit): string {
  return `${l.label} · ${Math.round(l.pct as number)}%${l.pctSuffix ?? ""} · ${l.detail}`;
}
