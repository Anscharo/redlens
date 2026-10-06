import { useEffect, useRef, useState } from "react";
import type { CommonsPool } from "./api";
import type { RateLimitState } from "./types";

const TOKEN_POLL_MS = 15_000;
const COMMONS_POLL_MS = 20_000;
// No signal to poll; an early lift just meets a fresh 429 and re-locks.
const CONCURRENT_LOCK_MS = 5_000;
// If /api/usage is down no top-up is ever observed, so the next send becomes a
// probe after this; chat.ts likewise fails open on unreadable commons state.
const COMMONS_MAX_LOCK_MS = 2 * 60_000;

type SetRateLimit = (next: RateLimitState | null) => void;

// "token": poll (not one long timeout) so a throttled tab catches up on refocus;
// fail open on a missing or unparsable timestamp.
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

// The "locked out" state after a 429, lifted automatically per gate.
export function useRateLimitLock(commons: CommonsPool | null, refresh: () => void) {
  const [rateLimit, setRateLimit] = useState<RateLimitState | null>(null);
  useTokenUnlock(rateLimit, setRateLimit);
  useConcurrentUnlock(rateLimit, setRateLimit);
  useCommonsPoll(rateLimit, setRateLimit, refresh);
  useCommonsUnlock(rateLimit, setRateLimit, commons);
  return [rateLimit, setRateLimit] as const;
}
