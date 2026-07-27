// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useResizeDrag } from "./useResizeDrag";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function fakeMouseDown(clientX: number): React.MouseEvent {
  return {
    preventDefault: vi.fn(),
    clientX,
  } as unknown as React.MouseEvent;
}

describe("useResizeDrag", () => {
  it("grows width to the right by default (growsLeft=false)", () => {
    const setWidth = vi.fn();
    const { result } = renderHook(() => useResizeDrag(200, setWidth, { min: 100, max: 400 }));
    act(() => result.current(fakeMouseDown(50)));
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 80 }));
    });
    expect(setWidth).toHaveBeenCalledWith(230); // 200 + (80-50)
  });

  it("clamps to min/max", () => {
    const setWidth = vi.fn();
    const { result } = renderHook(() => useResizeDrag(200, setWidth, { min: 100, max: 400 }));
    act(() => result.current(fakeMouseDown(50)));
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 1000 }));
    });
    expect(setWidth).toHaveBeenCalledWith(400);

    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: -1000 }));
    });
    expect(setWidth).toHaveBeenCalledWith(100);
  });

  it("growsLeft inverts the delta direction", () => {
    const setWidth = vi.fn();
    const { result } = renderHook(() =>
      useResizeDrag(200, setWidth, { min: 100, max: 400, growsLeft: true }),
    );
    act(() => result.current(fakeMouseDown(50)));
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 80 }));
    });
    // growsLeft: delta = startX - clientX = 50-80 = -30 → 200-30=170
    expect(setWidth).toHaveBeenCalledWith(170);
  });

  it("sets and restores cursor/userSelect styles across the drag", () => {
    const setWidth = vi.fn();
    document.body.style.cursor = "default";
    document.body.style.userSelect = "auto";
    const { result } = renderHook(() => useResizeDrag(200, setWidth, { min: 100, max: 400 }));
    act(() => result.current(fakeMouseDown(50)));
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(document.body.style.cursor).toBe("default");
    expect(document.body.style.userSelect).toBe("auto");
  });

  it("persists the final width to localStorage on mouseup when storageKey is set", () => {
    const setWidth = vi.fn();
    const { result } = renderHook(() =>
      useResizeDrag(200, setWidth, { min: 100, max: 400, storageKey: "panel-width" }),
    );
    act(() => result.current(fakeMouseDown(50)));
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 90 }));
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(localStorage.getItem("panel-width")).toBe("240"); // 200 + (90-50)
  });

  it("does not touch localStorage when no storageKey is given", () => {
    const setWidth = vi.fn();
    const { result } = renderHook(() => useResizeDrag(200, setWidth, { min: 100, max: 400 }));
    act(() => result.current(fakeMouseDown(50)));
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(localStorage.length).toBe(0);
  });

  it("removes mousemove/mouseup listeners after mouseup so further moves don't call setWidth", () => {
    const setWidth = vi.fn();
    const { result } = renderHook(() => useResizeDrag(200, setWidth, { min: 100, max: 400 }));
    act(() => result.current(fakeMouseDown(50)));
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
    setWidth.mockClear();
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 300 }));
    });
    expect(setWidth).not.toHaveBeenCalled();
  });

  it("swallows a localStorage.setItem failure without throwing", () => {
    const setWidth = vi.fn();
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });
    const { result } = renderHook(() =>
      useResizeDrag(200, setWidth, { min: 100, max: 400, storageKey: "panel-width" }),
    );
    act(() => result.current(fakeMouseDown(50)));
    expect(() => {
      act(() => {
        window.dispatchEvent(new MouseEvent("mouseup"));
      });
    }).not.toThrow();
    setItemSpy.mockRestore();
  });

  it("calls preventDefault on mousedown", () => {
    const setWidth = vi.fn();
    const { result } = renderHook(() => useResizeDrag(200, setWidth, { min: 100, max: 400 }));
    const evt = fakeMouseDown(50);
    act(() => result.current(evt));
    expect(evt.preventDefault).toHaveBeenCalled();
  });
});
