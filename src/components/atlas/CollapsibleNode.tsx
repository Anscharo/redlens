import { memo, useMemo, useRef, useEffect } from "react";
import { segmentDepths, nrChiclets } from "../../lib/depth";
import { type FlatEntry } from "../../lib/atlasHelpers";
import { DocNoChiclets } from "../DocNoChiclets";
import { NodeContent } from "../NodeContent";
import { NodeMeta } from "./NodeMeta";
import { useAtlasActions } from "./AtlasActionsContext";
import { revealStore } from "../../lib/revealStore";
import { PreviewMark } from "../preview/PreviewMark";
import { usePreviewDim } from "../../lib/previewFilter";
import { useDataSource } from "../../lib/dataSource";
import { useSelection } from "../../lib/selection";
import { useSelectionSet } from "../../lib/selectionFilter";
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
  agentName,
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
  /** Owning prime/executor agent name — shown as a pill under the doc number
   *  whenever the row is expanded. Undefined for docs not under an agent. */
  agentName?: string | null;
}) {
  const { navigate, toggle, splitNavigate, expandAll, selectSubtree } = useAtlasActions();
  const isPreview = !!useDataSource().preview;
  const { ids: selectedIds, selectionMode, toggleDoc } = useSelection();
  const inSelectedOnly = !!useSelectionSet();
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
  // Instant click feedback for expand-all: expanding a large subtree blocks the
  // main thread, so the CSS .is-open rotation (which keys off isSubtreeExpanded)
  // only lands after the work finishes — the click feels dead. A Web Animation on
  // the chevron runs on the compositor, so it turns to its target angle and gives
  // a slight pop the moment the click registers, playing through the jank. CSS
  // takes the angle back over once the expand lands (see the effect below).
  const expandAllRef = useRef<HTMLButtonElement>(null);
  const spinRef = useRef<Animation | null>(null);
  const pulseRef = useRef<Animation | null>(null);
  const doExpandAll = () => {
    track("reader_expand_all", { node_id: node.id, action: isSubtreeExpanded ? "collapse" : "expand" });
    const willOpen = !isSubtreeExpanded;
    const btn = expandAllRef.current;
    if (btn?.animate) {
      const from = isSubtreeExpanded ? 90 : 0;
      const to = willOpen ? 90 : 0;
      spinRef.current?.cancel();
      // rotate (transform) held via fill:forwards until CSS .is-open catches up
      spinRef.current = btn.animate(
        [{ transform: `rotate(${from}deg)` }, { transform: `rotate(${to}deg)` }],
        { duration: 200, easing: "ease-out", fill: "forwards" },
      );
      // pulse: a looping bright scale-up "working…" beat via the independent
      // scale/opacity props (they compose with the rotate above instead of
      // fighting it). Runs on the compositor, so it keeps pulsing through the
      // expand's main-thread jank; the effect below stops it once .is-open lands.
      pulseRef.current?.cancel();
      pulseRef.current = btn.animate(
        [
          { scale: "1", opacity: "1" },
          { scale: "1.4", opacity: "1", offset: 0.5 },
          { scale: "1", opacity: "1" },
        ],
        { duration: 520, easing: "ease-in-out", iterations: Infinity },
      );
      // Defer the heavy expand two frames so the chevron feedback commits to the
      // compositor and PAINTS first. Running expandAll now would let React flush
      // the large synchronous re-render in this same task, before the browser
      // ever paints the animation — so it'd only appear once the expand is done.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => expandAll?.(node.id, willOpen)),
      );
    } else {
      expandAll?.(node.id, willOpen);
    }
  };
  // Once CSS .is-open reflects the new state (the expand finished), stop the
  // "working…" pulse and release the WAAPI rotation hold — hover/steady styles
  // resume and both sit at the same angle, so there's no visible jump.
  useEffect(() => {
    pulseRef.current?.cancel();
    pulseRef.current = null;
    spinRef.current?.cancel();
    spinRef.current = null;
  }, [isSubtreeExpanded]);

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
      {selectionMode && (
        <label
          className="atlas-node-select absolute top-2 right-2"
          aria-label={`Select ${node.title}`}
          title="shift-click: also select everything beneath"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={selectedIds.has(node.id)}
            onChange={(e) => {
              e.stopPropagation();
              // Shift-click selects this doc + all its descendants; a plain click
              // toggles just this one. The change event's native mouse event
              // carries the shift state.
              if ((e.nativeEvent as MouseEvent).shiftKey && selectSubtree) {
                selectSubtree(node.id);
              } else {
                toggleDoc(node.id);
              }
            }}
          />
        </label>
      )}
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
            ref={expandAllRef}
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
      </div>
      {isSelected && <div className="atlas-node-meta"><NodeMeta node={node} /></div>}

      {/* In selected-only mode the reader shows a flat list that ignores depth-6
          gating, so revealing hidden descendants is a no-op — hide the affordance
          rather than offer a dead button. */}
      {hiddenCount > 0 && onExpandChildren && !inSelectedOnly && (
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
      {isExpanded && (hasContent || agentName) && (
        <div className="flex items-start">
          {/* Left gutter: the owning-agent pill, aligned under the doc-number
              chiclets and never wider than them — a long name wraps to further
              (centered) lines within that width. The column reserves the full
              doc-number indent so the body keeps the exact left edge it had with
              no pill. */}
          <div
            className="shrink-0 pl-3"
            style={{ width: TITLE_TEXT_OFFSET + CHICLET_W * docNoParts.length, marginTop: 4.5 }}
          >
            {agentName && (
              <span className="atlas-agent-pill" style={{ maxWidth: CHICLET_W * docNoParts.length }}>
                {agentName}
              </span>
            )}
          </div>
          {hasContent && (
            <div className="atlas-node-body flex-1 min-w-0" style={{ marginLeft: 0 }}>
              <NodeContent content={node.content} onNavigate={navigate} />
            </div>
          )}
        </div>
      )}
    </article>
  );
});
