import { memo, useMemo, useRef } from "react";
import { segmentDepths, nrChiclets } from "../../lib/depth";
import { type FlatEntry } from "../../lib/atlasHelpers";
import { DocNoChiclets } from "../DocNoChiclets";
import { NodeContent } from "../NodeContent";
import { NodeMeta } from "./NodeMeta";
import { NodeCopyLink } from "./NodeCopyLink";
import { NodeAtlasLink } from "./NodeAtlasLink";
import { useAtlasActions } from "./AtlasActionsContext";
import { useCopyState } from "../../hooks/useCopyState";
import { revealStore } from "../../lib/revealStore";
import { PreviewMark } from "../preview/PreviewMark";
import { usePreviewDim } from "../../lib/previewFilter";
import { useDataSource } from "../../lib/dataSource";
import { track } from "../../lib/analytics";

const DRAG_THRESHOLD_PX = 4;

// Body indent so expanded text lines up with where the title text begins:
// pl-3 (12) + gap-2 (8) + toggle (14) + gap-2 (8) + expand-all (14) + gap-2 (8)
// + title margin+padding (5), plus 15px per chiclet segment (.atlas-chiclet
// width — keep in sync with index.css).
const TITLE_TEXT_OFFSET = 69;
const CHICLET_W = 15;

const TITLE_CLASS = "text-lg font-bold";

