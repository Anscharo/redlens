// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useUTCDay } from "./useUTCDay";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useUTCDay", () => {
  it("initializes to the current UTC day", () => {
    vi.setSystemTime(new Date("2026-07-23T12:00:00.000Z"));
    const { result } = renderHook(() => useUTCDay());
    expect(result.current).toBe("2026-07-23");
  });

  it("updates once the interval crosses midnight UTC", () => {
    vi.setSystemTime(new Date("2026-07-23T23:59:30.000Z"));
    const { result } = renderHook(() => useUTCDay());
    expect(result.current).toBe("2026-07-23");
    act(() => {
      vi.setSystemTime(new Date("2026-07-24T00:00:30.000Z"));
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe("2026-07-24");
  });

  it("does not change (or re-render to a new value) when the day hasn't crossed", () => {
    vi.setSystemTime(new Date("2026-07-23T10:00:00.000Z"));
    const { result } = renderHook(() => useUTCDay());
    act(() => {
      vi.setSystemTime(new Date("2026-07-23T10:01:00.000Z"));
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe("2026-07-23");
  });

  it("clears the interval on unmount", () => {
    vi.setSystemTime(new Date("2026-07-23T23:59:30.000Z"));
    const { result, unmount } = renderHook(() => useUTCDay());
    unmount();
    act(() => {
      vi.setSystemTime(new Date("2026-07-24T00:00:30.000Z"));
      vi.advanceTimersByTime(60_000);
    });
    // Value captured before unmount should not have updated post-unmount.
    expect(result.current).toBe("2026-07-23");
  });
});
