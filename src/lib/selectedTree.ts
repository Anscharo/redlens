import { realDepth } from "./depth";
import type { AtlasNode } from "../types";
import type { VisibleNode } from "../components/tree/TreeRow";

// Nodes with at least one SELECTED descendant. Post-order DFS over the same
// byParent structure the tree renders from, so it lines up exactly with the
// walk below. A node in here earns a working chevron in the selected-only view.
export function selectedDescendantSet(
  byParent: Map<string | null, AtlasNode[]>,
  selectionSet: Set<string>,
): Set<string> {
  const set = new Set<string>();
  const mark = (parentId: string | null): boolean => {
    let any = false;
    for (const node of byParent.get(parentId) ?? []) {
      const childHas = mark(node.id);
      if (childHas) set.add(node.id);
      if (childHas || selectionSet.has(node.id)) any = true;
    }
    return any;
  };
  mark(null);
  return set;
}

// Build the "selected only" sidebar rows: ONLY selected docs, arranged by their
// selection nesting. A selected node gets a working chevron iff it has a selected
// DESCENDANT; expanding it reveals only those selected descendants — never
// unselected children. Unselected intermediate ancestors are not rendered as
// rows; the parentDocNo chain still yields correct depth/chiclet colors for a
// selected node whose parent is hidden.
//
// `reveal` means the nearest selected ancestor is shown AND expanded, so selected
// nodes at this level should appear. It passes UNCHANGED through unselected
// intermediates (a deeper selected node still answers to that ancestor's expand
// state), and the walk starts revealed so top-level selected nodes (those with no
// selected ancestor) always show.
export function buildSelectedOnlyNodes(
  byParent: Map<string | null, AtlasNode[]>,
  selectionSet: Set<string>,
  expandedIds: Set<string>,
): VisibleNode[] {
  const selHasDesc = selectedDescendantSet(byParent, selectionSet);
  const result: VisibleNode[] = [];
  const walk = (parentId: string | null, parentDocNo: string | undefined, reveal: boolean) => {
    for (const node of byParent.get(parentId) ?? []) {
      if (selectionSet.has(node.id)) {
        const hasChildren = selHasDesc.has(node.id);
        if (reveal) {
          result.push({ node, hasChildren, treeDepth: realDepth(node.doc_no, parentDocNo), parentDocNo });
        }
        // This node is now the nearest selected ancestor for its subtree; its
        // selected descendants show only while it's shown AND expanded.
        walk(node.id, node.doc_no, reveal && hasChildren && expandedIds.has(node.id));
      } else {
        // Unselected intermediate: never a row; keep the same reveal so a deeper
        // selected node still tracks the selected ancestor above it.
        walk(node.id, node.doc_no, reveal);
      }
    }
  };
  walk(null, undefined, true);
  return result;
}
