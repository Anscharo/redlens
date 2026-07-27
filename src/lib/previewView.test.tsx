// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";

const setSubset = vi.fn();
let subsetValue: "all" | "changed" | "selected" = "all";

vi.mock("./atlasSubset", () => ({
  useAtlasSubset: () => [subsetValue, setSubset],
}));

import { usePreviewView, PreviewViewProvider } from "./previewView";

function wrapper({ children }: { children: ReactNode }) {
  return <PreviewViewProvider>{children}</PreviewViewProvider>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  subsetValue = "all";
  setSubset.mockClear();
});

describe("usePreviewView", () => {
  it("returns the non-throwing default (onlyChanged=false, no-op setter) without a provider", () => {
    const { result } = renderHook(() => usePreviewView());
    expect(result.current.onlyChanged).toBe(false);
    // exercise the no-op default for coverage/contract; must not throw
    expect(() => result.current.setOnlyChanged(true)).not.toThrow();
  });

  it("derives onlyChanged=true when the URL subset is 'changed'", () => {
    subsetValue = "changed";
    const { result } = renderHook(() => usePreviewView(), { wrapper });
    expect(result.current.onlyChanged).toBe(true);
  });

  it("derives onlyChanged=false when the URL subset is 'all' or 'selected'", () => {
    subsetValue = "selected";
    const { result } = renderHook(() => usePreviewView(), { wrapper });
    expect(result.current.onlyChanged).toBe(false);
  });

  it("setOnlyChanged(true) sets the subset to 'changed'", () => {
    const { result } = renderHook(() => usePreviewView(), { wrapper });
    act(() => result.current.setOnlyChanged(true));
    expect(setSubset).toHaveBeenCalledWith("changed");
  });

  it("setOnlyChanged(false) sets the subset to 'all'", () => {
    const { result } = renderHook(() => usePreviewView(), { wrapper });
    act(() => result.current.setOnlyChanged(false));
    expect(setSubset).toHaveBeenCalledWith("all");
  });
});
