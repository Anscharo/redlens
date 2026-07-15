import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { List, useListRef } from "react-window";
import { useAtlasTree } from "../../hooks/useAtlasTree";
import { useTreeKeyboard } from "../../hooks/useTreeKeyboard";
import { usePulseDom } from "../../hooks/usePulseDom";
import { useRevealFlash } from "../../hooks/useRevealFlash";
import { realDepth, segmentDepths, depthColor } from "../../lib/depth";
import { revealStore } from "../../lib/revealStore";
import { scrollRequestStore } from "../../lib/scrollRequestStore";
import { usePreviewChangedSet } from "../../lib/previewFilter";
import { usePreviewDiff } from "../../lib/previewDiff";
import { useSelectionSet } from "../../lib/selectionFilter";
import { useDataSource } from "../../lib/dataSource";
import { track } from "../../lib/analytics";
import { PreviewTreeToggle } from "../preview/PreviewTreeToggle";
import { SelectionTreeToggle } from "../selection/SelectionTreeToggle";
import { TreeRow, ROW_HEIGHT, type VisibleNode, type TreeRowData } from "./TreeRow";

// Expand every ancestor of `doc_no` so the node's row is visible. Returns
// whether `next` changed. (fragile: doc_no prefix — same walk the selection
// effect has always used.)
function addAncestors(
  docNoToId: Map<string, string>,
  doc_no: string,
  next: Set<string>,
): boolean {
  const parts = doc_no.split(".");
  let changed = false;
  for (let i = 2; i < parts.length; i++) {
    const aid = docNoToId.get(parts.slice(0, i).join("."));
    if (aid && !next.has(aid)) {
      next.add(aid);
      changed = true;
    }
  }
  return changed;
}

const REVEAL_STEP_MS = 180;

interface Props {
  nodeId: string | null;
  onNavigate: (id: string) => void;
  onShiftNavigate?: (id: string) => void;
}

