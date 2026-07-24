// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { KeyboardEvent } from "react";
import { useTreeKeyboard } from "./useTreeKeyboard";
import type { VisibleNode } from "../components/tree/TreeRow";
import type { AtlasNode } from "../types";

afterEach(() => cleanup());

function node(id: string): AtlasNode {
  return {
    id,
    doc_no: id,
    title: id,
    type: "Core",
    depth: 1,
    parentId: null,
    content: "",
    order: 0,
    addressRefs: [],
  };
}

function makeVisibleNodes(ids: string[], childrenIds: Set<string> = new Set()): VisibleNode[] {
  return ids.map((id) => ({
    node: node(id),
    hasChildren: childrenIds.has(id),
    treeDepth: 0,
  }));
}

function key(k: string): KeyboardEvent {
  return { key: k, preventDefault: vi.fn() } as unknown as KeyboardEvent;
}

function setupParams(overrides: Partial<Parameters<typeof useTreeKeyboard>[0]> = {}) {
  const visibleNodes = makeVisibleNodes(["a", "b", "c"], new Set(["b"]));
  const scrollToRow = vi.fn();
  const onNavigate = vi.fn();
  const setFocusedIndex = vi.fn();
  const setExpandedIds = vi.fn();
  const listRef = { current: { scrollToRow } };
  const params = {
    visibleNodes,
    focusedIndex: -1,
    selectedIndex: 0,
    expandedIds: new Set<string>(),
    listRef,
    onNavigate,
    setFocusedIndex,
    setExpandedIds,
    ...overrides,
  };
  return { params, scrollToRow, onNavigate, setFocusedIndex, setExpandedIds };
}

describe("useTreeKeyboard", () => {
  it("does nothing when visibleNodes is empty", () => {
    const { params, setFocusedIndex } = setupParams({ visibleNodes: [] });
    const { result } = renderHook(() => useTreeKeyboard(params));
    act(() => result.current(key("ArrowDown")));
    expect(setFocusedIndex).not.toHaveBeenCalled();
  });

  it("ArrowDown moves focus forward from selectedIndex when focusedIndex is -1, and scrolls", () => {
    const { params, setFocusedIndex, scrollToRow } = setupParams({ focusedIndex: -1, selectedIndex: 0 });
    const { result } = renderHook(() => useTreeKeyboard(params));
    const e = key("ArrowDown");
    act(() => result.current(e));
    expect(e.preventDefault).toHaveBeenCalled();
    expect(setFocusedIndex).toHaveBeenCalledWith(1);
    expect(scrollToRow).toHaveBeenCalledWith({ index: 1, align: "smart" });
  });

  it("ArrowDown clamps at the last index", () => {
    const { params, setFocusedIndex } = setupParams({ focusedIndex: 2 });
    const { result } = renderHook(() => useTreeKeyboard(params));
    act(() => result.current(key("ArrowDown")));
    expect(setFocusedIndex).toHaveBeenCalledWith(2);
  });

  it("ArrowUp moves focus backward and clamps at 0", () => {
    const { params, setFocusedIndex } = setupParams({ focusedIndex: 0 });
    const { result } = renderHook(() => useTreeKeyboard(params));
    act(() => result.current(key("ArrowUp")));
    expect(setFocusedIndex).toHaveBeenCalledWith(0);
  });

  it("ArrowUp moves from focusedIndex 1 to 0", () => {
    const { params, setFocusedIndex } = setupParams({ focusedIndex: 1 });
    const { result } = renderHook(() => useTreeKeyboard(params));
    act(() => result.current(key("ArrowUp")));
    expect(setFocusedIndex).toHaveBeenCalledWith(0);
  });

  it("ArrowRight expands a collapsed node that hasChildren", () => {
    const { params, setExpandedIds } = setupParams({ focusedIndex: 1 }); // node "b" hasChildren
    const { result } = renderHook(() => useTreeKeyboard(params));
    act(() => result.current(key("ArrowRight")));
    expect(setExpandedIds).toHaveBeenCalled();
    const updater = setExpandedIds.mock.calls[0][0];
    const next = updater(new Set());
    expect(next.has("b")).toBe(true);
  });

  it("ArrowRight does nothing on a node without children", () => {
    const { params, setExpandedIds } = setupParams({ focusedIndex: 0 }); // node "a" no children
    const { result } = renderHook(() => useTreeKeyboard(params));
    act(() => result.current(key("ArrowRight")));
    expect(setExpandedIds).not.toHaveBeenCalled();
  });

  it("ArrowRight does nothing on an already-expanded node", () => {
    const { params, setExpandedIds } = setupParams({ focusedIndex: 1, expandedIds: new Set(["b"]) });
    const { result } = renderHook(() => useTreeKeyboard(params));
    act(() => result.current(key("ArrowRight")));
    expect(setExpandedIds).not.toHaveBeenCalled();
  });

  it("ArrowRight with idx < 0 (no selection) does nothing but still preventDefault", () => {
    const { params, setExpandedIds } = setupParams({ focusedIndex: -1, selectedIndex: -1 });
    const { result } = renderHook(() => useTreeKeyboard(params));
    const e = key("ArrowRight");
    act(() => result.current(e));
    expect(e.preventDefault).toHaveBeenCalled();
    expect(setExpandedIds).not.toHaveBeenCalled();
  });

  it("ArrowLeft collapses an expanded node", () => {
    const { params, setExpandedIds } = setupParams({ focusedIndex: 1, expandedIds: new Set(["b"]) });
    const { result } = renderHook(() => useTreeKeyboard(params));
    act(() => result.current(key("ArrowLeft")));
    expect(setExpandedIds).toHaveBeenCalled();
    const updater = setExpandedIds.mock.calls[0][0];
    const next = updater(new Set(["b", "other"]));
    expect(next.has("b")).toBe(false);
    expect(next.has("other")).toBe(true);
  });

  it("ArrowLeft does nothing on a node that isn't expanded", () => {
    const { params, setExpandedIds } = setupParams({ focusedIndex: 0, expandedIds: new Set() });
    const { result } = renderHook(() => useTreeKeyboard(params));
    act(() => result.current(key("ArrowLeft")));
    expect(setExpandedIds).not.toHaveBeenCalled();
  });

  it("Enter navigates to the focused node and resets focusedIndex to -1", () => {
    const { params, onNavigate, setFocusedIndex } = setupParams({ focusedIndex: 2 });
    const { result } = renderHook(() => useTreeKeyboard(params));
    act(() => result.current(key("Enter")));
    expect(onNavigate).toHaveBeenCalledWith("c");
    expect(setFocusedIndex).toHaveBeenCalledWith(-1);
  });

  it("Enter with idx < 0 does not navigate", () => {
    const { params, onNavigate } = setupParams({ focusedIndex: -1, selectedIndex: -1 });
    const { result } = renderHook(() => useTreeKeyboard(params));
    act(() => result.current(key("Enter")));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("an unhandled key does nothing", () => {
    const { params, setFocusedIndex, onNavigate, setExpandedIds } = setupParams();
    const { result } = renderHook(() => useTreeKeyboard(params));
    act(() => result.current(key("a")));
    expect(setFocusedIndex).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(setExpandedIds).not.toHaveBeenCalled();
  });

  it("handles a null listRef.current gracefully on ArrowDown", () => {
    const { params } = setupParams({ listRef: { current: null } });
    const { result } = renderHook(() => useTreeKeyboard(params));
    expect(() => act(() => result.current(key("ArrowDown")))).not.toThrow();
  });
});
