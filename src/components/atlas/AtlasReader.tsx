import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  type ReactElement,
} from "react";
import { AtlasActionsContext, useAtlasActions } from "./AtlasActionsContext";
import { useExpandAll, collectSubtree } from "./useExpandAll";
import { useDepth6Expand } from "./useDepth6Expand";
import { useAtlasScroll } from "./useAtlasScroll";
import { useExpandingAttr } from "../../hooks/useExpandingAttr";
import { CollapsibleNode } from "./CollapsibleNode";
import { JuniorPane } from "./JuniorPane";
import { usePreviewChangedSet } from "../../lib/previewFilter";
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

  const { fullyExpanded, expandAll } = useExpandAll(data, expandedSet, userToggles, setUserToggles);

  const { expandedParents, hiddenCount, expandParent, setParentsExpanded, entryById } = useDepth6Expand(
    data.flatNodes,
    id,
  );

  const triggerExpandingAnim = useExpandingAttr(scrollContainerRef);
  const handleExpandParent = useCallback((nodeId: string) => {
    expandParent(nodeId);
    triggerExpandingAnim();
  }, [expandParent, triggerExpandingAnim]);

  // Expand-all (double chevron) must also un-gate hidden depth-6+ descendants:
  // expandAll only flips content-toggle state, but gated children stay filtered
  // out of docList until their parent is in expandedParents. Reveal the whole
  // subtree on expand, re-gate it on collapse, so » truly opens everything.
  const handleExpandAll = useCallback((rootId: string, expand: boolean) => {
    expandAll(rootId, expand);
    const ids = collectSubtree(data.atlas.byParent, rootId);
    if (expand) {
      setParentsExpanded(ids, true);
      return;
    }
    // Collapsing a bulk-expanded ancestor must not re-gate the current
    // selection's own revealed path — otherwise a depth-6+ selected node
    // disappears from docList until the user navigates away and back (the
    // auto-reveal effect only re-fires on `id` change).
    const protectedIds = new Set<string>();
    let cur = entryById.get(id);
    while (cur && cur.depth >= 6) {
      const parentId = cur.node.parentId;
      if (!parentId) break;
      protectedIds.add(parentId);
      cur = entryById.get(parentId);
    }
    setParentsExpanded(
      ids.filter((nid) => !protectedIds.has(nid)),
      false,
    );
  }, [expandAll, setParentsExpanded, data, id, entryById]);

  useAtlasScroll(id, data, expandedParents);

  const changedSet = usePreviewChangedSet();

  const docList = useMemo(() => {
    const visible = data.flatNodes.filter((entry) => {
      // "changed only": show exactly the changed/added docs (flat), bypassing
      // the depth-6 gate. Otherwise honor the normal depth gating.
      if (changedSet) return changedSet.has(entry.node.id);
      return !(entry.depth >= 6 && !expandedParents.has(entry.node.parentId ?? ""));
    });
    // Cradle: the selected node's visible descendants are the contiguous run
    // of deeper entries right after it (flatNodes is DFS document order).
    // They get a left rail in the selected node's color, closed under the
    // last one by a curved foot. Disabled in "changed only" preview mode,
    // where the visible list is a flat, non-contiguous subset.
    let cradleStart = -1;
    let cradleEnd = -1;
    let cradleColor: string | undefined;
    const selIdx = selectedId ? visible.findIndex((e) => e.node.id === selectedId) : -1;
    if (!changedSet && selIdx >= 0) {
      const selDepth = visible[selIdx].depth;
      let i = selIdx + 1;
      while (i < visible.length && visible[i].depth > selDepth) i++;
      if (i > selIdx + 1) {
        cradleStart = selIdx + 1;
        cradleEnd = i - 1;
        cradleColor = visible[selIdx].color;
      }
    }
    const items: ReactElement[] = visible.map((entry, idx) => {
      const gatedCount = expandedParents.has(entry.node.id) ? 0 : (hiddenCount.get(entry.node.id) ?? 0);
      const cradle =
        cradleStart >= 0 && idx >= cradleStart && idx <= cradleEnd
          ? idx === cradleEnd
            ? ("foot" as const)
            : ("line" as const)
          : undefined;
      return (
        <CollapsibleNode
          key={entry.node.id}
          entry={entry}
          isSelected={entry.node.id === selectedId}
          isExpanded={expandedSet.has(entry.node.id) !== userToggles.has(entry.node.id)}
          hasChildren={data.atlas.byParent.has(entry.node.id)}
          isSubtreeExpanded={fullyExpanded.has(entry.node.id)}
          hiddenCount={gatedCount}
          onExpandChildren={handleExpandParent}
          cradle={cradle}
          cradleColor={cradle ? cradleColor : undefined}
        />
      );
    });
    // Wrap the selected node + its cradle descendants in one group so the
    // selected node's position:sticky is bounded to that group. It stays pinned
    // to the top while any of the selection is on screen, then scrolls off with
    // it once the lowest descendant (the cradle foot) clears the top — rather
    // than staying stuck all the way down the rest of the list. With no visible
    // descendants the group is just the selected node, so it scrolls normally.
    if (selIdx >= 0) {
      const groupEnd = cradleStart >= 0 ? cradleEnd : selIdx;
      return [
        ...items.slice(0, selIdx),
        <div key="__selection-group" className="selection-group">
          {items.slice(selIdx, groupEnd + 1)}
        </div>,
        ...items.slice(groupEnd + 1),
      ];
    }
    return items;
  }, [data, selectedId, expandedSet, userToggles, fullyExpanded, expandedParents, hiddenCount, handleExpandParent, changedSet]);

  return (
    <AtlasActionsContext.Provider value={{ navigate, toggle: handleToggle, splitNavigate, expandAll: handleExpandAll }}>
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
