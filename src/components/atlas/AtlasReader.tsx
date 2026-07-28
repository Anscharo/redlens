import {
  memo,
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
import { deriveSubtreeVisualState } from "./subtreeState";
import type { SubtreeVisualState } from "./subtreeState";
import { usePreviewChangedSet } from "../../lib/previewFilter";
import { useSelectionSet } from "../../lib/selectionFilter";
import { useSelection } from "../../lib/selection";
import { ErrorBoundary, PanelError } from "../ErrorBoundary";
import {
  ATLAS_EMPTY_SET,
  ATLAS_LEFT_PANE_STYLE,
  type LoadedData,
} from "../../lib/atlasHelpers";

type HiddenSubtreeSnapshot = {
  userToggles: Set<string>;
  expandedParents: Set<string>;
};

// Restore only the branch's own portion of a reader-wide set: start from the
// current set, then force membership of every id in `scope` (the branch's
// subtree) to match the snapshot. Entries outside the branch are left as they
// are now, so expand/collapse/reveal the user did elsewhere while the branch
// was hidden survive the restore instead of being clobbered.
function mergeSubtreeSnapshot(
  current: Set<string>,
  snapshot: Set<string>,
  scope: Set<string>,
): Set<string> {
  const next = new Set(current);
  for (const id of scope) {
    if (snapshot.has(id)) next.add(id);
    else next.delete(id);
  }
  return next;
}

// memo boundary: AtlasView re-renders on annotation-tab switches and other
// panel state the reader doesn't care about. All props here are stable refs
// (data, agentByDoc memoized; handlers are useCallbacks), so the reader skips
// those re-renders entirely — the panels can never slow it. (Selection changes
// still re-render it shallowly via its own useSelectionSet subscription for the
// "selected only" view, but docList bails when that set is unchanged.)
export const AtlasReader = memo(function AtlasReader({
  id,
  selectedId,
  splitId,
  onSplitChange,
  data,
  agentByDoc,
}: {
  id: string;
  selectedId: string | null;
  splitId: string | null;
  onSplitChange: (id: string | null) => void;
  data: LoadedData;
  agentByDoc?: Map<string, string> | null;
}) {
  const { navigate, splitNavigate } = useAtlasActions();
  const [userToggles, setUserToggles] = useState<Set<string>>(new Set());
  const [hiddenSubtrees, setHiddenSubtrees] = useState<Set<string>>(new Set());
  const seenExpanded = useRef<Set<string>>(new Set());
  const hiddenSnapshotsRef = useRef<Map<string, HiddenSubtreeSnapshot>>(new Map());
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

  const setNodeExpanded = useCallback((nodeId: string, expand: boolean) => {
    setUserToggles((prev) => {
      const next = new Set(prev);
      const auto = expandedSet.has(nodeId);
      const shouldToggle = expand ? !auto : auto;
      if (shouldToggle) next.add(nodeId);
      else next.delete(nodeId);
      return next;
    });
  }, [expandedSet]);

  const {
    expandedParents,
    hiddenCount,
    expandParent,
    setParentsExpanded,
    mergeParentsExpanded,
    entryById,
  } = useDepth6Expand(data.flatNodes, id);

  useEffect(() => {
    if (!id) return;
    setHiddenSubtrees((prev) => {
      if (!prev.size) return prev;
      const next = new Set(prev);
      let cur = entryById.get(id);
      while (cur) {
        next.delete(cur.node.id);
        const parentId = cur.node.parentId;
        if (!parentId) break;
        cur = entryById.get(parentId);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [id, entryById]);

  const descendantCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (let i = data.flatNodes.length - 1; i >= 0; i--) {
      const { node } = data.flatNodes[i];
      const children = data.atlas.byParent.get(node.id) ?? [];
      let count = children.length;
      for (const child of children) count += counts.get(child.id) ?? 0;
      counts.set(node.id, count);
    }
    return counts;
  }, [data]);

  const hasHiddenAncestor = useCallback((nodeId: string) => {
    let parentId = data.atlas.docs[nodeId]?.parentId ?? null;
    while (parentId) {
      if (hiddenSubtrees.has(parentId)) return true;
      parentId = data.atlas.docs[parentId]?.parentId ?? null;
    }
    return false;
  }, [data, hiddenSubtrees]);

  const handleHideSubtree = useCallback((rootId: string, hidden: boolean, options?: { restore?: boolean }) => {
    const subtreeIds = collectSubtree(data.atlas.byParent, rootId);
    if (hidden) {
      hiddenSnapshotsRef.current.set(rootId, {
        userToggles: new Set(userToggles),
        expandedParents: new Set(expandedParents),
      });
    }
    setHiddenSubtrees((prev) => {
      const next = new Set(prev);
      for (const nid of subtreeIds) {
        if (nid !== rootId) next.delete(nid);
      }
      if (hidden) next.add(rootId);
      else next.delete(rootId);
      return next;
    });
    if (!hidden) {
      const snapshot = hiddenSnapshotsRef.current.get(rootId);
      hiddenSnapshotsRef.current.delete(rootId);
      if (options?.restore && snapshot) {
        // Only the branch's own portion is restored (#177): merge the snapshot
        // over the branch's subtree ids, leaving unrelated reader state intact.
        const scope = new Set(subtreeIds);
        setUserToggles((prev) => mergeSubtreeSnapshot(prev, snapshot.userToggles, scope));
        mergeParentsExpanded(snapshot.expandedParents, scope);
      }
    }
    if (hidden) {
      setNodeExpanded(rootId, false);
      // If the active selection sits inside the branch we're hiding, it would
      // vanish with no id-change to recover it (clicking the same sidebar row is
      // a no-op). Move selection up to the branch's parent — outside the hidden
      // subtree, so the row stays visible and the hide sticks (navigating to the
      // root itself would trip the "reveal ancestors of the selection" effect and
      // immediately un-hide it).
      if (selectedId && selectedId !== rootId && subtreeIds.includes(selectedId)) {
        const parentId = data.atlas.docs[rootId]?.parentId ?? null;
        if (parentId) navigate(parentId);
      }
    }
  }, [data, userToggles, expandedParents, mergeParentsExpanded, setNodeExpanded, selectedId, navigate]);

  const handleSetSubtreeVisualState = useCallback((
    rootId: string,
    state: SubtreeVisualState,
    options?: { restore?: boolean },
  ) => {
    if (options?.restore) {
      handleHideSubtree(rootId, false, options);
      return;
    }
    const ids = collectSubtree(data.atlas.byParent, rootId);
    if (state === "hidden") {
      handleHideSubtree(rootId, true);
      setParentsExpanded(ids, false);
      return;
    }
    handleHideSubtree(rootId, false);
    expandAll(rootId, state === "expanded");
    setParentsExpanded(ids, true);
  }, [data, expandAll, setParentsExpanded, handleHideSubtree]);

  const triggerExpandingAnim = useExpandingAttr(scrollContainerRef);
  // The "N hidden" tab means two different things depending on why the rows are
  // hidden:
  //  - an explicitly shift-hidden branch → un-hide and SHOW every row beneath,
  //    but left collapsed (bodies closed) — not expanded. Deliberately distinct
  //    from the up-chevron, which restores the branch's prior shape.
  //  - a depth-6 gated parent → reveal only the gated child rows, never expanding
  //    every body in the branch (#220). That's exactly what expandParent does.
  const handleExpandParent = useCallback((nodeId: string) => {
    if (hiddenSubtrees.has(nodeId)) {
      handleSetSubtreeVisualState(nodeId, "collapsed");
    } else {
      expandParent(nodeId);
    }
    triggerExpandingAnim();
  }, [hiddenSubtrees, handleSetSubtreeVisualState, expandParent, triggerExpandingAnim]);

  const handleExpandAll = useCallback((rootId: string, expand: boolean) => {
    handleSetSubtreeVisualState(rootId, expand ? "expanded" : "collapsed");
  }, [handleSetSubtreeVisualState]);

  useAtlasScroll(id, data, expandedParents);

  const changedSet = usePreviewChangedSet();
  const selectionSet = useSelectionSet();
  const filterSet = changedSet ?? selectionSet;

  // Shift-clicking a doc's selection checkbox selects it + all descendants.
  const { selectSubtree } = useSelection();
  const handleSelectSubtree = useCallback((rootId: string) => {
    selectSubtree(collectSubtree(data.atlas.byParent, rootId));
  }, [selectSubtree, data]);

  // In the flat filtered view, a doc's "expand all children" affordance is only
  // meaningful if it actually has a descendant in the filter set. Collect every
  // ancestor of a matched doc so we can gate the affordance to those parents.
  const filteredParentIds = useMemo(() => {
    const set = new Set<string>();
    if (!filterSet) return set;
    for (const entry of data.flatNodes) {
      if (!filterSet.has(entry.node.id)) continue;
      let pid = entry.node.parentId ?? null;
      while (pid && !set.has(pid)) {
        set.add(pid);
        pid = data.atlas.docs[pid]?.parentId ?? null;
      }
    }
    return set;
  }, [data, filterSet]);

  const docList = useMemo(() => {
    if (filterSet) {
      // Selected-only / changed-only: a flat subset in document order. Between
      // two kept docs that are NOT adjacent in the full atlas order (something
      // was filtered out between them), drop an ellipsis barrier so the gap
      // reads as intentional rather than as true neighbors.
      const kept: { entry: (typeof data.flatNodes)[number]; i: number; gap: boolean }[] = [];
      let prev = -1;
      data.flatNodes.forEach((entry, i) => {
        if (!filterSet.has(entry.node.id)) return;
        if (hasHiddenAncestor(entry.node.id)) return;
        kept.push({ entry, i, gap: prev >= 0 && i - prev > 1 });
        prev = i;
      });

      // Cradle in the selected-only view (not changed-only preview): the selected
      // node's descendants that survive the filter get the rail — even when
      // non-contiguous (docs filtered out between them). We can't use the flat
      // list's adjacency like the unfiltered branch does, so compute the selected
      // node's descendant span in the FULL flatNodes (a contiguous deeper run in
      // DFS order) and mark kept rows whose original index falls inside it; the
      // last such row gets the closing foot.
      let cradleColor: string | undefined;
      let cradleFrom = -1;
      let cradleTo = -1;
      const selFull = !changedSet && selectedId ? data.flatNodes.findIndex((e) => e.node.id === selectedId) : -1;
      if (selFull >= 0) {
        const selDepth = data.flatNodes[selFull].depth;
        let j = selFull + 1;
        while (j < data.flatNodes.length && data.flatNodes[j].depth > selDepth) j++;
        if (j > selFull + 1) {
          cradleFrom = selFull + 1;
          cradleTo = j - 1;
          cradleColor = data.flatNodes[selFull].color;
        }
      }
      let lastCradleKept = -1;
      if (cradleFrom >= 0) {
        kept.forEach((k, idx) => {
          if (k.i >= cradleFrom && k.i <= cradleTo) lastCradleKept = idx;
        });
      }
      const kSel = selectedId ? kept.findIndex((k) => k.entry.node.id === selectedId) : -1;

      // Each kept row → its optional leading gap divider + the node itself.
      const blocks = kept.map(({ entry, i, gap }, k) => {
        const block: ReactElement[] = [];
        if (gap) {
          block.push(
            <div key={`__gap-${entry.node.id}`} className="selection-gap" aria-hidden="true">
              ⋯
            </div>,
          );
        }
        const inCradle = cradleFrom >= 0 && i >= cradleFrom && i <= cradleTo;
        const cradle = inCradle ? (k === lastCradleKept ? ("foot" as const) : ("line" as const)) : undefined;
        const hasExplicitHidden = hiddenSubtrees.has(entry.node.id);
        const subtreeState = deriveSubtreeVisualState({
          hasExplicitHidden,
          hasGatedHidden: false,
          isExpanded: fullyExpanded.has(entry.node.id),
        });
        block.push(
          <CollapsibleNode
            key={entry.node.id}
            entry={entry}
            isSelected={entry.node.id === selectedId}
            isExpanded={expandedSet.has(entry.node.id) !== userToggles.has(entry.node.id)}
            hasChildren={filteredParentIds.has(entry.node.id)}
            subtreeState={subtreeState}
            hasExplicitHiddenSubtree={hasExplicitHidden}
            hiddenCount={
              hasExplicitHidden
                ? descendantCount.get(entry.node.id) ?? 0
                : 0
            }
            onExpandChildren={handleExpandParent}
            cradle={cradle}
            cradleColor={cradle ? cradleColor : undefined}
            agentName={agentByDoc?.get(entry.node.id)}
            inSelectedOnly={!!selectionSet}
          />,
        );
        return block;
      });

      if (kSel < 0) return blocks.flat();
      // Bound the sticky selected node to a group spanning it + its cradle rows,
      // so it stays pinned while the cradle is on screen, then scrolls off with
      // it (matching the unfiltered cradle). With no cradle the group is just the
      // selected node.
      const groupEnd = lastCradleKept >= 0 ? lastCradleKept : kSel;
      return [
        ...blocks.slice(0, kSel).flat(),
        <div key="__selection-group" className="selection-group">
          {blocks.slice(kSel, groupEnd + 1).flat()}
        </div>,
        ...blocks.slice(groupEnd + 1).flat(),
      ];
    }

    // filterSet is null here (the flat filtered view returned above): honor the
    // normal depth-6 gating.
    const visible = data.flatNodes.filter((entry) => {
      if (hasHiddenAncestor(entry.node.id)) return false;
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
    if (!filterSet && selIdx >= 0) {
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
      const hasExplicitHidden = hiddenSubtrees.has(entry.node.id);
      const hasGatedHidden = !hasExplicitHidden && !expandedParents.has(entry.node.id) && (hiddenCount.get(entry.node.id) ?? 0) > 0;
      const subtreeState = deriveSubtreeVisualState({
        hasExplicitHidden,
        hasGatedHidden,
        isExpanded: fullyExpanded.has(entry.node.id),
      });
      const gatedCount = hasExplicitHidden
        ? descendantCount.get(entry.node.id) ?? 0
        : hasGatedHidden ? hiddenCount.get(entry.node.id) ?? 0 : 0;
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
          subtreeState={subtreeState}
          hasExplicitHiddenSubtree={hasExplicitHidden}
          hiddenCount={gatedCount}
          onExpandChildren={handleExpandParent}
          cradle={cradle}
          cradleColor={cradle ? cradleColor : undefined}
          agentName={agentByDoc?.get(entry.node.id)}
          inSelectedOnly={!!selectionSet}
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
  }, [data, selectedId, expandedSet, userToggles, fullyExpanded, expandedParents, hiddenCount, handleExpandParent, filterSet, changedSet, selectionSet, filteredParentIds, agentByDoc, hiddenSubtrees, descendantCount, hasHiddenAncestor]);

  // Stable actions-context value: rebuilding it every render forced every
  // memo'd CollapsibleNode to re-render on any parent render (e.g. a selection
  // change). All members are stable callbacks, so memoize the object too.
  const actions = useMemo(
    () => ({
      navigate,
      toggle: handleToggle,
      splitNavigate,
      expandAll: handleExpandAll,
      hideSubtree: handleHideSubtree,
      setSubtreeVisualState: handleSetSubtreeVisualState,
      selectSubtree: handleSelectSubtree,
    }),
    [navigate, handleToggle, splitNavigate, handleExpandAll, handleHideSubtree, handleSetSubtreeVisualState, handleSelectSubtree],
  );

  return (
    <AtlasActionsContext.Provider value={actions}>
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
            className="absolute top-2 right-[38px] z-10 mono text-[10px] px-1.5 py-0.5 rounded text-tan-3 hover:text-tan"
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
            <ErrorBoundary resetKey={id} fallback={(error) => <PanelError error={error} />}>
              {docList}
            </ErrorBoundary>
          </div>
        </div>
        {splitId && (
          <ErrorBoundary resetKey={splitId} fallback={(error) => <PanelError error={error} />}>
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
});
