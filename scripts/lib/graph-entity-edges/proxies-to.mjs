// 2x. proxies_to: proxy address → its implementation address, on the same chain.
import { normalizeAddress } from "../address-chains.mjs";

function run(ctx) {
  for (const [addr, info] of Object.entries(ctx.addressesRaw)) {
    if (!info.implementation) continue;
    const chain = info.chain ?? "ethereum";
    const from = `${normalizeAddress(addr)}:${chain}`;
    ctx.addEdge(from, "address", `${normalizeAddress(info.implementation)}:${chain}`, "address", "proxies_to", []);
  }
}

export const pattern = { id: "2x", run };
