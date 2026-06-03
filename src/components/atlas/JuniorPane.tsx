import { useState, useEffect, useCallback, useMemo, type ReactElement } from "react";
import { buildAncestors, type LoadedData } from "../../lib/atlasHelpers";
import { CollapsibleNode } from "./CollapsibleNode";
import { AtlasActionsContext } from "./AtlasActionsContext";

const ViewChildrenFill = ({ docNo, onExpand }: { docNo: string; onExpand: () => void }) => (
  <button
    type="button"
    onClick={onExpand}
    className="view-children-fill w-full text-center mono text-[10px] text-tan-3 bg-transparent cursor-pointer"
  >
    view all descendants of {docNo}
  </button>
);
import { type FlatEntry } from "../../lib/atlasHelpers";
import { depthColor, realDepth } from "../../lib/depth";

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
    const docNoPrefix = node.doc_no + ".";
    const slice: FlatEntry[] = [entry];
    let hasMore = false;
    for (const e of data.flatNodes) {
      if (e.node.doc_no.startsWith(docNoPrefix)) {
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
    <div className="flex flex-col" style={{ flex: "0 0 45%", minHeight: 0, overflow: "hidden" }}>
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
                href={`/atlas?id=${a.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  onShiftNavigate(a.id);
                }}
                className="hover:text-tan"
                style={{ 
                  color:  `var(--tan3)`,
                }}
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
      <div className="overflow-y-auto flex-1">
        <div className="mx-auto px-3 py-2">
          <AtlasActionsContext.Provider value={ctxValue}>{items}</AtlasActionsContext.Provider>
        </div>
      </div>
    </div>
  );
}
