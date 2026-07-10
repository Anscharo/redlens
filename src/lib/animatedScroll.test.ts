// glide() must cancel a prior in-flight glide on the same scroller instead of
// letting two rAF loops fight over scrollTop (deep review finding: no
// cancellation token). Driven with a fake scroller + mocked
// requestAnimationFrame/performance.now — jsdom's real scrollTop/layout can't
// observe the race directly.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { glide } from "./animatedScroll";

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
