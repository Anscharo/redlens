// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useResizeDrag } from "./useResizeDrag";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function fakeMouseDown(clientX: number, clientY = 0): React.MouseEvent {
  return {
    preventDefault: vi.fn(),
    clientX,
    clientY,
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

  // The comparison pane resizes vertically: it sits at the bottom of the reader
  // column, so its handle reads clientY and dragging UP has to grow it.
  it("axis: y reads clientY, shows row-resize, and grows upward with growsLeft", () => {
    const setHeight = vi.fn();
    const { result } = renderHook(() =>
      useResizeDrag(300, setHeight, { min: 120, max: 600, axis: "y", growsLeft: true }),
    );
    act(() => result.current(fakeMouseDown(0, 500)));
    expect(document.body.style.cursor).toBe("row-resize");
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientY: 440 }));
    });
    // Dragged up 60px → the bottom-anchored pane grows: 300 + (500-440) = 360.
    expect(setHeight).toHaveBeenCalledWith(360);
    // And back down past the floor clamps at min, rather than inverting.
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientY: 900 }));
    });
    expect(setHeight).toHaveBeenLastCalledWith(120);
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
  });

  it("axis: y ignores horizontal movement", () => {
    const setHeight = vi.fn();
    const { result } = renderHook(() =>
      useResizeDrag(300, setHeight, { min: 120, max: 600, axis: "y" }),
    );
    act(() => result.current(fakeMouseDown(0, 500)));
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 999, clientY: 500 }));
    });
    expect(setHeight).toHaveBeenCalledWith(300); // unchanged
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
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

  it("does not persist on a no-op press-release (no mousemove)", () => {
    // Guards a real bug: useSplitHeight passes a display cap (not the user's
    // stored preference) as the starting width for a childless doc. Without
    // this guard, merely pressing and releasing the handle would overwrite the
    // stored preference with that cap.
    const setWidth = vi.fn();
    const { result } = renderHook(() =>
      useResizeDrag(200, setWidth, { min: 100, max: 400, storageKey: "panel-width" }),
    );
    act(() => result.current(fakeMouseDown(50)));
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(localStorage.getItem("panel-width")).toBeNull();
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
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 90 }));
    });
    expect(() => {
      act(() => {
        window.dispatchEvent(new MouseEvent("mouseup"));
      });
    }).not.toThrow();
    expect(setItemSpy).toHaveBeenCalled();
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
