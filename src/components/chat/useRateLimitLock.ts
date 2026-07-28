import { useEffect, useState } from "react";
import type { CommonsPool } from "./api";
import type { RateLimitState } from "./types";

const TOKEN_POLL_MS = 15_000;
const COMMONS_POLL_MS = 20_000;
// Upper bound on an unconfirmed commons lock. `useUsage.refresh()` swallows
// fetch errors silently and just leaves `commons` on its last value — if
// /api/usage itself is down, polling it (and the "Check now" button, which
// hits the same endpoint) can never observe a top-up and the lock would
// otherwise never lift. Rather than stay stuck, treat this as a bounded
// backoff: let the next send through as a live probe. That's not "just
// letting requests through" — chat.ts fails OPEN on an unreadable commons
// state for the same reason, so a probe here matches the server's own
// judgment call, and a real re-exhaustion just re-locks and restarts the wait.
const COMMONS_MAX_LOCK_MS = 2 * 60_000;

// Tracks the "locked out" state after a 429 and lifts it automatically — the
// bug this fixes is that the composer used to stay disabled forever, since
// nothing ever cleared it outside of a successful send (which is unreachable
// once disabled). Two gates, two unlock strategies (see chat.ts: "rate_limited"
// vs "commons_exhausted"):
//   - "token" (per-user window) resets at a known instant (`resetsAt`). Poll
//     rather than one long setTimeout so a backgrounded/throttled tab still
//     catches up promptly on refocus; fail open (unlock immediately) if the
//     timestamp is missing or unparsable rather than lock forever.
//   - "commons" (shared pool) has no fixed reset — only a fresh /api/usage
//     read (a top-up) can lift it, so poll `refresh()` periodically and clear
//     the lock the moment `commons.remaining` is positive again, with a bounded
//     fallback (COMMONS_MAX_LOCK_MS) in case /api/usage itself can't confirm
//     either way. The caller should also expose a manual recheck (calling the
//     same `refresh`) for an immediate check rather than waiting on the poll.
export function useRateLimitLock(commons: CommonsPool | null, refresh: () => void) {
  const [rateLimit, setRateLimit] = useState<RateLimitState | null>(null);

  useEffect(() => {
    if (!rateLimit || rateLimit.kind !== "token") return;
    const resetMs = rateLimit.resetsAt ? Date.parse(rateLimit.resetsAt) : NaN;
    if (!Number.isFinite(resetMs)) {
      setRateLimit(null);
      return;
    }
    const check = () => {
      if (Date.now() >= resetMs) setRateLimit(null);
    };
    check(); // in case it already elapsed before this effect ran
    const id = setInterval(check, TOKEN_POLL_MS);
    return () => clearInterval(id);
  }, [rateLimit]);

  useEffect(() => {
    if (!rateLimit || rateLimit.kind !== "commons") return;
    const lockedAt = Date.now();
    const id = setInterval(() => {
      refresh();
      if (Date.now() - lockedAt >= COMMONS_MAX_LOCK_MS) setRateLimit(null);
    }, COMMONS_POLL_MS);
    return () => clearInterval(id);
  }, [rateLimit, refresh]);

  useEffect(() => {
    if (rateLimit?.kind === "commons" && commons && commons.remaining > 0) setRateLimit(null);
  }, [commons, rateLimit]);

  return [rateLimit, setRateLimit] as const;
}
