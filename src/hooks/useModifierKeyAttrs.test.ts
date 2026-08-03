// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { useModifierKeyAttrs } from "./useModifierKeyAttrs";

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

  it("clears both on unmount and stops listening", () => {
    const { unmount } = renderHook(() => useModifierKeyAttrs());
    press({ key: "Shift", shiftKey: true });
    unmount();
    expect(has("data-shift")).toBe(false);
    press({ key: "Shift", shiftKey: true });
    expect(has("data-shift")).toBe(false);
  });
});
