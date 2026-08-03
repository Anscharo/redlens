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

  // C4 (2026-08-02 QA report): opening an empty collection calls replace([]),
  // which — pre-fix — tripped the same empties-effect as an interactive drain
  // and silently reset selectedOnly + forgot the collection. It must not.
  it("replace([]) — opening an empty collection — keeps selectedOnly and the active collection", () => {
    subsetValue = "selected";
    storedIds = ["a"];
    const { result } = renderHook(() => useSelection(), { wrapper });
    act(() => {
      result.current.setActiveCollectionId("col1");
      result.current.setActiveCollectionName("Empty Collection");
    });
    setSubset.mockClear();

    act(() => result.current.replace([]));

    expect(result.current.ids.size).toBe(0);
    expect(setSubset).not.toHaveBeenCalled();
    expect(result.current.selectedOnly).toBe(true);
    expect(result.current.activeCollectionId).toBe("col1");
    expect(result.current.activeCollectionName).toBe("Empty Collection");
  });

  // The two open paths (CollectionsPage's openCollection, the /c/:id opener)
  // call replace() while still on the previous route and only navigate to
  // ?subset=selected afterwards — so `selectedOnly` can flip true a render
  // after `ids` already settled at empty. That's a second firing of the same
  // effect (selectedOnly is in its dependency array) and must not undo the
  // first firing's "keep it" decision.
  it("keeps context when selectedOnly flips true a render after an empty replace()", () => {
    storedIds = [];
    const { result, rerender } = renderHook(() => useSelection(), { wrapper });
    act(() => {
      result.current.replace([]);
      result.current.setActiveCollectionId("col1");
      result.current.setActiveCollectionName("Empty Collection");
    });
    expect(result.current.activeCollectionId).toBe("col1");
    setSubset.mockClear();

    // Simulate the subset=selected navigation landing on the next render.
    subsetValue = "selected";
    rerender();

    expect(result.current.selectedOnly).toBe(true);
    expect(setSubset).not.toHaveBeenCalled();
    expect(result.current.activeCollectionId).toBe("col1");
    expect(result.current.activeCollectionName).toBe("Empty Collection");
  });

  it("a later interactive drain still resets after an earlier empty replace() (the flag isn't sticky)", () => {
    subsetValue = "selected";
    storedIds = [];
    const { result } = renderHook(() => useSelection(), { wrapper });
    act(() => {
      result.current.replace([]);
      result.current.setActiveCollectionId("col1");
      result.current.setActiveCollectionName("Empty Collection");
    });
    expect(result.current.activeCollectionId).toBe("col1");
    setSubset.mockClear(); // isolate the drain's own call below from mount's

    // The user adds a doc (now interactive) then removes it again — this
    // drain-to-empty must reset normally, proving replace()'s flag doesn't
    // linger forever and mask a real drain.
    act(() => result.current.toggleDoc("a"));
    expect(result.current.activeCollectionId).toBe("col1"); // unaffected while non-empty
    act(() => result.current.toggleDoc("a"));

    expect(result.current.ids.size).toBe(0);
    expect(setSubset).toHaveBeenCalledWith("all");
    expect(result.current.activeCollectionId).toBeNull();
    expect(result.current.activeCollectionName).toBeNull();
  });

  // P1 data-loss bug (PR #230 review, 2026-08-03): a stale activeCollectionId
  // left over from the viewer's OWN previously-active collection must not
  // survive opening a shared (/c/:id) collection — even an empty one.
  // Pre-fix, SharedCollectionOpener called only replace([]) +
  // setActiveCollectionName(), trusting activeCollectionId was already null.
  // When it wasn't — the viewer had their own collection open first — the C4
  // bail-out just above (openedFromReplaceRef) meant nothing else cleared it
  // either: id and name diverged, the pill showed the shared collection's
  // name, and Save's "Update" would silently PATCH the viewer's own previous
  // collection with this (empty) id list. The fix has SharedCollectionOpener
  // call setActiveCollectionId(null) itself, right alongside replace() — this
  // test reproduces that exact call sequence.
  it("opening an empty SHARED collection clears a stale own-collection id (does not leak the previous owner's id)", () => {
    subsetValue = "selected";
    storedIds = ["a"];
    const { result } = renderHook(() => useSelection(), { wrapper });
    // The viewer has one of their OWN collections active.
    act(() => {
      result.current.setActiveCollectionId("own-123");
      result.current.setActiveCollectionName("My Collection");
    });
    expect(result.current.activeCollectionId).toBe("own-123");
    setSubset.mockClear();

    // SharedCollectionOpener's (fixed) sequence for an empty shared collection.
    act(() => {
      result.current.replace([]);
      result.current.setActiveCollectionId(null);
      result.current.setActiveCollectionName("Shared Empty Collection");
    });

    expect(result.current.ids.size).toBe(0);
    // The stale own-collection id must be gone — a subsequent "Update" save
    // can no longer PATCH it.
    expect(result.current.activeCollectionId).toBeNull();
    // The shared collection's name still shows in the pill.
    expect(result.current.activeCollectionName).toBe("Shared Empty Collection");
    // Still preserves C4: opening an empty collection (shared or own) must not
    // silently strip subset=selected back out from under the viewer.
    expect(setSubset).not.toHaveBeenCalled();
    expect(result.current.selectedOnly).toBe(true);
  });

  // Same root cause, non-empty case: a shared collection's own docs must not
  // get attributed to a stale own-collection id either. Unlike the empty
  // case, ids.size > 0 here means the empties-effect above is a no-op
  // regardless of openedFromReplaceRef (`if (ids.size > 0) return;` fires
  // first) — so nothing but SharedCollectionOpener's explicit, unconditional
  // clear protects this case. Pins that the fix isn't accidentally
  // empty-only.
  it("opening a NON-EMPTY shared collection also clears a stale own-collection id", () => {
    storedIds = ["a"];
    const { result } = renderHook(() => useSelection(), { wrapper });
    act(() => {
      result.current.setActiveCollectionId("own-123");
      result.current.setActiveCollectionName("My Collection");
    });

    act(() => {
      result.current.replace(["s1", "s2"]);
      result.current.setActiveCollectionId(null);
      result.current.setActiveCollectionName("Shared Collection");
    });

    expect(result.current.ids).toEqual(new Set(["s1", "s2"]));
    expect(result.current.activeCollectionId).toBeNull();
    expect(result.current.activeCollectionName).toBe("Shared Collection");
  });

  // Contrast case: opening one of the viewer's OWN other empty collections
  // (CollectionsPage.openCollection's sequence) must keep behaving like C4 —
  // it sets that collection's own real (non-null) id right alongside
  // replace(). This pins that the shared-collection fix above is scoped to
  // shared opens and does not turn into "always null the id after an empty
  // replace()".
  it("opening one of the viewer's OWN empty collections still keeps that collection's real id (C4, unaffected by the shared-collection fix)", () => {
    subsetValue = "selected";
    storedIds = ["a"];
    const { result } = renderHook(() => useSelection(), { wrapper });
    act(() => {
      result.current.setActiveCollectionId("own-123");
      result.current.setActiveCollectionName("My Collection");
    });
    setSubset.mockClear();

    // CollectionsPage.openCollection's sequence: replace() + the collection's
    // OWN real id (not null) + its name.
    act(() => {
      result.current.replace([]);
      result.current.setActiveCollectionId("own-456");
      result.current.setActiveCollectionName("My Other (Empty) Collection");
    });

    expect(result.current.ids.size).toBe(0);
    expect(result.current.activeCollectionId).toBe("own-456");
    expect(result.current.activeCollectionName).toBe("My Other (Empty) Collection");
    expect(setSubset).not.toHaveBeenCalled();
    expect(result.current.selectedOnly).toBe(true);
  });

  it("replace() with a non-empty collection is unaffected by the empties-effect", () => {
    storedIds = [];
    const { result } = renderHook(() => useSelection(), { wrapper });
    act(() => {
      result.current.replace(["x", "y"]);
      result.current.setActiveCollectionId("col2");
      result.current.setActiveCollectionName("Non-empty Collection");
    });
    expect(result.current.ids).toEqual(new Set(["x", "y"]));
    expect(result.current.activeCollectionId).toBe("col2");
    expect(result.current.activeCollectionName).toBe("Non-empty Collection");
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
