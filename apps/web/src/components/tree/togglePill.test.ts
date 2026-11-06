// Pure logic — no rendering, no jsdom pragma needed.
import { describe, it, expect } from "vitest";
import { TREE_TOGGLE_BAR_CLASS, togglePillStyle, treeToggleBarStyle } from "./togglePill";

describe("togglePill shared chrome", () => {
  it("exposes the toggle bar class", () => {
    expect(TREE_TOGGLE_BAR_CLASS).toContain("flex");
  });

  it("lifts the bar onto --surface only while filtered", () => {
    expect(treeToggleBarStyle(false)).toEqual({ borderBottom: "1px solid var(--border)", background: undefined });
    expect(treeToggleBarStyle(true)).toEqual({ borderBottom: "1px solid var(--border)", background: "var(--surface)" });
  });
});

describe("togglePillStyle", () => {
  it("returns the active color, hover background, accent border and bold weight when active", () => {
    expect(togglePillStyle(true, "var(--tan)")).toEqual({
      color: "var(--tan)",
      background: "var(--hover)",
      fontWeight: 600,
      border: "1px solid var(--accent)",
    });
  });

  it("returns the muted tan color, transparent background and border, and normal weight when inactive", () => {
    expect(togglePillStyle(false, "var(--tan)")).toEqual({
      color: "var(--tan-3)",
      background: "transparent",
      fontWeight: 400,
      border: "1px solid transparent",
    });
  });
});
