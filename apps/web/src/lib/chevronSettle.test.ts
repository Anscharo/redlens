// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { settleChevron, CHEVRON_SETTLE_MS } from "./chevronSettle";

describe("settleChevron", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flags the button data-settling immediately, then lifts it after CHEVRON_SETTLE_MS", () => {
    const btn = document.createElement("button");
    settleChevron(btn);
    expect(btn.hasAttribute("data-settling")).toBe(true);

    vi.advanceTimersByTime(CHEVRON_SETTLE_MS - 1);
    expect(btn.hasAttribute("data-settling")).toBe(true);

    vi.advanceTimersByTime(1);
    expect(btn.hasAttribute("data-settling")).toBe(false);
  });

  it("the returned cancel function clears the timer and lifts the flag immediately", () => {
    const btn = document.createElement("button");
    const cancel = settleChevron(btn);
    expect(btn.hasAttribute("data-settling")).toBe(true);

    cancel();
    expect(btn.hasAttribute("data-settling")).toBe(false);

    // The original timer must be cleared, not just raced — advancing past
    // CHEVRON_SETTLE_MS must not re-toggle anything.
    vi.advanceTimersByTime(CHEVRON_SETTLE_MS + 10);
    expect(btn.hasAttribute("data-settling")).toBe(false);
  });
});
