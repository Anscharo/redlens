import { useState, useEffect, useCallback, useMemo, type ReactElement } from "react";
import { buildAncestors, type FlatEntry, type LoadedData } from "../../lib/atlasHelpers";
import { CollapsibleNode } from "./CollapsibleNode";
import { AtlasActionsContext } from "./AtlasActionsContext";
import { useSplitHeight } from "./useSplitHeight";
import { depthColor, realDepth } from "../../lib/depth";

const ViewChildrenFill = ({ docNo, onExpand }: { docNo: string; onExpand: () => void }) => (
  <button
    type="button"
    onClick={onExpand}
    className="view-children-fill w-full text-center mono text-[10px] text-tan-3 bg-transparent cursor-pointer"
  >
    view all descendants of {docNo}
  </button>
);

const DEPTH_LIMIT = 6;

const TopNote = () => (
  <div
    className="mono text-[10px] py-1 text-tan-3"
    style={{ opacity: 0.55, borderBottom: "1px solid var(--border)" }}
  >
    SplitView only renders selected doc and its children — Shift-Click a doc to view it here.
  </div>
);

const NoMoreNote = ({ docNo }: { docNo: string }) => (
  <div
    className="mono text-[10px] py-1 text-tan-3"
    style={{ opacity: 0.55, borderTop: "1px solid var(--border)" }}
  >
    no more descendants of {docNo} to view
  </div>
);

export function JuniorPane({
  splitId,
  data,
  onShiftNavigate,
  onClose,
}: {
  splitId: string;
  data: LoadedData;
  onShiftNavigate: (id: string) => void;
  onClose: () => void;
}) {
  const [userToggles, setUserToggles] = useState<Set<string>>(new Set());
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    setUserToggles(new Set());
    setShowMore(false);
  }, [splitId]);

  const handleToggle = useCallback((nodeId: string) => {
    setUserToggles((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  // JuniorPane styles the current node differently from the rest of the chain, so it keeps using buildAncestors and renders the current segment separately. See buildAncestorsWithSelf in atlasHelpers if that ever changes.
  const ancestors = useMemo(
    () => buildAncestors(data.atlas.docs, data.atlas.docNoToId, splitId),
    [data, splitId],
  );

  const { slice, hasMore, autoExpanded } = useMemo(() => {
    const node = data.atlas.docs[splitId];
    if (!node) return { slice: [] as FlatEntry[], hasMore: false, autoExpanded: new Set<string>() };
    const entry = data.flatNodes.find((e) => e.node.id === splitId);
    if (!entry)
      return { slice: [] as FlatEntry[], hasMore: false, autoExpanded: new Set<string>() };
    const maxDepth = entry.depth + DEPTH_LIMIT;

    // Collect descendants via parent links (byParent), not doc_no prefix —
    // doc_nos are editorial and get renumbered, parent ids are stable identity.
    const descendantIds = new Set<string>();
    const stack = [splitId];
    while (stack.length) {
      for (const child of data.atlas.byParent.get(stack.pop()!) ?? []) {
        descendantIds.add(child.id);
        stack.push(child.id);
      }
    }

    const slice: FlatEntry[] = [entry];
    let hasMore = false;
    for (const e of data.flatNodes) {
      if (descendantIds.has(e.node.id)) {
        if (e.depth <= maxDepth || showMore) slice.push(e);
        else hasMore = true;
      }
    }
    const autoExpanded = new Set<string>([splitId]);
    return { slice, hasMore, autoExpanded };
  }, [data, splitId, showMore]);

  const node = data.atlas.docs[splitId];
  const docNo = node?.doc_no ?? "";
  const hasAbove = ancestors.length > 0;

  const { paneRef, scrollerRef, contentRef, height, startResize } = useSplitHeight();

  const ctxValue = useMemo(
    () => ({ navigate: onShiftNavigate, toggle: handleToggle, splitNavigate: onShiftNavigate }),
    [onShiftNavigate, handleToggle],
  );

  const items = useMemo(() => {
    const result: ReactElement[] = [];
    if (hasAbove) result.push(<TopNote key="top" />);
    for (const entry of slice) {
      result.push(
        <CollapsibleNode
          key={entry.node.id}
          entry={entry}
          idPrefix="junior"
          isSelected={entry.node.id === splitId}
          isExpanded={autoExpanded.has(entry.node.id) !== userToggles.has(entry.node.id)}
        />,
      );
    }
    if (hasMore)
      result.push(
        <ViewChildrenFill
          key="bottom"
          docNo={docNo}
          onExpand={() => setShowMore(true)}
        />,
      );
    else result.push(<NoMoreNote key="bottom" docNo={docNo} />);
    return result;
  }, [
    slice,
    hasMore,
    hasAbove,
    splitId,
    docNo,
    autoExpanded,
    userToggles,
  ]);

  return (
    // junior-pane: index.css suppresses the shift-click split hint in here —
    // this pane already is the split view.
    <div
      ref={paneRef}
      className="junior-pane flex flex-col"
      style={{
        // Falls back to the 45% default until the column has been measured.
        flex: height == null ? "0 0 45%" : `0 0 ${height}px`,
        minHeight: 0,
        overflow: "hidden",
        // Positioning context for the drag handle — the pane's own overflow
        // would otherwise clip a handle anchored to an ancestor.
        position: "relative",
      }}
    >
      {/* Drag the top edge to resize, like the sidebars' vertical handles.
          Inside the pane (not at top: -3) because overflow: hidden clips it.
          TODO: mouse-only — not focusable, no role/keyboard resizing. Follow-up
          PR: make this an accessible separator with arrow-key resize. */}
      <div
        onMouseDown={startResize}
        title="Drag to resize"
        style={{ position: "absolute", left: 0, right: 0, top: 0, height: 6, cursor: "row-resize", zIndex: 10 }}
      />
      <div
        className="flex items-center gap-1 px-3 py-1 shrink-0 mono text-xs overflow-hidden"
        style={{
          borderTop: "2px solid var(--border)",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg)",
        }}
      >
        <span className="truncate flex-1 text-tan-3">
          {ancestors.map((a, i) => (
            <span key={a.id}>
              {i > 0 && <span> / </span>}
              <a
                href={`${import.meta.env.BASE_URL}atlas?id=${a.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  onShiftNavigate(a.id);
                }}
                className="hover:text-tan"
                style={{ color: "var(--tan-3)" }}
              >
                {a.title}
              </a>
            </span>
          ))}
          {node && (
            <span>
              {ancestors.length > 0 && <span> / </span>}
              <span style={{ color: `color-mix(in srgb,${depthColor(realDepth(node.doc_no))} 75%, white)` }}>{node.title}</span>
            </span>
          )}
        </span>
        <button type="button" onClick={onClose} className="shrink-0 px-1 text-tan-3 hover:text-tan">
          ✕
        </button>
      </div>
      <div ref={scrollerRef} className="overflow-y-auto flex-1">
        <div ref={contentRef} className="mx-auto px-3 py-2">
          <AtlasActionsContext.Provider value={ctxValue}>{items}</AtlasActionsContext.Provider>
        </div>
      </div>
    </div>
  );
}