export function TreeSidebar({ nodeId, onNavigate, onShiftNavigate }: Props) {
  const bundle = useAtlasTree();
  const [sidebarWidth, setSidebarWidth] = useState(242);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const clickedRef = useRef(false);
  const scrolledForRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useListRef(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  usePulseDom(nodeId, containerRef);

  // child id → parent id in the *rendered* tree. byParent is built in the worker
  // via resolveParentId (doc_no-aware, incl. the NR-by-id step), so inverting it
  // gives the exact upward relation the tree renders by. Raw node.parentId is NOT
  // that relation — it comes from a depth stack capped at 6, so for any node
  // deeper than 6 levels it collapses onto the depth-6 ancestor and the real
  // intermediate parents are lost. Walking it would skip those, leaving the
  // selected node hidden (no sidebar selection). Walk parentOf instead.
  const parentOf = useMemo(() => {
    const m = new Map<string, string | null>();
    if (bundle) {
      for (const [pid, children] of bundle.byParent) {
        for (const child of children) m.set(child.id, pid);
      }
    }
    return m;
  }, [bundle]);

  useEffect(() => {
    if (!bundle || !nodeId || !parentOf.has(nodeId)) return;
    setExpandedIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      // Expand every ancestor so the selected node is visible, stepping upward
      // along the same relation the tree is grouped by.
      let pid = parentOf.get(nodeId) ?? null;
      while (pid) {
        if (!next.has(pid)) {
          next.add(pid);
          changed = true;
        }
        pid = parentOf.get(pid) ?? null;
      }
      // Also expand the selected node itself so its direct children show — this
      // is what the reader does on selection, and it's what makes the cradle
      // appear in the sidebar (a rail around the now-visible children), mirroring
      // the middle pane.
      if (bundle.byParent.has(nodeId) && !next.has(nodeId)) {
        next.add(nodeId);
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [bundle, nodeId, parentOf]);

  // Reader-side expansions (single or expand-all) ask us to make those rows
  // visible by expanding their ancestors, without changing the selection.
  useEffect(() => {
    if (!bundle) return;
    const { docs, docNoToId } = bundle;
    return revealStore.subscribe((ids) => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const id of ids) {
          const doc = docs[id];
          if (doc) changed = addAncestors(docNoToId, doc.doc_no, next) || changed;
        }
        return changed ? next : prev;
      });
    });
  }, [bundle]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let rafId = 0;
    const ro = new ResizeObserver(([entry]) => {
      const newWidth = entry.contentRect.width;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setSidebarWidth((prev) => (Math.abs(prev - newWidth) > 10 ? newWidth : prev));
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, []);

  const changedSet = usePreviewChangedSet();
  const selectionSet = useSelectionSet();
  const diff = usePreviewDiff();
  // Only preview mode has a diff; gate the rollup/flash/marks so the live reader
  // pays nothing for them (no per-row badge mounts, no reveal-flash effect).
  const isPreview = !!useDataSource().preview;

  // id → { count, depth } for the added/changed docs in its subtree. Walk up
  // parentOf from each changed doc, incrementing every ancestor's count and
  // tracking the max segment depth seen (so the badge can be tinted by the
  // deepest change's depth colour). parentOf is the same doc_no-aware relation
  // the tree renders by (see note above), so this lines up with what a collapsed
  // row actually hides. A new doc that itself has children is also an ancestor of
  // changes (its kids are new), so it gets the same badge/pill/reveal as a changed
  // doc with children. Skipped entirely in the flat "changed only" view (no
  // hierarchy to roll into).
  const rollup = useMemo(() => {
    const m = new Map<string, { count: number; depth: number }>();
    if (!bundle || !isPreview || changedSet) return m;
    for (const id of [...diff.added, ...diff.changed]) {
      const node = bundle.docs[id];
      if (!node) continue;
      // Colour depth must match the chiclet the row shows. NR-X nodes carry no
      // positional doc_no — segmentDepths short-circuits them to [1] — so derive
      // their depth from the tree (realDepth needs the parent's doc_no).
      let depth: number;
      if (node.doc_no.startsWith("NR-")) {
        const pid = parentOf.get(id);
        depth = realDepth(node.doc_no, pid ? bundle.docs[pid]?.doc_no : undefined);
      } else {
        const segs = segmentDepths(node.doc_no);
        depth = segs[segs.length - 1] ?? 0;
      }
      let pid = parentOf.get(id) ?? null;
      while (pid) {
        const cur = m.get(pid);
        if (cur) {
          cur.count++;
          if (depth > cur.depth) cur.depth = depth;
        } else {
          m.set(pid, { count: 1, depth });
        }
        pid = parentOf.get(pid) ?? null;
      }
    }
    return m;
  }, [bundle, isPreview, parentOf, diff, changedSet]);

  // Flash each changed/new doc when it becomes visible because an ancestor was
  // expanded (manual toggle or the staggered reveal) — see useRevealFlash.
  const flashIds = useMemo(() => new Set([...diff.added, ...diff.changed]), [diff]);
  const flashing = useRevealFlash(flashIds, parentOf, expandedIds, isPreview && !!bundle && !changedSet);

  const visibleNodes = useMemo(() => {
    if (!bundle) return [];
    const { byParent, docs } = bundle;
    // "Changed only" (preview): a flat list of just the changed docs, in
    // document order — no hierarchy, nothing to expand.
    if (changedSet) {
      return Object.values(docs)
        .filter((n) => changedSet.has(n.id))
        .sort((a, b) => a.order - b.order)
        // Use the node's real depth (not a flat 1) so chiclet colors — and NR-X
        // chiclets in particular, whose number is colored by this depth — match
        // the reader instead of all rendering as depth-1 red.
        .map((node) => ({ node, hasChildren: false, treeDepth: node.depth }));
    }
    const result: VisibleNode[] = [];
    // "Selected only": selected docs stay visible, but keep WORKING chevrons —
    // expanding a selected node reveals its children so you can browse into the
    // subtree. Hierarchical walk that shows a node when it's selected OR under an
    // expanded shown ancestor; the parentDocNo chain keeps depth/chiclet colors
    // right even where intermediate (unselected) ancestors are hidden.
    if (selectionSet) {
      const walkSel = (parentId: string | null, parentDocNo: string | undefined, reveal: boolean) => {
        for (const node of byParent.get(parentId) ?? []) {
          const hasChildren = byParent.has(node.id);
          if (selectionSet.has(node.id) || reveal) {
            result.push({ node, hasChildren, treeDepth: realDepth(node.doc_no, parentDocNo), parentDocNo });
            walkSel(node.id, node.doc_no, hasChildren && expandedIds.has(node.id));
          } else {
            walkSel(node.id, node.doc_no, false);
          }
        }
      };
      walkSel(null, undefined, false);
      return result;
    }
    function walk(parentId: string | null, parentDocNo?: string) {
      for (const node of byParent.get(parentId) ?? []) {
        const hasChildren = byParent.has(node.id);
        result.push({ node, hasChildren, treeDepth: realDepth(node.doc_no, parentDocNo), parentDocNo });
        if (hasChildren && expandedIds.has(node.id)) walk(node.id, node.doc_no);
      }
    }
    walk(null);
    return result;
  }, [bundle, expandedIds, changedSet, selectionSet]);

  const selectedIndex = useMemo(
    () => (nodeId ? visibleNodes.findIndex((v) => v.node.id === nodeId) : -1),
    [visibleNodes, nodeId],
  );

  // Cradle: a left rail in the selected node's depth colour hanging down the
  // selected node's visible/expanded descendants, closed by a curved foot under
  // the last one — the sidebar twin of the reader's cradle (AtlasReader). Because
  // visibleNodes is DFS document order, those descendants are the contiguous run
  // of deeper-treeDepth rows right after the selection; expanding more of them
  // (manual toggle or expand-all reveal) grows the run, so the cradle extends
  // automatically. No descendants visible → no cradle.
  const cradle = useMemo(() => {
    const sel = selectedIndex >= 0 ? visibleNodes[selectedIndex] : undefined;
    if (!sel) return null;
    let i = selectedIndex + 1;
    while (i < visibleNodes.length && visibleNodes[i].treeDepth > sel.treeDepth) i++;
    if (i <= selectedIndex + 1) return null;
    return { start: selectedIndex + 1, end: i - 1, color: depthColor(sel.treeDepth) };
  }, [visibleNodes, selectedIndex]);

  useEffect(() => {
    if (clickedRef.current) {
      clickedRef.current = false;
      scrolledForRef.current = nodeId;
      return;
    }
    // Only scroll when the *selected node* changes (a real navigation). Expanding
    // or collapsing another section shifts selectedIndex without changing nodeId —
    // that must not jerk the view back to the selection (it would fight the user
    // who is scrolling/expanding elsewhere).
    if (nodeId === scrolledForRef.current) return;
    if (selectedIndex >= 0 && listRef.current) {
      listRef.current.scrollToRow({ index: selectedIndex, align: "smart" });
      scrolledForRef.current = nodeId;
    }
  }, [selectedIndex, nodeId, listRef]);

  // Expand from `id` down through every node that has a changed descendant
  // (rollup keys), revealing the changes without unfolding unrelated subtrees.
  // Changed leaves become visible once their (rollup-key) parent is expanded.
  // Done one level per REVEAL_STEP_MS tick (not all at once) so the cascade is
  // legible — each level's pills appear, linger, then fade as they unfold.
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (revealTimer.current) clearTimeout(revealTimer.current); }, []);

  const revealChanges = useCallback(
    (id: string) => {
      if (!bundle) return;
      const { byParent } = bundle;
      if (revealTimer.current) clearTimeout(revealTimer.current);
      let frontier = [id];
      const step = () => {
        setExpandedIds((prev) => {
          const next = new Set(prev);
          for (const cur of frontier) next.add(cur);
          return next;
        });
        const nextFrontier: string[] = [];
        for (const cur of frontier) {
          for (const child of byParent.get(cur) ?? []) {
            if (rollup.has(child.id)) nextFrontier.push(child.id);
          }
        }
        frontier = nextFrontier;
        revealTimer.current = frontier.length ? setTimeout(step, REVEAL_STEP_MS) : null;
      };
      step();
    },
    [bundle, rollup],
  );

  const toggleExpand = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      track("reader_sidebar_toggle", {
        node_id: id,
        action: expandedIds.has(id) ? "collapse" : "expand",
        all: e.altKey,
      });
      setExpandedIds((prev) => {
        const next = new Set(prev);
        // alt-click: expand/collapse the entire subtree (Finder convention)
        if (e.altKey && bundle) {
          const expand = !prev.has(id);
          const stack = [id];
          while (stack.length) {
            const cur = stack.pop()!;
            const kids = bundle.byParent.get(cur);
            if (!kids?.length) continue;
            if (expand) next.add(cur);
            else next.delete(cur);
            for (const k of kids) stack.push(k.id);
          }
          return next;
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [bundle, expandedIds],
  );

  const handleKeyDown = useTreeKeyboard({
    visibleNodes,
    focusedIndex,
    selectedIndex,
    expandedIds,
    listRef,
    onNavigate,
    setFocusedIndex,
    setExpandedIds,
  });

  const handleRowClick = useCallback(
    (id: string) => {
      track("reader_sidebar_nav", { node_id: id });
      clickedRef.current = true;
      setFocusedIndex(-1);
      onNavigate(id);
      scrollRequestStore.request(id);
    },
    [onNavigate],
  );

  const rowProps: TreeRowData = useMemo(
    () => ({
      visibleNodes,
      selectedIndex,
      focusedIndex,
      expandedIds,
      rollup,
      flashing,
      isPreview,
      sidebarWidth,
      cradle,
      onNavigate: handleRowClick,
      onToggle: toggleExpand,
      onReveal: revealChanges,
      onShiftNavigate,
    }),
    [
      visibleNodes,
      selectedIndex,
      focusedIndex,
      expandedIds,
      rollup,
      flashing,
      isPreview,
      sidebarWidth,
      cradle,
      handleRowClick,
      toggleExpand,
      revealChanges,
      onShiftNavigate,
    ],
  );

  if (!bundle) return <div className="tree-sidebar" ref={containerRef} />;

  return (
    <div
      className="tree-sidebar"
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="tree"
      aria-label="Atlas tree"
    >
      <PreviewTreeToggle />
      <SelectionTreeToggle />
      <List
        listRef={listRef}
        rowCount={visibleNodes.length}
        rowHeight={ROW_HEIGHT}
        rowComponent={TreeRow}
        rowProps={rowProps}
        overscanCount={20}
        // scrollbar-gutter: stable permanently reserves the 8px scrollbar lane
        // so rows never render under it — the JS title budget (SCROLLBAR_W) then
        // adds a small extra gap on top. Prevents titles kissing the scrollbar.
        style={{ flex: 1, scrollbarGutter: "stable" }}
      />
    </div>
  );
}

