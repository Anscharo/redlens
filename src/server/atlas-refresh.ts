// Incremental in-memory index updates for the in-process self-updater
// (docs/plans/atlas-runtime-freshness-inprocess.md).
//
// STATUS — these are the *optimization* half, deliberately NOT yet wired into a
// live update path. The shipping path is full rebuild + `setIndexes` (see
// indexes.ts `rebuildFromDisk`): correct, with a clean snapshot model. `patchDocs`
// only mutates the doc/MiniSearch side; it is the doc-half of the eventual single
// in-place updater whose other half is in-place graphology reconcile (addNode/
// dropNode/addEdge/dropEdge). You cannot cheaply prove a doc delta is edge-free
// without running relation extraction on the changed docs — which *is* the graph
// reconcile work — so do NOT branch "doc-only → patch, else → rebuild": that
// collapses to "always rebuild". Wire `patchDocs` only once graph reconcile exists,
// and never mix mechanisms in one update (patch mutates the live object; setIndexes
// swaps a new one — patch-then-swap would drop the in-place edits).
//
// ATOMICITY — `patchDocs` is SYNCHRONOUS on purpose: the single-threaded event
// loop cannot interleave a request handler mid-call, so no query observes a
// half-applied delta and no clone is needed. Two rules keep that true:
//   1. never introduce an `await` into patchDocs;
//   2. `vacuum` is async — rely on MiniSearch auto-vacuum or call it un-awaited;
//      `discard`/`replace` exclude docs from results immediately, before cleanup.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { contentHash } from "./embed-text.ts";
import { config } from "./config.ts";
import { buildGraph, readArtifactsFromDisk } from "./indexes.ts";
import type { AtlasNode, Edge, Entity, Indexes } from "./indexes.ts";

export interface DocDelta {
  added: AtlasNode[];
  changed: AtlasNode[];
  removed: string[]; // doc ids
}

export function isEmptyDelta(d: DocDelta): boolean {
  return d.added.length === 0 && d.changed.length === 0 && d.removed.length === 0;
}

// Compute the doc-level delta by comparing per-doc `contentHash` (title+content,
// renumber-stable) — the same hash sync.ts and sync-embeddings.ts key on, so
// "changed" means one thing across all three lanes. `id`-only comparison would
// miss modifications (the common case), hence hashing.
export function diffDocs(oldDocs: Map<string, AtlasNode>, newDocs: AtlasNode[]): DocDelta {
  const added: AtlasNode[] = [];
  const changed: AtlasNode[] = [];
  const newIds = new Set<string>();

  for (const doc of newDocs) {
    newIds.add(doc.id);
    const prev = oldDocs.get(doc.id);
    if (!prev) added.push(doc);
    else if (contentHash(prev) !== contentHash(doc)) changed.push(doc);
  }

  const removed: string[] = [];
  for (const id of oldDocs.keys()) if (!newIds.has(id)) removed.push(id);

  return { added, changed, removed };
}

// Mutate the live indexes in place for a doc delta. SYNCHRONOUS = atomic (see
// header). Mutates the expensive MiniSearch index per-doc, then rebuilds the
// cheap derived maps (byDocNo, childrenIndex) from the updated docMap — an O(n)
// pass over a Map, far cheaper than the index work avoided, and immune to the
// subtle bugs of surgically patching parentId/doc_no/order changes by hand.
//
// Does NOT touch the graphology graph or entity/edge arrays (the global half).
export function patchDocs(ix: Indexes, delta: DocDelta): void {
  for (const id of delta.removed) {
    ix.docMap.delete(id);
    if (ix.mini.has(id)) ix.mini.discard(id);
  }
  for (const doc of delta.added) {
    ix.docMap.set(doc.id, doc);
    if (!ix.mini.has(doc.id)) ix.mini.add(doc);
  }
  for (const doc of delta.changed) {
    ix.docMap.set(doc.id, doc);
    // replace = discard-by-id + add; id is unchanged so it stays addressable.
    if (ix.mini.has(doc.id)) ix.mini.replace(doc);
    else ix.mini.add(doc);
  }
  rebuildDerivedMaps(ix);
}

function rebuildDerivedMaps(ix: Indexes): void {
  const byDocNo = new Map<string, AtlasNode>();
  const childrenIndex = new Map<string, AtlasNode[]>();
  for (const d of ix.docMap.values()) {
    byDocNo.set(d.doc_no, d);
    if (d.parentId) {
      const arr = childrenIndex.get(d.parentId);
      if (arr) arr.push(d);
      else childrenIndex.set(d.parentId, [d]);
    }
  }
  for (const arr of childrenIndex.values()) arr.sort((a, b) => a.order - b.order);
  ix.byDocNo = byDocNo;
  ix.childrenIndex = childrenIndex;
}

// ── In-place update (the subprocess-shrink path) ────────────────────────────
// The subprocess regenerates docs.json/graph.json/manifest but NOT
// search-index.json (BUILD_SKIP_SEARCH_INDEX=1), so the server owns the index:
// it patches its live MiniSearch and re-serializes it to disk. SYNCHRONOUS =
// atomic on the event loop (see header). The graph is rebuilt wholesale from the
// fresh graph.json (relation extraction already ran in the subprocess; in-memory
// graphology construction is cheap) and reassigned in place.

// Pure mutation: patch the live indexes for the new artifact arrays; returns the
// doc delta. No disk I/O (testable). The new graph is built into locals BEFORE
// any mutation, so a malformed graph.json throws here and leaves `ix` untouched.
export function applyInPlaceUpdate(
  ix: Indexes,
  newDocs: AtlasNode[],
  entities: Entity[],
  edges: Edge[],
  meta: Record<string, string | null>,
): DocDelta {
  const delta = diffDocs(ix.docMap, newDocs);
  const { graph, entityBySlug, entityById } = buildGraph(newDocs, entities, edges);
  // Commit — synchronous, no awaits, no expected throws past here:
  patchDocs(ix, delta);
  ix.graph = graph;
  ix.entities = entities;
  ix.edges = edges;
  ix.entityBySlug = entityBySlug;
  ix.entityById = entityById;
  ix.meta = meta; // advances atlasCommit — the convergence signal
  return delta;
}

// Disk orchestration: read the freshly-built artifacts, apply in place, then
// re-serialize the patched index to public/ + dist/ for the browser (the
// subprocess skipped building it).
export function refreshInPlaceFromDisk(ix: Indexes): DocDelta {
  const { docs, entities, edges, meta } = readArtifactsFromDisk();
  const delta = applyInPlaceUpdate(ix, docs, entities, edges, meta);
  const idxJson = JSON.stringify(ix.mini.toJSON());
  writeFileSync(join(config.publicDir, "search-index.json"), idxJson);
  try {
    writeFileSync(join(config.distDir, "search-index.json"), idxJson);
  } catch {
    /* dev: no dist/ */
  }
  return delta;
}
