import { useState, useEffect, useCallback, useMemo } from "react";
import { type FlatEntry } from "../../lib/atlasHelpers";

export function useDepth6Expand(flatNodes: FlatEntry[], id: string) {
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());

  // gatedCount[parentId] = how many immediate children of `parentId` are at
  // depth >= 6 (i.e., would be revealed if the user expands `parentId`). This is
  // the structural depth-6 gate, distinct from the "hidden" subtree visual state
  // (see subtreeState.ts) which tracks user-driven hide/collapse.
  // Single O(N) pass; lookup is O(1).
  const { gatedCount, entryById } = useMemo(() => {
    const gatedCount = new Map<string, number>();
    const entryById = new Map<string, FlatEntry>();
    for (const entry of flatNodes) {
      entryById.set(entry.node.id, entry);
      if (entry.depth >= 6 && entry.node.parentId) {
        gatedCount.set(entry.node.parentId, (gatedCount.get(entry.node.parentId) ?? 0) + 1);
      }
    }
    return { gatedCount, entryById };
  }, [flatNodes]);

  // On navigation, two auto-expansions:
  //   1. If the target is depth-6+, walk up and expand every ancestor on the path.
  //   2. If the target itself has gated descendants, expand them too.
  // Auto-expansion on navigation is not animated (no data-expanding signal) — the
  // user teleported here, not opened it interactively. Animation is reserved for
  // the explicit affordance click path (handleExpandParent in AtlasView).
  useEffect(() => {
    if (!id) return;
    const target = entryById.get(id);
    if (!target) return;
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (target.depth >= 6) {
        let cur = target;
        while (cur.depth >= 6) {
          const parentId = cur.node.parentId;
          if (!parentId) break;
          next.add(parentId);
          const parent = entryById.get(parentId);
          if (!parent) break;
          cur = parent;
        }
      }
      if ((gatedCount.get(target.node.id) ?? 0) > 0 && !prev.has(target.node.id)) {
        next.add(target.node.id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [id, entryById, gatedCount]);

  const expandParent = useCallback((nodeId: string) => {
    setExpandedParents((prev) => {
      if (prev.has(nodeId)) return prev;
      return new Set([...prev, nodeId]);
    });
  }, []);

  // Bulk reveal/re-gate for expand-all («/»): add every id in the subtree so
  // its gated depth-6+ children show (reveal=true), or drop them to re-hide
  // (reveal=false). Passing whole-subtree ids is a harmless superset — only the
  // ids that are parents of depth-6+ nodes actually gate anything.
  const setParentsExpanded = useCallback((ids: string[], reveal: boolean) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const nid of ids) {
        if (reveal ? next.has(nid) : !next.has(nid)) continue;
        if (reveal) next.add(nid);
        else next.delete(nid);
        changed = true;
      }
      return changed ? next : prev;
    });
  }, []);

  // Restore a snapshot's reveal state for one branch only: force membership of
  // every id in `scope` (the branch's subtree) to match the snapshot, leaving
  // gated-reveal state elsewhere untouched. See mergeSubtreeSnapshot in
  // AtlasReader — this is the expandedParents equivalent.
  const mergeParentsExpanded = useCallback((snapshot: Set<string>, scope: Set<string>) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of scope) {
        const want = snapshot.has(id);
        if (want === next.has(id)) continue;
        if (want) next.add(id);
        else next.delete(id);
        changed = true;
      }
      return changed ? next : prev;
    });
  }, []);

  return { expandedParents, gatedCount, expandParent, setParentsExpanded, mergeParentsExpanded, entryById };
}
