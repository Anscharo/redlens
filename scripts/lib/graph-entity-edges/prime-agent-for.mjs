// 2i. prime_agent_for: each Prime Agent → Sky Core (Pattern 1).
import { isPrimeAgent } from "../graph-patterns.mjs";

function run(ctx) {
  for (const d of ctx.allDocs.filter(isPrimeAgent)) {
    const ent = ctx.entityByDocId.get(d.id);
    if (ent) ctx.addEdge(ent.id, "entity", ctx.skyCore.id, "entity", "prime_agent_for", [d.doc_no]);
  }
}

export const pattern = { id: "2i", run };
