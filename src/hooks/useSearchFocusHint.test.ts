// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";
import { useSearchFocusHint } from "./useSearchFocusHint";
import { hintStore } from "../lib/hintStore";
import { FOCUS_HINTS } from "../lib/hintText";

afterEach(() => {
  cleanup();
  hintStore.setHover(null);
  hintStore.setFocus(null);
});

describe("useSearchFocusHint", () => {
  it("says nothing until the field is focused", () => {
    renderHook(() => useSearchFocusHint(false));
    expect(hintStore.getSnapshot()).toBe(null);
  });

  it("offers Enter-to-first-result when no recents are showing", () => {
    const { result } = renderHook(() => useSearchFocusHint(false));
    act(() => result.current.onFocus());
    expect(hintStore.getSnapshot()).toBe(FOCUS_HINTS.search);
  });

  it("switches to the arrow-key hint when the dropdown opens under the cursor", () => {
    // The whole reason this can't be a static data-focus-hint attribute:
    // showRecent flips while focus stays put, firing no focus event.
    const { result, rerender } = renderHook(({ show }) => useSearchFocusHint(show), {
      initialProps: { show: false },
    });
    act(() => result.current.onFocus());
    expect(hintStore.getSnapshot()).toBe(FOCUS_HINTS.search);
    rerender({ show: true });
    expect(hintStore.getSnapshot()).toBe(FOCUS_HINTS["search-recents"]);
    rerender({ show: false });
    expect(hintStore.getSnapshot()).toBe(FOCUS_HINTS.search);
  });

  it("stops republishing after blur — clearing is useContextHints' job", () => {
    const { result, rerender } = renderHook(({ show }) => useSearchFocusHint(show), {
      initialProps: { show: false },
    });
    act(() => result.current.onFocus());
    act(() => result.current.onBlur());
    hintStore.setFocus(null); // stand in for the focusout listener
    rerender({ show: true });
    expect(hintStore.getSnapshot()).toBe(null);
  });
});
