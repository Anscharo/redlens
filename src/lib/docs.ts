import type { AtlasNode } from "../types";

export interface AtlasBundle {
  docs: Record<string, AtlasNode>;
  /** parentId → children sorted by `order`. Root nodes are keyed by `null`. */
  byParent: Map<string | null, AtlasNode[]>;
}

let cached: Promise<AtlasBundle> | null = null;

function buildBundle(docs: Record<string, AtlasNode>): AtlasBundle {
  const byParent = new Map<string | null, AtlasNode[]>();
  for (const node of Object.values(docs)) {
    const key = node.parentId;
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
