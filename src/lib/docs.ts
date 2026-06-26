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
// fetch of both browser docs artifacts: `shallow` resolves early (depth ≤ 5,
// content INCLUDED → sidebar + content first paint) and `full` resolves slightly
// later (all depths merged in → complete AtlasNode map). Consumers that want a
// progressive render await shallow then full (see useAtlasTree, useAtlasData).
// main → preview → main never crosses bundles because everything is keyed by
// base. The preview base is threaded via the worker `name` (read as self.name),
// keeping `new Worker(new URL(...))` inline so Vite statically detects and
// COMPILES the worker — splitting it to mutate a query param defeats that and
// ships the raw .ts (video/mp2t MIME).
interface WorkerHandles {
  shallow: Promise<AtlasBundle>;
  full: Promise<AtlasBundle>;
}
const workerCache = new Map<string, WorkerHandles>();

// Synchronous reference index, fed by every resolved bundle. Lets the markdown
// renderer turn an atlas reference fragment (a bare UUID or a doc_no, e.g. the
// `#…` of a sky-atlas.io deep-link embedded in atlas prose) into an internal
// node id without prop-drilling the whole bundle into NodeContent.
const knownNodeIds = new Set<string>();
const docNoIndex = new Map<string, string>();

function registerRefs(b: AtlasBundle): void {
  for (const id in b.docs) knownNodeIds.add(id);
  for (const [docNo, id] of b.docNoToId) docNoIndex.set(docNo, id);
}

/** Resolve an atlas reference fragment (UUID or doc_no) to an internal node id,
 *  or undefined when it isn't a node we host (caller should keep it external). */
export function resolveAtlasRef(fragment: string): string | undefined {
  if (knownNodeIds.has(fragment)) return fragment;
  return docNoIndex.get(fragment);
}

function toBundle(msg: {
  docs: Record<string, AtlasNode>;
  atlasCommit?: string | null;
  byParentEntries: [string | null, AtlasNode[]][];
  docNoToIdEntries: [string, string][];
}): AtlasBundle {
  const bundle: AtlasBundle = {
    docs: msg.docs,
    atlasCommit: msg.atlasCommit ?? null,
    byParent: new Map(msg.byParentEntries),
    docNoToId: new Map(msg.docNoToIdEntries),
  };
  registerRefs(bundle);
  return bundle;
}

function spawn(base: string): WorkerHandles {
  let resolveShallow!: (b: AtlasBundle) => void, rejectShallow!: (e: Error) => void;
  let resolveFull!: (b: AtlasBundle) => void, rejectFull!: (e: Error) => void;
  const shallow = new Promise<AtlasBundle>((res, rej) => { resolveShallow = res; rejectShallow = rej; });
  const full = new Promise<AtlasBundle>((res, rej) => { resolveFull = res; rejectFull = rej; });

  const worker = new Worker(new URL("../workers/atlas.worker.ts", import.meta.url), {
    type: "module",
    name: base,
  });
  worker.addEventListener("message", (e) => {
    const msg = e.data;
    if (msg.type === "shallow") {
      resolveShallow(toBundle(msg));
    } else if (msg.type === "ready") {
      resolveFull(toBundle(msg));
      worker.terminate();
    } else if (msg.type === "error") {
      worker.terminate();
      // Stale pinned sha (404 on /api/atlas/<sha>/) → force-forward reload
      // instead of surfacing an error; the page is on its way out.
      if (handledStaleMessage(msg.message)) return;
      const err = new Error(msg.message);
      rejectShallow(err);
      rejectFull(err);
    }
  });
  return { shallow, full };
}

function handles(base: string): WorkerHandles {
  let h = workerCache.get(base);
  if (!h) {
    h = spawn(base);
    // Drop from cache on failure so the next call re-spawns the worker.
    h.full.catch(() => workerCache.delete(base));
    workerCache.set(base, h);
  }
  return h;
}

/** Full atlas bundle — all depths, content merged in. Resolves once both
 *  docs-shallow.json and docs-deep.json have landed. */
export function loadAtlas(base: string = liveAtlasBase()): Promise<AtlasBundle> {
  return handles(base).full;
}

/** Shallow bundle — depth ≤ 5 (the initial visible tree, content included).
 *  Resolves early (the instant docs-shallow.json lands) for fast first paint;
 *  callers that also need deep nodes await loadAtlas afterward to upgrade. */
export function loadAtlasShallow(base: string = liveAtlasBase()): Promise<AtlasBundle> {
  return handles(base).shallow;
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
