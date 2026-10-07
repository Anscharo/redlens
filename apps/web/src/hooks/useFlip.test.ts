// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFlip } from "./useFlip";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function row(key: string, top: number) {
  const el = document.createElement("li");
  el.setAttribute("data-flip-key", key);
  Object.defineProperty(el, "offsetTop", { configurable: true, get: () => top });
  return el;
}

function listOf(...items: HTMLElement[]) {
  const list = document.createElement("ol");
  for (const item of items) list.append(item);
  return list;
}

describe("useFlip", () => {
  it("does nothing when the list ref is empty", () => {
    expect(() => renderHook(() => useFlip({ current: null }))).not.toThrow();
  });

  it("does not slide on the first layout, only records positions", () => {
    const a = row("a", 0);
    const b = row("b", 20);
    renderHook(() => useFlip({ current: listOf(a, b) }));
    expect(a.style.transform).toBe("");
    expect(b.style.transform).toBe("");
  });

  it("slides a reordered child from its previous offsetTop, then eases to rest", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const queued: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((fn) => {
      queued.push(fn);
      return queued.length;
    });
    const a = row("a", 0);
    const b = row("b", 20);
    const list = listOf(a, b);
    const { rerender } = renderHook(() => useFlip({ current: list }));
    list.insertBefore(b, a);
    Object.defineProperty(a, "offsetTop", { configurable: true, get: () => 20 });
    Object.defineProperty(b, "offsetTop", { configurable: true, get: () => 0 });
    rerender();
    expect(a.style.transform).toBe("translateY(-20px)");
    expect(b.style.transform).toBe("translateY(20px)");
    queued.forEach((fn) => fn(0));
    expect(a.style.transform).toBe("");
    expect(a.style.transition).toContain("transform");
    expect(b.style.transform).toBe("");
  });

  it("skips the slide under prefers-reduced-motion", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }));
    const a = row("a", 0);
    const b = row("b", 20);
    const list = listOf(a, b);
    const { rerender } = renderHook(() => useFlip({ current: list }));
    list.insertBefore(b, a);
    Object.defineProperty(a, "offsetTop", { configurable: true, get: () => 20 });
    rerender();
    expect(a.style.transform).toBe("");
  });

  it("skips a move smaller than half a pixel", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const a = row("a", 0);
    const list = listOf(a);
    const { rerender } = renderHook(() => useFlip({ current: list }));
    Object.defineProperty(a, "offsetTop", { configurable: true, get: () => 0.2 });
    // Force an order change so the hook considers a move.
    const ghost = row("b", 40);
    list.append(ghost);
    rerender();
    expect(a.style.transform).toBe("");
  });
});
