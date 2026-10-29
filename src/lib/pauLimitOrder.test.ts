// Which rate-limit rows the PAUs tables leave out: a switched-off key derived
// from an address the atlas dropped, unless the atlas still names the key.
import { describe, expect, it } from "vitest";
import type { LiveRateLimit } from "./pau.ts";
import { isRetiredOff, limitName } from "./pauLimitOrder.ts";

const KEY = "0x" + "4a".repeat(32);
const retired = { address: "0x" + "e9".repeat(20), removedAt: "2025-08-25T14:36:55Z", commit: "dd131566" };
const limit = (maxAmount: string, gone = true): LiveRateLimit => ({
  key: KEY, configured: { maxAmount, slope: "0" }, setAt: { block: 1, time: "", tx: "" }, changes: 1, data: null, available: null,
  derived: { constant: "LIMIT_7540_DEPOSIT", args: [retired.address] }, ...(gone ? { retired } : {}),
});

describe("isRetiredOff", () => {
  it("leaves out a switched-off retired key no atlas document names", () => {
    expect(isRetiredOff(limit("0"), new Map())).toBe(true);
  });
  it("keeps one still on, one the atlas still names, and one not retired", () => {
    expect(isRetiredOff(limit("5"), new Map())).toBe(false);
    expect(isRetiredOff(limit("0"), new Map([[KEY, [{ docId: "d", label: "JTRSY · Inflow" }]]]))).toBe(false);
    expect(isRetiredOff(limit("0", false), new Map())).toBe(false);
  });
});

describe("limitName", () => {
  const derived = { constant: "LIMIT_4626_WITHDRAW", args: ["0x" + "77".repeat(20)] };
  it("names a key by its document on this chain, adding the controller constant to a shared name", () => {
    const refs = [{ docId: "a", label: "Arbitrum - Maple · Outflow", chain: "arbitrum" }, { docId: "e", label: "Ethereum Mainnet - Maple · Outflow", chain: "ethereum", shared: true }];
    expect(limitName({ key: KEY, derived }, new Map([[KEY, refs]]), "ethereum")).toBe("Maple · Outflow · LIMIT_4626_WITHDRAW");
    expect(limitName({ key: KEY, derived }, new Map([[KEY, refs]]), "arbitrum")).toBe("Maple · Outflow");
  });
  it("falls back to a document on another chain, then the derivation, then the key", () => {
    const refs = [{ docId: "a", label: "Arbitrum - Maple · Outflow", chain: "arbitrum" }];
    expect(limitName({ key: KEY, derived }, new Map([[KEY, refs]]), "base")).toBe("Arbitrum - Maple · Outflow");
    expect(limitName({ key: KEY, derived }, new Map(), "base")).toBe(`LIMIT_4626_WITHDRAW · ${derived.args[0]}`);
    expect(limitName({ key: KEY }, new Map(), "base")).toBe(KEY);
  });
});
