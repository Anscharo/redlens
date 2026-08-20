// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { usePagedRows } from "./usePagedRows";

afterEach(() => cleanup());

describe("usePagedRows", () => {
  it("shows up to pageSize rows initially, with correct remaining count", () => {
    const rows = Array.from({ length: 250 }, (_, i) => i);
    const { result } = renderHook(() => usePagedRows(rows, 100));
    expect(result.current.visible).toHaveLength(100);
    expect(result.current.visible[0]).toBe(0);
    expect(result.current.visible[99]).toBe(99);
    expect(result.current.remaining).toBe(150);
  });

  it("shows all rows and zero remaining when rows.length <= pageSize", () => {
    const rows = [1, 2, 3];
    const { result } = renderHook(() => usePagedRows(rows, 100));
    expect(result.current.visible).toEqual([1, 2, 3]);
    expect(result.current.remaining).toBe(0);
  });

  it("showMore expands the visible window by pageSize, capped at rows.length", () => {
    const rows = Array.from({ length: 250 }, (_, i) => i);
    const { result } = renderHook(() => usePagedRows(rows, 100));
    act(() => result.current.showMore());
    expect(result.current.visible).toHaveLength(200);
    expect(result.current.remaining).toBe(50);
    act(() => result.current.showMore());
    // capped at rows.length, not 300
    expect(result.current.visible).toHaveLength(250);
    expect(result.current.remaining).toBe(0);
  });

  it("resets to one page when rows identity changes", () => {
    const rowsA = Array.from({ length: 250 }, (_, i) => i);
    const { result, rerender } = renderHook(({ rows }) => usePagedRows(rows, 100), {
      initialProps: { rows: rowsA },
    });
    act(() => result.current.showMore());
    expect(result.current.visible).toHaveLength(200);

    const rowsB = Array.from({ length: 50 }, (_, i) => i);
    rerender({ rows: rowsB });
    expect(result.current.visible).toHaveLength(50);
    expect(result.current.remaining).toBe(0);
  });

  it("uses the default page size of 100 when omitted", () => {
    const rows = Array.from({ length: 120 }, (_, i) => i);
    const { result } = renderHook(() => usePagedRows(rows));
    expect(result.current.visible).toHaveLength(100);
    expect(result.current.remaining).toBe(20);
  });
});
