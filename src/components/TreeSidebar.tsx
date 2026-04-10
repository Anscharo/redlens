import { useState, useEffect, useRef, useMemo, useCallback, memo } from "react";
import { List, useListRef, type RowComponentProps } from "react-window";
import { prepareWithSegments, layoutWithLines, type PreparedTextWithSegments } from "@chenglou/pretext";
import { useAtlasTree } from "../hooks/useAtlasTree";
import { realDepth, segmentDepths, type AtlasNode } from "../types";

const ROW_HEIGHT = 20;
const FONT = "10px Lora";
const TOGGLE_WIDTH = 14;
const PAD_X = 6;

interface VisibleNode {
  node: AtlasNode;
  hasChildren: boolean;
  treeDepth: number;
}

// Cache prepared text measurements
const preparedCache = new Map<string, PreparedTextWithSegments>();
function getPrepared(text: string): PreparedTextWithSegments {
  let p = preparedCache.get(text);
  if (!p) {
    p = prepareWithSegments(text, FONT);
    preparedCache.set(text, p);
  }
  return p;
}

function truncateTitle(title: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  const prepared = getPrepared(title);
  const result = layoutWithLines(prepared, maxWidth, 14);
  if (result.lineCount <= 1) return title;
  return result.lines[0].text.trimEnd() + "\u2026";
}

interface Props {
  nodeId: string | null;
  onNavigate: (id: string) => void;
}

interface TreeRowData {
  visibleNodes: VisibleNode[];
  selectedIndex: number;
  focusedIndex: number;
  expandedIds: Set<string>;
  sidebarWidth: number;
  onNavigate: (id: string) => void;
  onToggle: (id: string, e: React.MouseEvent) => void;
}

// Hoisted static styles for TreeRow
const DOC_NUM_STYLE: React.CSSProperties = {
  flexShrink: 0,
  fontSize: 8,
  userSelect: "none",
  display: "inline-flex",
  alignItems: "center",
};
const DOT_STYLE: React.CSSProperties = { color: "var(--gray)" };
const HIDDEN_PAD_STYLE: React.CSSProperties = { visibility: "hidden" };
const TOGGLE_BASE: React.CSSProperties = {
  width: TOGGLE_WIDTH,
  textAlign: "center",
  flexShrink: 0,
  fontSize: 9,
  userSelect: "none",
};
const TITLE_BASE: React.CSSProperties = {
  flex: 1,
  overflow: "hidden",
  whiteSpace: "nowrap",
};
const ROW_LAYOUT_STYLE: React.CSSProperties = {
  paddingLeft: 5, // indent (3) + 2
  paddingRight: PAD_X,
  display: "flex",
  alignItems: "center",
  gap: 2,
};

