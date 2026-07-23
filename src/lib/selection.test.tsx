// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";

const setSubset = vi.fn();
let subsetValue: "all" | "changed" | "selected" = "all";

vi.mock("./atlasSubset", () => ({
  useAtlasSubset: () => [subsetValue, setSubset],
}));

let storedIds: string[] = [];
const saveSelectionMock = vi.fn();

vi.mock("./selectionStore", () => ({
  STORAGE_KEY: "redline-sky-atlas:selection",
  loadSelection: () => storedIds,
  saveSelection: (ids: string[]) => saveSelectionMock(ids),
}));

import { useSelection, SelectionProvider } from "./selection";

function wrapper({ children }: { children: ReactNode }) {
  return <SelectionProvider>{children}</SelectionProvider>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  subsetValue = "all";
  storedIds = [];
  setSubset.mockClear();
  saveSelectionMock.mockClear();
});

describe("useSelection", () => {
  it("returns the inert NOOP default without a provider", () => {
    const { result } = renderHook(() => useSelection());
    expect(result.current.ids.size).toBe(0);
    expect(result.current.selectedOnly).toBe(false);
    expect(result.current.activeCollectionId).toBeNull();
    expect(result.current.activeCollectionName).toBeNull();
    // Every action is a no-op; must not throw and must not mutate anything.
    act(() => {
      result.current.toggleDoc("x");
      result.current.selectSubtree(["x"]);
      result.current.clear();
      result.current.replace(["x"]);
      result.current.setSelectedOnly(true);
      result.current.setActiveCollectionId("x");
      result.current.setActiveCollectionName("x");
    });
    expect(result.current.ids.size).toBe(0);
  });

  it("hydrates ids from loadSelection on mount", () => {
    storedIds = ["a", "b"];
    const { result } = renderHook(() => useSelection(), { wrapper });
    expect(result.current.ids).toEqual(new Set(["a", "b"]));
  });

  it("toggleDoc adds then removes an id, persisting via saveSelection", () => {
    const { result } = renderHook(() => useSelection(), { wrapper });
    act(() => result.current.toggleDoc("a"));
    expect(result.current.ids.has("a")).toBe(true);
    expect(saveSelectionMock).toHaveBeenLastCalledWith(["a"]);

    act(() => result.current.toggleDoc("a"));
    expect(result.current.ids.has("a")).toBe(false);
  });

  it("selectSubtree adds the whole subtree when the root is unselected", () => {
    const { result } = renderHook(() => useSelection(), { wrapper });
    act(() => result.current.selectSubtree(["a", "b", "c"]));
    expect(result.current.ids).toEqual(new Set(["a", "b", "c"]));
  });

  it("selectSubtree removes the whole subtree when the root is already selected", () => {
    storedIds = ["a", "b", "c"];
    const { result } = renderHook(() => useSelection(), { wrapper });
    expect(result.current.ids).toEqual(new Set(["a", "b", "c"]));
    act(() => result.current.selectSubtree(["a", "b"]));
    expect(result.current.ids).toEqual(new Set(["c"]));
  });

  it("selectSubtree is a no-op for an empty array", () => {
    const { result } = renderHook(() => useSelection(), { wrapper });
    act(() => result.current.selectSubtree([]));
    expect(result.current.ids.size).toBe(0);
  });

  it("clear empties the selection", () => {
    storedIds = ["a"];
    const { result } = renderHook(() => useSelection(), { wrapper });
    act(() => result.current.clear());
    expect(result.current.ids.size).toBe(0);
  });

  it("replace overwrites the selection with the given ids", () => {
    storedIds = ["old"];
    const { result } = renderHook(() => useSelection(), { wrapper });
    act(() => result.current.replace(["x", "y"]));
    expect(result.current.ids).toEqual(new Set(["x", "y"]));
  });

  it("selectedOnly reflects a URL subset of 'selected'", () => {
    subsetValue = "selected";
    const { result } = renderHook(() => useSelection(), { wrapper });
    expect(result.current.selectedOnly).toBe(true);
  });

  it("setSelectedOnly(true/false) drives the URL subset", () => {
    const { result } = renderHook(() => useSelection(), { wrapper });
    act(() => result.current.setSelectedOnly(true));
    expect(setSubset).toHaveBeenCalledWith("selected");
    act(() => result.current.setSelectedOnly(false));
    expect(setSubset).toHaveBeenCalledWith("all");
  });

  it("setActiveCollectionId / setActiveCollectionName update state", () => {
    const { result } = renderHook(() => useSelection(), { wrapper });
    act(() => {
      result.current.setActiveCollectionId("col-1");
      result.current.setActiveCollectionName("My Collection");
    });
    expect(result.current.activeCollectionId).toBe("col-1");
    expect(result.current.activeCollectionName).toBe("My Collection");
  });

  it("resets selectedOnly and the active collection once the selection empties", () => {
    subsetValue = "selected";
    storedIds = ["a"];
    const { result } = renderHook(() => useSelection(), { wrapper });
    act(() => {
      result.current.setActiveCollectionId("col1");
      result.current.setActiveCollectionName("My Collection");
    });
    expect(result.current.activeCollectionId).toBe("col1");

    act(() => result.current.clear());
    expect(setSubset).toHaveBeenCalledWith("all");
    expect(result.current.activeCollectionId).toBeNull();
    expect(result.current.activeCollectionName).toBeNull();
  });

  it("syncs ids from a cross-tab storage event matching STORAGE_KEY", () => {
    const { result } = renderHook(() => useSelection(), { wrapper });
    storedIds = ["z"];
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "redline-sky-atlas:selection" }));
    });
    expect(result.current.ids).toEqual(new Set(["z"]));
  });

  it("ignores storage events for unrelated keys", () => {
    const { result } = renderHook(() => useSelection(), { wrapper });
    storedIds = ["should-not-apply"];
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "some-other-key" }));
    });
    expect(result.current.ids.size).toBe(0);
  });
});
