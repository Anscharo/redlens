// @vitest-environment jsdom
// glide() must cancel a prior in-flight glide on the same scroller instead of
// letting two rAF loops fight over scrollTop (deep review finding: no
// cancellation token). Driven with a fake scroller + mocked
// requestAnimationFrame/performance.now — jsdom's real scrollTop/layout can't
// observe the race directly.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { glide, needsScroll, scrollIfOutOfView } from "./animatedScroll";

type FakeScroller = { scrollTop: number };

function fakeScroller(): FakeScroller {
  return { scrollTop: 0 };
}

describe("glide", () => {
  let rafCallbacks: FrameRequestCallback[];
  let now: number;
  const realRAF = globalThis.requestAnimationFrame;
  const realNow = performance.now;

  beforeEach(() => {
    rafCallbacks = [];
    now = 0;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    performance.now = () => now;
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = realRAF;
    performance.now = realNow;
  });

  function step() {
    const cbs = rafCallbacks;
    rafCallbacks = [];
    for (const cb of cbs) cb(now);
  }

  it("a second glide on the same scroller cancels the first — only the second writes scrollTop", () => {
    const scroller = fakeScroller() as unknown as Element;

    glide(scroller, 100); // first glide: 0 -> 100
    now = 50;
    step(); // first loop's queued frame runs, scrollTop moves partway toward 100
    const midway = scroller.scrollTop;
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(100);

    glide(scroller, 0); // second glide starts from wherever we are -> 0, supersedes the first
    now = 60;
    step(); // both the first loop's next frame AND the second loop's first frame are queued now

    // If the first (stale) loop were still writing, scrollTop would be pulled
    // back toward 100; the fix means only the second glide's math applies.
    expect(scroller.scrollTop).toBeLessThanOrEqual(midway);
  });

  it("without a second glide, a single glide runs to completion", () => {
    const scroller = fakeScroller() as unknown as Element;
    glide(scroller, 200);
    now = 220; // >= GLIDE_MS
    step();
    expect(scroller.scrollTop).toBe(200);
  });
});

// Navigating to a doc must land its TITLE on screen plus a slice of its body —
// the old check only asked whether ANY part of the row was visible, so a tall
// doc counted as "in view" with its heading scrolled off the top.
describe("needsScroll", () => {
  // A 600px-tall reader band starting at y=64.
  const band = { viewTop: 64, viewBottom: 664 };
  const title = (top: number) => ({ titleTop: top, titleBottom: top + 40 });

  it("scrolls when the title is above the band, even though the body still fills the screen", () => {
    expect(
      needsScroll({ ...band, ...title(-200), bodyTop: -160, bodyBottom: 900 }),
    ).toBe(true);
  });

  it("scrolls when the title is below the band", () => {
    expect(needsScroll({ ...band, ...title(700), bodyTop: 740, bodyBottom: 900 })).toBe(true);
  });

  it("scrolls when the title is only partly visible at the bottom edge", () => {
    expect(needsScroll({ ...band, ...title(640) })).toBe(true);
  });

  it("does not scroll for a bodyless row that is fully in view", () => {
    expect(needsScroll({ ...band, ...title(100) })).toBe(false);
  });

  it("scrolls when the title is in view but too little of the body shows", () => {
    // body 500 tall, wants 100 visible; only the last 24px of the band are left.
    expect(
      needsScroll({ ...band, ...title(600), bodyTop: 640, bodyBottom: 1140 }),
    ).toBe(true);
  });

  it("does not scroll once the wanted fraction of body is showing", () => {
    // body 500 tall wants 100; 300 is showing.
    expect(
      needsScroll({ ...band, ...title(100), bodyTop: 140, bodyBottom: 640 }),
    ).toBe(false);
  });

  it("asks only for what fits when the body is taller than the room beneath the title", () => {
    // body 5000 tall would "want" 1000px — more than the 560px of room. With the
    // title at the top of the band every available pixel is already body, so
    // demanding the fraction would scroll forever chasing an impossible target.
    expect(
      needsScroll({ ...band, ...title(64), bodyTop: 104, bodyBottom: 5104 }),
    ).toBe(false);
  });

  it("ignores a zero-height body", () => {
    expect(needsScroll({ ...band, ...title(100), bodyTop: 140, bodyBottom: 140 })).toBe(false);
  });
});

