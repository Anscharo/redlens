import type { AtlasNode } from "../types";

export interface AtlasBundle {
  docs: Record<string, AtlasNode>;
  /** parentId → children sorted by `order`. Root nodes are keyed by `null`. */
  byParent: Map<string | null, AtlasNode[]>;
  /** doc_no → node id (for doc_no-based lookups) */
  docNoToId: Map<string, string>;
}

let cached: Promise<AtlasBundle> | null = null;

export function loadAtlas(): Promise<AtlasBundle> {
  if (!cached) {
    cached = new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL("../workers/atlas.worker.ts", import.meta.url),
        { type: "module" }
      );
      worker.addEventListener("message", (e) => {
        const msg = e.data;
        if (msg.type === "ready") {
          worker.terminate();
          resolve({
            docs: msg.docs,
            byParent: new Map(msg.byParentEntries),
            docNoToId: new Map(msg.docNoToIdEntries),
          });
        } else if (msg.type === "error") {
          worker.terminate();
          reject(new Error(msg.message));
        }
      });
    });
  }
  return cached;
}

export function loadDocs(): Promise<Record<string, AtlasNode>> {
  return loadAtlas().then((b) => b.docs);
}
