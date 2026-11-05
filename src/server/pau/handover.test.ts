// crawlOwnedChains: every chain the crawl has a source for, less those where
// the explorer is ahead of the crawl; a chain with no source is never the
// crawl's. The query itself is checked against Postgres (see the PAU
// CLAUDE.md, "Reading from HyperSync or JSON-RPC").
import { describe, expect, it } from "bun:test";
import type { PauRegistry } from "../../lib/pauRegistry.ts";
import { crawlOwnedChains } from "./handover.ts";

const A = "0x" + "a".repeat(40);
const dep = (chain: string) => ({ prime: "p", primeName: "P", chain, kind: "monolithic", members: [{ role: "rateLimits", address: A, provenance: [] }] });
const reg = { shared: [], ignored: [], deployments: ["base", "ethereum", "optimism", "xlayer"].map(dep) } as unknown as PauRegistry;
const src = { url: "s", blocks: 1, head: async () => 1, deployBlock: async () => 0, logs: async () => ({ logs: [], to: 0 }) };

/** A database where the explorer is ahead of the crawl on `ahead`; counts the queries. */
function fakeDb(ahead: string[]) {
  const calls = { n: 0 };
  const db = async () => {
    calls.n++;
    return ahead.map((chain) => ({ chain }));
  };
  return { db: db as never, calls };
}

describe("crawlOwnedChains", () => {
  it("takes every sourced chain the explorer is not ahead on, in one query", async () => {
    const { db, calls } = fakeDb(["ethereum", "xlayer"]);
    const owned = await crawlOwnedChains(db, reg, (c) => (c === "xlayer" ? [] : [src]));
    expect([...owned].sort()).toEqual(["base", "optimism"]);
    expect(calls.n).toBe(1);
  });
  it("leaves every chain to the explorer, without a query, when no chain has a source", async () => {
    const { db, calls } = fakeDb([]);
    expect(await crawlOwnedChains(db, reg, () => [])).toEqual(new Set());
    expect(calls.n).toBe(0);
  });
});
