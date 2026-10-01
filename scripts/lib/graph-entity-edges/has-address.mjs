// 2u. has_address: entity → each address labelled with its name.
function run(ctx) {
  for (const [slug, entity] of ctx.entityMap) {
    for (const { addr, chain } of ctx.labelToAddresses.get(slug) ?? []) {
      ctx.addEdge(entity.id, "entity", `${addr}:${chain}`, "address", "has_address", []);
    }
  }
}

export const pattern = { id: "2u", run };