export function TreeSidebar({ nodeId, onNavigate }: Props) {
  const bundle = useAtlasTree();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const clickedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useListRef(null);

  // Initialize expanded state: depths 1-3
  useEffect(() => {
    if (!bundle || initialized) return;
    const initial = new Set<string>();
    for (const node of Object.values(bundle.docs)) {
      if (node.depth <= 3) initial.add(node.id);
    }
    setExpandedIds(initial);
    setInitialized(true);
  }, [bundle, initialized]);

  // When nodeId changes, expand all ancestors
  useEffect(() => {
    if (!bundle || !nodeId) return;
    const { docs } = bundle;
    const target = docs[nodeId];
    if (!target) return;

    setExpandedIds((prev) => {
      const next = new Set(prev);
      let cur = target;
      let changed = false;
      while (cur.parentId) {
        if (!next.has(cur.parentId)) {
          next.add(cur.parentId);
          changed = true;
        }
        cur = docs[cur.parentId];
        if (!cur) break;
      }
      return changed ? next : prev;
    });
  }, [bundle, nodeId]);

  // Track sidebar width via ResizeObserver — debounced with rAF + threshold
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

  // Build flat visible nodes list
  const visibleNodes = useMemo(() => {
    if (!bundle) return [];
    const { byParent } = bundle;
    const result: VisibleNode[] = [];
    function walk(parentId: string | null) {
      for (const node of byParent.get(parentId) ?? []) {
        const hasChildren = byParent.has(node.id);
        const treeDepth = realDepth(node.doc_no);
        result.push({ node, hasChildren, treeDepth });
        if (hasChildren && expandedIds.has(node.id)) {
          walk(node.id);
        }
      }
    }
    walk(null);
    return result;
  }, [bundle, expandedIds]);

  // Find selected index and scroll to it
  const selectedIndex = useMemo(() => {
    if (!nodeId) return -1;
    return visibleNodes.findIndex((v) => v.node.id === nodeId);
  }, [visibleNodes, nodeId]);

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

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
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
  }, [visibleNodes, focusedIndex, selectedIndex, expandedIds, listRef, onNavigate]);

  const handleRowClick = useCallback((id: string) => {
    clickedRef.current = true;
    setFocusedIndex(-1);
    onNavigate(id);
  }, [onNavigate]);

  const rowProps: TreeRowData = useMemo(() => ({
    visibleNodes,
    selectedIndex,
    focusedIndex,
    expandedIds,
    sidebarWidth,
    onNavigate: handleRowClick,
    onToggle: toggleExpand,
  }), [visibleNodes, selectedIndex, focusedIndex, expandedIds, sidebarWidth, handleRowClick, toggleExpand]);

  if (!bundle) return <div className="tree-sidebar" ref={containerRef} />;

  return (
    <div className="tree-sidebar" ref={containerRef} tabIndex={0} onKeyDown={handleKeyDown} style={{ outline: "none" }}>
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

const TreeRow = memo(function TreeRow({
  index,
  style,
  visibleNodes,
  selectedIndex,
  focusedIndex,
  expandedIds,
  sidebarWidth,
  onNavigate,
  onToggle,
}: RowComponentProps<TreeRowData>) {
  const item = visibleNodes[index];
  if (!item) return null;
  const { node, hasChildren, treeDepth } = item;
  const isSelected = index === selectedIndex;
  const isFocused = index === focusedIndex;
  const isExpanded = expandedIds.has(node.id);
  const depthVar = `var(--depth-${Math.min(Math.max(treeDepth, 1), 17)})`;

  const docNumWidth = node.doc_no.length * 4;
  const availableWidth = sidebarWidth - 5 - docNumWidth - TOGGLE_WIDTH - PAD_X - 6;

  const displayTitle = useMemo(
    () => truncateTitle(node.title, Math.max(availableWidth, 20)),
    [node.title, availableWidth]
  );

  const docNoSegments = useMemo(() => {
    const parts = node.doc_no.split(".");
    const depths = segmentDepths(node.doc_no);
    return { parts, depths, needsPad: parts[parts.length - 1].length < 2 };
  }, [node.doc_no]);

  const boxShadow = isSelected
    ? `inset 2px 0 0 ${depthVar}`
    : isFocused
      ? `inset 2px 0 0 var(--tan-3), inset 0 0 0 1px rgba(255, 255, 255, 0.1)`
      : undefined;

  return (
    <div
      style={{ ...style, ...ROW_LAYOUT_STYLE, boxShadow }}
      className={`tree-row ${isSelected ? "is-selected" : ""} ${isFocused ? "is-focused" : ""}`}
      onClick={() => onNavigate(node.id)}
    >
      {/* Doc number — each segment colored by its semantic depth */}
      <span className="mono" style={DOC_NUM_STYLE}>
        {docNoSegments.parts.map((seg, i) => (
          <span key={i}>
            {i > 0 && <span style={DOT_STYLE}>.</span>}
            <span style={{ color: docNoSegments.depths[i] === 0 ? "var(--gray)" : `var(--depth-${Math.min(docNoSegments.depths[i], 17)})` }}>{seg}</span>
          </span>
        ))}
        {docNoSegments.needsPad && <span style={HIDDEN_PAD_STYLE}>0</span>}
      </span>

      {/* Toggle */}
      <span
        className="tree-toggle"
        style={{ ...TOGGLE_BASE, color: hasChildren ? "var(--tan-3)" : "transparent" }}
        onClick={hasChildren ? (e) => onToggle(node.id, e) : undefined}
      >
        {hasChildren ? (isExpanded ? "\u25BE" : "\u25B8") : "\u00B7"}
      </span>

      {/* Title */}
      <span
        className="tree-title"
        style={{ ...TITLE_BASE, color: depthVar }}
        title={node.doc_no + " \u2014 " + node.title}
      >
        {displayTitle}
      </span>
    </div>
  );
});
