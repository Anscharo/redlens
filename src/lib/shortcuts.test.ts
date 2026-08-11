import { describe, expect, it } from "vitest";
import { isTypingTarget, SLASH_COMMANDS } from "./shortcuts";

// isTypingTarget only reads tagName/isContentEditable off the event target, so
// plain object stand-ins exercise it without jsdom. They aren't real
// EventTargets, hence the cast.
const asTarget = (o: object): EventTarget => o as unknown as EventTarget;

describe("isTypingTarget", () => {
  it("returns true for an input", () => {
    expect(isTypingTarget(asTarget({ tagName: "INPUT" }))).toBe(true);
  });

  it("returns true for a textarea", () => {
    expect(isTypingTarget(asTarget({ tagName: "TEXTAREA" }))).toBe(true);
  });

  it("returns true for a select", () => {
    expect(isTypingTarget(asTarget({ tagName: "SELECT" }))).toBe(true);
  });

  it("returns true for a contentEditable element", () => {
    expect(isTypingTarget(asTarget({ tagName: "DIV", isContentEditable: true }))).toBe(true);
  });

  it("returns false for a plain div", () => {
    expect(isTypingTarget(asTarget({ tagName: "DIV" }))).toBe(false);
  });

  it("returns false for null", () => {
    expect(isTypingTarget(null)).toBe(false);
  });

  it("returns false for a non-Element object", () => {
    expect(isTypingTarget(asTarget({ foo: "bar" }))).toBe(false);
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
