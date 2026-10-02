// 2t. defines_entity: defining doc → the entity it defines.
function run(ctx) {
  for (const e of ctx.entityMap.values()) {
    if (e.defining_doc_id && ctx.docIds.has(e.defining_doc_id)) {
      ctx.addEdge(e.defining_doc_id, "doc", e.id, "entity", "defines_entity", []);
    }
  }
}

export const pattern = { id: "2t", run };
