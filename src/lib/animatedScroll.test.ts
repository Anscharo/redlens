// glide() must cancel a prior in-flight glide on the same scroller instead of
// letting two rAF loops fight over scrollTop (deep review finding: no
// cancellation token). Driven with a fake scroller + mocked
// requestAnimationFrame/performance.now — jsdom's real scrollTop/layout can't
// observe the race directly.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { glide, needsScroll } from "./animatedScroll";

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
