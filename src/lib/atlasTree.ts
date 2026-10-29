// The atlas tree, read from doc numbers. A heading's depth is capped at 6, so a
// stored parentId is wrong below that depth; a node's parent is the document
// its doc number extends. The spec's structural suffixes hang on what they
// belong to: an Annotation, Action Tenet or Active Data (`.0.3.X`, `.0.4.X`,
// `.0.6.X`) on the document before the `.0`, a Scenario Variation (`.varX`) on
// its Scenario, and a Scenario (`.1.X`) under an Action Tenet on that tenet.
// The stored parentId is used only where no such document exists, and for
// Needed Research, which is numbered globally. Pure.
import type { AtlasNode } from "../types.ts";
import { pushTo } from "./collections.ts";

export interface DocTree {
  /** parentId → children sorted by `order`; roots are keyed by null. */
  byParent: Map<string | null, AtlasNode[]>;
  docNoToId: Map<string, string>;
}

function parentDocNo(dn: string, has: (dn: string) => boolean): string {
  const parts = dn.split(".");
  const last = parts[parts.length - 1];
  if (last.startsWith("var")) return parts.slice(0, -1).join(".");
  if (parts.length >= 4) {
    const [m2, m1] = [parts[parts.length - 3], parts[parts.length - 2]];
    if (m2 === "0" && (m1 === "3" || m1 === "4" || m1 === "6")) return parts.slice(0, -3).join(".");
  }
  if (parts[parts.length - 2] === "1") {
    const tenet = parts.slice(0, -2).join(".");
    if (has(tenet) && /\.0\.4\.\d+$/.test(tenet)) return tenet;
  }
  return parts.slice(0, -1).join(".");
}

/** The tree of `docs`, whatever subset of the atlas they are. */
export function docTree(docs: Record<string, AtlasNode>): DocTree {
  const docNoToId = new Map<string, string>();
  for (const node of Object.values(docs)) docNoToId.set(node.doc_no, node.id);
  const parentOf = (node: AtlasNode): string | null => {
    if (node.doc_no.startsWith("NR-")) return node.parentId;
    if (node.doc_no.split(".").length <= 2) return null;
    return docNoToId.get(parentDocNo(node.doc_no, (dn) => docNoToId.has(dn))) ?? node.parentId;
  };
  const byParent = new Map<string | null, AtlasNode[]>();
  for (const node of Object.values(docs)) pushTo(byParent, parentOf(node), node);
  for (const bucket of byParent.values()) bucket.sort((a, b) => a.order - b.order);
  return { byParent, docNoToId };
}
