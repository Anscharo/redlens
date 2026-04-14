import { useCallback } from "react";
import type { VisibleNode } from "../components/tree/TreeRow";

interface Params {
  visibleNodes: VisibleNode[];
  focusedIndex: number;
  selectedIndex: number;
  expandedIds: Set<string>;
  listRef: React.MutableRefObject<{ scrollToRow: (opts: { index: number; align: "auto" | "smart" | "center" | "start" | "end" }) => void } | null>;
  onNavigate: (id: string) => void;
  setFocusedIndex: (i: number) => void;
  setExpandedIds: (fn: (prev: Set<string>) => Set<string>) => void;
}

export function useTreeKeyboard({
  visibleNodes, focusedIndex, selectedIndex, expandedIds,
  listRef, onNavigate, setFocusedIndex, setExpandedIds,
}: Params) {
  return useCallback((e: React.KeyboardEvent) => {
    if (visibleNodes.length === 0) return;
    const idx = focusedIndex >= 0 ? focusedIndex : selectedIndex;

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const next = Math.min(idx + 1, visibleNodes.length - 1);
        setFocusedIndex(next);
        listRef.current?.scrollToRow({ index: next, align: "smart" });
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const prev = Math.max(idx - 1, 0);
        setFocusedIndex(prev);
        listRef.current?.scrollToRow({ index: prev, align: "smart" });
        break;
      }
      case "ArrowRight": {
        e.preventDefault();
        if (idx >= 0) {
          const node = visibleNodes[idx].node;
          if (visibleNodes[idx].hasChildren && !expandedIds.has(node.id)) {
            setExpandedIds((prev) => new Set(prev).add(node.id));
          }
        }
        break;
      }
      case "ArrowLeft": {
        e.preventDefault();
        if (idx >= 0) {
          const node = visibleNodes[idx].node;
          if (expandedIds.has(node.id)) {
            setExpandedIds((prev) => { const next = new Set(prev); next.delete(node.id); return next; });
          }
        }
        break;
      }
      case "Enter": {
        e.preventDefault();
        if (idx >= 0) {
          onNavigate(visibleNodes[idx].node.id);
          setFocusedIndex(-1);
        }
        break;
      }
    }
  }, [visibleNodes, focusedIndex, selectedIndex, expandedIds, listRef, onNavigate, setFocusedIndex, setExpandedIds]);
}
