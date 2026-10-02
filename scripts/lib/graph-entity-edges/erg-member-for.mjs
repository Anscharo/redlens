// 2r. erg_member_for (Pattern 7): each named ERG member → the ERG membership doc.
function run(ctx) {
  if (!ctx.ergDoc) return;
  for (const name of ctx.ergMemberNames) {
    const entity = ctx.entityByName(name);
    if (entity) ctx.addEdge(entity.id, "entity", ctx.ergDoc.id, "doc", "erg_member_for", [ctx.ergDoc.doc_no]);
  }
}

export const pattern = { id: "2r", run };
