// 2n. ranked_delegate_for (Pattern 10), carrying the rank level in meta.level.
function run(ctx) {
  for (const [level, items] of ctx.rankedDelegatesByLevel) {
    for (const { name, docNo } of items) {
      const entity = ctx.entityByName(name);
      if (!entity) continue;
      const meta = JSON.stringify({ level });
      ctx.addEdge(entity.id, "entity", ctx.skyGovernance.id, "entity", "ranked_delegate_for", [docNo], meta);
    }
  }
}

export const pattern = { id: "2n", run };
