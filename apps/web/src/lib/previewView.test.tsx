// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const setSubset = vi.fn();
let subsetValue: "all" | "changed" | "selected" = "all";

vi.mock("./atlasSubset", () => ({
  useAtlasSubset: () => [subsetValue, setSubset],
}));

import { usePreviewView, PreviewViewProvider } from "./previewView";

function wrapper({ children }: { children: ReactNode }) {
  return <PreviewViewProvider>{children}</PreviewViewProvider>;
}

// baseKey rides real URL state (useUrlState), so exercising it needs a
// memory-location Router rather than the atlasSubset-only mock above.
function baseWrapper(path: string) {
  const { hook } = memoryLocation({ path, record: true });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <Router hook={hook}>
        <PreviewViewProvider>{children}</PreviewViewProvider>
      </Router>
    );
  };
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
    expect(result.current.baseKey).toBeNull();
    // exercise the no-op defaults for coverage/contract; must not throw
    expect(() => result.current.setOnlyChanged(true)).not.toThrow();
    expect(() => result.current.setBaseKey("sky")).not.toThrow();
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

describe("usePreviewView — baseKey (?base=)", () => {
  it("defaults to null when the param is absent", () => {
    const { result } = renderHook(() => usePreviewView(), { wrapper: baseWrapper("/preview/x") });
    expect(result.current.baseKey).toBeNull();
  });

  it("reads ?base=sky", () => {
    const { result } = renderHook(() => usePreviewView(), { wrapper: baseWrapper("/preview/x?base=sky") });
    expect(result.current.baseKey).toBe("sky");
  });

  it("reads ?base=repo", () => {
    const { result } = renderHook(() => usePreviewView(), { wrapper: baseWrapper("/preview/x?base=repo") });
    expect(result.current.baseKey).toBe("repo");
  });

  it("treats an invalid base value as null", () => {
    const { result } = renderHook(() => usePreviewView(), { wrapper: baseWrapper("/preview/x?base=bogus") });
    expect(result.current.baseKey).toBeNull();
  });

  it("setBaseKey writes the param", () => {
    const { result } = renderHook(() => usePreviewView(), { wrapper: baseWrapper("/preview/x") });
    act(() => result.current.setBaseKey("repo"));
    expect(result.current.baseKey).toBe("repo");
  });

  it("setBaseKey(null) clears the param", () => {
    const { result } = renderHook(() => usePreviewView(), { wrapper: baseWrapper("/preview/x?base=sky") });
    act(() => result.current.setBaseKey(null));
    expect(result.current.baseKey).toBeNull();
  });

  it("setBaseKey does not touch the (separately URL-synced) subset state", () => {
    const { result } = renderHook(() => usePreviewView(), { wrapper: baseWrapper("/preview/x") });
    act(() => result.current.setBaseKey("sky"));
    expect(result.current.baseKey).toBe("sky");
    expect(setSubset).not.toHaveBeenCalled();
  });
});
