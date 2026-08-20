// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { KeyboardEvent } from "react";

const refreshRecent = vi.fn();
vi.mock("@/lib/recentSearches", () => ({
  refreshRecent: () => refreshRecent(),
}));

afterEach(() => cleanup());
beforeEach(() => {
  vi.resetModules();
  refreshRecent.mockReset();
});

function key(k: string, extra: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: k,
    preventDefault: vi.fn(),
    shiftKey: false,
    ...extra,
  } as unknown as KeyboardEvent;
}

describe("useRecentDropdown", () => {
  it("starts closed, not visible, active=-1", async () => {
    const { useRecentDropdown } = await import("./useRecentDropdown");
    const { result } = renderHook(() =>
      useRecentDropdown({ suggestions: ["a", "b"], query: "" }),
    );
    expect(result.current.visible).toBe(false);
    expect(result.current.active).toBe(-1);
  });

  it("swallows the first mount focus (autoFocus) without opening", async () => {
    const { useRecentDropdown } = await import("./useRecentDropdown");
    const { result } = renderHook(() =>
      useRecentDropdown({ suggestions: ["a", "b"], query: "" }),
    );
    act(() => result.current.handlers.onFocus());
    expect(result.current.visible).toBe(false);
    expect(refreshRecent).not.toHaveBeenCalled();
  });

  it("a subsequent focus opens the dropdown and calls refreshRecent", async () => {
    const { useRecentDropdown } = await import("./useRecentDropdown");
    const { result } = renderHook(() =>
      useRecentDropdown({ suggestions: ["a", "b"], query: "" }),
    );
    act(() => result.current.handlers.onFocus()); // swallowed
    act(() => result.current.handlers.onFocus()); // real focus
    expect(result.current.visible).toBe(true);
    expect(refreshRecent).toHaveBeenCalled();
  });

  it("onPointerDown (openDropdown) opens directly, no mount-swallow", async () => {
    const { useRecentDropdown } = await import("./useRecentDropdown");
    const { result } = renderHook(() =>
      useRecentDropdown({ suggestions: ["a", "b"], query: "" }),
    );
    act(() => result.current.handlers.onPointerDown());
    expect(result.current.visible).toBe(true);
  });

  it("visible is false when suggestions is empty even if open", async () => {
    const { useRecentDropdown } = await import("./useRecentDropdown");
    const { result } = renderHook(() =>
      useRecentDropdown({ suggestions: [], query: "" }),
    );
    act(() => result.current.handlers.onPointerDown());
    expect(result.current.visible).toBe(false);
  });

  it("ArrowDown/ArrowUp move the active index within bounds", async () => {
    const { useRecentDropdown } = await import("./useRecentDropdown");
    const { result } = renderHook(() =>
      useRecentDropdown({ suggestions: ["a", "b", "c"], query: "" }),
    );
    act(() => result.current.handlers.onPointerDown());
    act(() => result.current.handlers.onKeyDown(key("ArrowDown")));
    expect(result.current.active).toBe(0);
    act(() => result.current.handlers.onKeyDown(key("ArrowDown")));
    act(() => result.current.handlers.onKeyDown(key("ArrowDown")));
    act(() => result.current.handlers.onKeyDown(key("ArrowDown"))); // past last, clamps
    expect(result.current.active).toBe(2);
    act(() => result.current.handlers.onKeyDown(key("ArrowUp")));
    expect(result.current.active).toBe(1);
    act(() => result.current.handlers.onKeyDown(key("ArrowUp")));
    act(() => result.current.handlers.onKeyDown(key("ArrowUp"))); // past -1, clamps
    expect(result.current.active).toBe(-1);
  });

  it("Tab with no active selection steps into the dropdown (active=0)", async () => {
    const { useRecentDropdown } = await import("./useRecentDropdown");
    const { result } = renderHook(() =>
      useRecentDropdown({ suggestions: ["a", "b"], query: "" }),
    );
    act(() => result.current.handlers.onPointerDown());
    const e = key("Tab");
    act(() => result.current.handlers.onKeyDown(e));
    expect(e.preventDefault).toHaveBeenCalled();
    expect(result.current.active).toBe(0);
  });

  it("Tab with shiftKey does not step in", async () => {
    const { useRecentDropdown } = await import("./useRecentDropdown");
    const { result } = renderHook(() =>
      useRecentDropdown({ suggestions: ["a", "b"], query: "" }),
    );
    act(() => result.current.handlers.onPointerDown());
    act(() => result.current.handlers.onKeyDown(key("Tab", { shiftKey: true })));
    expect(result.current.active).toBe(-1);
  });

  it("Enter with active >= 0 selects and calls onSelect, closing the dropdown", async () => {
    const onSelect = vi.fn();
    const { useRecentDropdown } = await import("./useRecentDropdown");
    const { result } = renderHook(() =>
      useRecentDropdown({ suggestions: ["a", "b"], query: "", onSelect }),
    );
    act(() => result.current.handlers.onPointerDown());
    act(() => result.current.handlers.onKeyDown(key("ArrowDown")));
    act(() => result.current.handlers.onKeyDown(key("Enter")));
    expect(onSelect).toHaveBeenCalledWith("a", 0);
    expect(result.current.visible).toBe(false);
    expect(result.current.active).toBe(-1);
  });

  it("select() is a no-op when index is out of range or onSelect missing", async () => {
    const { useRecentDropdown } = await import("./useRecentDropdown");
    const { result } = renderHook(() =>
      useRecentDropdown({ suggestions: ["a"], query: "" }), // no onSelect
    );
    act(() => result.current.handlers.onPointerDown());
    act(() => result.current.select(0));
    // Since no onSelect was given, close() should not have been triggered by select's early-return.
    expect(result.current.visible).toBe(true);
  });

  it("Escape closes the dropdown from any state", async () => {
    const { useRecentDropdown } = await import("./useRecentDropdown");
    const { result } = renderHook(() =>
      useRecentDropdown({ suggestions: ["a", "b"], query: "" }),
    );
    act(() => result.current.handlers.onPointerDown());
    act(() => result.current.handlers.onKeyDown(key("ArrowDown")));
    act(() => result.current.handlers.onKeyDown(key("Escape")));
    expect(result.current.visible).toBe(false);
    expect(result.current.active).toBe(-1);
  });

  it("Backspace/Delete on an empty query re-opens a closed dropdown", async () => {
    const { useRecentDropdown } = await import("./useRecentDropdown");
    const { result } = renderHook(() =>
      useRecentDropdown({ suggestions: ["a", "b"], query: "" }),
    );
    act(() => result.current.handlers.onKeyDown(key("Backspace")));
    expect(result.current.visible).toBe(true);
  });

  it("Backspace with non-empty query trimmed does not re-open", async () => {
    const { useRecentDropdown } = await import("./useRecentDropdown");
    const { result } = renderHook(() =>
      useRecentDropdown({ suggestions: ["a", "b"], query: "  x  " }),
    );
    act(() => result.current.handlers.onKeyDown(key("Backspace")));
    expect(result.current.visible).toBe(false);
  });

  it("onOptionHover sets active to the hovered index", async () => {
    const { useRecentDropdown } = await import("./useRecentDropdown");
    const { result } = renderHook(() =>
      useRecentDropdown({ suggestions: ["a", "b"], query: "" }),
    );
    act(() => result.current.onOptionHover(1));
    expect(result.current.active).toBe(1);
  });

  it("onBlur closes after the 120ms delay", async () => {
    vi.useFakeTimers();
    const { useRecentDropdown } = await import("./useRecentDropdown");
    const { result } = renderHook(() =>
      useRecentDropdown({ suggestions: ["a", "b"], query: "" }),
    );
    act(() => result.current.handlers.onPointerDown());
    expect(result.current.visible).toBe(true);
    act(() => result.current.handlers.onBlur());
    act(() => vi.advanceTimersByTime(120));
    expect(result.current.visible).toBe(false);
    vi.useRealTimers();
  });

  it("a refocus within the blur delay cancels the pending close", async () => {
    vi.useFakeTimers();
    const { useRecentDropdown } = await import("./useRecentDropdown");
    const { result } = renderHook(() =>
      useRecentDropdown({ suggestions: ["a", "b"], query: "" }),
    );
    act(() => result.current.handlers.onFocus()); // consume the mount-swallow first
    act(() => result.current.handlers.onPointerDown());
    act(() => result.current.handlers.onBlur());
    act(() => vi.advanceTimersByTime(50));
    // Refocus cancels blurTimer via openDropdown's clearTimeout.
    act(() => result.current.handlers.onFocus());
    act(() => vi.advanceTimersByTime(120));
    expect(result.current.visible).toBe(true);
    vi.useRealTimers();
  });

  it("resets active to -1 when query changes", async () => {
    const { useRecentDropdown } = await import("./useRecentDropdown");
    const { result, rerender } = renderHook(
      ({ query }) => useRecentDropdown({ suggestions: ["a", "b"], query }),
      { initialProps: { query: "" } },
    );
    act(() => result.current.handlers.onPointerDown());
    act(() => result.current.handlers.onKeyDown(key("ArrowDown")));
    expect(result.current.active).toBe(0);
    rerender({ query: "gov" });
    expect(result.current.active).toBe(-1);
  });

  it("ignores non-navigation keys and keys with no active target harmlessly", async () => {
    const { useRecentDropdown } = await import("./useRecentDropdown");
    const { result } = renderHook(() =>
      useRecentDropdown({ suggestions: ["a", "b"], query: "" }),
    );
    act(() => result.current.handlers.onPointerDown());
    expect(() => act(() => result.current.handlers.onKeyDown(key("a")))).not.toThrow();
    expect(result.current.active).toBe(-1);
  });
});