// scrollIfOutOfView glues needsScroll's geometry to the real DOM (closest,
// getComputedStyle, matchMedia, scrollIntoView/glide) — the part needsScroll's
// own pure-function tests above deliberately don't reach.
describe("scrollIfOutOfView", () => {
  const realMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = realMatchMedia;
    document.body.innerHTML = "";
  });

  function mockMatchMedia(reducedMotion: boolean) {
    window.matchMedia = ((query: string) => ({
      matches: reducedMotion,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  function setRect(el: Element, r: Partial<DOMRect>) {
    el.getBoundingClientRect = () =>
      ({ x: 0, y: 0, width: 0, height: 0, left: 0, right: 0, top: 0, bottom: 0, toJSON() {}, ...r }) as DOMRect;
  }

  /** A row (article + its [data-row-bar] title), optionally inside a .atlas-scroll ancestor. */
  function buildRow(opts: { inScroller: boolean }) {
    const scroller = document.createElement("div");
    scroller.className = "atlas-scroll";
    const el = document.createElement("article");
    const bar = document.createElement("div");
    bar.setAttribute("data-row-bar", "");
    el.appendChild(bar);
    el.style.scrollMarginTop = "64px";
    if (opts.inScroller) {
      scroller.appendChild(el);
      document.body.appendChild(scroller);
    } else {
      document.body.appendChild(el);
    }
    return { scroller, el, bar };
  }

  it("does nothing when the row's title is already fully in view", () => {
    mockMatchMedia(false);
    const { scroller, el, bar } = buildRow({ inScroller: true });
    setRect(scroller, { top: 0, bottom: 600 });
    setRect(el, { top: 100 });
    setRect(bar, { top: 100, bottom: 140 });
    scroller.scrollTop = 5;

    scrollIfOutOfView(el);

    expect(scroller.scrollTop).toBe(5);
  });

  it("falls back to instant scrollIntoView when there is no .atlas-scroll ancestor", () => {
    mockMatchMedia(false);
    const { el, bar } = buildRow({ inScroller: false });
    setRect(el, { top: -300 });
    setRect(bar, { top: -300, bottom: -260 }); // above the band -> out of view
    const scrollIntoViewMock = vi.fn();
    el.scrollIntoView = scrollIntoViewMock;

    scrollIfOutOfView(el);

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "instant", block: "start" });
  });

  it("falls back to instant scrollIntoView under reduced motion, even with a scroller", () => {
    mockMatchMedia(true);
    const { scroller, el, bar } = buildRow({ inScroller: true });
    setRect(scroller, { top: 0, bottom: 600 });
    setRect(el, { top: -300 });
    setRect(bar, { top: -300, bottom: -260 });
    const scrollIntoViewMock = vi.fn();
    el.scrollIntoView = scrollIntoViewMock;

    scrollIfOutOfView(el);

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "instant", block: "start" });
  });

  it("glides the scroller to the computed target when the row is out of view", () => {
    mockMatchMedia(false);
    const rafCallbacks: FrameRequestCallback[] = [];
    const realRAF = globalThis.requestAnimationFrame;
    const realNow = performance.now;
    let now = 0;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    performance.now = () => now;

    try {
      const { scroller, el, bar } = buildRow({ inScroller: true });
      setRect(scroller, { top: 0, bottom: 600 });
      setRect(el, { top: -300 });
      setRect(bar, { top: -300, bottom: -260 });
      Object.defineProperty(scroller, "scrollHeight", { value: 2000, configurable: true });
      Object.defineProperty(scroller, "clientHeight", { value: 600, configurable: true });
      scroller.scrollTop = 400;

      scrollIfOutOfView(el);
      now = 220; // >= GLIDE_MS: the glide's single queued frame lands on target
      for (const cb of rafCallbacks.splice(0)) cb(now);

      // target = clamp(el.top - scroller.top + scroller.scrollTop - margin, 0, scrollHeight - clientHeight)
      //        = clamp(-300 - 0 + 400 - 64, 0, 1400) = 36
      expect(scroller.scrollTop).toBe(36);
    } finally {
      globalThis.requestAnimationFrame = realRAF;
      performance.now = realNow;
    }
  });
});
