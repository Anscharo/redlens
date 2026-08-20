// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";
import { useModifierKeyAttrs, ALT_TURN_MS } from "./useModifierKeyAttrs";

const root = () => document.documentElement;
const has = (attr: string) => root().hasAttribute(attr);

function press(init: KeyboardEventInit) {
  window.dispatchEvent(new KeyboardEvent("keydown", init));
}
function release(init: KeyboardEventInit) {
  window.dispatchEvent(new KeyboardEvent("keyup", init));
}

afterEach(() => {
  cleanup();
  root().removeAttribute("data-alt");
  root().removeAttribute("data-shift");
  root().removeAttribute("data-alt-turn");
});

describe("useModifierKeyAttrs", () => {
  it("mirrors Alt onto <html data-alt> and clears it on release", () => {
    renderHook(() => useModifierKeyAttrs());
    expect(has("data-alt")).toBe(false);
    press({ key: "Alt", altKey: true });
    expect(has("data-alt")).toBe(true);
    release({ key: "Alt", altKey: false });
    expect(has("data-alt")).toBe(false);
  });

  it("mirrors Shift onto <html data-shift> and clears it on release", () => {
    renderHook(() => useModifierKeyAttrs());
    press({ key: "Shift", shiftKey: true });
    expect(has("data-shift")).toBe(true);
    release({ key: "Shift", shiftKey: false });
    expect(has("data-shift")).toBe(false);
  });

  it("tracks the two independently, including both held at once", () => {
    renderHook(() => useModifierKeyAttrs());
    press({ key: "Shift", shiftKey: true });
    press({ key: "Alt", shiftKey: true, altKey: true });
    expect([has("data-alt"), has("data-shift")]).toEqual([true, true]);
    // Letting go of Alt alone must not take Shift's attribute with it.
    release({ key: "Alt", shiftKey: true, altKey: false });
    expect([has("data-alt"), has("data-shift")]).toEqual([false, true]);
  });

  // Guard against the attribute sticking on: a keyup of the modifier itself
  // means it is no longer held, whatever the event's own flag claims. Left to
  // the flag alone, a browser that reports the modifier as still down on its
  // own keyup would leave every chevron previewing the alt target until the
  // window happened to lose focus.
  it("clears on the modifier's own keyup even if the event still reports it held", () => {
    renderHook(() => useModifierKeyAttrs());
    press({ key: "Alt", code: "AltLeft", altKey: true });
    press({ key: "Shift", code: "ShiftLeft", altKey: true, shiftKey: true });
    release({ key: "Alt", code: "AltLeft", altKey: true, shiftKey: true });
    // Alt's own release clears Alt; Shift is genuinely still down.
    expect([has("data-alt"), has("data-shift")]).toEqual([false, true]);
    release({ key: "Shift", code: "ShiftLeft", shiftKey: true });
    expect(has("data-shift")).toBe(false);
  });

  it("reads the flags off the event, so a key repeat keeps the attribute on", () => {
    renderHook(() => useModifierKeyAttrs());
    press({ key: "Shift", shiftKey: true });
    press({ key: "Shift", shiftKey: true, repeat: true });
    expect(has("data-shift")).toBe(true);
  });

  // The bug this guards: a modifier held while focus leaves the window never
  // delivers its keyup, so without a blur handler the attribute sticks on
  // forever — every chevron would preview the wrong target and every row would
  // sit there offering a split-pane hint with Shift long released.
  it("clears both on window blur", () => {
    renderHook(() => useModifierKeyAttrs());
    press({ key: "Shift", shiftKey: true, altKey: true });
    expect([has("data-alt"), has("data-shift")]).toEqual([true, true]);
    window.dispatchEvent(new Event("blur"));
    expect([has("data-alt"), has("data-shift")]).toEqual([false, false]);
  });

  // data-alt-turn is what makes the chevron SNAP between the two previews
  // instead of creeping over the 1s hover-drift curve (index.css). It has to
  // land in the same tick as the flip, or the style recalc that moves the
  // chevron reads the slow duration and the snap never happens.
  describe("data-alt-turn", () => {
    it("goes up with data-alt and lifts on its own after ALT_TURN_MS", () => {
      vi.useFakeTimers();
      try {
        renderHook(() => useModifierKeyAttrs());
        press({ key: "Alt", altKey: true });
        expect([has("data-alt"), has("data-alt-turn")]).toEqual([true, true]);
        act(() => vi.advanceTimersByTime(ALT_TURN_MS - 1));
        expect(has("data-alt-turn")).toBe(true);
        act(() => vi.advanceTimersByTime(1));
        // Alt is still held — only the "just turned" window closed.
        expect([has("data-alt"), has("data-alt-turn")]).toEqual([true, false]);
      } finally {
        vi.useRealTimers();
      }
    });

    // Symmetry is the point: fast out, slow crawl back is the same wrong
    // preview in mirror image.
    it("goes up again on release, not just on press", () => {
      vi.useFakeTimers();
      try {
        renderHook(() => useModifierKeyAttrs());
        press({ key: "Alt", altKey: true });
        act(() => vi.advanceTimersByTime(ALT_TURN_MS));
        expect(has("data-alt-turn")).toBe(false);
        release({ key: "Alt", altKey: false });
        expect([has("data-alt"), has("data-alt-turn")]).toEqual([false, true]);
      } finally {
        vi.useRealTimers();
      }
    });

    // Holding Alt delivers a keydown per repeat on some platforms. Restamping
    // on every one would hold the fast duration open indefinitely, so the
    // eventual drift toward the next rung would snap instead of drifting.
    it("does not restamp when the flag did not actually flip", () => {
      vi.useFakeTimers();
      try {
        renderHook(() => useModifierKeyAttrs());
        press({ key: "Alt", altKey: true });
        act(() => vi.advanceTimersByTime(ALT_TURN_MS));
        press({ key: "Alt", altKey: true, repeat: true });
        expect([has("data-alt"), has("data-alt-turn")]).toEqual([true, false]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("is cleared on unmount", () => {
      const { unmount } = renderHook(() => useModifierKeyAttrs());
      press({ key: "Alt", altKey: true });
      expect(has("data-alt-turn")).toBe(true);
      unmount();
      expect(has("data-alt-turn")).toBe(false);
    });
  });

  it("clears both on unmount and stops listening", () => {
    const { unmount } = renderHook(() => useModifierKeyAttrs());
    press({ key: "Shift", shiftKey: true });
    unmount();
    expect(has("data-shift")).toBe(false);
    press({ key: "Shift", shiftKey: true });
    expect(has("data-shift")).toBe(false);
  });
});
