import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { List, useListRef } from "react-window";
import { useAtlasTree } from "../../hooks/useAtlasTree";
import { useTreeKeyboard } from "../../hooks/useTreeKeyboard";
import { usePulseDom } from "../../hooks/usePulseDom";
import { realDepth } from "../../lib/depth";
import { revealStore } from "../../lib/revealStore";
import { scrollRequestStore } from "../../lib/scrollRequestStore";
import { TreeRow, ROW_HEIGHT, type VisibleNode, type TreeRowData } from "./TreeRow";

// Expand every ancestor of `doc_no` so the node's row is visible. Returns
// whether `next` changed. (fragile: doc_no prefix — same walk the selection
// effect has always used.)
function addAncestors(
  docNoToId: Map<string, string>,
  doc_no: string,
  next: Set<string>,
): boolean {
  const parts = doc_no.split(".");
  let changed = false;
  for (let i = 2; i < parts.length; i++) {
    const aid = docNoToId.get(parts.slice(0, i).join("."));
    if (aid && !next.has(aid)) {
      next.add(aid);
      changed = true;
    }
  }
  return changed;
}

interface Props {
  nodeId: string | null;
  onNavigate: (id: string) => void;
  onShiftNavigate?: (id: string) => void;
}

export function TreeSidebar({ nodeId, onNavigate, onShiftNavigate }: Props) {
  const bundle = useAtlasTree();
  const [sidebarWidth, setSidebarWidth] = useState(242);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const clickedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useListRef(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  usePulseDom(nodeId, containerRef);

  useEffect(() => {
    if (!bundle || !nodeId) return;
    const { docs, docNoToId } = bundle;
    const target = docs[nodeId];
    if (!target) return;
    setExpandedIds((prev) => {
      const next = new Set(prev);
      return addAncestors(docNoToId, target.doc_no, next) ? next : prev;
    });
  }, [bundle, nodeId]);

  // Reader-side expansions (single or expand-all) ask us to make those rows
  // visible by expanding their ancestors, without changing the selection.
  useEffect(() => {
    if (!bundle) return;
    const { docs, docNoToId } = bundle;
    return revealStore.subscribe((ids) => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const id of ids) {
          const doc = docs[id];
          if (doc) changed = addAncestors(docNoToId, doc.doc_no, next) || changed;
        }
        return changed ? next : prev;
      });
    });
  }, [bundle]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let rafId = 0;
    const ro = new ResizeObserver(([entry]) => {
      const newWidth = entry.contentRect.width;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setSidebarWidth((prev) => (Math.abs(prev - newWidth) > 10 ? newWidth : prev));
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, []);

  const visibleNodes = useMemo(() => {
    if (!bundle) return [];
    const { byParent } = bundle;
    const result: VisibleNode[] = [];
    function walk(parentId: string | null, parentDocNo?: string) {
      for (const node of byParent.get(parentId) ?? []) {
        const hasChildren = byParent.has(node.id);
        result.push({ node, hasChildren, treeDepth: realDepth(node.doc_no, parentDocNo) });
        if (hasChildren && expandedIds.has(node.id)) walk(node.id, node.doc_no);
      }
    }
    walk(null);
    return result;
  }, [bundle, expandedIds]);

  const selectedIndex = useMemo(
    () => (nodeId ? visibleNodes.findIndex((v) => v.node.id === nodeId) : -1),
    [visibleNodes, nodeId],
  );

  useEffect(() => {
    if (clickedRef.current) {
      clickedRef.current = false;
      return;
    }
    if (selectedIndex >= 0 && listRef.current) {
      listRef.current.scrollToRow({ index: selectedIndex, align: "smart" });
    }
  }, [selectedIndex, listRef]);

  const toggleExpand = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setExpandedIds((prev) => {
        const next = new Set(prev);
        // alt-click: expand/collapse the entire subtree (Finder convention)
        if (e.altKey && bundle) {
          const expand = !prev.has(id);
          const stack = [id];
          while (stack.length) {
            const cur = stack.pop()!;
            const kids = bundle.byParent.get(cur);
            if (!kids?.length) continue;
            if (expand) next.add(cur);
            else next.delete(cur);
            for (const k of kids) stack.push(k.id);
          }
          return next;
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [bundle],
  );

  const handleKeyDown = useTreeKeyboard({
    visibleNodes,
    focusedIndex,
    selectedIndex,
    expandedIds,
    listRef,
    onNavigate,
    setFocusedIndex,
    setExpandedIds,
  });

  const handleRowClick = useCallback(
    (id: string) => {
      clickedRef.current = true;
      setFocusedIndex(-1);
      onNavigate(id);
      scrollRequestStore.request(id);
    },
    [onNavigate],
  );

  const rowProps: TreeRowData = useMemo(
    () => ({
      visibleNodes,
      selectedIndex,
      focusedIndex,
      expandedIds,
      sidebarWidth,
      onNavigate: handleRowClick,
      onToggle: toggleExpand,
      onShiftNavigate,
    }),
    [
      visibleNodes,
      selectedIndex,
      focusedIndex,
      expandedIds,
      sidebarWidth,
      handleRowClick,
      toggleExpand,
      onShiftNavigate,
    ],
  );

  if (!bundle) return <div className="tree-sidebar" ref={containerRef} />;

  return (
    <div
      className="tree-sidebar"
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="tree"
      aria-label="Atlas tree"
    >
      <List
        listRef={listRef}
        rowCount={visibleNodes.length}
        rowHeight={ROW_HEIGHT}
        rowComponent={TreeRow}
        rowProps={rowProps}
        overscanCount={20}
        style={{ flex: 1 }}
      />
    </div>
  );
}
