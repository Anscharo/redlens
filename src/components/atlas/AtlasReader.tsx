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
import { useRungs } from "./useRungs";
import { useAtlasScroll } from "./useAtlasScroll";
import { useExpandingAttr } from "../../hooks/useExpandingAttr";
import { CollapsibleNode } from "./CollapsibleNode";
import { JuniorPane } from "./JuniorPane";
import { DEFAULT_RUNG, nextRung, type Rung } from "./subtreeState";
import { revealStore } from "../../lib/revealStore";
import { usePreviewChangedSet } from "../../lib/previewFilter";
import { useSelectionSet } from "../../lib/selectionFilter";
import { useSelection } from "../../lib/selection";
import { ErrorBoundary, PanelError } from "../ErrorBoundary";
import {
  ATLAS_EMPTY_SET,
  ATLAS_LEFT_PANE_STYLE,
  collectSubtree,
  type FlatEntry,
  type LoadedData,
} from "../../lib/atlasHelpers";

// A row's on-screen subtree is the contiguous run of following rows indented
// deeper than it (flatNodes is display order, `depth` is the doc-number
// realDepth used for indentation). This is what the user sees as "beneath" a
// node, and it can differ from the parentId subtree when the heading-level-6
// cap reparents a deeply-numbered doc — so hiding, counting, and selection all
// key off this visual span instead of parentId, keeping what disappears
// matched to what looked nested.
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
  const seenExpanded = useRef<Set<string>>(new Set());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { rung, rungRef, writeRungs, revealTo } = useRungs();

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

  // expandedSet gets a fresh identity on every navigation; read it through a ref
  // so setBodiesExpanded stays referentially stable — it feeds handlePendulum
  // and thus the actions-context object — if it churned per navigation, every
  // CollapsibleNode (a context consumer) would re-render on each doc click.
  const expandedSetRef = useRef(expandedSet);
  expandedSetRef.current = expandedSet;

  // Latest-value refs read inside click handlers / effects so the callbacks
  // that close over them (handlePendulum, the reveal-on-nav effect) stay
  // referentially stable across ordinary navigation.
  const selectedIdRef = useRef(selectedId);
  // Set by handlePendulum just before it moves the selection onto a branch
  // root it just collapsed (see below) — guards the reveal-on-nav effect from
  // instantly re-opening the branch the click just closed.
  const selfCollapsedRef = useRef<string | null>(null);
  // Last id the reveal-on-nav effect actually completed a reveal for — guards
  // a same-id re-fire (the docs-deep phase-2 swap) from re-raising a rung the
  // user just collapsed on the current selection.
  const revealedForIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  });

  // One O(n) depth-stack pass over flatNodes computes two things at once:
  //   - visualSpanCount: size of each node's on-screen subtree (the deeper-
  //     indented run that follows it), for the "N hidden" count so it matches
  //     exactly the rows a collapse removes.
  //   - visualChildren: each node's IMMEDIATE on-screen children — the
  //     pendulum only ever discloses one level, so this is what handlePendulum
  //     and the "N hidden" tab both walk.
  // Both pop the same set (entries with depth >= the current row), so they
  // share the walk; after popping, the stack top is the current row's
  // on-screen parent — free to record once we're there.
  const { visualSpanCount, visualChildren } = useMemo(() => {
    const counts = new Map<string, number>();
    const children = new Map<string, string[]>();
    const entries = data.flatNodes;
    const stack: { id: string; index: number; depth: number }[] = [];
    for (let i = 0; i < entries.length; i++) {
      const d = entries[i].depth;
      while (stack.length && stack[stack.length - 1].depth >= d) {
        const top = stack.pop()!;
        counts.set(top.id, i - top.index - 1);
      }
      if (stack.length) {
        const parentId = stack[stack.length - 1].id;
        const arr = children.get(parentId);
        if (arr) arr.push(entries[i].node.id);
        else children.set(parentId, [entries[i].node.id]);
      }
      stack.push({ id: entries[i].node.id, index: i, depth: d });
    }
    for (const top of stack) counts.set(top.id, entries.length - top.index - 1);
    return { visualSpanCount: counts, visualChildren: children };
  }, [data.flatNodes]);

  // A doc reached from the sidebar (or any in-app link) may live inside a
  // collapsed branch. Navigating to it must reveal it AND its siblings: walk
  // its VISUAL ancestor chain and raise each ancestor to at least rung 1 —
  // revealTo is monotonic and idempotent, so this never lowers a rung or
  // touches body state. Visual (not parentId) so it also reveals rows the
  // heading-depth cap reparented, where a parentId walk would open the wrong
  // branch.
  useEffect(() => {
    if (!id) return;
    // Once we've navigated away from the branch a pendulum click just
    // self-collapsed, the guard below has done its job — clear it so a
    // LATER, unrelated return to the same id behaves like an ordinary fresh
    // navigation (raises the target's rung again).
    if (selfCollapsedRef.current && selfCollapsedRef.current !== id) {
      selfCollapsedRef.current = null;
    }
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
    revealTo(ancestors, 1);
    // Raising the TARGET itself to rung 1 is what makes a deep link show its
    // children's titles on arrival. Guarded against two self-undo loops:
    //   - a pendulum click that just collapsed this exact id and moved
    //     selection onto it (selfCollapsedRef) — re-raising would instantly
    //     reopen what the click just closed.
    //   - a same-id re-fire from the docs-deep phase-2 swap (revealedForIdRef)
    //     — without it, the phase-2 pass would re-raise a rung the user just
    //     closed on the current selection.
    // Set AFTER the i < 0 bail (not before): the phase-1 run (docs-shallow,
    // target not yet loaded) bails without recording, so the phase-2 run is
    // the first SUCCESSFUL one and still raises the target — that's what
    // keeps deep links to depth-6+ docs working.
    if (revealedForIdRef.current !== id && selfCollapsedRef.current !== id) {
      revealTo([id], 1);
    }
    revealedForIdRef.current = id;
  }, [id, data.flatNodes, revealTo]);

  // THE single "is this row's children hidden" predicate: absent rung (or
  // rung 0) means the chevron is up and the immediate children's rows don't
  // render.
  const isCollapsed = useCallback(
    (nodeId: string) => (rung.get(nodeId)?.level ?? 0) === 0,
    [rung],
  );

  // Every row hidden by a collapsed ancestor. One O(n) pass over the on-screen
  // order: a row is hidden iff any of its visual ancestors is at rung 0.
  // Nested collapsed branches stay collapsed branches, so per-level
  // disclosure (open one branch, its children appear but their own chevrons
  // stay up) falls out for free.
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

  // Bulk body writer for the pendulum's level-1/level-2 transitions: one
  // setUserToggles call for a whole level of children at once, mirroring the
  // deleted useExpandAll's expandAll. expandedSetRef is read HOISTED OUTSIDE
  // the updater (StrictMode double-invokes it; see main.tsx) — looping the
  // per-node toggle over a Scope's ~1,540 ids would otherwise allocate 1,540
  // growing Sets.
  const setBodiesExpanded = useCallback((ids: string[], expand: boolean) => {
    const auto = expandedSetRef.current;
    setUserToggles((prev) => {
      const next = new Set(prev);
      for (const nid of ids) {
        if (!data.atlas.docs[nid]?.content) continue;
        const isAuto = auto.has(nid);
        // target: isExpanded (= auto XOR toggled) === expand
        if ((expand && isAuto) || (!expand && !isAuto)) next.delete(nid);
        else next.add(nid);
      }
      return next;
    });
  }, [data]);

  // Arms the reveal animation: flips `data-expanding` on the scroll container
  // for a beat, which is what lets newly inserted rows and bodies run their
  // @starting-style entrance (see index.css). A plain attribute write — no React
  // state, so it can't invalidate docList and rebuild every row.
  const triggerExpandingAnim = useExpandingAttr(scrollContainerRef);
  // Read through a ref, NOT as a dependency. handlePendulum feeds the
  // actions-context object that every memo'd row consumes, so anything in its
  // dep array that churns re-renders all ~1200 rows on an unrelated body
  // toggle — the exact failure the stability tests below guard. This callback
  // measured as churning inside this component (it is stable in isolation), so
  // the ref keeps the guarantee independent of why. Same idiom as
  // expandedSetRef / selectedIdRef above; the read happens in a click handler,
  // long after render, so it is always current.
  const triggerExpandingAnimRef = useRef(triggerExpandingAnim);
  triggerExpandingAnimRef.current = triggerExpandingAnim;

  // The » click: advances rootId's rung to the next pendulum position and
  // forces its immediate children's bodies to match (level 1 → closed,
  // level 2 → open, level 0 → no body writes — collapsing preserves whatever
  // shape the descendants were left in, which is the whole point of storing
  // rung instead of deriving it).
  const handlePendulum = useCallback((rootId: string) => {
    const cur = rungRef.current.get(rootId) ?? DEFAULT_RUNG;
    const next = nextRung(cur);
    // Only the OUTWARD swings insert anything: 0 → 1 adds the child rows, 1 → 2
    // adds their bodies. Arm the reveal animation for those, so each step of the
    // ladder visibly arrives instead of blinking into place. The inward swings
    // only remove nodes, where the attribute would be inert anyway.
    if (next.level > cur.level) triggerExpandingAnimRef.current();
    writeRungs([[rootId, next]]);
    const children = visualChildren.get(rootId) ?? [];
    if (next.level === 0) {
      // Collapsing hides the WHOLE visual subtree, not just the immediate
      // children — if the selection sits anywhere inside it, it would
      // vanish. Move it onto the branch root itself (the row whose chevron
      // was clicked) so focus lands on the collapsed row instead of
      // disappearing.
      const subtreeIds = visualSubtreeIds(data.flatNodes, rootId);
      const sel = selectedIdRef.current;
      if (sel && sel !== rootId && subtreeIds.includes(sel)) {
        selfCollapsedRef.current = rootId;
        navigate(rootId);
      }
      return;
    }
    if (next.level === 1) {
      setBodiesExpanded(children, false);
      // Only the 0 → 1 swing also asks the sidebar to reveal the children —
      // level 2 already does this on its own outward swing, and would
      // otherwise be the only rung that ever syncs the sidebar.
      if (cur.level === 0) revealStore.reveal(children);
      return;
    }
    // next.level === 2
    setBodiesExpanded(children, true);
    revealStore.reveal(children);
  }, [data, writeRungs, visualChildren, setBodiesExpanded, navigate]);

  // The "N hidden" tab reveals every row beneath the node, left collapsed
  // (bodies closed): every member of the visual span that itself has visual
  // children is raised to rung 1 in one write. The root gets dir: -1 so the
  // very next chevron click on it undoes the reveal in a single click instead
  // of three; descendants get the ordinary forward direction.
  const handleExpandParent = useCallback((nodeId: string) => {
    const span = [nodeId, ...visualSubtreeIds(data.flatNodes, nodeId)];
    const updates: [string, Rung][] = [];
    for (const memberId of span) {
      if (!visualChildren.has(memberId)) continue;
      updates.push([memberId, { level: 1, dir: memberId === nodeId ? -1 : 1 }]);
    }
    writeRungs(updates);
    triggerExpandingAnim();
  }, [data, visualChildren, writeRungs, triggerExpandingAnim]);

  const changedSet = usePreviewChangedSet();
  const selectionSet = useSelectionSet();
  const filterSet = changedSet ?? selectionSet;

  // Re-scroll to the selected doc whenever the view mode flips, so leaving
  // "selected only" (or preview "changed only") keeps the current node in view.
  useAtlasScroll(id, data, rung, changedSet ? "changed" : selectionSet ? "selected" : "all");

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
      // from filterSet — rung state is a hierarchy-view concept that must NOT
      // apply here, or a matching doc that happens to sit under a collapsed
      // ancestor would silently vanish from the subset (e.g. changed docs
      // omitted so a review looks complete when it isn't). See
      // AtlasReader.test.tsx "filtered view ignores collapse state". rungLevel
      // is fixed at 1 (chevron shown "open", never "hidden") and gatedCount is
      // fixed at 0 — a real "N hidden" tab here would mutate rung state with
      // no visible effect in this view.
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
        block.push(
          <CollapsibleNode
            key={entry.node.id}
            entry={entry}
            isSelected={entry.node.id === selectedId}
            isExpanded={expandedSet.has(entry.node.id) !== userToggles.has(entry.node.id)}
            hasChildren={filteredParentIds.has(entry.node.id)}
            rungLevel={1}
            gatedCount={0}
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

    // filterSet is null here (the flat filtered view returned above). Row
    // visibility comes from one source — hiddenNodeIds, computed above from
    // the rung map.
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
      const r = rung.get(entry.node.id) ?? DEFAULT_RUNG;
      const gatedCount = r.level === 0 ? visualSpanCount.get(entry.node.id) ?? 0 : 0;
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
          hasChildren={visualChildren.has(entry.node.id)}
          rungLevel={r.level}
          rungDir={r.dir}
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
  }, [data, selectedId, expandedSet, userToggles, filterSet, changedSet, selectionSet, filteredParentIds, agentByDoc, rung, visualSpanCount, visualChildren, hiddenNodeIds, handleExpandParent]);

  // Stable actions-context value: rebuilding it every render forced every
  // memo'd CollapsibleNode to re-render on any parent render (e.g. a selection
  // change or an ordinary body toggle). All members are referentially stable
  // across those renders — handlePendulum reads rung/selection state through
  // refs rather than closing over it — so memoize the object too.
  const actions = useMemo(
    () => ({
      navigate,
      toggle: handleToggle,
      splitNavigate,
      pendulum: handlePendulum,
      selectSubtree: handleSelectSubtree,
    }),
    [navigate, handleToggle, splitNavigate, handlePendulum, handleSelectSubtree],
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
