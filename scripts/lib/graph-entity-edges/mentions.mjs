// 2v. mentions: doc → each address it contains.
import { normalizeAddress } from "../address-chains.mjs";

function run(ctx) {
  for (const d of ctx.allDocs) {
    for (const addr of d.addressRefs ?? []) {
      // addressRefs keep raw casing while addressesRaw is keyed by the normalized
      // form (EVM lowercased, Solana base58 as-is). The node id MUST match the
      // has_address side, or the graph splits around Solana addresses.
      const key = normalizeAddress(addr);
      const chain = ctx.addressesRaw[key]?.chain ?? "ethereum";
      ctx.addEdge(d.id, "doc", `${key}:${chain}`, "address", "mentions", [d.doc_no]);
    }
  }
}

export const pattern = { id: "2v", run };
