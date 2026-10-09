// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useTreeDrawer } from "./useTreeDrawer";

afterEach(cleanup);

describe("useTreeDrawer", () => {
  it("starts closed, and opens and closes on request", () => {
    const { result } = renderHook(() => useTreeDrawer("/atlas"));
    expect(result.current.open).toBe(false);
    act(() => result.current.openTree());
    expect(result.current.open).toBe(true);
    act(() => result.current.closeTree());
    expect(result.current.open).toBe(false);
  });

  it("closes on navigation", () => {
    const { result, rerender } = renderHook(({ loc }) => useTreeDrawer(loc), { initialProps: { loc: "/atlas" } });
    act(() => result.current.openTree());
    rerender({ loc: "/" });
    expect(result.current.open).toBe(false);
  });

  it("keeps its callbacks stable across renders", () => {
    const { result, rerender } = renderHook(() => useTreeDrawer("/atlas"));
    const { openTree, closeTree } = result.current;
    act(() => openTree());
    rerender();
    expect(result.current.openTree).toBe(openTree);
    expect(result.current.closeTree).toBe(closeTree);
  });
});
