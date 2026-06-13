import { memo, useMemo, useRef } from "react";
import { segmentDepths } from "../../lib/depth";
import { type FlatEntry } from "../../lib/atlasHelpers";
import { DocNoChiclets } from "../DocNoChiclets";
import { NodeContent } from "../NodeContent";
import { NodeMeta } from "./NodeMeta";
import { useAtlasActions } from "./AtlasActionsContext";
import { revealStore } from "../../lib/revealStore";

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
  parentDocNo,
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
  parentDocNo?: string;
  onExpandChildren?: (id: string) => void;
  idPrefix?: string;
  /** Row is part of the selected node's descendant rail; "foot" closes it. */
  cradle?: "line" | "foot";
  cradleColor?: string;
}) {
  const { navigate, toggle, splitNavigate, expandAll } = useAtlasActions();
  const { node, depth, color, hasContent } = entry;
  const HeadingTag = `h${Math.min(depth, 6)}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  // NR-X nodes are leaves attached to regular tree nodes. The doc_no is opaque
  // ("NR-2"), so derive the chiclet strip from the parent's path plus one
  // trailing chiclet for the NR itself — that way the chiclets reflect the
  // actual nesting position rather than the bare "NR-X" token.
  // Memoised so DocNoChiclets (also memo'd) gets stable array references and
  // skips re-render when only isSelected/isExpanded changes on this node.
  const { docNoParts, docNoDepths } = useMemo(() => {
    const isNR = node.doc_no.startsWith("NR-");
    const src = isNR && parentDocNo ? `${parentDocNo}.x` : node.doc_no;
    return {
      docNoParts: src.split("."),
      docNoDepths: src.startsWith("NR-") ? [1] : segmentDepths(src),
    };
  }, [node.doc_no, parentDocNo]);
  const mouseDownRef = useRef<{ x: number; y: number } | null>(null);

  const showExpandAll = hasChildren && !!expandAll;
  // Expanding (not collapsing) also asks the tree sidebar to reveal the node.
  const doToggle = () => {
    if (!isExpanded) revealStore.reveal([node.id]);
    toggle(node.id);
  };
  const doExpandAll = () => expandAll?.(node.id, !isSubtreeExpanded);

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
        <DocNoChiclets parts={docNoParts} depths={docNoDepths} />
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
        <div className="atlas-node-title flex items-center gap-2 py-1.5 flex-1 min-w-0">
          <HeadingTag className={TITLE_CLASS}>
            {node.title}
          </HeadingTag>
        </div>
      </div>
      {isSelected && <div className="atlas-node-meta"><NodeMeta node={node} /></div>}

      {hiddenCount > 0 && onExpandChildren && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
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
        <div
          className="atlas-node-body"
          style={{ marginLeft: TITLE_TEXT_OFFSET + CHICLET_W * docNoParts.length }}
        >
          <NodeContent content={node.content} onNavigate={navigate} />
        </div>
      )}
    </article>
  );
});
