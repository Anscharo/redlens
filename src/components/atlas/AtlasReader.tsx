import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  type ReactElement,
} from "react";
import { AtlasActionsContext, useAtlasActions } from "./AtlasActionsContext";
import { useDepth6Expand } from "./useDepth6Expand";
import { useAtlasScroll } from "./useAtlasScroll";
import { useExpandingAttr } from "../../hooks/useExpandingAttr";
import { CollapsibleNode } from "./CollapsibleNode";
import { JuniorPane } from "./JuniorPane";
import { ErrorBoundary, PanelError } from "../ErrorBoundary";
import {
  ATLAS_EMPTY_SET,
  ATLAS_LEFT_PANE_STYLE,
  type LoadedData,
} from "../../lib/atlasHelpers";

export function AtlasReader({
  id,
  selectedId,
  splitId,
  onSplitChange,
  data,
}: {
  id: string;
  selectedId: string | null;
  splitId: string | null;
  onSplitChange: (id: string | null) => void;
  data: LoadedData;
}) {
  const { navigate, splitNavigate } = useAtlasActions();
  const [userToggles, setUserToggles] = useState<Set<string>>(new Set());
  const seenExpanded = useRef<Set<string>>(new Set());
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setUserToggles((prev) => {
      if (!id || !prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, [id]);

  const handleToggle = useCallback((nodeId: string) => {
    setUserToggles((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const expandedSet = useMemo(() => {
    if (!id) return ATLAS_EMPTY_SET;
    if (!data.atlas.docs[id]) return new Set(seenExpanded.current);
    seenExpanded.current.add(id);
    return new Set(seenExpanded.current);
  }, [data, id]);

  const { expandedParents, hiddenCount, expandParent } = useDepth6Expand(
    data.flatNodes,
    id,
  );

  const triggerExpandingAnim = useExpandingAttr(scrollContainerRef);
  const handleExpandParent = useCallback((nodeId: string) => {
    expandParent(nodeId);
    triggerExpandingAnim();
  }, [expandParent, triggerExpandingAnim]);

  useAtlasScroll(id, data, expandedParents);

  const docList = useMemo(() => {
    const items: ReactElement[] = [];
    for (const entry of data.flatNodes) {
      if (entry.depth >= 6 && !expandedParents.has(entry.node.parentId ?? "")) continue;
      const gatedCount = expandedParents.has(entry.node.id) ? 0 : (hiddenCount.get(entry.node.id) ?? 0);
      const parentDocNo = entry.node.parentId
        ? data.atlas.docs[entry.node.parentId]?.doc_no
        : undefined;
      items.push(
        <CollapsibleNode
          key={entry.node.id}
          entry={entry}
          isSelected={entry.node.id === selectedId}
          isExpanded={expandedSet.has(entry.node.id) !== userToggles.has(entry.node.id)}
          hiddenCount={gatedCount}
          parentDocNo={parentDocNo}
          onExpandChildren={handleExpandParent}
        />,
      );
    }
    return items;
  }, [data, selectedId, expandedSet, userToggles, expandedParents, hiddenCount, handleExpandParent]);

  return (
    <AtlasActionsContext.Provider value={{ navigate, toggle: handleToggle, splitNavigate }}>
      <div
        className="relative flex flex-col overflow-hidden flex-1 min-w-0"
        style={{ ...ATLAS_LEFT_PANE_STYLE, minHeight: 0 }}
      >
        {id && !splitId && (
          <button
            type="button"
            title="Open comparison pane (or shift-click any node)"
            onClick={() => onSplitChange(id)}
            aria-label="Open comparison pane"
            className="absolute top-2 right-2 z-10 mono text-[10px] px-1.5 py-0.5 rounded text-tan-3 hover:text-tan"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            <svg
              width="12"
              height="10"
              viewBox="0 0 12 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              aria-hidden="true"
            >
              <rect x="0.5" y="0.5" width="11" height="3.5" rx="0.5" />
              <rect x="0.5" y="6" width="11" height="3.5" rx="0.5" />
            </svg>
          </button>
        )}
        <div ref={scrollContainerRef} className="atlas-scroll overflow-y-auto flex-1" style={{ minHeight: 0 }}>
          <div className="mx-auto py-2">
            <ErrorBoundary resetKey={id} fallback={<PanelError />}>
              {docList}
            </ErrorBoundary>
          </div>
        </div>
        {splitId && (
          <ErrorBoundary resetKey={splitId} fallback={<PanelError />}>
            <JuniorPane
              splitId={splitId}
              data={data}
              onShiftNavigate={onSplitChange}
              onClose={() => onSplitChange(null)}
            />
          </ErrorBoundary>
        )}
      </div>
    </AtlasActionsContext.Provider>
  );
}
