// Is the reader's semantic search lane usable right now, and how should it
// blend? Same shape as chatEnabled() / usersEnabled(): read the serve-time
// injection once, never touch `window.__…` anywhere else.
//
// Unlike those two there is no build-time half. The lane ships in every bundle
// (it is a fetch and a merge, nothing to tree-shake) and is purely a runtime
// capability of the deployment serving it — an embedding key and a Postgres
// with populated `atlas_doc_embeddings`. Static hosting leaves the placeholder
// unreplaced, which reads as unavailable; correct, since there is no /api there.
import { isSemanticStrategy, type SemanticStrategy } from "@/lib/searchSemantic";

export function semanticSearchAvailable(): boolean {
  return window.__SEMANTIC_SEARCH__ === true;
}

/** The deployment's default blend for the lexical lane; "off" when unavailable. */
export function semanticStrategyDefault(): SemanticStrategy {
  if (!semanticSearchAvailable()) return "off";
  const injected = window.__SEMANTIC_STRATEGY__;
  return isSemanticStrategy(injected) ? injected : "fallback";
}
