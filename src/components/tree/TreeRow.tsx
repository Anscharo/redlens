import { useMemo } from "react";
import { type RowComponentProps } from "react-window";
import { segmentDepths, chicletColor } from "../../lib/depth";
import type { AtlasNode } from "../../types";
import { truncateTitle } from "../../lib/treeUtils";
import { DocNoChiclets } from "../DocNoChiclets";

export const ROW_HEIGHT = 26;
const TOGGLE_WIDTH = 12;
const PAD_X = 3;

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
  onShiftNavigate?: (id: string) => void;
}

const TOGGLE_BASE: React.CSSProperties = {
  width: TOGGLE_WIDTH,
  textAlign: "center",
  flexShrink: 0,
  fontSize: 16,
  userSelect: "none",
};
const TITLE_BASE: React.CSSProperties = {
  flex: 1,
  marginLeft: 5,
  fontSize: 13,
  overflow: "hidden",
  whiteSpace: "nowrap",
  letterSpacing: "0.05em",
};
const ROW_LAYOUT_STYLE: React.CSSProperties = {
  paddingLeft: 5,
  paddingRight: PAD_X,
  display: "flex",
  alignItems: "center",
  gap: 2,
};

export function TreeRow({
  index,
  style,
  visibleNodes,
  selectedIndex,
  focusedIndex,
  expandedIds,
  sidebarWidth,
  onNavigate,
  onToggle,
  onShiftNavigate,
}: RowComponentProps<TreeRowData>) {
  const item = visibleNodes[index];
  const node = item?.node;
  const title = node?.title ?? "";
  const docNo = node?.doc_no ?? "";
  const treeDepth = item?.treeDepth ?? 0;

  const docNoSegments = useMemo(() => {
    if (!docNo) return { parts: [] as string[], depths: [] as number[], width: 0 };
    const parts = docNo.split(".");
    // NR-X nodes have a single opaque token; colour it at the node's actual tree depth
    // rather than letting segmentDepths fall back to 1.
    const depths = docNo.startsWith("NR-") ? [treeDepth] : segmentDepths(docNo);
    // chiclet width = ~7 px/char + ~6 px (padding+border) per segment, no dots
    const width = parts.reduce((sum, seg) => sum + Math.max(13, seg.length * 7 + 6), 0);
    return { parts, depths, width };
  }, [docNo, treeDepth]);

  const availableWidth = sidebarWidth - 5 - docNoSegments.width - TOGGLE_WIDTH - PAD_X - 6 - 5;

  const displayTitle = useMemo(
    () => (title ? truncateTitle(title, Math.max(availableWidth, 20)) : ""),
    [title, availableWidth],
  );

  if (!item || !node) return null;
  const { hasChildren } = item;
  const isSelected = index === selectedIndex;
  const isFocused = index === focusedIndex;
  const isExpanded = expandedIds.has(node.id);
  const titleColor = chicletColor(docNoSegments.depths[docNoSegments.depths.length - 1] ?? 0);
  const depthVar = `var(--depth-${Math.min(Math.max(treeDepth, 1), 17)})`;
  const selectedBar = `color-mix(in srgb, ${depthVar} 80%, var(--row-bar-tint))`;
  const boxShadow = isSelected
    ? `inset 3px 0 0 ${selectedBar}`
    : isFocused
      ? `inset 2px 0 0 var(--tan-3), inset 0 0 0 1px var(--row-hover)`
      : undefined;

  return (
    <div
      data-node-id={node.id}
      style={{ ...style, ...ROW_LAYOUT_STYLE, boxShadow, ["--row-color" as string]: depthVar }}
      className={`tree-row ${isSelected ? "is-selected" : ""} ${isFocused ? "is-focused" : ""}`}
      onClick={(e) => {
        if (e.shiftKey && onShiftNavigate) {
          e.preventDefault();
          onShiftNavigate(node.id);
        } else onNavigate(node.id);
      }}
    >
      <span
        className="tree-toggle"
        style={{
          ...TOGGLE_BASE,
          color: hasChildren ? (isExpanded ? titleColor : "var(--tan-3)") : "transparent",
        }}
        onClick={hasChildren ? (e) => onToggle(node.id, e) : undefined}
      >
        {hasChildren ? (isExpanded ? "\u25BE" : "\u25B8") : "\u00B7"}
      </span>
      <DocNoChiclets parts={docNoSegments.parts} depths={docNoSegments.depths} />
      <span
        style={{ ...TITLE_BASE, color: titleColor }}
        title={node.doc_no + " \u2014 " + node.title}
      >
        {displayTitle}
      </span>
    </div>
  );
}
