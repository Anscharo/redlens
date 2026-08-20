// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCopyState } from "./useCopyState";

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useCopyState", () => {
  it("starts with copied=false", () => {
    const { result } = renderHook(() => useCopyState());
    expect(result.current.copied).toBe(false);
  });

  it("flips to true after copy(), then back to false after 1200ms", async () => {
    const { result } = renderHook(() => useCopyState());
    await act(async () => {
      result.current.copy("hello");
      // Flush the writeText().then microtask without advancing timers
      // so the 1200ms reset timer doesn't fire yet.
      await Promise.resolve();
    });
    expect(result.current.copied).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(1200);
    });
    expect(result.current.copied).toBe(false);
  });

  it("a second copy() before the timer elapses resets the timer", async () => {
    const { result } = renderHook(() => useCopyState());
    await act(async () => {
      result.current.copy("first");
      await Promise.resolve();
    });
    expect(result.current.copied).toBe(true);
    // Advance halfway, then trigger another copy — should still be copied at the end of the second window.
    await act(async () => {
      vi.advanceTimersByTime(600);
      result.current.copy("second");
      await Promise.resolve();
    });
    expect(result.current.copied).toBe(true);
    // Original 1200ms from first copy would have elapsed by now (600 + 600 = 1200);
    // but the second copy reset the timer, so copied should still be true.
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current.copied).toBe(true);
    // Now the second timer should fire.
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current.copied).toBe(false);
  });
});
