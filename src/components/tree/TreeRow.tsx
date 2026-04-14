import { useMemo } from "react";
import { type RowComponentProps } from "react-window";
import { segmentDepths, type AtlasNode } from "../../types";
import { truncateTitle } from "../../lib/treeUtils";

export const ROW_HEIGHT = 20;
export const TOGGLE_WIDTH = 14;
export const PAD_X = 6;

export interface VisibleNode {
  node: AtlasNode;
  hasChildren: boolean;
  treeDepth: number;
}

export interface TreeRowData {
  visibleNodes: VisibleNode[];
  selectedIndex: number;
  focusedIndex: number;
  expandedIds: Set<string>;
  sidebarWidth: number;
  onNavigate: (id: string) => void;
  onToggle: (id: string, e: React.MouseEvent) => void;
}

const DOC_NUM_STYLE: React.CSSProperties = {
  flexShrink: 0, fontSize: 8, userSelect: "none", display: "inline-flex", alignItems: "center",
};
const DOT_STYLE: React.CSSProperties = { color: "var(--gray)" };
const HIDDEN_PAD_STYLE: React.CSSProperties = { visibility: "hidden" };
const TOGGLE_BASE: React.CSSProperties = {
  width: TOGGLE_WIDTH, textAlign: "center", flexShrink: 0, fontSize: 9, userSelect: "none",
};
const TITLE_BASE: React.CSSProperties = { flex: 1, overflow: "hidden", whiteSpace: "nowrap" };
export const ROW_LAYOUT_STYLE: React.CSSProperties = {
  paddingLeft: 5, paddingRight: PAD_X, display: "flex", alignItems: "center", gap: 2,
};

export function TreeRow({
  index, style,
  visibleNodes, selectedIndex, focusedIndex, expandedIds, sidebarWidth, onNavigate, onToggle,
}: RowComponentProps<TreeRowData>) {
  const item = visibleNodes[index];
  const node = item?.node;
  const title = node?.title ?? "";
  const docNo = node?.doc_no ?? "";

  const docNumWidth = docNo.length * 4;
  const availableWidth = sidebarWidth - 5 - docNumWidth - TOGGLE_WIDTH - PAD_X - 6;

  const displayTitle = useMemo(
    () => title ? truncateTitle(title, Math.max(availableWidth, 20)) : "",
    [title, availableWidth]
  );

  if (!item) return null;
  const { hasChildren, treeDepth } = item;

  const docNoSegments = useMemo(() => {
    if (!docNo) return { parts: [] as string[], depths: [] as number[], needsPad: false };
    const parts = docNo.split(".");
    // NR-X nodes have a single opaque token; colour it at the node's actual tree depth
    // rather than letting segmentDepths fall back to 1.
    const depths = docNo.startsWith("NR-") ? [treeDepth] : segmentDepths(docNo);
    return { parts, depths, needsPad: parts[parts.length - 1].length < 2 };
  }, [docNo, treeDepth]);
  const isSelected = index === selectedIndex;
  const isFocused = index === focusedIndex;
  const isExpanded = expandedIds.has(node!.id);
  const depthVar = `var(--depth-${Math.min(Math.max(treeDepth, 1), 17)})`;
  const boxShadow = isSelected
    ? `inset 2px 0 0 ${depthVar}`
    : isFocused ? `inset 2px 0 0 var(--tan-3), inset 0 0 0 1px rgba(255, 255, 255, 0.1)` : undefined;

  return (
    <div
      style={{ ...style, ...ROW_LAYOUT_STYLE, boxShadow }}
      className={`tree-row ${isSelected ? "is-selected" : ""} ${isFocused ? "is-focused" : ""}`}
      onClick={() => onNavigate(node.id)}
    >
      <span className="mono" style={DOC_NUM_STYLE}>
        {docNoSegments.parts.map((seg, i) => (
          <span key={i}>
            {i > 0 && <span style={DOT_STYLE}>.</span>}
            <span style={{ color: docNoSegments.depths[i] === 0 ? "var(--gray)" : `var(--depth-${Math.min(docNoSegments.depths[i], 17)})` }}>{seg}</span>
          </span>
        ))}
        {docNoSegments.needsPad && <span style={HIDDEN_PAD_STYLE}>0</span>}
      </span>
      <span
        className="tree-toggle"
        style={{ ...TOGGLE_BASE, color: hasChildren ? "var(--tan-3)" : "transparent" }}
        onClick={hasChildren ? (e) => onToggle(node.id, e) : undefined}
      >
        {hasChildren ? (isExpanded ? "\u25BE" : "\u25B8") : "\u00B7"}
      </span>
      <span
        className="tree-title"
        style={{ ...TITLE_BASE, color: depthVar }}
        title={node.doc_no + " \u2014 " + node.title}
      >
        {displayTitle}
      </span>
    </div>
  );
}
