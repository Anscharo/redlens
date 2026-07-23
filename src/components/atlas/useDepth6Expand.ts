import { useState, useEffect, useCallback, useMemo } from "react";
import { type FlatEntry } from "../../lib/atlasHelpers";

export function useDepth6Expand(flatNodes: FlatEntry[], id: string) {
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());

  // hiddenCount[parentId] = how many immediate children of `parentId` are at
  // depth >= 6 (i.e., would be revealed if the user expands `parentId`).
  // Single O(N) pass; lookup is O(1).
  const { hiddenCount, entryById } = useMemo(() => {
    const hiddenCount = new Map<string, number>();
    const entryById = new Map<string, FlatEntry>();
    for (const entry of flatNodes) {
      entryById.set(entry.node.id, entry);
      if (entry.depth >= 6 && entry.node.parentId) {
        hiddenCount.set(entry.node.parentId, (hiddenCount.get(entry.node.parentId) ?? 0) + 1);
      }
    }
    return { hiddenCount, entryById };
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
      if ((hiddenCount.get(target.node.id) ?? 0) > 0 && !prev.has(target.node.id)) {
        next.add(target.node.id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [id, entryById, hiddenCount]);

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

  const restoreParentsExpanded = useCallback((next: Set<string>) => {
    setExpandedParents(new Set(next));
  }, []);

  return { expandedParents, hiddenCount, expandParent, setParentsExpanded, restoreParentsExpanded, entryById };
}
