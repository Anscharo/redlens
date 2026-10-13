// The registry marks an ALM proxy `freezable` exactly where its verified
// contract is an ALMProxyFreezable, so a page can tell the two proxies of one
// deployment apart. A proxy with no cached source is not judged.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PauRegistry } from "./pauRegistry.ts";

const root = path.join(import.meta.dirname, "../..");
const registry = JSON.parse(readFileSync(path.join(root, "src/data/pau-registry.json"), "utf8")) as PauRegistry;
const chains = JSON.parse(readFileSync(path.join(root, "src/data/chain-registry.json"), "utf8")).chains as { chain: string; chainId: number }[];
const cache = path.join(root, ".cache/etherscan");

/** The verified contract name cached for an address on a chain: one address can be a different contract on each. */
function contractName(chain: string, address: string): string | null {
  const id = chains.find((c) => c.chain === chain)?.chainId;
  const file = path.join(cache, String(id), `${address}.json`);
  return id !== undefined && existsSync(file) ? ((JSON.parse(readFileSync(file, "utf8")) as { contractName?: string }).contractName ?? null) : null;
}

describe("freezable ALM proxy labels", () => {
  it("label an ALM proxy `freezable` iff its verified contract is ALMProxyFreezable", () => {
    const proxies = [...registry.deployments, ...registry.shared].flatMap((d) => d.members.filter((m) => m.role === "almProxy").map((m) => ({ ...m, chain: d.chain })));
    const wrong = proxies.flatMap((m) => {
      const name = contractName(m.chain, m.address);
      return name !== null && (name === "ALMProxyFreezable") !== (m.label === "freezable") ? [`${m.address}: ${name}, label ${m.label ?? "none"}`] : [];
    });
    expect(wrong).toEqual([]);
  });
});
