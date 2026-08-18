// @vitest-environment jsdom
// useColorOverrides wires palette-storage's pure I/O to React state. These
// cover setDraftValue's own decisions (unknown-token guard, no-op on an
// unchanged value, and — the important one — snapping back to "no override"
// when a differently-formatted value normalizes to the same color as the
// stylesheet default) plus effectiveValue's draft-vs-default fallback.
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useColorOverrides } from "./useColorOverrides";

function styleTag(css: string) {
  const el = document.createElement("style");
  el.textContent = css;
  document.head.appendChild(el);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  document.head.querySelectorAll("style").forEach((el) => el.remove());
});

describe("useColorOverrides — initial state", () => {
  it("starts with empty draft/saved and isDirty false when nothing is stored", () => {
    const { result } = renderHook(() => useColorOverrides());
    expect(result.current.draft).toEqual({});
    expect(result.current.saved).toEqual({});
    expect(result.current.isDirty).toBe(false);
    expect(result.current.hasSaved).toBe(false);
  });

  it("seeds draft and saved from a pre-existing localStorage override", () => {
    localStorage.setItem(
      "redline-sky-atlas:palette-overrides",
      JSON.stringify({ v: 1, values: { bg: "#222222" } }),
    );
    const { result } = renderHook(() => useColorOverrides());
    expect(result.current.saved).toEqual({ bg: "#222222" });
    expect(result.current.draft).toEqual({ bg: "#222222" });
    expect(result.current.hasSaved).toBe(true);
  });
});

describe("useColorOverrides — setDraftValue", () => {
  it("ignores a name that isn't a real token (defensive against a bad caller)", () => {
    const { result } = renderHook(() => useColorOverrides());
    act(() => result.current.setDraftValue("not-a-real-token", "#ff0000"));
    expect(result.current.draft).toEqual({});
  });

  it("records a value that differs from the (unset, empty-string) default", () => {
    const { result } = renderHook(() => useColorOverrides());
    act(() => result.current.setDraftValue("bg", "#111111"));
    expect(result.current.draft).toEqual({ bg: "#111111" });
    expect(result.current.isDirty).toBe(true);
  });

  it("setting the same value twice keeps a stable, single entry", () => {
    const { result } = renderHook(() => useColorOverrides());
    act(() => result.current.setDraftValue("bg", "#111111"));
    act(() => result.current.setDraftValue("bg", "#111111"));
    expect(result.current.draft).toEqual({ bg: "#111111" });
  });

  it("setting a value that normalizes to the stylesheet default removes the override entirely", () => {
    // --hover's real default here is #ffffff; typing the 3-digit shorthand
    // for the same color should count as "back to default", not a new override.
    styleTag(":root { --hover: #ffffff; }");
    const { result } = renderHook(() => useColorOverrides());
    act(() => result.current.setDraftValue("hover", "#123456"));
    expect(result.current.draft).toEqual({ hover: "#123456" });
    act(() => result.current.setDraftValue("hover", "#fff"));
    expect(result.current.draft).toEqual({});
  });

  it("setting an already-default value on a token that was never overridden is a true no-op", () => {
    // Distinct from the "removes an existing override" case above: here
    // "border-muted" was never in the draft to begin with, so this exercises
    // setDraftValue's early-return branch rather than the delete-key branch.
    styleTag(":root { --border-muted: #ffffff; }");
    const { result } = renderHook(() => useColorOverrides());
    act(() => result.current.setDraftValue("border-muted", "#fff"));
    expect(result.current.draft).toEqual({});
  });
});

describe("useColorOverrides — effectiveValue", () => {
  it("falls back to cssDefault when the token has no draft override", () => {
    styleTag(":root { --border: rgb(10, 20, 30); }");
    const { result } = renderHook(() => useColorOverrides());
    expect(result.current.effectiveValue("border")).toBe("rgb(10,20,30)");
  });

  it("reflects the draft value once one is set", () => {
    const { result } = renderHook(() => useColorOverrides());
    act(() => result.current.setDraftValue("accent", "#c9a08a"));
    expect(result.current.effectiveValue("accent")).toBe("#c9a08a");
  });
});
