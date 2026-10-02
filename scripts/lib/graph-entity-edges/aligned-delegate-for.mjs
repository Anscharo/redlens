// 2m. aligned_delegate_for (Pattern 10). Handles a list/prose-shaped registry.
// The registry doc is a table, so alignedDelegateNames is normally empty and
// build-graph Phase 2.7 emits these edges from the table rows instead.
import { ALIGNED_DELEGATES_UUID } from "../graph-patterns.mjs";

function run(ctx) {
  const registryDoc = ctx.docById.get(ALIGNED_DELEGATES_UUID);
  for (const name of ctx.alignedDelegateNames) {
    const entity = ctx.entityByName(name);
    if (entity && registryDoc) {
      ctx.addEdge(entity.id, "entity", ctx.skyGovernance.id, "entity", "aligned_delegate_for", [registryDoc.doc_no]);
    }
  }
}

export const pattern = { id: "2m", run };
