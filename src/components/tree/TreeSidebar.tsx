import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { List, useListRef } from "react-window";
import { useAtlasTree } from "../../hooks/useAtlasTree";
import { useTreeKeyboard } from "../../hooks/useTreeKeyboard";
import { usePulseDom } from "../../hooks/usePulseDom";
import { realDepth } from "../../lib/depth";
import { usePreviewChangedSet } from "../../lib/previewFilter";
import { PreviewTreeToggle } from "../preview/PreviewTreeToggle";
import { TreeRow, ROW_HEIGHT, type VisibleNode, type TreeRowData } from "./TreeRow";

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

  // child id → parent id in the *rendered* tree. byParent is built in the worker
  // via resolveParentId (doc_no-aware, incl. the NR-by-id step), so inverting it
  // gives the exact upward relation the tree renders by. Raw node.parentId is NOT
  // that relation — it comes from a depth stack capped at 6, so for any node
  // deeper than 6 levels it collapses onto the depth-6 ancestor and the real
  // intermediate parents are lost. Walking it would skip those, leaving the
  // selected node hidden (no sidebar selection). Walk parentOf instead.
  const parentOf = useMemo(() => {
    const m = new Map<string, string | null>();
    if (bundle) {
      for (const [pid, children] of bundle.byParent) {
        for (const child of children) m.set(child.id, pid);
      }
    }
    return m;
  }, [bundle]);

  useEffect(() => {
    if (!bundle || !nodeId || !parentOf.has(nodeId)) return;
    setExpandedIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      // Expand every ancestor so the selected node is visible, stepping upward
      // along the same relation the tree is grouped by.
      let pid = parentOf.get(nodeId) ?? null;
      while (pid) {
        if (!next.has(pid)) {
          next.add(pid);
          changed = true;
        }
        pid = parentOf.get(pid) ?? null;
      }
      return changed ? next : prev;
    });
  }, [bundle, nodeId, parentOf]);

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

  const changedSet = usePreviewChangedSet();

  const visibleNodes = useMemo(() => {
    if (!bundle) return [];
    const { byParent, docs } = bundle;
    // "Changed only": flat list of just the changed/added docs, in document
    // order — no hierarchy, no ancestors, nothing to expand.
    if (changedSet) {
      return Object.values(docs)
        .filter((n) => changedSet.has(n.id))
        .sort((a, b) => a.order - b.order)
        .map((node) => ({ node, hasChildren: false, treeDepth: 1 }));
    }
    const result: VisibleNode[] = [];
    function walk(parentId: string | null, parentDocNo?: string) {
      for (const node of byParent.get(parentId) ?? []) {
        const hasChildren = byParent.has(node.id);
        result.push({ node, hasChildren, treeDepth: realDepth(node.doc_no, parentDocNo), parentDocNo });
        if (hasChildren && expandedIds.has(node.id)) walk(node.id, node.doc_no);
      }
    }
    walk(null);
    return result;
  }, [bundle, expandedIds, changedSet]);

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

  const toggleExpand = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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
      <PreviewTreeToggle />
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

