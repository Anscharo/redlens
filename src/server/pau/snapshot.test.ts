// buildSnapshot with a fake chain: which contracts are read, that every
// replayed holder is confirmed with hasRole, that rate limits are read live in
// key order, and that a failed read stays null rather than becoming "false".
import { describe, expect, it } from "bun:test";
import { keccak256, toHex } from "viem";
import type { PauDeployment } from "../../lib/pauRegistry.ts";
import type { PauEventRow } from "./replay.ts";
import { buildSnapshot, type ChainCall } from "./snapshot.ts";

const RELAYER = keccak256(toHex("RELAYER"));
const CTRL = "0x" + "c".repeat(40);
const RL = "0x" + "1".repeat(40);
const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);
const m = (role: string, address: string) => ({ role, address, provenance: [] });
const d = { prime: "p", primeName: "Spark", chain: "ethereum", kind: "monolithic", members: [m("controller", CTRL), m("rateLimits", RL), m("relayer", A)] } as PauDeployment;
const row = (contract: string, event: string, args: Record<string, unknown>, block = 1): PauEventRow => ({ contract, event, args, block, block_time: "2026-01-01T00:00:00.000Z", tx_hash: "0xt" });

const events: Record<string, PauEventRow[]> = {
  [CTRL]: [row(CTRL, "RoleGranted", { role: RELAYER, account: A }), row(CTRL, "RoleGranted", { role: RELAYER, account: B }), row(CTRL, "MaxSlippageSet", { pool: A, maxSlippage: "9" })],
  [RL]: [row(RL, "RateLimitDataSet", { key: "0xk1", maxAmount: "10", slope: "1" }), row(RL, "RateLimitDataSet", { key: "0xk2", maxAmount: "20", slope: "2" })],
};

describe("buildSnapshot", () => {
  it("reads the PAU contracts only, confirming holders and reading every rate-limit key", async () => {
    const seen: ChainCall[] = [];
    const read = async (_chain: string, calls: ChainCall[]) => {
      seen.push(...calls);
      return calls.map((c) => {
        if (c.functionName === "hasRole") return c.args[1] === A ? true : null;
        if (c.functionName === "getRateLimitData") return c.args[0] === "0xk1" ? { maxAmount: 10n, slope: 1n, lastAmount: 4n, lastUpdated: 7n } : null;
        return c.args[0] === "0xk1" ? 6n : null;
      });
    };
    const snap = await buildSnapshot(d, read, async (_c, a) => ({ events: events[a] ?? [], complete: a === RL }));
    expect(snap).toMatchObject({ deployment: "p:ethereum:monolithic", primeName: "Spark", chain: "ethereum", kind: "monolithic" });
    expect(snap.contracts.map((c) => c.role)).toEqual(["controller", "rateLimits"]);
    const [ctrl, rl] = snap.contracts;
    expect(ctrl.roles?.map((r) => [r.account, r.name, r.holds])).toEqual([[A, "RELAYER", true], [B, "RELAYER", null]]);
    expect(ctrl.params?.map((p) => p.subject)).toEqual([A]);
    expect(ctrl.events).toBe(3);
    expect([ctrl.historyComplete, rl.historyComplete]).toEqual([false, true]);
    expect(rl.rateLimits?.map((r) => [r.key, r.data, r.available])).toEqual([
      ["0xk1", { maxAmount: "10", slope: "1", lastAmount: "4", lastUpdated: "7" }, "6"],
      ["0xk2", null, null],
    ]);
    expect(seen.every((c) => c.address === CTRL || c.address === RL)).toBe(true);
  });
  it("lists a contract with no stored history and asks the chain nothing about it", async () => {
    let calls = 0;
    const snap = await buildSnapshot(d, async (_c, cs) => ((calls += cs.length), []), async () => ({ events: [], complete: false }));
    expect(snap.contracts.map((c) => [c.role, c.events, c.roles, c.rateLimits])).toEqual([["controller", 0, undefined, undefined], ["rateLimits", 0, undefined, undefined]]);
    expect(calls).toBe(0);
  });
});
