// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { useSplitPane } from "./useSplitPane";
import { useAtlasNodeId } from "./useAtlasNodeId";

const track = vi.fn();
vi.mock("../lib/analytics", () => ({
  track: (...a: unknown[]) => track(...a),
}));

function wrapperFor(path: string) {
  const { hook, searchHook } = memoryLocation({ path, record: true });
  return ({ children }: { children: React.ReactNode }) => (
    <Router hook={hook} searchHook={searchHook}>
      {children}
    </Router>
  );
}

beforeEach(() => track.mockClear());
afterEach(cleanup);

describe("useSplitPane", () => {
  it("reads the comparison pane from ?split=", () => {
    const { result } = renderHook(() => useSplitPane("a"), { wrapper: wrapperFor("/atlas?id=a&split=b") });
    expect(result.current.splitId).toBe("b");
  });

  it("tracks opening a pane, and writes it to the URL", () => {
    const { result } = renderHook(() => useSplitPane("a"), { wrapper: wrapperFor("/atlas?id=a") });
    act(() => result.current.handleSplitChange("b"));
    expect(track).toHaveBeenCalledWith("atlas_split_open", { node_id: "a", split_id: "b" });
    expect(result.current.splitId).toBe("b");
  });

  it("tracks closing a pane, naming the pane that closed", () => {
    const { result } = renderHook(() => useSplitPane("a"), { wrapper: wrapperFor("/atlas?id=a&split=b") });
    act(() => result.current.handleSplitChange(null));
    expect(track).toHaveBeenCalledWith("reader_split_close", { node_id: "a", split_id: "b" });
    expect(result.current.splitId).toBeNull();
  });

  it("does not track re-selecting the pane already open", () => {
    const { result } = renderHook(() => useSplitPane("a"), { wrapper: wrapperFor("/atlas?id=a&split=b") });
    act(() => result.current.handleSplitChange("b"));
    expect(track).not.toHaveBeenCalled();
  });
});

describe("useAtlasNodeId", () => {
  it("is the reader's ?id=", () => {
    const { result } = renderHook(() => useAtlasNodeId(), { wrapper: wrapperFor("/atlas?id=a") });
    expect(result.current).toBe("a");
  });

  it("is null off the reader, even with an ?id= param", () => {
    const { result } = renderHook(() => useAtlasNodeId(), { wrapper: wrapperFor("/radar?id=a") });
    expect(result.current).toBeNull();
  });
});
