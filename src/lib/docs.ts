import type { AtlasNode } from "../types";

export interface AtlasBundle {
  docs: Record<string, AtlasNode>;
  /** parentId → children sorted by `order`. Root nodes are keyed by `null`. */
  byParent: Map<string | null, AtlasNode[]>;
}

let cached: Promise<AtlasBundle> | null = null;

function buildBundle(docs: Record<string, AtlasNode>): AtlasBundle {
  // Build doc_no → id lookup for parent resolution
  const docNoToId = new Map<string, string>();
  for (const node of Object.values(docs)) {
    docNoToId.set(node.doc_no, node.id);
  }

  // Resolve true parent via doc_no structure (parser's parentId is broken at depth 6+).
  // Supporting doc patterns: .0.3.X (Annotation), .0.4.X (Tenet), .0.6.X (Active Data),
  // .1.X (Scenario after Tenet), .varX (Scenario Variation)
  function resolveParentId(node: AtlasNode): string | null {
    const dn = node.doc_no;
    if (dn.startsWith("NR-")) return node.parentId;

    const parts = dn.split(".");
    if (parts.length <= 2) return null; // A.X = root scope

    const last = parts[parts.length - 1];

    // .varX → parent is everything before .varX
    if (last.startsWith("var")) {
      return docNoToId.get(parts.slice(0, -1).join(".")) ?? node.parentId;
    }

    // Check if this is a supporting doc instance: last 3 segments match .0.{3|4|6}.X
    if (parts.length >= 4) {
      const m2 = parts[parts.length - 3]; // potential "0"
      const m1 = parts[parts.length - 2]; // potential "3", "4", or "6"
      if (m2 === "0" && (m1 === "3" || m1 === "4" || m1 === "6")) {
        // Parent is the target document: everything before .0.T
        const parentDocNo = parts.slice(0, -3).join(".");
        return docNoToId.get(parentDocNo) ?? node.parentId;
      }
    }

    // Check if this is a scenario (.1.X after a tenet):
    // parent tenet pattern: ...0.4.N.1.X — parent is ...0.4.N
    if (parts.length >= 3 && parts[parts.length - 2] === "1") {
      const candidateParent = parts.slice(0, -2).join(".");
      if (docNoToId.has(candidateParent)) {
        return docNoToId.get(candidateParent)!;
      }
    }

    // Default: parent is one segment shorter
    const parentDocNo = parts.slice(0, -1).join(".");
    return docNoToId.get(parentDocNo) ?? node.parentId;
  }

  const byParent = new Map<string | null, AtlasNode[]>();
  for (const node of Object.values(docs)) {
    const key = resolveParentId(node);
    let bucket = byParent.get(key);
    if (!bucket) { bucket = []; byParent.set(key, bucket); }
    bucket.push(node);
  }
  for (const bucket of byParent.values()) bucket.sort((a, b) => a.order - b.order);
  return { docs, byParent };
}

export function loadAtlas(): Promise<AtlasBundle> {
  if (!cached) {
    cached = fetch(`${import.meta.env.BASE_URL}docs.json`)
      .then((r) => r.json())
      .then(buildBundle);
  }
  return cached;
}

export function loadDocs(): Promise<Record<string, AtlasNode>> {
  return loadAtlas().then((b) => b.docs);
}
