import { useState, useEffect, useRef, useMemo, useCallback, useTransition } from "react";
import { List, useListRef } from "react-window";
import { useAtlasTree } from "../../hooks/useAtlasTree";
import { useTreeKeyboard } from "../../hooks/useTreeKeyboard";
import { realDepth } from "../../types";
import { TreeRow, ROW_HEIGHT, type VisibleNode, type TreeRowData } from "./TreeRow";

interface Props {
  nodeId: string | null;
  onNavigate: (id: string) => void;
}

export function TreeSidebar({ nodeId, onNavigate }: Props) {
  const bundle = useAtlasTree();
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const clickedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useListRef(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!bundle || initializedRef.current) return;
    initializedRef.current = true;
    const initial = new Set<string>();
    for (const node of Object.values(bundle.docs)) {
      if (node.depth <= 2) initial.add(node.id);
    }
    startTransition(() => setExpandedIds(initial)); // eslint-disable-line react-hooks/set-state-in-effect
  }, [bundle]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!bundle || !nodeId) return;
    const { docs, docNoToId } = bundle;
    const target = docs[nodeId];
    if (!target) return;
    const parts = target.doc_no.split(".");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpandedIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (let i = 2; i < parts.length; i++) {
        const aid = docNoToId.get(parts.slice(0, i).join("."));
        if (aid && !next.has(aid)) { next.add(aid); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [bundle, nodeId]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let rafId = 0;
    const ro = new ResizeObserver(([entry]) => {
      const newWidth = entry.contentRect.width;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setSidebarWidth(prev => Math.abs(prev - newWidth) > 10 ? newWidth : prev);
      });
    });
    ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(rafId); };
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
    () => nodeId ? visibleNodes.findIndex((v) => v.node.id === nodeId) : -1,
    [visibleNodes, nodeId]
  );

  useEffect(() => {
    if (clickedRef.current) { clickedRef.current = false; return; }
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
    visibleNodes, focusedIndex, selectedIndex, expandedIds,
    listRef, onNavigate, setFocusedIndex, setExpandedIds,
  });

  const handleRowClick = useCallback((id: string) => {
    clickedRef.current = true;
    setFocusedIndex(-1);
    onNavigate(id);
  }, [onNavigate]);

  const rowProps: TreeRowData = useMemo(() => ({
    visibleNodes, selectedIndex, focusedIndex, expandedIds, sidebarWidth,
    onNavigate: handleRowClick, onToggle: toggleExpand,
  }), [visibleNodes, selectedIndex, focusedIndex, expandedIds, sidebarWidth, handleRowClick, toggleExpand]);

  if (!bundle) return <div className="tree-sidebar" ref={containerRef} />;

  return (
    <div className="tree-sidebar" ref={containerRef} tabIndex={0} onKeyDown={handleKeyDown} role="tree" aria-label="Atlas tree">
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
