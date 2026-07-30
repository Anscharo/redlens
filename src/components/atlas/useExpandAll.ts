import { useCallback, useMemo, useRef } from "react";
import type { AtlasBundle } from "../../lib/docs";
import type { LoadedData } from "../../lib/atlasHelpers";
import { revealStore } from "../../lib/revealStore";

export function collectSubtree(byParent: AtlasBundle["byParent"], rootId: string): string[] {
  const ids = [rootId];
  for (let i = 0; i < ids.length; i++) {
    for (const child of byParent.get(ids[i]) ?? []) ids.push(child.id);
  }
  return ids;
}

// Recursive expand/collapse for the reader. `fullyExpanded` holds every node
// whose own text (if any) and all descendants' texts are currently expanded —
// rows use it to flip the » affordance to «. isExpanded for a node is
// expandedSet XOR userToggles (see AtlasReader).
export function useExpandAll(
  data: LoadedData,
  expandedSet: Set<string>,
  userToggles: Set<string>,
  setUserToggles: React.Dispatch<React.SetStateAction<Set<string>>>,
) {
  const fullyExpanded = useMemo(() => {
    const full = new Set<string>();
    const childrenOk = new Map<string, boolean>();
    // flatNodes is DFS document order, so a reverse pass sees children first.
    for (let i = data.flatNodes.length - 1; i >= 0; i--) {
      const { node, hasContent } = data.flatNodes[i];
      const selfOk = !hasContent || expandedSet.has(node.id) !== userToggles.has(node.id);
      const ok = selfOk && (childrenOk.get(node.id) ?? true);
      if (ok) full.add(node.id);
      if (node.parentId) {
        childrenOk.set(node.parentId, (childrenOk.get(node.parentId) ?? true) && ok);
      }
    }
    return full;
  }, [data, expandedSet, userToggles]);

  // expandedSet gets a fresh identity on every navigation (it accumulates the
  // visited id). Reading it through a ref keeps expandAll referentially stable
  // across navigation — otherwise expandAll → handleSetSubtreeVisualState → the
  // whole actions-context object would be recreated on every doc click, and
  // since every CollapsibleNode consumes that context, all ~1200 rows would
  // re-render synchronously (the click-to-select lag). The read happens inside a
  // click handler, after render, so the ref is current.
  const expandedSetRef = useRef(expandedSet);
  expandedSetRef.current = expandedSet;

  const expandAll = useCallback(
    (rootId: string, expand: boolean) => {
      const ids = collectSubtree(data.atlas.byParent, rootId);
      setUserToggles((prev) => {
        const next = new Set(prev);
        for (const nid of ids) {
          if (!data.atlas.docs[nid]?.content) continue;
          const auto = expandedSetRef.current.has(nid);
          // target: isExpanded (= auto XOR toggled) === expand
          if ((expand && auto) || (!expand && !auto)) next.delete(nid);
          else next.add(nid);
        }
        return next;
      });
      if (expand) revealStore.reveal(ids);
    },
    [data, setUserToggles],
  );

  return { fullyExpanded, expandAll };
}
