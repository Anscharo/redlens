// Keys an instance lists by address: a RateLimitID param holding an address
// names the prime's keys derived from it, marked `via`, and never overrides a
// key the atlas states by hash.
import { describe, expect, it } from "vitest";
import type { StoredPauSnapshot } from "./pau.ts";
import { addressKeyIndex, keysFromAddress, listedAddress, withAddressKeys } from "./pauAddressKeys.ts";

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const DEPOSIT = "0xD1917664bE3FdAea377f6E8D5BF043ab5C3b1312";
const KEY = "0x" + "d0".repeat(32);
const OTHER = "0x" + "e0".repeat(32);
const at = { block: 1, time: "", tx: "" };
const limit = (key: string, args: string[]) => ({ key, configured: { maxAmount: "0", slope: "0" }, setAt: at, changes: 1, data: null, available: null, derived: { constant: "LIMIT_ASSET_TRANSFER", args } });
const snap = { deployment: "p:ethereum:monolithic", prime: "p", primeName: "Spark", chain: "ethereum", kind: "monolithic", fetchedAt: "", contracts: [
  { role: "rateLimits", address: "0x1", events: 2, historyComplete: true, rateLimits: [limit(KEY, [USDC.toLowerCase(), DEPOSIT.toLowerCase()]), limit(OTHER, [USDC.toLowerCase(), "0x" + "9".repeat(40)])] },
] } as StoredPauSnapshot;
const blackrock = { displayName: "Blackrock USDC", signalParams: [
  { key: "Rate Limit IDs / BUIDLI_DEPOSIT", value: DEPOSIT, srcDocId: "d1" },
  { key: "Token Address", value: USDC, srcDocId: "d2" },
] };

describe("listedAddress", () => {
  it("reads an address only under a RateLimitID param", () => {
    expect(listedAddress("Rate Limit IDs / BUIDLI_DEPOSIT", ` ${DEPOSIT} `)).toBe(DEPOSIT.toLowerCase());
    expect(listedAddress("Token Address", USDC)).toBeNull();
    expect(listedAddress("Inflow RateLimitID", KEY)).toBeNull();
  });
});

describe("keysFromAddress / addressKeyIndex", () => {
  it("finds the prime's keys whose derivation uses the address, whatever its case", () => {
    expect(keysFromAddress([snap], DEPOSIT).map((m) => m.key)).toEqual([KEY]);
    expect(keysFromAddress([snap], USDC).map((m) => m.key)).toEqual([KEY, OTHER]);
  });
  it("labels each key by the param that lists the address, marked with it; a token address is not a listing", () => {
    expect(addressKeyIndex([blackrock], [snap]).get(KEY)).toEqual([{ docId: "d1", label: "Blackrock USDC · BUIDLI_DEPOSIT", via: DEPOSIT.toLowerCase() }]);
    expect(addressKeyIndex([blackrock], [snap]).has(OTHER)).toBe(false);
  });
  it("names every param of one instance that lists the same address, since the address cannot say which operation it is", () => {
    const ustb = { displayName: "Superstate USTB", signalParams: [
      { key: "Rate Limit IDs / USTB_DEPOSIT", value: DEPOSIT, srcDocId: "u1" },
      { key: "Rate Limit IDs / USTB_REDEEM", value: DEPOSIT, srcDocId: "u1" },
    ] };
    expect(addressKeyIndex([ustb], [snap]).get(KEY)).toEqual([{ docId: "u1", label: "Superstate USTB · USTB_DEPOSIT, USTB_REDEEM", via: DEPOSIT.toLowerCase() }]);
  });
  it("never replaces a key the atlas states by hash", () => {
    const byHash = new Map([[KEY, [{ docId: "h", label: "Stated" }]]]);
    expect(withAddressKeys(byHash, addressKeyIndex([blackrock], [snap])).get(KEY)).toEqual([{ docId: "h", label: "Stated" }]);
  });
});
