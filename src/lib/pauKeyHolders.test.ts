// keyHolders: which PAU contracts have a rate-limit key, live or probed unset,
// in the order the hover card lists them.
import { describe, expect, it } from "vitest";
import type { ContractState, LiveRateLimit, StoredPauSnapshot } from "./pau.ts";
import { keyHolders } from "./pauKeyHolders.ts";

const KEY = "0x" + "ab".repeat(32);
const OTHER = "0x" + "cd".repeat(32);
const limit = (key: string): LiveRateLimit => ({
  key,
  configured: { maxAmount: "1", slope: "1" },
  setAt: { block: 1, time: "2026-01-01T00:00:00Z", tx: "0x" },
  changes: 1,
  data: { maxAmount: "1", slope: "1", lastAmount: "1", lastUpdated: "1" },
  available: "1",
});
const rl = (address: string, extra: Partial<ContractState>): ContractState => ({ role: "rateLimits", address, events: 0, historyComplete: true, ...extra }) as ContractState;
const snap = (primeName: string, chain: string, kind: "monolithic" | "diamond", contracts: ContractState[]) =>
  ({ deployment: `${primeName}:${chain}:${kind}`, prime: primeName, primeName, chain, kind, contracts, fetchedAt: "" }) as StoredPauSnapshot;

describe("keyHolders", () => {
  it("finds the key on every contract holding it, matched without regard to case", () => {
    const res = { deployments: [snap("Spark", "base", "monolithic", [rl("0x1", { rateLimits: [limit(KEY.toUpperCase().replace("0X", "0x"))] })]), snap("Grove", "ethereum", "monolithic", [rl("0x2", { rateLimits: [limit(OTHER)] })])] };
    expect(keyHolders(res, KEY).map((h) => h.contract)).toEqual(["0x1"]);
  });
  it("lists a key a live read found unset with no limit", () => {
    const res = { deployments: [snap("Spark", "ethereum", "monolithic", [rl("0x1", { unsetKeys: [KEY] })])] };
    expect(keyHolders(res, KEY)).toEqual([expect.objectContaining({ contract: "0x1", limit: null })]);
  });
  it("finds nothing for a hash no contract holds", () => {
    expect(keyHolders({ deployments: [snap("Spark", "ethereum", "monolithic", [rl("0x1", { rateLimits: [limit(OTHER)] })])] }, KEY)).toEqual([]);
  });
  it("orders by prime, then Ethereum first, then chain, monolithic before diamond", () => {
    const held = (p: string, c: string, k: "monolithic" | "diamond") => snap(p, c, k, [rl(`${p}:${c}:${k}`, { rateLimits: [limit(KEY)] })]);
    const res = { deployments: [held("Spark", "base", "monolithic"), held("Spark", "ethereum", "diamond"), held("Grove", "ethereum", "monolithic"), held("Spark", "ethereum", "monolithic"), held("Spark", "arbitrum", "monolithic")] };
    expect(keyHolders(res, KEY).map((h) => h.contract)).toEqual(["Grove:ethereum:monolithic", "Spark:ethereum:monolithic", "Spark:ethereum:diamond", "Spark:arbitrum:monolithic", "Spark:base:monolithic"]);
  });
});
