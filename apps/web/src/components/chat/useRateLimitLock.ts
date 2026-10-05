import { useEffect, useRef, useState } from "react";
import type { CommonsPool } from "./api";
import type { RateLimitState } from "./types";

const TOKEN_POLL_MS = 15_000;
const COMMONS_POLL_MS = 20_000;
// "concurrent" (the per-user in-flight cap) has no server signal to wait on —
// unlike the token window's resetsAt or the commons pool's /api/usage read,
// there's nothing to poll. It clears itself as soon as one of the user's own
// in-flight turns finishes, which in practice is seconds, not minutes, so a
// short optimistic timeout stands in for a real signal. If it fires early
// (the other turn is still running), the next send just gets re-locked by a
// fresh 429 for another short window — self-correcting, same spirit as the
// commons lock's bounded COMMONS_MAX_LOCK_MS fallback below.
const CONCURRENT_LOCK_MS = 5_000;
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
// once disabled). Three gates, three unlock strategies (see chat.ts:
// "rate_limited", "commons_exhausted", "too_many_concurrent"):
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
//   - "concurrent" (per-user in-flight cap) has no server signal at all — it
//     self-lifts on a short fixed timeout (CONCURRENT_LOCK_MS) instead.
type SetRateLimit = (next: RateLimitState | null) => void;

// "token": poll for the known reset instant; fail open on a missing or
// unparsable timestamp.
function useTokenUnlock(rateLimit: RateLimitState | null, setRateLimit: SetRateLimit) {
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
  }, [rateLimit, setRateLimit]);
}

// "concurrent": no signal to wait on — lift after a short fixed timeout.
function useConcurrentUnlock(rateLimit: RateLimitState | null, setRateLimit: SetRateLimit) {
  useEffect(() => {
    if (!rateLimit || rateLimit.kind !== "concurrent") return;
    const id = setTimeout(() => setRateLimit(null), CONCURRENT_LOCK_MS);
    return () => clearTimeout(id);
  }, [rateLimit, setRateLimit]);
}

// "commons": poll `refresh()`, and lift after COMMONS_MAX_LOCK_MS regardless.
function useCommonsPoll(rateLimit: RateLimitState | null, setRateLimit: SetRateLimit, refresh: () => void) {
  useEffect(() => {
    if (!rateLimit || rateLimit.kind !== "commons") return;
    const lockedAt = Date.now();
    const id = setInterval(() => {
      refresh();
      if (Date.now() - lockedAt >= COMMONS_MAX_LOCK_MS) setRateLimit(null);
    }, COMMONS_POLL_MS);
    return () => clearInterval(id);
  }, [rateLimit, setRateLimit, refresh]);
}

// "commons": lift the moment a FRESH reading shows room. The reading that was
// current at the instant the lock was set is NOT evidence the pool has room —
// it can be a stale cached-positive value from before another user drained
// the shared pool, which is exactly the 429 that just fired. So it is pinned
// on the render that first sets the lock and ignored; useUsage.refresh()
// parses fresh JSON into a new object on every successful fetch, so identity
// inequality is a reliable "this arrived after the lock".
function useCommonsUnlock(rateLimit: RateLimitState | null, setRateLimit: SetRateLimit, commons: CommonsPool | null) {
  const lockReadingRef = useRef<CommonsPool | null>(null);
  const wasCommonsRef = useRef(false);
  useEffect(() => {
    const isCommons = rateLimit?.kind === "commons";
    if (isCommons && !wasCommonsRef.current) lockReadingRef.current = commons;
    wasCommonsRef.current = isCommons;
    if (!isCommons) return;
    if (commons && commons !== lockReadingRef.current && commons.remaining > 0) setRateLimit(null);
  }, [commons, rateLimit, setRateLimit]);
}

export function useRateLimitLock(commons: CommonsPool | null, refresh: () => void) {
  const [rateLimit, setRateLimit] = useState<RateLimitState | null>(null);
  useTokenUnlock(rateLimit, setRateLimit);
  useConcurrentUnlock(rateLimit, setRateLimit);
  useCommonsPoll(rateLimit, setRateLimit, refresh);
  useCommonsUnlock(rateLimit, setRateLimit, commons);
  return [rateLimit, setRateLimit] as const;
}
