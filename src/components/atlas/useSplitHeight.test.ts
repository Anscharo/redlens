// @vitest-environment jsdom
// useSplitHeight's clamping order (SPLIT_MIN_PX floor, availPx - READER_MIN_PX
// cap, contentPx overriding dragged) is dense enough to get subtly wrong — see
// the Codex/Claude review findings on this file. jsdom has no real layout, so
// availPx/contentPx are driven by hand: attach the refs to a hand-built DOM
// tree, stub clientHeight/scrollHeight, then fire the same triggers the hook's
// own effects listen for (a "resize" event, a shrinkToContent prop change).
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useSplitHeight, SPLIT_MIN_PX, READER_MIN_PX, SPLIT_DEFAULT_FRACTION } from "./useSplitHeight";

const STORAGE_KEY = "redline-sky-atlas:split-pane-height";

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function stubClientHeight(el: HTMLElement, px: number) {
  Object.defineProperty(el, "clientHeight", { value: px, configurable: true });
}

function stubOffsetTop(el: HTMLElement, px: number) {
  Object.defineProperty(el, "offsetTop", { value: px, configurable: true });
}

/** Builds parent(availPx) > pane > scroller > content and wires them into the
 *  hook's refs, mirroring what JuniorPane actually mounts. */
function attach(result: { current: ReturnType<typeof useSplitHeight> }, opts: { availPx: number; paneH: number; scrollerH: number }) {
  const parent = document.createElement("div");
  stubClientHeight(parent, opts.availPx);
  const pane = document.createElement("div");
  stubClientHeight(pane, opts.paneH);
  parent.appendChild(pane);
  const scroller = document.createElement("div");
  stubClientHeight(scroller, opts.scrollerH);
  pane.appendChild(scroller);
  const content = document.createElement("div");
  scroller.appendChild(content);
  result.current.paneRef.current = pane;
  result.current.scrollerRef.current = scroller;
  result.current.contentRef.current = content;
  return { parent, pane, scroller, content };
}

describe("useSplitHeight", () => {
  it("uses the default fraction of the available height, clamped to maxPx, when nothing is dragged or stored", () => {
    const { result } = renderHook(({ shrink }) => useSplitHeight(shrink), { initialProps: { shrink: false } });
    attach(result, { availPx: 1000, paneH: 400, scrollerH: 400 });
    act(() => window.dispatchEvent(new Event("resize")));

    // defaultPx = round(1000 * 0.45) = 450, well under maxPx (1000-160=840).
    expect(result.current.height).toBe(Math.round(1000 * SPLIT_DEFAULT_FRACTION));
  });

  it("floors at SPLIT_MIN_PX even when the content is shorter", () => {
    const { result, rerender } = renderHook(({ shrink }) => useSplitHeight(shrink), {
      initialProps: { shrink: false },
    });
    const { content } = attach(result, { availPx: 1000, paneH: 400, scrollerH: 380 });
    Object.defineProperty(content, "scrollHeight", { value: 50, configurable: true });
    act(() => window.dispatchEvent(new Event("resize")));

    // Re-render with shrinkToContent flipped on so the content-measuring effect
    // (gated on the `shrink` prop) fires against the DOM just attached.
    rerender({ shrink: true });

    // contentPx = scrollHeight(50) + chrome(paneH 400 - scrollerH 380 = 20) = 70,
    // which undercuts SPLIT_MIN_PX(120) — the floor wins.
    expect(result.current.height).toBe(SPLIT_MIN_PX);
  });

  it("caps at availPx - READER_MIN_PX when the stored/dragged height is larger", () => {
    localStorage.setItem(STORAGE_KEY, "900");
    const { result } = renderHook(({ shrink }) => useSplitHeight(shrink), { initialProps: { shrink: false } });
    attach(result, { availPx: 1000, paneH: 400, scrollerH: 400 });
    act(() => window.dispatchEvent(new Event("resize")));

    expect(result.current.height).toBe(1000 - READER_MIN_PX);
  });

  it("ignores a stored height below SPLIT_MIN_PX (readStored discards it)", () => {
    localStorage.setItem(STORAGE_KEY, "10");
    const { result } = renderHook(({ shrink }) => useSplitHeight(shrink), { initialProps: { shrink: false } });
    attach(result, { availPx: 1000, paneH: 400, scrollerH: 400 });
    act(() => window.dispatchEvent(new Event("resize")));

    // Falls back to the default fraction, not the too-small stored value.
    expect(result.current.height).toBe(Math.round(1000 * SPLIT_DEFAULT_FRACTION));
  });

  it("fits content using the scroller's offset from the pane top as chrome, not pane-minus-scroller clientHeight", () => {
    const { result, rerender } = renderHook(({ shrink }) => useSplitHeight(shrink), {
      initialProps: { shrink: false },
    });
    const { scroller, content } = attach(result, { availPx: 1000, paneH: 400, scrollerH: 400 });
    stubOffsetTop(scroller, 35); // the breadcrumb header's height
    Object.defineProperty(content, "scrollHeight", { value: 200, configurable: true });
    act(() => window.dispatchEvent(new Event("resize")));
    rerender({ shrink: true });

    // contentPx = scrollHeight(200) + offsetTop(35) = 235.
    expect(result.current.height).toBe(235);
  });

  it("does not shrink to a Suspense skeleton's height — skips measuring while one is present", () => {
    const { result, rerender } = renderHook(({ shrink }) => useSplitHeight(shrink), {
      initialProps: { shrink: false },
    });
    const { scroller, content } = attach(result, { availPx: 1000, paneH: 400, scrollerH: 400 });
    stubOffsetTop(scroller, 35);
    const skeleton = document.createElement("div");
    skeleton.setAttribute("data-node-content-skeleton", "");
    content.appendChild(skeleton);
    Object.defineProperty(content, "scrollHeight", { value: 50, configurable: true }); // the skeleton's own (short) height
    act(() => window.dispatchEvent(new Event("resize")));
    rerender({ shrink: true });

    // Skeleton present: contentPx stays unset, so height falls back to the
    // default fraction rather than fitting the skeleton's height.
    expect(result.current.height).toBe(Math.round(1000 * SPLIT_DEFAULT_FRACTION));

    // Skeleton replaced by real (taller) content — the next re-measure (the
    // real ResizeObserver would fire this on its own; toggling shrinkToContent
    // here re-runs the effect the same way a fresh navigation would) now uses
    // the real content height.
    content.removeChild(skeleton);
    Object.defineProperty(content, "scrollHeight", { value: 200, configurable: true });
    rerender({ shrink: false });
    rerender({ shrink: true });
    expect(result.current.height).toBe(235); // 200 + offsetTop(35, still stubbed on scroller)
  });
});
