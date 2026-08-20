// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import { usePulseDom } from "./usePulseDom";

const MS = 700;

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom's rAF is backed by setTimeout, which fake timers intercept — make it
  // synchronous so tests can assert immediately after renderHook/rerender.
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((fn) => {
    fn(performance.now());
    return 0;
  });
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

function isPulsing(container: HTMLElement, nodeId: string) {
  return container.querySelector(`[data-node-id="${nodeId}"]`)!.classList.contains("is-pulse");
}

describe("usePulseDom", () => {
  it("adds no class when nodeId is null", () => {
    const container = makeContainer("abc");
    renderHook(() => usePulseDom(null, useRef(container)));
    expect(isPulsing(container, "abc")).toBe(false);
  });

  it("adds is-pulse to the matching element when nodeId is set", () => {
    const container = makeContainer("abc", "xyz");
    renderHook(() => usePulseDom("abc", useRef(container)));
    expect(isPulsing(container, "abc")).toBe(true);
    expect(isPulsing(container, "xyz")).toBe(false);
  });

  it("removes is-pulse after the timeout elapses", () => {
    const container = makeContainer("abc");
    renderHook(() => usePulseDom("abc", useRef(container)));
    expect(isPulsing(container, "abc")).toBe(true);
    act(() => { vi.advanceTimersByTime(MS); });
    expect(isPulsing(container, "abc")).toBe(false);
  });

  it("switching nodeId moves is-pulse to the new element and clears it after ms from the switch", () => {
    const container = makeContainer("first", "second");
    const { rerender } = renderHook(
      ({ nodeId }) => usePulseDom(nodeId, useRef(container)),
      { initialProps: { nodeId: "first" as string | null } },
    );
    act(() => { vi.advanceTimersByTime(300); });
    rerender({ nodeId: "second" });
    expect(isPulsing(container, "first")).toBe(false);
    expect(isPulsing(container, "second")).toBe(true);
    act(() => { vi.advanceTimersByTime(MS - 1); });
    expect(isPulsing(container, "second")).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect(isPulsing(container, "second")).toBe(false);
  });
});
