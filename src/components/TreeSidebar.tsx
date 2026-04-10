import { useState, useEffect, useRef, useMemo, useCallback, memo } from "react";
import { List, useListRef } from "react-window";
import { prepareWithSegments, layoutWithLines, type PreparedTextWithSegments } from "@chenglou/pretext";
import { useAtlasTree } from "../hooks/useAtlasTree";
import { realDepth, type AtlasNode } from "../types";

const ROW_HEIGHT = 20;
const FONT = "10px Lora";
const TOGGLE_WIDTH = 14;
const PAD_X = 6;

interface VisibleNode {
  node: AtlasNode;
  hasChildren: boolean;
  treeDepth: number; // actual tree depth (not capped at 6)
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
  return result.lines[0].text.trimEnd() + "…";
}

interface Props {
  nodeId: string | null;
  onNavigate: (id: string) => void;
}

// Props passed to each row via rowProps
interface TreeRowData {
  visibleNodes: VisibleNode[];
  selectedIndex: number;
  expandedIds: Set<string>;
  sidebarWidth: number;
  onNavigate: (id: string) => void;
  onToggle: (id: string, e: React.MouseEvent) => void;
}

export function TreeSidebar({ nodeId, onNavigate }: Props) {
  const bundle = useAtlasTree();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useListRef();

  // Initialize expanded state: depths 1–3
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

  // Track sidebar width via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSidebarWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
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

  const rowProps: TreeRowData = useMemo(() => ({
    visibleNodes,
    selectedIndex,
    expandedIds,
    sidebarWidth,
    onNavigate,
    onToggle: toggleExpand,
  }), [visibleNodes, selectedIndex, expandedIds, sidebarWidth, onNavigate, toggleExpand]);

  if (!bundle) return <div className="tree-sidebar" ref={containerRef} />;

  return (
    <div className="tree-sidebar" ref={containerRef}>
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

type TreeRowProps = {
  ariaAttributes: Record<string, unknown>;
  index: number;
  style: React.CSSProperties;
} & TreeRowData;

const TreeRow = memo(function TreeRow({
  index,
  style,
  visibleNodes,
  selectedIndex,
  expandedIds,
  sidebarWidth,
  onNavigate,
  onToggle,
}: TreeRowProps) {
  const item = visibleNodes[index];
  if (!item) return null;
  const { node, hasChildren, treeDepth } = item;
  const isSelected = index === selectedIndex;
  const isExpanded = expandedIds.has(node.id);
  const indent = 3;
  const depthVar = `var(--depth-${Math.min(Math.max(treeDepth, 1), 17)})`;

  const docNumWidth = node.doc_no.length * 4; // ~4px per char at 7px mono
  const availableWidth = sidebarWidth - indent - 2 - docNumWidth - TOGGLE_WIDTH - PAD_X - 6;
  const displayTitle = truncateTitle(node.title, Math.max(availableWidth, 20));

  return (
    <div
      style={{
        ...style,
        paddingLeft: indent + 2,
        paddingRight: PAD_X,
        boxShadow: isSelected ? `inset 2px 0 0 ${depthVar}` : undefined,
        display: "flex",
        alignItems: "center",
        gap: 2,
      }}
      className={`tree-row ${isSelected ? "is-selected" : ""}`}
      onClick={() => onNavigate(node.id)}
    >
      {/* Doc number — pad last segment to 2 chars for alignment */}
      <span
        className="mono"
        style={{
          flexShrink: 0,
          fontSize: 7,
          color: "var(--gray)",
          userSelect: "none",
        }}
      >
        {node.doc_no}
        {node.doc_no.split(".").pop()!.length < 2 && <span style={{ visibility: "hidden" }}>0</span>}
      </span>

      {/* Toggle */}
      <span
        className="tree-toggle"
        style={{
          width: TOGGLE_WIDTH,
          textAlign: "center",
          flexShrink: 0,
          fontSize: 8,
          color: hasChildren ? "var(--tan-3)" : "transparent",
          userSelect: "none",
        }}
        onClick={hasChildren ? (e) => onToggle(node.id, e) : undefined}
      >
        {hasChildren ? (isExpanded ? "▾" : "▸") : "·"}
      </span>

      {/* Title */}
      <span
        className="tree-title"
        style={{
          color: depthVar,
          flex: 1,
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}
        title={node.doc_no + " — " + node.title}
      >
        {displayTitle}
      </span>
    </div>
  );
});
