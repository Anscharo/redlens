import { useState, useEffect, useCallback, useMemo } from "react";
import { type FlatEntry } from "./CollapsibleNode";

export function useDepth6Expand(flatNodes: FlatEntry[], id: string) {
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());

  const { hasDeepChildren, entryById } = useMemo(() => {
    const hasDeepChildren = new Set<string>();
    const entryById = new Map<string, FlatEntry>();
    for (const entry of flatNodes) {
      entryById.set(entry.node.id, entry);
      if (entry.depth >= 6 && entry.node.parentId) {
        hasDeepChildren.add(entry.node.parentId);
      }
    }
    return { hasDeepChildren, entryById };
  }, [flatNodes]);

  // When navigating to a depth-6+ node, expand every ancestor on the path.
  // This collapses the fills along the path (expanded parents show no fill)
  // while sibling branches keep theirs — making it clear what's hidden vs shown.
  useEffect(() => {
    if (!id) return;
    const target = entryById.get(id);
    if (!target || target.depth < 6) return;
    setExpandedParents(prev => {
      const next = new Set(prev);
      let cur = target;
      while (cur.depth >= 6) {
        const parentId = cur.node.parentId;
        if (!parentId) break;
        next.add(parentId);
        const parent = entryById.get(parentId);
        if (!parent) break;
        cur = parent;
      }
      return next;
    });
  }, [id, entryById]);

  const expandParent = useCallback((nodeId: string) => {
    setExpandedParents(prev => new Set([...prev, nodeId]));
  }, []);

  return { expandedParents, hasDeepChildren, expandParent };
}
