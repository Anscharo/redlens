// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { hintStore } from "./hintStore";

afterEach(() => {
  hintStore.setHover(null);
  hintStore.setFocus(null);
});

describe("hintStore", () => {
  it("starts empty", () => {
    expect(hintStore.getSnapshot()).toBe(null);
  });

  it("shows the focus hint when nothing is hovered", () => {
    hintStore.setFocus("arrows");
    expect(hintStore.getSnapshot()).toBe("arrows");
  });

  it("hover outranks focus, and clearing hover falls back to focus", () => {
    hintStore.setFocus("arrows");
    hintStore.setHover("shift-click");
    expect(hintStore.getSnapshot()).toBe("shift-click");
    hintStore.setHover(null);
    expect(hintStore.getSnapshot()).toBe("arrows");
  });

  it("is null once both tiers are clear", () => {
    hintStore.setHover("shift-click");
    hintStore.setFocus("arrows");
    hintStore.setHover(null);
    hintStore.setFocus(null);
    expect(hintStore.getSnapshot()).toBe(null);
  });

  it("notifies subscribers, and unsubscribing stops that", () => {
    const cb = vi.fn();
    const off = hintStore.subscribe(cb);
    hintStore.setFocus("arrows");
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    hintStore.setFocus("other");
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("does not notify when a tier is set to what it already held", () => {
    hintStore.setFocus("arrows");
    const cb = vi.fn();
    const off = hintStore.subscribe(cb);
    hintStore.setFocus("arrows");
    expect(cb).not.toHaveBeenCalled();
    off();
  });
});
