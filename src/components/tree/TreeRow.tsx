import { useMemo } from "react";
import { type RowComponentProps } from "react-window";
import { segmentDepths, chicletColor, nrSidebarChiclets } from "../../lib/depth";
import type { AtlasNode } from "../../types";
import { truncateTitle } from "../../lib/treeUtils";
import { DocNoChiclets } from "../DocNoChiclets";
import { Tooltip } from "../Tooltip";
import { PreviewMark } from "../preview/PreviewMark";
import { PreviewRollupBadge } from "../preview/PreviewRollupBadge";
import { usePreviewDim } from "../../lib/previewFilter";

export const ROW_HEIGHT = 29;
const TOGGLE_WIDTH = 12;
const PAD_X = 3;
// Sidebar scrollbar width — keep in sync with the 8px ::-webkit-scrollbar in
// index.css. Reserved from the title budget so long titles and their ellipsis
// don't render under the scrollbar.
const SCROLLBAR_W = 8;
// Approx rendered width of the rollup badge (border + padding + digits + flex
// gap) — subtracted from the title budget when the badge shows so the title
// truncates instead of clipping. Scales with digit count so a multi-digit count
// (12, 300) doesn't over-budget the title.
function rollupBadgeWidth(count: number): number {
  return Math.max(14, String(count).length * 7 + 8) + 2; // +2 for the flex gap
}

export interface VisibleNode {
  node: AtlasNode;
  hasChildren: boolean;
  treeDepth: number;
  parentDocNo?: string;
}

export interface TreeRowData {
  visibleNodes: VisibleNode[];
  selectedIndex: number;
  focusedIndex: number;
  expandedIds: Set<string>;
  rollup: Map<string, { count: number; depth: number }>;
  flashing: ReadonlySet<string>;
  isPreview: boolean;
  sidebarWidth: number;
  cradle: { start: number; end: number; color: string } | null;
  onNavigate: (id: string) => void;
  onToggle: (id: string, e: React.MouseEvent) => void;
  onReveal: (id: string) => void;
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
  rollup,
  flashing,
  isPreview,
  sidebarWidth,
  cradle,
  onNavigate,
  onToggle,
  onReveal,
  onShiftNavigate,
}: RowComponentProps<TreeRowData>) {
  const item = visibleNodes[index];
  const node = item?.node;
  const title = node?.title ?? "";
  const docNo = node?.doc_no ?? "";
  const treeDepth = item?.treeDepth ?? 0;
  const parentDocNo = item?.parentDocNo;
  const dim = usePreviewDim(node?.id ?? "");

  const docNoSegments = useMemo(() => {
    type Seg = {
      parts: string[];
      depths: number[];
      slots: number[] | undefined;
      gradients: (string | undefined)[] | undefined;
      width: number;
    };
    if (!docNo) return { parts: [], depths: [], slots: undefined, gradients: undefined, width: 0 } as Seg;
    // NR-X nodes: "NR" under the parent's first segment, dash stretched (with a
    // gradient line) so the number sits one column past the parent, aligned with
    // the node's siblings.
    if (docNo.startsWith("NR-")) {
      const { parts, depths, slots, gradients } = nrSidebarChiclets(docNo, parentDocNo, treeDepth);
      const width = parts.reduce((sum, seg, i) => sum + Math.max(12, seg.length * 7 + 6) * slots[i], 0);
      return { parts, depths, slots, gradients, width } as Seg;
    }
    const parts = docNo.split(".");
    const depths = segmentDepths(docNo);
    // chiclet width = ~7 px/char + ~6 px (padding+border) per segment, no dots
    const width = parts.reduce((sum, seg) => sum + Math.max(13, seg.length * 7 + 6), 0);
    return { parts, depths, slots: undefined, gradients: undefined, width } as Seg;
  }, [docNo, treeDepth, parentDocNo]);

  // The rollup badge sits between the mark and the title (collapsed rows only),
  // so claw back its width from the title budget when it's showing.
  const rollupEntry = isPreview && node ? rollup.get(node.id) : undefined;
  const showRollup = !!node && !expandedIds.has(node.id) && (rollupEntry?.count ?? 0) > 0;
  const availableWidth =
    sidebarWidth - SCROLLBAR_W - 5 - docNoSegments.width - TOGGLE_WIDTH - PAD_X - 6 - 5 -
    (showRollup ? rollupBadgeWidth(rollupEntry?.count ?? 0) : 0);

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
  const inCradle = !!cradle && index >= cradle.start && index <= cradle.end;
  const cradleClass = inCradle ? (index === cradle!.end ? "in-cradle cradle-foot" : "in-cradle") : "";

  return (
    <div
      data-node-id={node.id}
      style={{
        ...style,
        ...ROW_LAYOUT_STYLE,
        boxShadow,
        opacity: dim ? 0.86 : undefined,
        ["--row-color" as string]: depthVar,
        ...(inCradle ? { ["--cradle-color" as string]: cradle!.color } : {}),
      }}
      className={`tree-row ${isSelected ? "is-selected" : ""} ${isFocused ? "is-focused" : ""} ${flashing.has(node.id) ? "is-change-flash" : ""} ${cradleClass}`}
      onClick={(e) => {
        if (e.shiftKey && onShiftNavigate) {
          e.preventDefault();
          onShiftNavigate(node.id);
        } else onNavigate(node.id);
      }}
    >
      {hasChildren ? (
        <Tooltip content="TIP: navigate sidebar with keyboard arrow keys">
          <span
            className="tree-toggle"
            style={{ ...TOGGLE_BASE, color: isExpanded ? titleColor : "var(--tan-3)" }}
            onClick={(e) => onToggle(node.id, e)}
          >
            {isExpanded ? "\u25BE" : "\u25B8"}
          </span>
        </Tooltip>
      ) : (
        <span
          className="tree-toggle tree-toggle-empty"
          style={{ ...TOGGLE_BASE, color: "transparent" }}
        >
          {"\u00B7"}
        </span>
      )}
      <DocNoChiclets
        parts={docNoSegments.parts}
        depths={docNoSegments.depths}
        slots={docNoSegments.slots}
        gradients={docNoSegments.gradients}
      />
      {isPreview && (
        <>
          <PreviewMark nodeId={node.id} className="text-[13px] ml-0.5" />
          <PreviewRollupBadge
            key={node.id}
            entry={rollupEntry}
            expanded={isExpanded}
            onReveal={() => onReveal(node.id)}
            className="text-[10px]"
          />
        </>
      )}
      <span
        style={{ ...TITLE_BASE, color: titleColor }}
        title={node.doc_no + " \u2014 " + node.title}
      >
        {displayTitle}
      </span>
    </div>
  );
}
