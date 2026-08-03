import { useCallback } from "react";
import type { VisibleNode } from "../components/tree/TreeRow";

interface Params {
  visibleNodes: VisibleNode[];
  focusedIndex: number;
  selectedIndex: number;
  expandedIds: Set<string>;
  listRef: React.MutableRefObject<{
    scrollToRow: (opts: {
      index: number;
      align: "auto" | "smart" | "center" | "start" | "end";
    }) => void;
  } | null>;
  onNavigate: (id: string) => void;
  setFocusedIndex: (i: number) => void;
  setExpandedIds: (fn: (prev: Set<string>) => Set<string>) => void;
}

export function useTreeKeyboard({
  visibleNodes,
  focusedIndex,
  selectedIndex,
  expandedIds,
  listRef,
  onNavigate,
  setFocusedIndex,
  setExpandedIds,
}: Params) {
  return useCallback(
    (e: React.KeyboardEvent) => {
      if (visibleNodes.length === 0) return;
      const idx = focusedIndex >= 0 ? focusedIndex : selectedIndex;
      // `idx` can be stale: a mouse-driven toggle can shrink visibleNodes out
      // from under a previously-set focusedIndex (TreeSidebar clamps it back
      // in a follow-up effect, but that runs after this handler could already
      // have fired for the stale value). Never trust it directly — every
      // lookup below goes through `visibleNodes[idx]` optional-chained, and
      // every index handed to scrollToRow is clamped into range first.
      const clampIndex = (i: number) => Math.min(Math.max(i, 0), visibleNodes.length - 1);

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const next = clampIndex(idx + 1);
          setFocusedIndex(next);
          listRef.current?.scrollToRow({ index: next, align: "smart" });
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const prev = clampIndex(idx - 1);
          setFocusedIndex(prev);
          listRef.current?.scrollToRow({ index: prev, align: "smart" });
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          const entry = visibleNodes[idx];
          if (entry && entry.hasChildren && !expandedIds.has(entry.node.id)) {
            setExpandedIds((prev) => new Set(prev).add(entry.node.id));
          }
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          const entry = visibleNodes[idx];
          if (entry && expandedIds.has(entry.node.id)) {
            setExpandedIds((prev) => {
              const next = new Set(prev);
              next.delete(entry.node.id);
              return next;
            });
          }
          break;
        }
        case "Enter": {
          e.preventDefault();
          const entry = visibleNodes[idx];
          if (entry) {
            onNavigate(entry.node.id);
            setFocusedIndex(-1);
          }
          break;
        }
      }
    },
    [
      visibleNodes,
      focusedIndex,
      selectedIndex,
      expandedIds,
      listRef,
      onNavigate,
      setFocusedIndex,
      setExpandedIds,
    ],
  );
}
