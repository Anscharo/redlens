import { describe, expect, it } from "vitest";
import { isTypingTarget, SHORTCUTS, SLASH_COMMANDS } from "./shortcuts";

describe("isTypingTarget", () => {
  it("returns true for an input", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
  });

  it("returns true for a textarea", () => {
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
  });

  it("returns true for a select", () => {
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
  });

  it("returns true for a contentEditable element", () => {
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("returns false for a plain div", () => {
    expect(isTypingTarget({ tagName: "DIV" })).toBe(false);
  });

  it("returns false for null", () => {
    expect(isTypingTarget(null)).toBe(false);
  });

  it("returns false for a non-Element object", () => {
    expect(isTypingTarget({ foo: "bar" })).toBe(false);
  });
});

describe("SHORTCUTS", () => {
  it("every entry has a non-empty keys array and description", () => {
    for (const s of SHORTCUTS) {
      expect(s.keys.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
    }
  });

  it("has a non-empty primary subset of roughly 6 entries", () => {
    const primary = SHORTCUTS.filter((s) => s.primary);
    expect(primary.length).toBeGreaterThan(0);
    expect(primary.length).toBeGreaterThanOrEqual(4);
    expect(primary.length).toBeLessThanOrEqual(8);
  });
});

describe("SLASH_COMMANDS", () => {
  it("is non-empty and every cmd starts with /", () => {
    expect(SLASH_COMMANDS.length).toBeGreaterThan(0);
    for (const s of SLASH_COMMANDS) {
      expect(s.cmd.startsWith("/")).toBe(true);
    }
  });
});
