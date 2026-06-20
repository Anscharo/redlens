import { useCallback, useMemo } from "react";
import type { AtlasBundle } from "../../lib/docs";
import type { LoadedData } from "../../lib/atlasHelpers";
import { revealStore } from "../../lib/revealStore";

function collectSubtree(byParent: AtlasBundle["byParent"], rootId: string): string[] {
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

  const expandAll = useCallback(
    (rootId: string, expand: boolean) => {
      const ids = collectSubtree(data.atlas.byParent, rootId);
      setUserToggles((prev) => {
        const next = new Set(prev);
        for (const nid of ids) {
          if (!data.atlas.docs[nid]?.content) continue;
          const auto = expandedSet.has(nid);
          // target: isExpanded (= auto XOR toggled) === expand
          if ((expand && auto) || (!expand && !auto)) next.delete(nid);
          else next.add(nid);
        }
        return next;
      });
      if (expand) revealStore.reveal(ids);
    },
    [data, expandedSet, setUserToggles],
  );

  return { fullyExpanded, expandAll };
}
