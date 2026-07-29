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
  type FlatEntry,
  type LoadedData,
} from "../../lib/atlasHelpers";

type HiddenSubtreeSnapshot = {
  userToggles: Set<string>;
  expandedParents: Set<string>;
  hiddenSubtrees: Set<string>;
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

// A row's on-screen subtree is the contiguous run of following rows indented
// deeper than it (flatNodes is display order, `depth` is the doc-number
// realDepth used for indentation). This is what the user sees as "beneath" a
// node, and it can differ from the parentId subtree when the heading-level-6 cap
// reparents a deeply-numbered doc — so hiding, counting, and selection all key
// off this visual span instead of parentId, keeping what disappears matched to
// what looked nested.
function visualSubtreeIds(flatNodes: FlatEntry[], rootId: string): string[] {
  const i = flatNodes.findIndex((e) => e.node.id === rootId);
  if (i < 0) return [];
  const rootDepth = flatNodes[i].depth;
  const ids: string[] = [];
  for (let j = i + 1; j < flatNodes.length && flatNodes[j].depth > rootDepth; j++) {
    ids.push(flatNodes[j].node.id);
  }
  return ids;
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

  // expandedSet gets a fresh identity on every navigation; read it through a ref
  // so setNodeExpanded stays referentially stable. It feeds handleHideSubtree and
  // thus the actions-context object — if it churned per navigation, every
  // CollapsibleNode (a context consumer) would re-render on each doc click.
  const expandedSetRef = useRef(expandedSet);
  expandedSetRef.current = expandedSet;
  const setNodeExpanded = useCallback((nodeId: string, expand: boolean) => {
    setUserToggles((prev) => {
      const next = new Set(prev);
      const auto = expandedSetRef.current.has(nodeId);
      const shouldToggle = expand ? !auto : auto;
      if (shouldToggle) next.add(nodeId);
      else next.delete(nodeId);
      return next;
    });
  }, []);

  const {
    expandedParents,
    setParentsExpanded,
    mergeParentsExpanded,
  } = useDepth6Expand(data.flatNodes, id);

  // Latest-value refs for the state handleHideSubtree snapshots. Reading these
  // (instead of closing over the values) keeps handleHideSubtree — and the whole
  // actions-context object built from it — referentially stable across ordinary
  // body toggles. Without this, every expand/collapse recreated the context and
  // re-rendered every memo'd CollapsibleNode, defeating the memo boundary during
  // the most frequent interaction. The snapshot reads happen in click handlers,
  // by which point this effect has already synced the refs.
  const userTogglesRef = useRef(userToggles);
  const expandedParentsRef = useRef(expandedParents);
  const hiddenSubtreesRef = useRef(hiddenSubtrees);
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    userTogglesRef.current = userToggles;
    expandedParentsRef.current = expandedParents;
    hiddenSubtreesRef.current = hiddenSubtrees;
    selectedIdRef.current = selectedId;
  });

  // Size of each node's on-screen subtree (the deeper-indented run that follows
  // it). Single O(n) pass with a depth stack. Used for the "N hidden" count so
  // it matches exactly the rows a hide removes.
  const visualSpanCount = useMemo(() => {
    const counts = new Map<string, number>();
    const entries = data.flatNodes;
    const stack: { id: string; index: number; depth: number }[] = [];
    for (let i = 0; i < entries.length; i++) {
      const d = entries[i].depth;
      while (stack.length && stack[stack.length - 1].depth >= d) {
        const top = stack.pop()!;
        counts.set(top.id, i - top.index - 1);
      }
      stack.push({ id: entries[i].node.id, index: i, depth: d });
    }
    for (const top of stack) counts.set(top.id, entries.length - top.index - 1);
    return counts;
  }, [data.flatNodes]);

  // Nodes that gate deeper-than-level-6 rows by default: the on-screen parent of
  // any row at depth >= 6. Data-derived, so "hidden because it's deep" needs no
  // separate code path from "hidden on purpose" — both are just collapsed roots.
  const defaultGateRoots = useMemo(() => {
    const roots = new Set<string>();
    const stack: { id: string; depth: number }[] = [];
    for (const entry of data.flatNodes) {
      while (stack.length && stack[stack.length - 1].depth >= entry.depth) stack.pop();
      if (entry.depth >= 6 && stack.length) roots.add(stack[stack.length - 1].id);
      stack.push({ id: entry.node.id, depth: entry.depth });
    }
    return roots;
  }, [data.flatNodes]);

  // A doc reached from the sidebar (or any in-app link) may live inside a
  // collapsed tree. Navigating to it must reveal it AND its siblings: walk its
  // VISUAL ancestor chain and fully un-collapse each one — drop any intent-hide
  // and open any default gate. Visual (not parentId) so it also reveals rows the
  // heading-depth cap reparented, where a parentId walk would open the wrong gate.
  useEffect(() => {
    if (!id) return;
    const entries = data.flatNodes;
    const i = entries.findIndex((e) => e.node.id === id);
    if (i < 0) return;
    const ancestors: string[] = [];
    let depth = entries[i].depth;
    for (let j = i - 1; j >= 0 && depth > 0; j--) {
      if (entries[j].depth < depth) {
        depth = entries[j].depth;
        ancestors.push(entries[j].node.id);
      }
    }
    // Un-hide the ANCESTORS only — not the doc itself. Navigating to a collapsed
    // root (its own subtree hidden) should keep it collapsed: the doc is already
    // visible, and we don't want to auto-expand its subtree. This also lets a
    // hide operation move selection onto the very root it collapsed.
    setHiddenSubtrees((prev) => {
      if (!prev.size) return prev;
      const next = new Set(prev);
      let changed = false;
      for (const a of ancestors) if (next.delete(a)) changed = true;
      return changed ? next : prev;
    });
    // Open only the gate ancestors (idempotent — a no-op when the row is already
    // visible, so plain navigation between shown docs doesn't spuriously reveal).
    const gateAncestors = ancestors.filter((a) => defaultGateRoots.has(a));
    if (gateAncestors.length) setParentsExpanded(gateAncestors, true);
  }, [id, data.flatNodes, defaultGateRoots, setParentsExpanded]);

  // THE single "is this subtree collapsed" predicate. A subtree is collapsed if
  // the user closed it (intent) OR it's a default depth-6 gate the user hasn't
  // opened (default). The ONLY difference between the two cases is this data
  // lookup — the filter, the count, and the visual state below are identical.
  const isCollapsed = useCallback(
    (nodeId: string) =>
      hiddenSubtrees.has(nodeId) || (defaultGateRoots.has(nodeId) && !expandedParents.has(nodeId)),
    [hiddenSubtrees, defaultGateRoots, expandedParents],
  );

  // Every row hidden by a collapsed ancestor. One O(n) pass over the on-screen
  // order: a row is hidden iff any of its visual ancestors is collapsed. Nested
  // collapsed roots stay collapsed roots, so per-level disclosure (open one gate,
  // its children appear but their own gates stay shut) falls out for free.
  const hiddenNodeIds = useMemo(() => {
    const hidden = new Set<string>();
    const stack: { depth: number; collapsed: boolean }[] = [];
    let collapsedOnStack = 0;
    for (const entry of data.flatNodes) {
      while (stack.length && stack[stack.length - 1].depth >= entry.depth) {
        if (stack.pop()!.collapsed) collapsedOnStack--;
      }
      if (collapsedOnStack > 0) hidden.add(entry.node.id);
      const collapsed = isCollapsed(entry.node.id);
      stack.push({ depth: entry.depth, collapsed });
      if (collapsed) collapsedOnStack++;
    }
    return hidden;
  }, [data.flatNodes, isCollapsed]);

  const handleHideSubtree = useCallback((rootId: string, hidden: boolean, options?: { restore?: boolean }) => {
    // Hide the VISUAL subtree (what looks nested on screen), not the parentId
    // subtree — the two diverge under the heading-depth cap (see visualSubtreeIds).
    const subtreeIds = visualSubtreeIds(data.flatNodes, rootId);
    // Restore scope includes rootId itself, so restoring re-opens the root's OWN
    // depth-6 gate (and its body toggle) that hiding closed. Without it, a node
    // whose deep children were revealed before hiding stays gated after restore —
    // children never reappear and the reader "working…" pulse spins forever.
    const scope = new Set([rootId, ...subtreeIds]);
    if (hidden) {
      hiddenSnapshotsRef.current.set(rootId, {
        userToggles: new Set(userTogglesRef.current),
        expandedParents: new Set(expandedParentsRef.current),
        // Nested branches the user had hidden inside this one — recorded so a
        // later restore brings back their hidden state too, not just the
        // expand/collapse shape of the rows around them.
        hiddenSubtrees: new Set(
          [...hiddenSubtreesRef.current].filter((nid) => nid !== rootId && scope.has(nid)),
        ),
      });
    }
    const snapshot = !hidden ? hiddenSnapshotsRef.current.get(rootId) : undefined;
    const restoring = !hidden && !!options?.restore && !!snapshot;
    setHiddenSubtrees((prev) => {
      const next = new Set(prev);
      for (const nid of subtreeIds) {
        if (nid !== rootId) next.delete(nid);
      }
      if (hidden) next.add(rootId);
      else {
        next.delete(rootId);
        // Restore re-hides the nested branches captured at hide time; a plain
        // un-hide (e.g. the "N hidden" tab) leaves them all shown.
        if (restoring && snapshot) for (const nid of snapshot.hiddenSubtrees) next.add(nid);
      }
      return next;
    });
    if (!hidden) {
      hiddenSnapshotsRef.current.delete(rootId);
      if (restoring && snapshot) {
        // Only the branch's own portion is restored (#177): merge the snapshot
        // over the branch's subtree ids, leaving unrelated reader state intact.
        setUserToggles((prev) => mergeSubtreeSnapshot(prev, snapshot.userToggles, scope));
        mergeParentsExpanded(snapshot.expandedParents, scope);
      }
    }
    if (hidden) {
      setNodeExpanded(rootId, false);
      // If the active selection sits inside the branch we're hiding, it would
      // vanish. Move selection onto the branch root itself — the doc whose
      // chevron was clicked — so focus lands on the collapsed row rather than
      // disappearing. The root stays hidden because the reveal-on-nav effect only
      // un-hides ancestors, never the navigated doc.
      const sel = selectedIdRef.current;
      if (sel && sel !== rootId && subtreeIds.includes(sel)) {
        navigate(rootId);
      }
    }
  }, [data, mergeParentsExpanded, setNodeExpanded, navigate]);

  const handleSetSubtreeVisualState = useCallback((
    rootId: string,
    state: SubtreeVisualState,
    options?: { restore?: boolean },
  ) => {
    if (options?.restore) {
      handleHideSubtree(rootId, false, options);
      return;
    }
    // Reveal/re-gate the whole VISUAL span (the on-screen subtree), including the
    // root's own gate — one span notion for both default gates and explicit hides.
    const span = [rootId, ...visualSubtreeIds(data.flatNodes, rootId)];
    if (state === "hidden") {
      handleHideSubtree(rootId, true);
      setParentsExpanded(span, false);
      return;
    }
    handleHideSubtree(rootId, false);
    expandAll(rootId, state === "open");
    setParentsExpanded(span, true);
  }, [data, expandAll, setParentsExpanded, handleHideSubtree]);

  const triggerExpandingAnim = useExpandingAttr(scrollContainerRef);
  // The "N hidden" tab reveals every row beneath the node, left collapsed (bodies
  // closed). Same behavior whether the rows were hidden by default (depth-6 gate)
  // or on purpose — the collapse model no longer distinguishes them here.
  const handleExpandParent = useCallback((nodeId: string) => {
    handleSetSubtreeVisualState(nodeId, "closed");
    triggerExpandingAnim();
  }, [handleSetSubtreeVisualState, triggerExpandingAnim]);

  const handleExpandAll = useCallback((rootId: string, expand: boolean) => {
    handleSetSubtreeVisualState(rootId, expand ? "open" : "closed");
  }, [handleSetSubtreeVisualState]);

  const changedSet = usePreviewChangedSet();
  const selectionSet = useSelectionSet();
  const filterSet = changedSet ?? selectionSet;

  // Re-scroll to the selected doc whenever the view mode flips, so leaving
  // "selected only" (or preview "changed only") keeps the current node in view.
  useAtlasScroll(id, data, expandedParents, changedSet ? "changed" : selectionSet ? "selected" : "all");

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
      // The flat filtered list (selected-only / changed-only) is built purely
      // from filterSet — depth-6 gating and explicit hides are hierarchy-view
      // concepts that must NOT apply here, or a matching doc that happens to sit
      // under a collapsed/gated/hidden ancestor would silently vanish from the
      // subset (e.g. changed docs omitted so a review looks complete when it
      // isn't). See AtlasReader.test.tsx "filtered view ignores collapse state".
      const kept: { entry: (typeof data.flatNodes)[number]; i: number; gap: boolean }[] = [];
      let prev = -1;
      data.flatNodes.forEach((entry, i) => {
        if (!filterSet.has(entry.node.id)) return;
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
        const collapsed = isCollapsed(entry.node.id);
        const subtreeState = deriveSubtreeVisualState({
          hidden: collapsed,
          bodiesOpen: fullyExpanded.has(entry.node.id),
        });
        block.push(
          <CollapsibleNode
            key={entry.node.id}
            entry={entry}
            isSelected={entry.node.id === selectedId}
            isExpanded={expandedSet.has(entry.node.id) !== userToggles.has(entry.node.id)}
            hasChildren={filteredParentIds.has(entry.node.id)}
            subtreeState={subtreeState}
            hasExplicitHiddenSubtree={hiddenSubtrees.has(entry.node.id)}
            gatedCount={collapsed ? visualSpanCount.get(entry.node.id) ?? 0 : 0}
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

    // filterSet is null here (the flat filtered view returned above). One filter
    // now covers both default depth-6 gating and explicit hides: a row is out iff
    // it sits under a collapsed ancestor.
    const visible = data.flatNodes.filter((entry) => !hiddenNodeIds.has(entry.node.id));
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
      const collapsed = isCollapsed(entry.node.id);
      const subtreeState = deriveSubtreeVisualState({
        hidden: collapsed,
        bodiesOpen: fullyExpanded.has(entry.node.id),
      });
      const gatedCount = collapsed ? visualSpanCount.get(entry.node.id) ?? 0 : 0;
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
          hasExplicitHiddenSubtree={hiddenSubtrees.has(entry.node.id)}
          gatedCount={gatedCount}
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
  }, [data, selectedId, expandedSet, userToggles, fullyExpanded, handleExpandParent, filterSet, changedSet, selectionSet, filteredParentIds, agentByDoc, hiddenSubtrees, visualSpanCount, hiddenNodeIds, isCollapsed]);

  // Stable actions-context value: rebuilding it every render forced every
  // memo'd CollapsibleNode to re-render on any parent render (e.g. a selection
  // change or an ordinary body toggle). All members are referentially stable
  // across those renders — handleHideSubtree reads its snapshot state through
  // refs rather than closing over it — so memoize the object too.
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
