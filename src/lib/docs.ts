import type { AtlasNode } from "../types";

export interface AtlasBundle {
  docs: Record<string, AtlasNode>;
  /** parentId → children sorted by `order`. Root nodes are keyed by `null`. */
  byParent: Map<string | null, AtlasNode[]>;
  /** doc_no → node id (for doc_no-based lookups) */
  docNoToId: Map<string, string>;
  atlasCommit: string | null;
}

// Cache per data-source base so main → preview → main never serves the wrong
// bundle. Default base ("/") is the live atlas; a preview passes
// "/api/preview/<sha>/" (threaded into the worker via a ?base= query param).
const atlasCache = new Map<string, Promise<AtlasBundle>>();

export function loadAtlas(base: string = import.meta.env.BASE_URL): Promise<AtlasBundle> {
  let cached = atlasCache.get(base);
  if (!cached) {
    cached = new Promise<AtlasBundle>((resolve, reject) => {
      // Keep `new Worker(new URL(...))` inline so Vite statically detects and
      // COMPILES the worker. Splitting it into `const url = ...` (to mutate
      // searchParams) defeats that detection — Vite then ships the raw .ts as an
      // asset, which the browser refuses to load as a module (video/mp2t MIME).
      // The preview base is threaded via the worker `name` (read as self.name),
      // not a ?base= query param, precisely to keep this expression inline.
      const worker = new Worker(new URL("../workers/atlas.worker.ts", import.meta.url), {
        type: "module",
        name: base,
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
      atlasCache.delete(base);
      throw err;
    });
    atlasCache.set(base, cached);
  }
  return cached;
}

// Cache the derived promise per base so `use(loadDocs())` always sees the same
// identity across renders. Returning a fresh `.then(...)` each call makes React
// Suspense treat every render as a new suspended fetch, flashing the fallback
// and resetting scroll position.
const docsPromises = new Map<string, Promise<Record<string, AtlasNode>>>();

export function loadDocs(base: string = import.meta.env.BASE_URL): Promise<Record<string, AtlasNode>> {
  let docsPromise = docsPromises.get(base);
  if (!docsPromise) {
    docsPromise = loadAtlas(base)
      .then((b) => b.docs)
      .catch((err) => {
        docsPromises.delete(base);
        throw err;
      });
    docsPromises.set(base, docsPromise);
  }
  return docsPromise;
}
