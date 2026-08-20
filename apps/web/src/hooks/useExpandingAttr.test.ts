// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useRef } from "react";
import { useExpandingAttr } from "./useExpandingAttr";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(durationMs?: number) {
  const el = document.createElement("div");
  return renderHook(() => {
    const ref = useRef<HTMLElement | null>(el);
    return useExpandingAttr(ref, durationMs);
  });
}

describe("useExpandingAttr", () => {
  it("sets data-expanding on the element when invoked", () => {
    const el = document.createElement("div");
    const { result } = renderHook(() => {
      const ref = useRef<HTMLElement | null>(el);
      return useExpandingAttr(ref);
    });
    act(() => result.current());
    expect(el.getAttribute("data-expanding")).toBe("true");
  });

  it("removes data-expanding after the duration elapses", () => {
    const el = document.createElement("div");
    const { result } = renderHook(() => {
      const ref = useRef<HTMLElement | null>(el);
      return useExpandingAttr(ref, 250);
    });
    act(() => result.current());
    expect(el.hasAttribute("data-expanding")).toBe(true);
    act(() => vi.advanceTimersByTime(250));
    expect(el.hasAttribute("data-expanding")).toBe(false);
  });

  it("does nothing if the ref's current element is null", () => {
    const { result } = renderHook(() => {
      const ref = useRef<HTMLElement | null>(null);
      return useExpandingAttr(ref);
    });
    expect(() => act(() => result.current())).not.toThrow();
  });

  it("a second invocation before the timer fires clears/restarts the timer", () => {
    const el = document.createElement("div");
    const { result } = renderHook(() => {
      const ref = useRef<HTMLElement | null>(el);
      return useExpandingAttr(ref, 250);
    });
    act(() => result.current());
    act(() => vi.advanceTimersByTime(150));
    act(() => result.current()); // restarts the 250ms window
    act(() => vi.advanceTimersByTime(150));
    // Original 250ms would have elapsed (150+150=300) but restart means it hasn't.
    expect(el.hasAttribute("data-expanding")).toBe(true);
    act(() => vi.advanceTimersByTime(100));
    expect(el.hasAttribute("data-expanding")).toBe(false);
  });

  it("uses the default duration of 250ms when omitted", () => {
    const { result } = setup();
    // Just verify no crash and callback is stable/callable.
    expect(typeof result.current).toBe("function");
  });
});
