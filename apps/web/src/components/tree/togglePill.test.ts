// Pure logic — no rendering, no jsdom pragma needed.
import { describe, it, expect } from "vitest";
import { TREE_TOGGLE_BAR_CLASS, TREE_TOGGLE_BAR_STYLE, togglePillStyle } from "./togglePill";

describe("togglePill shared chrome", () => {
  it("exposes the toggle bar class and style constants", () => {
    expect(TREE_TOGGLE_BAR_CLASS).toContain("flex");
    expect(TREE_TOGGLE_BAR_STYLE).toEqual({ borderBottom: "1px solid var(--border)" });
  });
});

describe("togglePillStyle", () => {
  it("returns the active color, hover background, and bold weight when active", () => {
    expect(togglePillStyle(true, "var(--tan)")).toEqual({
      color: "var(--tan)",
      background: "var(--hover)",
      fontWeight: 600,
    });
  });

  it("returns the muted tan color, transparent background, and normal weight when inactive", () => {
    expect(togglePillStyle(false, "var(--tan)")).toEqual({
      color: "var(--tan-3)",
      background: "transparent",
      fontWeight: 400,
    });
  });
});
