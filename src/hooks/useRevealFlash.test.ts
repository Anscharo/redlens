// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import { useRevealFlash } from "./useRevealFlash";

const DELAY = 210; // CHANGE_FLASH_DELAY_MS
const DURATION = 600; // CHANGE_FLASH_MS (jsdom has no CSS var → falls back to 600)

// tree: A (root) → B → C
const parentOf = new Map<string, string | null>([
  ["A", null],
  ["B", "A"],
  ["C", "B"],
]);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function makeContainer(...nodeIds: string[]) {
  const el = document.createElement("div");
  for (const id of nodeIds) {
    const row = document.createElement("div");
    row.setAttribute("data-node-id", id);
    el.appendChild(row);
  }
  return el;
}
function flashing(container: HTMLElement, id: string) {
  return container.querySelector(`[data-node-id="${id}"]`)!.classList.contains("is-change-flash");
}

describe("useRevealFlash", () => {
  it("does not flash docs already visible on first render (priming)", () => {
    const container = makeContainer("C");
    renderHook(() =>
      useRevealFlash(new Set(["C"]), parentOf, new Set(["A", "B"]), true, useRef(container)),
    );
    act(() => vi.advanceTimersByTime(DELAY + 1));
    expect(flashing(container, "C")).toBe(false);
  });

  it("flashes a changed doc after the delay once its ancestors expand", () => {
    const container = makeContainer("C");
    const { rerender } = renderHook(
      ({ expandedIds }) =>
        useRevealFlash(new Set(["C"]), parentOf, expandedIds, true, useRef(container)),
      { initialProps: { expandedIds: new Set<string>() } },
    );
    rerender({ expandedIds: new Set(["A", "B"]) });
    act(() => vi.advanceTimersByTime(DELAY - 1));
    expect(flashing(container, "C")).toBe(false); // still within the delay
    act(() => vi.advanceTimersByTime(1));
    expect(flashing(container, "C")).toBe(true);
  });

  it("clears the flash after the duration", () => {
    const container = makeContainer("C");
    const { rerender } = renderHook(
      ({ expandedIds }) =>
        useRevealFlash(new Set(["C"]), parentOf, expandedIds, true, useRef(container)),
      { initialProps: { expandedIds: new Set<string>() } },
    );
    rerender({ expandedIds: new Set(["A", "B"]) });
    act(() => vi.advanceTimersByTime(DELAY));
    expect(flashing(container, "C")).toBe(true);
    act(() => vi.advanceTimersByTime(DURATION));
    expect(flashing(container, "C")).toBe(false);
  });

  it("does not flash while inactive", () => {
    const container = makeContainer("C");
    const { rerender } = renderHook(
      ({ active, expandedIds }) =>
        useRevealFlash(new Set(["C"]), parentOf, expandedIds, active, useRef(container)),
      { initialProps: { active: false, expandedIds: new Set<string>() } },
    );
    rerender({ active: false, expandedIds: new Set(["A", "B"]) });
    act(() => vi.advanceTimersByTime(DELAY + DURATION));
    expect(flashing(container, "C")).toBe(false);
  });

  it("flashes each generation in a staggered reveal (a later expansion does not cancel an earlier pending flash)", () => {
    const container = makeContainer("B", "C");
    const { rerender } = renderHook(
      ({ expandedIds }) =>
        useRevealFlash(new Set(["B", "C"]), parentOf, expandedIds, true, useRef(container)),
      { initialProps: { expandedIds: new Set<string>() } },
    );
    rerender({ expandedIds: new Set(["A"]) }); // reveals B → schedule B flash @ +DELAY
    act(() => vi.advanceTimersByTime(100));
    rerender({ expandedIds: new Set(["A", "B"]) }); // reveals C → schedule C flash @ 100+DELAY
    act(() => vi.advanceTimersByTime(DELAY - 100)); // t = DELAY → B fires
    expect(flashing(container, "B")).toBe(true);
    act(() => vi.advanceTimersByTime(100)); // t = DELAY+100 → C fires
    expect(flashing(container, "C")).toBe(true);
    expect(flashing(container, "B")).toBe(true); // still within its own duration
  });

  it("skips rows that are not in the DOM (off-screen / virtualized away)", () => {
    const container = makeContainer("B"); // C intentionally absent
    const { rerender } = renderHook(
      ({ expandedIds }) =>
        useRevealFlash(new Set(["C"]), parentOf, expandedIds, true, useRef(container)),
      { initialProps: { expandedIds: new Set<string>() } },
    );
    rerender({ expandedIds: new Set(["A", "B"]) });
    expect(() => act(() => vi.advanceTimersByTime(DELAY + DURATION))).not.toThrow();
    expect(container.querySelector('[data-node-id="C"]')).toBeNull();
  });
});
