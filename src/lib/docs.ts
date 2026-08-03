import type { AtlasNode } from "../types";
import { liveAtlasBase, handledStaleMessage } from "./atlasBase";
import type { AtlasBundle } from "./docsTypes";

// AtlasBundle moved to the DOM-free ./docsTypes so server-side report builders
// can import it without this worker/atlasBase layer. Re-exported here so existing
// `import type { AtlasBundle } from "./docs"` callers keep working.
export type { AtlasBundle } from "./docsTypes";

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
//
// Keyed by data-source base (same key as workerCache/docsPromises above) —
// registerRefs is fed by EVERY resolved bundle, including preview bundles, so
// a single shared (unkeyed) index would let a preview's doc_no collide with
// and resolve to a live-atlas node id (or vice versa) once both had loaded in
// the same session. resolveAtlasRef takes the caller's base and only ever
// looks at that base's slice.
const refIndexes = new Map<string, { knownNodeIds: Set<string>; docNoIndex: Map<string, string> }>();

function refIndexFor(base: string): { knownNodeIds: Set<string>; docNoIndex: Map<string, string> } {
  let idx = refIndexes.get(base);
  if (!idx) {
    idx = { knownNodeIds: new Set(), docNoIndex: new Map() };
    refIndexes.set(base, idx);
  }
  return idx;
}

function registerRefs(base: string, b: AtlasBundle): void {
  const idx = refIndexFor(base);
  for (const id in b.docs) idx.knownNodeIds.add(id);
  for (const [docNo, id] of b.docNoToId) idx.docNoIndex.set(docNo, id);
}

/** Resolve an atlas reference fragment (UUID or doc_no) to an internal node id
 *  within `base`'s bundle, or undefined when it isn't a node we host there
 *  (caller should keep it external). */
export function resolveAtlasRef(base: string, fragment: string): string | undefined {
  const idx = refIndexes.get(base);
  if (!idx) return undefined;
  if (idx.knownNodeIds.has(fragment)) return fragment;
  return idx.docNoIndex.get(fragment);
}

function toBundle(
  base: string,
  msg: {
    docs: Record<string, AtlasNode>;
    atlasCommit?: string | null;
    byParentEntries: [string | null, AtlasNode[]][];
    docNoToIdEntries: [string, string][];
  },
): AtlasBundle {
  const bundle: AtlasBundle = {
    docs: msg.docs,
    atlasCommit: msg.atlasCommit ?? null,
    byParent: new Map(msg.byParentEntries),
    docNoToId: new Map(msg.docNoToIdEntries),
  };
  registerRefs(base, bundle);
  return bundle;
}

function spawn(base: string): WorkerHandles {
  let resolveShallow!: (b: AtlasBundle) => void, rejectShallow!: (e: Error) => void;
  let resolveFull!: (b: AtlasBundle) => void, rejectFull!: (e: Error) => void;
  const shallow = new Promise<AtlasBundle>((res, rej) => { resolveShallow = res; rejectShallow = rej; });
  const full = new Promise<AtlasBundle>((res, rej) => { resolveFull = res; rejectFull = rej; });
  // Has `shallow` already settled (via the "shallow" branch below, or by us
  // rejecting it)? Guards the "error" branch from double-settling it and tells
  // it whether shallow is still worth waiting on.
  let shallowSettled = false;

  const worker = new Worker(new URL("../workers/atlas.worker.ts", import.meta.url), {
    type: "module",
    name: base,
  });
  worker.addEventListener("message", (e) => {
    const msg = e.data;
    if (msg.type === "shallow") {
      shallowSettled = true;
      resolveShallow(toBundle(base, msg));
    } else if (msg.type === "ready") {
      resolveFull(toBundle(base, msg));
      worker.terminate();
    } else if (msg.type === "error") {
      // Stale pinned sha (404 on /api/atlas/<sha>/) → force-forward reload
      // instead of surfacing an error; the page is on its way out.
      if (handledStaleMessage(msg.message)) {
        worker.terminate();
        return;
      }
      const err = new Error(msg.message);
      // The worker posts ONE blanket "error" for Promise.all([shallowP,
      // deepP]) even when only docs-deep.json failed (atlas.worker.ts) —
      // rejecting `shallow` too, unconditionally, used to destroy a shallow
      // tree that had already loaded (or was about to: Promise.all rejects
      // the instant EITHER promise rejects, without waiting for the other, so
      // a fast deep failure can win the race against a still-in-flight
      // shallow fetch). fetchJson names the artifact in its thrown message
      // ("docs-deep.json: 404" — see lib/verify.ts), so use that to tell a
      // deep-only failure apart from one that also/only hit shallow.
      const deepOnly = msg.message.includes("docs-deep.json") && !msg.message.includes("docs-shallow.json");
      rejectFull(err);
      if (deepOnly && !shallowSettled) {
        // Leave the worker running instead of terminating it: its independent
        // shallow fetch (atlas.worker.ts's own separate shallowP.then/.catch)
        // may still resolve and post "shallow" above, which settles `shallow`
        // normally — exactly the case this exists to protect. If shallow
        // fails too, that rejection is swallowed worker-side with no second
        // message to catch it here (a gap only a dedicated shallow-error
        // message from the worker could close); this is the ambiguous/
        // both-failed branch below.
        return;
      }
      worker.terminate();
      if (!shallowSettled) {
        shallowSettled = true;
        rejectShallow(err);
      }
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
