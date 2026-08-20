import type { AtlasNode } from "@/types";

/** All descendant node ids of `rootId` (the root itself is excluded), resolved
 *  via the atlas `byParent` map (the doc_no-based semantic tree built in
 *  atlas.worker — NOT the raw `parentId` field, which is flattened at the
 *  depth-6 heading cap and so loses deep instance subtrees).
 *
 *  The radar actor history uses this to expand each instance/invocation ICD
 *  root into its nested config docs (rate limits, contract addresses, off-chain
 *  parameters, …) so subtree edits surface in history. `byParent` is a tree, so
 *  no visited-set is needed. */
export function descendantIds(
  rootId: string,
  byParent: Map<string | null, AtlasNode[]>,
): string[] {
  const out: string[] = [];
  const stack = [...(byParent.get(rootId) ?? [])];
  while (stack.length) {
    const node = stack.pop()!;
    out.push(node.id);
    const kids = byParent.get(node.id);
    if (kids) stack.push(...kids);
  }
  return out;
}
