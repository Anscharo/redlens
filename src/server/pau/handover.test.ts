// crawlOwnedChains: a crawl-only chain is the crawl's at once; a chain the
// crawl reads only through HyperSync stays on the explorer until its crawl has
// caught up; a chain with no log source is never the crawl's. The query itself
// is checked against Postgres (see the PAU CLAUDE.md, "Reading from HyperSync").
import { describe, expect, it } from "bun:test";
import type { PauRegistry } from "../../lib/pauRegistry.ts";
import { crawlOwnedChains } from "./handover.ts";

const A = "0x" + "a".repeat(40);
const dep = (chain: string) => ({ prime: "p", primeName: "P", chain, kind: "monolithic", members: [{ role: "rateLimits", address: A, provenance: [] }] });
const reg = { shared: [], ignored: [], deployments: ["base", "ethereum", "optimism", "xlayer"].map(dep) } as unknown as PauRegistry;
const src = { url: "s", blocks: 1, head: async () => 1, deployBlock: async () => 0, logs: async () => ({ logs: [], to: 0 }) };

/** A database whose crawl has caught up on `caughtUp` only; records which chains were asked. */
function fakeDb(caughtUp: Set<string>) {
  const asked: string[] = [];
  const db = async (_s: TemplateStringsArray, ...v: unknown[]) => {
    const chain = String(v[0]);
    asked.push(chain);
    return [{ crawled: 1, behind: caughtUp.has(chain) ? 0 : 1 }];
  };
  return { db: db as never, asked };
}

describe("crawlOwnedChains", () => {
  it("takes crawl-only chains at once and HyperSync chains once caught up", async () => {
    const { db, asked } = fakeDb(new Set(["optimism"]));
    const sources = (c: string) => (c === "xlayer" ? [] : [src]);
    const owned = await crawlOwnedChains(db, reg, sources, (c) => c === "base");
    expect([...owned].sort()).toEqual(["base", "optimism"]);
    expect(asked.sort()).toEqual(["ethereum", "optimism"]);
  });
  it("leaves every chain to the explorer when no chain has a source", async () => {
    const { db } = fakeDb(new Set(["ethereum"]));
    expect(await crawlOwnedChains(db, reg, () => [], () => false)).toEqual(new Set());
  });
});
