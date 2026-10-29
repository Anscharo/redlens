// keyHolders: which PAU contracts hold a rate-limit key, in the order the hover
// card lists them; keyAbsence: where a key none holds is known never set.
import { describe, expect, it } from "vitest";
import type { ContractState, LiveRateLimit, StoredPauSnapshot } from "./pau.ts";
import { keyAbsence, keyHolders } from "./pauKeyHolders.ts";

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
  it("leaves out a contract a live read found never set the key on", () => {
    const res = { deployments: [snap("Spark", "ethereum", "monolithic", [rl("0x1", { unsetKeys: [KEY] })]), snap("Spark", "base", "monolithic", [rl("0x2", { rateLimits: [limit(KEY)] })])] };
    expect(keyHolders(res, KEY).map((h) => h.contract)).toEqual(["0x2"]);
  });
  it("finds nothing for a hash no contract holds", () => {
    expect(keyHolders({ deployments: [snap("Spark", "ethereum", "monolithic", [rl("0x1", { rateLimits: [limit(OTHER)] })])] }, KEY)).toEqual([]);
  });
  it("says where a key no contract holds was read live and found never set, and which of the same primes' contracts were not read", () => {
    const res = {
      deployments: [
        snap("Spark", "base", "monolithic", [rl("0x1", { unsetKeys: [KEY.toUpperCase().replace("0X", "0x")] })]),
        snap("Spark", "ethereum", "monolithic", [rl("0x2", { unsetKeys: [KEY], rateLimits: [limit(OTHER)] })]),
        snap("Spark", "arbitrum", "monolithic", [rl("0x3", { rateLimits: [limit(OTHER)] })]),
        snap("Grove", "ethereum", "monolithic", [rl("0x4", {})]),
      ],
    };
    const absence = keyAbsence(res, KEY)!;
    expect(absence.unset.map((p) => p.contract)).toEqual(["0x2", "0x1"]);
    expect(absence.unread.map((p) => p.contract)).toEqual(["0x3"]);
  });
  it("gives no absence for a key some contract holds, or one no live read found unset", () => {
    const held = { deployments: [snap("Spark", "base", "monolithic", [rl("0x1", { unsetKeys: [KEY] })]), snap("Spark", "ethereum", "monolithic", [rl("0x2", { rateLimits: [limit(KEY)] })])] };
    expect(keyAbsence(held, KEY)).toBeNull();
    expect(keyAbsence({ deployments: [snap("Spark", "ethereum", "monolithic", [rl("0x1", { rateLimits: [limit(OTHER)] })])] }, KEY)).toBeNull();
  });
  it("orders by prime, then Ethereum first, then chain, monolithic before diamond", () => {
    const held = (p: string, c: string, k: "monolithic" | "diamond") => snap(p, c, k, [rl(`${p}:${c}:${k}`, { rateLimits: [limit(KEY)] })]);
    const res = { deployments: [held("Spark", "base", "monolithic"), held("Spark", "ethereum", "diamond"), held("Grove", "ethereum", "monolithic"), held("Spark", "ethereum", "monolithic"), held("Spark", "arbitrum", "monolithic")] };
    expect(keyHolders(res, KEY).map((h) => h.contract)).toEqual(["Grove:ethereum:monolithic", "Spark:ethereum:monolithic", "Spark:ethereum:diamond", "Spark:arbitrum:monolithic", "Spark:base:monolithic"]);
  });
});
