// 2o. holds_role_for (Pattern 11): role holder → the role-binding doc.
function run(ctx) {
  for (const { holder, bindingDoc, roleSlug } of ctx.roleBindings) {
    const meta = JSON.stringify({ role: roleSlug });
    ctx.addEdge(holder.id, "entity", bindingDoc.id, "doc", "holds_role_for", [bindingDoc.doc_no], meta);
  }
}

export const pattern = { id: "2o", run };
