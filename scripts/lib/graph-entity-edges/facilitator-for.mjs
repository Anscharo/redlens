// 2k. {operational,core}_facilitator_for (Pattern 5): the facilitator named in a
// facilitator-assignment doc → the executor agent that doc sits under.
import { isFacilitatorDoc, extractAssignment } from "../graph-patterns.mjs";

function run(ctx) {
  for (const d of ctx.allDocs.filter(isFacilitatorDoc)) {
    const isCore = /core executor facilitator/i.test(d.title);
    const name = extractAssignment(d.content, "(?:The )?(?:(?:Operational|Core) (?:Executor )?)?Facilitator for [^.]+");
    if (!name) continue;
    const facEntity = ctx.entityByName(name);
    const executorDoc = d.parentId ? ctx.docById.get(d.parentId) : null;
    const executorEntity = executorDoc ? ctx.entityByDocId.get(executorDoc.id) : null;
    if (!facEntity || !executorEntity) continue;
    const edgeType = isCore ? "core_facilitator_for" : "operational_facilitator_for";
    ctx.addEdge(facEntity.id, "entity", executorEntity.id, "entity", edgeType, [d.doc_no]);
  }
}

export const pattern = { id: "2k", run };
