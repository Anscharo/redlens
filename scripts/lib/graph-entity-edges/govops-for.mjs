// 2l. {operational,core}_govops_for (Pattern 5): the GovOps org named in a
// GovOps-assignment doc → the executor agent that doc sits under.
import { isGovOpsDoc, extractAssignment } from "../graph-patterns.mjs";

// Regex source handed to extractAssignment; graph-entities.mjs reads the same assignment sentence.
export const GOVOPS_FOR_PREFIX = "(?:(?:Operational|Core) )?GovOps for [^.]+";

function run(ctx) {
  for (const d of ctx.allDocs.filter(isGovOpsDoc)) {
    const isCore = /core govops/i.test(d.title);
    const name = extractAssignment(d.content, GOVOPS_FOR_PREFIX);
    if (!name) continue;
    const govEntity = ctx.entityByName(name);
    const executorDoc = d.parentId ? ctx.docById.get(d.parentId) : null;
    const executorEntity = executorDoc ? ctx.entityByDocId.get(executorDoc.id) : null;
    if (!govEntity || !executorEntity) continue;
    const edgeType = isCore ? "core_govops_for" : "operational_govops_for";
    ctx.addEdge(govEntity.id, "entity", executorEntity.id, "entity", edgeType, [d.doc_no]);
  }
}

export const pattern = { id: "2l", run };
