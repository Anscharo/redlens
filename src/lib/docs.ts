import type { AtlasNode } from "../types";

export interface AtlasBundle {
  docs: Record<string, AtlasNode>;
  /** parentId → children sorted by `order`. Root nodes are keyed by `null`. */
  byParent: Map<string | null, AtlasNode[]>;
  /** doc_no → node id (for doc_no-based lookups) */
  docNoToId: Map<string, string>;
  atlasCommit: string | null;
}

let cached: Promise<AtlasBundle> | null = null;

export function loadAtlas(): Promise<AtlasBundle> {
  if (!cached) {
    cached = new Promise<AtlasBundle>((resolve, reject) => {
      const worker = new Worker(new URL("../workers/atlas.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.addEventListener("message", (e) => {
        const msg = e.data;
        if (msg.type === "ready") {
          worker.terminate();
          resolve({
            docs: msg.docs,
            atlasCommit: msg.atlasCommit ?? null,
            byParent: new Map(msg.byParentEntries),
            docNoToId: new Map(msg.docNoToIdEntries),
          });
        } else if (msg.type === "error") {
          worker.terminate();
          reject(new Error(msg.message));
        }
      });
    }).catch((err) => {
      cached = null;
      throw err;
    });
  }
  return cached!;
}

// Cache the derived promise so `use(loadDocs())` always sees the same identity
// across renders. Returning a fresh `.then(...)` each call makes React Suspense
// treat every render as a new suspended fetch, flashing the fallback and
// resetting scroll position.
let docsPromise: Promise<Record<string, AtlasNode>> | null = null;

export function loadDocs(): Promise<Record<string, AtlasNode>> {
  if (!docsPromise) {
    docsPromise = loadAtlas()
      .then((b) => b.docs)
      .catch((err) => {
        docsPromise = null;
        throw err;
      });
  }
  return docsPromise;
}
