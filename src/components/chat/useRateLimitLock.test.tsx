// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useRateLimitLock } from "./useRateLimitLock";
import type { CommonsPool } from "./api";

afterEach(() => {
  vi.useRealTimers();
});

function setup(commons: CommonsPool | null, refresh: () => void) {
  return renderHook(({ c }: { c: CommonsPool | null }) => useRateLimitLock(c, refresh), { initialProps: { c: commons } });
}

describe("useRateLimitLock — token-window gate", () => {
  it("starts unlocked", () => {
    const { result } = setup(null, vi.fn());
    expect(result.current[0]).toBeNull();
  });

  it("stays locked before resetsAt and clears itself once the poll notices it has passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { result } = setup(null, vi.fn());

    act(() => {
      result.current[1]({ message: "Usage limit reached.", resetsAt: "2026-01-01T00:00:20Z", kind: "token" });
    });
    expect(result.current[0]?.kind).toBe("token");

    // Not yet due — one poll tick, still locked.
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(result.current[0]).not.toBeNull();

    // Past resetsAt — the next poll tick lifts the lock.
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(result.current[0]).toBeNull();
  });

  it("fails open immediately when resetsAt is missing", () => {
    const { result } = setup(null, vi.fn());
    act(() => {
      result.current[1]({ message: "Usage limit reached.", kind: "token" });
    });
    expect(result.current[0]).toBeNull();
  });

  it("fails open immediately when resetsAt is unparsable", () => {
    const { result } = setup(null, vi.fn());
    act(() => {
      result.current[1]({ message: "Usage limit reached.", resetsAt: "not-a-date", kind: "token" });
    });
    expect(result.current[0]).toBeNull();
  });

  it("unlocks right away if resetsAt is already in the past when the lock is set (backgrounded tab)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { result } = setup(null, vi.fn());
    act(() => {
      result.current[1]({ message: "Usage limit reached.", resetsAt: "2025-12-31T23:00:00Z", kind: "token" });
    });
    expect(result.current[0]).toBeNull();
  });
});

describe("useRateLimitLock — commons gate", () => {
  it("does not auto-clear on the passage of time alone before the bounded fallback", () => {
    vi.useFakeTimers();
    const { result } = setup(null, vi.fn());
    act(() => {
      result.current[1]({ message: "Shared pool is out of credits.", kind: "commons" });
    });
    act(() => {
      vi.advanceTimersByTime(60_000); // well under the 2-minute bounded fallback
    });
    expect(result.current[0]).not.toBeNull();
  });

  it("auto-clears after the bounded max lock duration as a last-resort probe, even if /api/usage never confirms", () => {
    vi.useFakeTimers();
    // refresh() that never changes `commons` (e.g. /api/usage itself is down —
    // useUsage.refresh() would swallow the error and leave commons as-is).
    const { result } = setup(null, vi.fn());
    act(() => {
      result.current[1]({ message: "Shared pool is out of credits.", kind: "commons" });
    });
    act(() => {
      vi.advanceTimersByTime(2 * 60_000 + 1);
    });
    expect(result.current[0]).toBeNull();
  });

  it("polls refresh() periodically while locked", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const { result } = setup(null, refresh);
    act(() => {
      result.current[1]({ message: "Shared pool is out of credits.", kind: "commons" });
    });
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not poll refresh() for a token-gate lock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const refresh = vi.fn();
    const { result } = setup(null, refresh);
    act(() => {
      result.current[1]({ message: "Usage limit reached.", resetsAt: "2026-01-01T01:00:00Z", kind: "token" });
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("clears the lock the moment a commons prop update shows room in the pool", () => {
    const { result, rerender } = setup(null, vi.fn());
    act(() => {
      result.current[1]({ message: "Shared pool is out of credits.", kind: "commons" });
    });
    expect(result.current[0]).not.toBeNull();

    rerender({ c: { used: 5, total: 10, remaining: 5 } });
    expect(result.current[0]).toBeNull();
  });

  it("ignores a stale positive reading present when the lock is set, and unlocks only on a fresh one", () => {
    // The panel already holds a cached-positive commons value when a
    // `commons_exhausted` 429 arrives (another user drained the pool after the
    // last refresh). That reading predates the drain, so it must not unlock.
    const stale: CommonsPool = { used: 0, total: 10, remaining: 10 };
    const { result, rerender } = setup(stale, vi.fn());
    act(() => {
      result.current[1]({ message: "Shared pool is out of credits.", kind: "commons" });
    });
    // Same stale object still on the prop → lock holds.
    expect(result.current[0]).not.toBeNull();

    // A genuinely fresh reading (new object) that shows room lifts it.
    rerender({ c: { used: 0, total: 10, remaining: 10 } });
    expect(result.current[0]).toBeNull();
  });

  it("stays locked if a commons update still shows the pool drained", () => {
    const { result, rerender } = setup(null, vi.fn());
    act(() => {
      result.current[1]({ message: "Shared pool is out of credits.", kind: "commons" });
    });
    rerender({ c: { used: 10, total: 10, remaining: 0 } });
    expect(result.current[0]).not.toBeNull();
  });
});
