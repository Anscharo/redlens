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
