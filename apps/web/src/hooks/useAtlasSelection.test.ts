// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useAtlasSelection } from "./useAtlasSelection";

afterEach(() => cleanup());

describe("useAtlasSelection", () => {
  it("initializes selectedId from the id prop", () => {
    const onNavigate = vi.fn();
    const { result } = renderHook(() => useAtlasSelection("abc", onNavigate));
    expect(result.current.selectedId).toBe("abc");
  });

  it("mirrors external id changes (e.g. back/forward nav) into selectedId", () => {
    const onNavigate = vi.fn();
    const { result, rerender } = renderHook(({ id }) => useAtlasSelection(id, onNavigate), {
      initialProps: { id: "abc" },
    });
    rerender({ id: "xyz" });
    expect(result.current.selectedId).toBe("xyz");
  });

  it("handleNavigate updates selectedId synchronously and calls onNavigate", () => {
    const onNavigate = vi.fn();
    const { result } = renderHook(() => useAtlasSelection("abc", onNavigate));
    act(() => {
      result.current.handleNavigate("new-id");
    });
    expect(result.current.selectedId).toBe("new-id");
    expect(onNavigate).toHaveBeenCalledWith("new-id");
  });

  it("handleNavigate identity is stable across renders unless onNavigate changes", () => {
    const onNavigate = vi.fn();
    const { result, rerender } = renderHook(({ id }) => useAtlasSelection(id, onNavigate), {
      initialProps: { id: "abc" },
    });
    const first = result.current.handleNavigate;
    rerender({ id: "abc" });
    expect(result.current.handleNavigate).toBe(first);
  });
});
