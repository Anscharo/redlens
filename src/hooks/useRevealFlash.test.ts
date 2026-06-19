// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRevealFlash } from "./useRevealFlash";

const DELAY = 210; // CHANGE_FLASH_DELAY_MS
const DURATION = 600; // CHANGE_FLASH_MS (jsdom has no CSS var → falls back to 600)

// tree: A (root) → B → C
const parentOf = new Map<string, string | null>([
  ["A", null],
  ["B", "A"],
  ["C", "B"],
]);

// Stable flashIds references — in the app this set is memoized on [diff], so its
// identity only changes when the change set changes. Tests must do the same or
// the re-baseline-on-flashIds-change guard would fire every render.
const EMPTY_IDS = new Set<string>();
const IDS_C = new Set(["C"]);
const IDS_BC = new Set(["B", "C"]);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useRevealFlash", () => {
  it("does not flash docs already visible on first render (priming)", () => {
    const { result } = renderHook(() =>
      useRevealFlash(IDS_C, parentOf, new Set(["A", "B"]), true),
    );
    act(() => vi.advanceTimersByTime(DELAY + 1));
    expect(result.current.size).toBe(0);
  });

  it("does not flash when the diff arrives after the bundle (flashIds change ≠ reveal)", () => {
    const { result, rerender } = renderHook(
      ({ flashIds }) => useRevealFlash(flashIds, parentOf, new Set(["A", "B"]), true),
      { initialProps: { flashIds: EMPTY_IDS } },
    );
    // C is already visible (A,B expanded); the diff resolving must NOT flash it.
    rerender({ flashIds: IDS_C });
    act(() => vi.advanceTimersByTime(DELAY + DURATION));
    expect(result.current.has("C")).toBe(false);
  });

  it("flashes a changed doc after the delay once its ancestors expand", () => {
    const { result, rerender } = renderHook(
      ({ expandedIds }) => useRevealFlash(IDS_C, parentOf, expandedIds, true),
      { initialProps: { expandedIds: new Set<string>() } },
    );
    rerender({ expandedIds: new Set(["A", "B"]) });
    act(() => vi.advanceTimersByTime(DELAY - 1));
    expect(result.current.has("C")).toBe(false); // still within the delay
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.has("C")).toBe(true);
  });

  it("clears the flash after the duration", () => {
    const { result, rerender } = renderHook(
      ({ expandedIds }) => useRevealFlash(IDS_C, parentOf, expandedIds, true),
      { initialProps: { expandedIds: new Set<string>() } },
    );
    rerender({ expandedIds: new Set(["A", "B"]) });
    act(() => vi.advanceTimersByTime(DELAY));
    expect(result.current.has("C")).toBe(true);
    act(() => vi.advanceTimersByTime(DURATION));
    expect(result.current.has("C")).toBe(false);
  });

  it("flashes nothing while inactive", () => {
    const { result, rerender } = renderHook(
      ({ active, expandedIds }) => useRevealFlash(IDS_C, parentOf, expandedIds, active),
      { initialProps: { active: false, expandedIds: new Set<string>() } },
    );
    rerender({ active: false, expandedIds: new Set(["A", "B"]) });
    act(() => vi.advanceTimersByTime(DELAY + DURATION));
    expect(result.current.size).toBe(0);
  });

  it("drains a pending flash timer when deactivated mid-delay", () => {
    const { result, rerender } = renderHook(
      ({ active, expandedIds }) => useRevealFlash(IDS_C, parentOf, expandedIds, active),
      { initialProps: { active: true, expandedIds: new Set<string>() } },
    );
    rerender({ active: true, expandedIds: new Set(["A", "B"]) }); // schedule C flash @ +DELAY
    act(() => vi.advanceTimersByTime(100)); // still within the delay
    rerender({ active: false, expandedIds: new Set(["A", "B"]) }); // deactivate before it fires
    act(() => vi.advanceTimersByTime(DELAY + DURATION));
    expect(result.current.size).toBe(0);
  });

  it("flashes each generation in a staggered reveal (a later expansion does not cancel an earlier pending flash)", () => {
    const { result, rerender } = renderHook(
      ({ expandedIds }) => useRevealFlash(IDS_BC, parentOf, expandedIds, true),
      { initialProps: { expandedIds: new Set<string>() } },
    );
    rerender({ expandedIds: new Set(["A"]) }); // reveals B → schedule B flash @ +DELAY
    act(() => vi.advanceTimersByTime(100));
    rerender({ expandedIds: new Set(["A", "B"]) }); // reveals C → schedule C flash @ 100+DELAY
    act(() => vi.advanceTimersByTime(DELAY - 100)); // t = DELAY → B fires
    expect(result.current.has("B")).toBe(true);
    act(() => vi.advanceTimersByTime(100)); // t = DELAY+100 → C fires
    expect(result.current.has("C")).toBe(true);
    expect(result.current.has("B")).toBe(true); // still within its own duration
  });

  it("a re-reveal is not cut short by the prior flash's end timer", () => {
    const { result, rerender } = renderHook(
      ({ expandedIds }) => useRevealFlash(IDS_C, parentOf, expandedIds, true),
      { initialProps: { expandedIds: new Set<string>() } },
    );
    rerender({ expandedIds: new Set(["A", "B"]) }); // reveal C → start @210, end @810
    act(() => vi.advanceTimersByTime(DELAY)); // t=210, C flashing, end scheduled @810
    act(() => vi.advanceTimersByTime(290)); // t=500
    // collapse then re-expand → C is "newly" again, second flash start @ t=710
    rerender({ expandedIds: new Set(["A"]) });
    rerender({ expandedIds: new Set(["A", "B"]) });
    act(() => vi.advanceTimersByTime(210)); // t=710, second start fires, cancels old end @810
    expect(result.current.has("C")).toBe(true);
    act(() => vi.advanceTimersByTime(100)); // t=810 — old end would have fired, but was cancelled
    expect(result.current.has("C")).toBe(true);
  });
});
