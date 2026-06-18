import type { AtlasNode } from "../types";
import { liveAtlasBase, handledStaleMessage } from "./atlasBase";

export interface AtlasBundle {
  docs: Record<string, AtlasNode>;
  /** parentId → children sorted by `order`. Root nodes are keyed by `null`. */
  byParent: Map<string | null, AtlasNode[]>;
  /** doc_no → node id (for doc_no-based lookups) */
  docNoToId: Map<string, string>;
  atlasCommit: string | null;
}

// One atlas worker per data-source base, backing TWO promises from a single
// fetch of both browser docs artifacts: `tree` resolves early (content-less
// metadata + lookup maps → sidebar renders) and `ready` resolves slightly later
// (content merged in → full AtlasNode map). main → preview → main never crosses
// bundles because everything is keyed by base. The preview base is threaded via
// the worker `name` (read as self.name), keeping `new Worker(new URL(...))`
// inline so Vite statically detects and COMPILES the worker — splitting it to
// mutate a query param defeats that and ships the raw .ts (video/mp2t MIME).
interface WorkerHandles {
  tree: Promise<AtlasBundle>;
  ready: Promise<AtlasBundle>;
}
const workerCache = new Map<string, WorkerHandles>();

function toBundle(msg: {
  docs: Record<string, AtlasNode>;
  atlasCommit?: string | null;
  byParentEntries: [string | null, AtlasNode[]][];
  docNoToIdEntries: [string, string][];
}): AtlasBundle {
  return {
    docs: msg.docs,
    atlasCommit: msg.atlasCommit ?? null,
    byParent: new Map(msg.byParentEntries),
    docNoToId: new Map(msg.docNoToIdEntries),
  };
}

function spawn(base: string): WorkerHandles {
  let resolveTree!: (b: AtlasBundle) => void, rejectTree!: (e: Error) => void;
  let resolveReady!: (b: AtlasBundle) => void, rejectReady!: (e: Error) => void;
  const tree = new Promise<AtlasBundle>((res, rej) => { resolveTree = res; rejectTree = rej; });
  const ready = new Promise<AtlasBundle>((res, rej) => { resolveReady = res; rejectReady = rej; });

  const worker = new Worker(new URL("../workers/atlas.worker.ts", import.meta.url), {
    type: "module",
    name: base,
  });
  worker.addEventListener("message", (e) => {
    const msg = e.data;
    if (msg.type === "shallow") {
      resolveTree(toBundle(msg));
    } else if (msg.type === "ready") {
      resolveReady(toBundle(msg));
      worker.terminate();
    } else if (msg.type === "error") {
      worker.terminate();
      // Stale pinned sha (404 on /api/atlas/<sha>/) → force-forward reload
      // instead of surfacing an error; the page is on its way out.
      if (handledStaleMessage(msg.message)) return;
      const err = new Error(msg.message);
      rejectTree(err);
      rejectReady(err);
    }
  });
  return { tree, ready };
}

function handles(base: string): WorkerHandles {
  let h = workerCache.get(base);
  if (!h) {
    h = spawn(base);
    // Drop from cache on failure so the next call re-spawns the worker.
    h.ready.catch(() => workerCache.delete(base));
    workerCache.set(base, h);
  }
  return h;
}

/** Full atlas bundle (content merged in). Same contract as before the split. */
export function loadAtlas(base: string = liveAtlasBase()): Promise<AtlasBundle> {
  return handles(base).ready;
}

/** Metadata-only bundle (no content) — resolves early for the atlas tree. */
export function loadAtlasTree(base: string = liveAtlasBase()): Promise<AtlasBundle> {
  return handles(base).tree;
}

// Cache the derived promise per base so `use(loadDocs())` always sees the same
// identity across renders. Returning a fresh `.then(...)` each call makes React
// Suspense treat every render as a new suspended fetch, flashing the fallback
// and resetting scroll position.
const docsPromises = new Map<string, Promise<Record<string, AtlasNode>>>();

export function loadDocs(base: string = liveAtlasBase()): Promise<Record<string, AtlasNode>> {
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
