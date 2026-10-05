import { liveAtlasBase } from "./atlasBase";

// Is the reader's semantic search lane usable right now? Same shape as
// chatEnabled() / usersEnabled(): read the serve-time injection once, never
// touch `window.__…` anywhere else.
//
// Unlike those two there is no build-time half. The lane ships in every bundle
// (it is a fetch and a merge, nothing to tree-shake) and is purely a runtime
// capability of the deployment serving it — an embedding key and a Postgres
// with populated `atlas_doc_embeddings`. Static hosting leaves the placeholder
// unreplaced, which reads as unavailable; correct, since there is no /api there.
//
// This is the ONLY semantic injection. Meaning-matched rows appear on the
// meaning lane and nowhere else, so there is no blend for a deployment to
// choose: either it can answer that lane or it cannot.
export function semanticSearchAvailable(): boolean {
  return window.__SEMANTIC_SEARCH__ === true;
}

// The lane answers from the LIVE pgvector index — `/api/search/semantic` has no
// per-sha or per-preview form, and the ids it returns are hydrated against
// whatever docs.json the worker loaded. On a preview or sha-pinned base those
// are two different atlases: ids from live main would be dropped silently, or
// worse, point at a different document. So the lane is offered only where the
// base it would be fused into IS the live one.
//
// Both the pill and the ?lane= coercion read THIS, not the flag above, so they
// cannot disagree about where the lane is usable.
export function semanticLaneUsable(base: string): boolean {
  return semanticSearchAvailable() && base === liveAtlasBase();
}
