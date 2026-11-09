// A Curve pool's coins stop at the first index it does not answer; a vault's
// owner and curator are kept as it answers them, and it is asked about exactly
// the accounts the atlas names to its allocator and sentinel roles. A target
// that answers nothing gets no entry.
import { describe, expect, it } from "bun:test";
import type { ContractState, LiveRateLimit, PauSnapshot } from "../../lib/pau.ts";
import type { ChainCall } from "./snapshot.ts";
import { withTargets } from "./targets.ts";
import { atlasRoleClaims } from "./role-claims.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [POOL, VAULT, USDC, USDT, OWNER, ALLOC, OTHER, DEAD] = ["1", "2", "3", "4", "5", "6", "7", "8"].map((c) => "0x" + c.repeat(40));

const lim = (constant: string, args: string[]) => ({ key: constant, derived: { constant, args } }) as unknown as LiveRateLimit;
const snap = (limits: LiveRateLimit[]): PauSnapshot => ({
  deployment: "d", prime: "p", primeName: "P", chain: "ethereum", kind: "monolithic",
  contracts: [{ role: "rateLimits", address: "0xrl", events: 1, historyComplete: true, rateLimits: limits } as ContractState],
});

const ANSWERS: Record<string, Record<string, unknown>> = {
  [POOL]: { "coins:0": USDC.toUpperCase().replace("0X", "0x"), "coins:1": USDT },
  [VAULT]: { owner: OWNER, curator: OWNER, [`isAllocator:${ALLOC}`]: true, [`isAllocator:${OTHER}`]: false },
};
const calls: ChainCall[] = [];
const read = async (_chain: string, cs: ChainCall[]) => {
  calls.push(...cs);
  return cs.map((c) => ANSWERS[c.address]?.[[c.functionName, ...c.args.map(String)].join(":")] ?? null);
};

describe("withTargets", () => {
  it("reads a Curve pool's coins up to the first it does not answer", async () => {
    const out = await withTargets(snap([lim("LIMIT_CURVE_SWAP", [POOL])]), read);
    expect(out.targets).toEqual({ [POOL]: { coins: [USDC, USDT] } });
  });
  it("reads a vault's owner and curator, and its role for each claimed account", async () => {
    calls.length = 0;
    const claims = new Map([[VAULT, { allocators: [ALLOC, OTHER], sentinels: [] }]]);
    const out = await withTargets(snap([lim("LIMIT_4626_DEPOSIT", [VAULT])]), read, claims);
    expect(out.targets?.[VAULT]).toEqual({ owner: OWNER, curator: OWNER, allocators: { [ALLOC]: true, [OTHER]: false } });
    expect(calls.filter((c) => c.functionName === "isSentinel")).toEqual([]);
  });
  it("keeps no entry for a target that answers nothing, and reads nothing without one", async () => {
    expect((await withTargets(snap([lim("LIMIT_4626_DEPOSIT", [DEAD])]), read)).targets).toBeUndefined();
    calls.length = 0;
    expect((await withTargets(snap([lim("LIMIT_USDS_MINT", [])]), read)).targets).toBeUndefined();
    expect(calls).toEqual([]);
  });
});

describe("atlasRoleClaims", () => {
  it("collects each vault's named allocators and sentinels from its instance's role params", () => {
    const params = {
      "Token Address": [VAULT.toUpperCase().replace("0X", "0x"), "d"],
      "Allocator Role Addresses": [`| Entity | Address |\n| A | \`${ALLOC}\` |\n| B | \`${OTHER}\` |`, "d"],
      "Sentinel Role Address": [`Held at \`${OWNER}\`.`, "d"],
      "Owner Role Address": [DEAD, "d"],
    };
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "claims-")), "graph.json");
    fs.writeFileSync(file, JSON.stringify({ entities: [{ meta: JSON.stringify({ params }) }, { meta: { params: { "Allocator Role Address": [ALLOC, "d"] } } }] }));
    expect([...atlasRoleClaims(file)]).toEqual([[VAULT, { allocators: [ALLOC, OTHER], sentinels: [OWNER] }]]);
  });
  it("claims nothing without a graph", () => {
    expect(atlasRoleClaims("/nonexistent/graph.json").size).toBe(0);
  });
});
