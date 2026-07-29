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
import { NodeSelectBox } from "./NodeSelectBox";
import { track } from "../../lib/analytics";
import {
  nextSubtreeTransition,
  type SubtreeVisualState,
} from "./subtreeState";

const DRAG_THRESHOLD_PX = 4;

// Body indent so expanded text lines up with where the title text begins:
// pl-3 (12) + gap-2 (8) + expand-all (14) + gap-2 (8) + title margin+padding (5),
// plus 15px per chiclet segment (.atlas-chiclet width — keep in sync with
// index.css).
const TITLE_TEXT_OFFSET = 47;
const CHICLET_W = 15;
// gap-2 (8) + the toggle chevron (14): the agent pill may extend past the doc
// numbers to also cover the chevron column, giving a slightly wider cap.
const CHEVRON_W = 22;

const TITLE_CLASS = "text-lg font-bold";

export const CollapsibleNode = memo(function CollapsibleNode({
  entry,
  isSelected,
  isExpanded,
  hasChildren = false,
  subtreeState = "closed",
  hasExplicitHiddenSubtree = false,
  gatedCount = 0,
  onExpandChildren,
  idPrefix,
  cradle,
  cradleColor,
  agentName,
  inSelectedOnly = false,
}: {
  entry: FlatEntry;
  isSelected: boolean;
  isExpanded: boolean;
  hasChildren?: boolean;
  subtreeState?: SubtreeVisualState;
  hasExplicitHiddenSubtree?: boolean;
  gatedCount?: number;
  onExpandChildren?: (id: string) => void;
  idPrefix?: string;
  /** Row is part of the selected node's descendant rail; "foot" closes it. */
  cradle?: "line" | "foot";
  cradleColor?: string;
  /** Owning prime/executor agent name — shown as a pill under the doc number
   *  whenever the row is expanded. Undefined for docs not under an agent. */
  agentName?: string | null;
  /** "Selected only" view is active — hides the hidden-descendants affordance.
   *  Passed as a prop (not read from selection context) so a selection change
   *  doesn't re-render every row; see NodeSelectBox for the checkbox itself. */
  inSelectedOnly?: boolean;
}) {
  const { navigate, toggle, splitNavigate, expandAll, setSubtreeVisualState } = useAtlasActions();
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
  const mouseDownRef = useRef<{ x: number; y: number } | null>(null);
  // Selected node always full-strength; otherwise dim untouched docs in preview.
  const dim = usePreviewDim(node.id) && !isSelected;

  const isSubtreeExpanded = subtreeState === "open";
  const isSubtreeHidden = subtreeState === "hidden";
  const showExpandAll = hasChildren && (!!setSubtreeVisualState || !!expandAll);
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
  const doExpandAll = (event?: React.MouseEvent) => {
    const transition = nextSubtreeTransition({
      state: subtreeState,
      shiftKey: !!event?.shiftKey,
      hasExplicitHidden: hasExplicitHiddenSubtree,
    });
    track("reader_expand_all", { node_id: node.id, action: transition });
    const willOpen = transition === "open" || transition === "restore";
    // The heavy state update (a large subtree re-render), deferred below so the
    // chevron feedback paints first. Both action models funnel through here: the
    // main reader supplies setSubtreeVisualState (the live path), the standalone
    // fallback supplies expandAll. Either way the deferral + compositor feedback
    // must wrap it — the setSubtreeVisualState branch used to bypass them, which
    // restored the exact click-freeze the animation path exists to prevent.
    const commit = setSubtreeVisualState
      ? () =>
          transition === "restore"
            ? setSubtreeVisualState(node.id, "open", { restore: true })
            : setSubtreeVisualState(node.id, transition)
      : () => expandAll?.(node.id, willOpen);
    const btn = expandAllRef.current;
    if (btn?.animate) {
      const from = isSubtreeHidden ? -90 : isSubtreeExpanded ? 90 : 0;
      const to = transition === "hidden" ? -90 : willOpen ? 90 : 0;
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
      // Defer the heavy commit two frames so the chevron feedback commits to the
      // compositor and PAINTS first. Committing now would let React flush the
      // large synchronous re-render in this same task, before the browser ever
      // paints the animation — so it'd only appear once the expand is done.
      // Backstop: cancel the pulse one frame after the commit even if the subtree
      // state didn't change (a click that reveals nothing) — otherwise the
      // state-keyed effect below never fires and the pulse would spin forever.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          commit();
          requestAnimationFrame(() => {
            pulseRef.current?.cancel();
            pulseRef.current = null;
          });
        }),
      );
    } else {
      commit();
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
  }, [isSubtreeExpanded, isSubtreeHidden]);

  return (
    <article
      id={idPrefix ? `${idPrefix}-${node.id}` : node.id}
      className={`atlas-node relative${isSelected ? " is-selected" : ""}${
        cradle ? ` in-cradle${cradle === "foot" ? " cradle-foot" : ""}` : ""
      }`}
      data-has-hidden={gatedCount > 0 ? "true" : undefined}
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
      <NodeSelectBox nodeId={node.id} title={node.title} />
      {/* data-row-bar: marker the outer onClick uses to distinguish title-bar clicks from body clicks (see handler above). */}
      <div data-row-bar className="flex items-center gap-2 pl-3">
        <DocNoChiclets parts={docNoParts} depths={docNoDepths} />
        {showExpandAll ? (
          <button
            ref={expandAllRef}
            type="button"
            className={`atlas-node-toggle atlas-node-expand-all${
              isSubtreeHidden ? " is-hidden" : isSubtreeExpanded ? " is-open" : ""
            }`}
            aria-label={`${
              isSubtreeHidden
                ? hasExplicitHiddenSubtree ? "Restore hidden" : "Expand hidden"
                : isSubtreeExpanded ? "Collapse" : "Expand"
            } all sections under ${node.doc_no}`}
            title={
              isSubtreeHidden
                ? hasExplicitHiddenSubtree
                  ? "restore hidden descendants"
                  : "expand hidden descendants"
                : isSubtreeExpanded
                  ? "collapse all beneath (shift-click: hide descendants)"
                  : "expand all beneath (shift-click: hide descendants)"
            }
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
      {isSelected && isExpanded && <div className="atlas-node-meta"><NodeMeta node={node} /></div>}

      {/* In selected-only mode the reader shows a flat list that ignores depth-6
          gating, so revealing hidden descendants is a no-op — hide the affordance
          rather than offer a dead button. */}
      {gatedCount > 0 && onExpandChildren && !inSelectedOnly && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            track("reader_reveal_hidden", { node_id: node.id, hidden_count: gatedCount });
            onExpandChildren(node.id);
          }}
          title={`View ${gatedCount} hidden ${gatedCount === 1 ? "section" : "sections"} under ${node.doc_no}`}
          aria-label={`View ${gatedCount} hidden sections`}
          className="view-children-affordance"
        >
          <span>{gatedCount} hidden</span>
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
              <span className="atlas-agent-pill" style={{ maxWidth: CHICLET_W * docNoParts.length + CHEVRON_W }}>
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
