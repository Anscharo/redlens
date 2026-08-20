// @vitest-environment jsdom
// apply/reset/copySnippet are the three buttons on /admin/palette. Each has
// to keep three places in sync — localStorage, the live inline styles on
// <html>, and the hook's own `saved` snapshot — so these are round-trip
// tests, not just "was the function called".
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useColorOverrides } from "./useColorOverrides";
import { readOverrides } from "./palette-storage";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  vi.restoreAllMocks();
});

describe("useColorOverrides — apply", () => {
  it("persists the draft to localStorage, applies it live, and folds draft into saved", () => {
    const { result } = renderHook(() => useColorOverrides());
    act(() => result.current.setDraftValue("bg", "#111111"));
    act(() => result.current.apply());

    expect(readOverrides()).toEqual({ bg: "#111111" });
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#111111");
    expect(result.current.saved).toEqual({ bg: "#111111" });
    expect(result.current.isDirty).toBe(false);
  });

  it("isDirty flips true again after re-editing a token that was just applied (same key set, new value)", () => {
    // shallowEqual short-circuits on key-count first; this exercises its
    // per-key value comparison, which the key-count mismatch in the test
    // above never reaches.
    const { result } = renderHook(() => useColorOverrides());
    act(() => result.current.setDraftValue("bg", "#111111"));
    act(() => result.current.apply());
    expect(result.current.isDirty).toBe(false);

    act(() => result.current.setDraftValue("bg", "#222222"));
    expect(result.current.isDirty).toBe(true);
  });

  it("clears the inline property for a token that was saved but is no longer in the draft", () => {
    const { result } = renderHook(() => useColorOverrides());
    act(() => result.current.setDraftValue("bg", "#111111"));
    act(() => result.current.apply());
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#111111");

    // Revert to default (empty string, since no stylesheet default is loaded here)
    // and re-apply — the stale inline value must not survive.
    act(() => result.current.setDraftValue("bg", ""));
    act(() => result.current.apply());

    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("");
    expect(readOverrides()).toEqual({});
  });
});

describe("useColorOverrides — reset", () => {
  it("wipes localStorage, clears inline overrides, and empties saved + draft", () => {
    const { result } = renderHook(() => useColorOverrides());
    act(() => result.current.setDraftValue("accent", "#c9a08a"));
    act(() => result.current.apply());
    expect(result.current.hasSaved).toBe(true);

    act(() => result.current.reset());

    expect(readOverrides()).toEqual({});
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("");
    expect(result.current.saved).toEqual({});
    expect(result.current.draft).toEqual({});
    expect(result.current.hasSaved).toBe(false);
  });
});

describe("useColorOverrides — copySnippet", () => {
  it("writes the generated CSS snippet to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { result } = renderHook(() => useColorOverrides());
    act(() => result.current.setDraftValue("bg", "#111111"));

    await act(async () => {
      await result.current.copySnippet();
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain("--bg: #111111;");
  });
});
