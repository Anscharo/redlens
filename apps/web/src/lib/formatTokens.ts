// Compact token-count formatting for context/usage displays. Pure, no locale
// dependence — used by ConversationCard and LimitsMeter.
export function formatTokens(n: number): string {
  if (n < 1000) return `${Math.round(n)}`;
  if (n < 1e6) return `${trimTrailingZero((n / 1000).toFixed(1))}k`;
  return `${trimTrailingZero((n / 1e6).toFixed(1))}M`;
}

function trimTrailingZero(s: string): string {
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

// A limit is "nearly full" at this percent — the one product threshold behind
// every hot/red treatment (pie stroke, edge-line fill, summary text). The old
// UsageNote dot went hot at 80; unifying the three limit displays deliberately
// moved that to 90 ("more than 90% full" per the spec).
export const HOT_PCT = 90;

// used/limit as a percent, clamped to [0, 100]. Either side missing or a
// non-positive limit means "unknown" — null, not 0 — since 0 isn't a real
// denominator. Shared by all three chat limits (context window, time window,
// credits pool) so the clamp lives in exactly one place.
export function ratioPct(used: number | null, limit: number | null): number | null {
  if (used == null || !limit || limit < 0) return null;
  return Math.min(100, Math.max(0, (used / limit) * 100));
}