export const CollapsibleNode = memo(function CollapsibleNode({
  entry,
  isSelected,
  isExpanded,
  hasChildren = false,
  isSubtreeExpanded = false,
  hiddenCount = 0,
  onExpandChildren,
  idPrefix,
  cradle,
  cradleColor,
}: {
  entry: FlatEntry;
  isSelected: boolean;
  isExpanded: boolean;
  hasChildren?: boolean;
  isSubtreeExpanded?: boolean;
  hiddenCount?: number;
  onExpandChildren?: (id: string) => void;
  idPrefix?: string;
  /** Row is part of the selected node's descendant rail; "foot" closes it. */
  cradle?: "line" | "foot";
  cradleColor?: string;
}) {
  const { navigate, toggle, splitNavigate, expandAll } = useAtlasActions();
  const isPreview = !!useDataSource().preview;
  const { node, depth, color, hasContent } = entry;
  const HeadingTag = `h${Math.min(depth, 6)}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  // NR-X nodes carry an opaque global number ("NR-12"), not a positional doc_no.
  // Render the bare token: the "NR-" prefix is neutral (depth 0), the number takes
  // the node's true depth colour — the parent context lives in the tree.
  // Memoised so DocNoChiclets (also memo'd) gets stable array references and
  // skips re-render when only isSelected/isExpanded changes on this node.
  const { docNoParts, docNoDepths } = useMemo(() => {
    if (node.doc_no.startsWith("NR-")) {
      const { parts, depths } = nrChiclets(node.doc_no, depth);
      return { docNoParts: parts, docNoDepths: depths };
    }
    return {
      docNoParts: node.doc_no.split("."),
      docNoDepths: segmentDepths(node.doc_no),
    };
  }, [node.doc_no, depth]);
  const docNoCopy = useCopyState();
  const mouseDownRef = useRef<{ x: number; y: number } | null>(null);
  // Selected node always full-strength; otherwise dim untouched docs in preview.
  const dim = usePreviewDim(node.id) && !isSelected;

  const showExpandAll = hasChildren && !!expandAll;
  // Expanding (not collapsing) also asks the tree sidebar to reveal the node.
  const doToggle = () => {
    track("reader_node_toggle", { node_id: node.id, action: isExpanded ? "collapse" : "expand" });
    if (!isExpanded) revealStore.reveal([node.id]);
    toggle(node.id);
  };
  const doExpandAll = () => {
    track("reader_expand_all", { node_id: node.id, action: isSubtreeExpanded ? "collapse" : "expand" });
    expandAll?.(node.id, !isSubtreeExpanded);
  };

  return (
    <article
      id={idPrefix ? `${idPrefix}-${node.id}` : node.id}
      className={`atlas-node relative${isSelected ? " is-selected" : ""}${
        cradle ? ` in-cradle${cradle === "foot" ? " cradle-foot" : ""}` : ""
      }`}
      data-has-hidden={hiddenCount > 0 ? "true" : undefined}
      style={
        {
          ["--row-color" as string]: color,
          opacity: dim ? 0.92 : undefined,
          ...(cradleColor ? { ["--cradle-color" as string]: cradleColor } : {}),
        } as React.CSSProperties
      }
      aria-label={`${node.doc_no} — ${node.title}`}
      aria-expanded={hasContent ? isExpanded : undefined}
      tabIndex={0}
      onMouseDown={(e: React.MouseEvent) => {
        mouseDownRef.current = { x: e.clientX, y: e.clientY };
      }}
      onClick={(e: React.MouseEvent) => {
        if ((e.target as Element).closest('a, button, [role="button"]')) return;
        // Drag-text-select fires a click on mouseup — skip those so selecting
        // a paragraph doesn't also toggle or navigate the row.
        const down = mouseDownRef.current;
        mouseDownRef.current = null;
        if (down) {
          const dx = Math.abs(e.clientX - down.x);
          const dy = Math.abs(e.clientY - down.y);
          if (dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX) return;
        }
        // inRowBar = click landed on the title row (chiclets/title), not the expanded body. See data-row-bar attr below.
        const inRowBar = !!(e.target as Element).closest("[data-row-bar]");
        if (e.shiftKey) {
          e.preventDefault();
          splitNavigate(node.id);
          return;
        }
        if (!isSelected) {
          // Click anywhere on the row (title or body) selects it.
          track("reader_title_click", { node_id: node.id });
          navigate(node.id);
          return;
        }
        // Already selected: only title-bar clicks toggle the body. Body clicks do nothing.
        if (inRowBar && hasContent) doToggle();
      }}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (isSelected && hasContent) {
            doToggle();
          } else {
            navigate(node.id);
          }
        }
      }}
    >
      {/* data-row-bar: marker the outer onClick uses to distinguish title-bar clicks from body clicks (see handler above). */}
      <div data-row-bar className="flex items-center gap-2 pl-3">
        <button
          type="button"
          className="atlas-docno-copy"
          data-copied={docNoCopy.copied ? "true" : undefined}
          title={docNoCopy.copied ? "Copied!" : `Copy ${node.doc_no}`}
          aria-label={`Copy doc number ${node.doc_no}`}
          onClick={(e) => {
            e.stopPropagation();
            docNoCopy.copy(node.doc_no);
          }}
        >
          <DocNoChiclets parts={docNoParts} depths={docNoDepths} />
          {/* Swaps in over the first chiclet on hover (CSS) — see .atlas-docno-copy. */}
          <svg
            className="atlas-docno-copy-icon"
            width="11"
            height="11"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <rect x="4" y="4" width="7" height="7" rx="1" />
            <path d="M1 8V2C1 1.45 1.45 1 2 1H8" />
          </svg>
        </button>
        {hasContent ? (
          <button
            type="button"
            className={`atlas-node-toggle${isExpanded ? " is-open" : ""}`}
            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${node.doc_no}`}
            title={showExpandAll ? "alt-click: expand/collapse all beneath" : undefined}
            onClick={(e) => (e.altKey && showExpandAll ? doExpandAll() : doToggle())}
          >
            ›
          </button>
        ) : (
          <span className="atlas-node-toggle" style={{ visibility: "hidden" }} aria-hidden="true">
            {"›"}
          </span>
        )}
        {showExpandAll ? (
          <button
            type="button"
            className={`atlas-node-toggle atlas-node-expand-all${isSubtreeExpanded ? " is-open" : ""}`}
            aria-label={`${isSubtreeExpanded ? "Collapse" : "Expand"} all sections under ${node.doc_no}`}
            title={isSubtreeExpanded ? "collapse all beneath" : "expand all beneath"}
            onClick={doExpandAll}
          >
            »
          </button>
        ) : (
          <span className="atlas-node-toggle" style={{ visibility: "hidden" }} aria-hidden="true">
            {"»"}
          </span>
        )}
        {isPreview && <PreviewMark nodeId={node.id} className="text-lg" />}
        <div className="atlas-node-title flex items-center gap-2 py-1.5 flex-1 min-w-0">
          <HeadingTag className={TITLE_CLASS}>
            {node.title}
          </HeadingTag>
        </div>
        {isSelected && (
          <div className="atlas-node-corner">
            <NodeCopyLink node={node} />
            <NodeAtlasLink node={node} />
          </div>
        )}
      </div>

      {hiddenCount > 0 && onExpandChildren && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            track("reader_reveal_hidden", { node_id: node.id, hidden_count: hiddenCount });
            onExpandChildren(node.id);
          }}
          title={`View ${hiddenCount} hidden ${hiddenCount === 1 ? "section" : "sections"} under ${node.doc_no}`}
          aria-label={`View ${hiddenCount} hidden sections`}
          className="view-children-affordance"
        >
          <span>{hiddenCount} hidden</span>
          <svg
            width="8"
            height="5"
            viewBox="0 0 8 5"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M0 0 L8 0 L4 5 Z" />
          </svg>
        </button>
      )}
      {isExpanded && hasContent && (
        <div className="atlas-node-expanded flex items-start">
          <div
            className="atlas-node-gutter shrink-0 pl-3"
            style={{ width: TITLE_TEXT_OFFSET + CHICLET_W * docNoParts.length }}
          >
            {isSelected && (
              <NodeMeta node={node} gutterWidth={TITLE_TEXT_OFFSET + CHICLET_W * docNoParts.length} />
            )}
          </div>
          <div className="atlas-node-body flex-1 min-w-0">
            <NodeContent content={node.content} onNavigate={navigate} />
          </div>
        </div>
      )}
    </article>
  );
});
