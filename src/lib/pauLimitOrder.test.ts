// Which rate-limit rows the PAUs tables leave out: a switched-off key derived
// from an address the atlas dropped, unless the atlas still names the key.
import { describe, expect, it } from "vitest";
import type { LiveRateLimit } from "./pau.ts";
import { isRetiredOff } from "./pauLimitOrder.ts";

const KEY = "0x" + "4a".repeat(32);
const retired = { address: "0x" + "e9".repeat(20), removedAt: "2025-08-25T14:36:55Z", commit: "dd131566" };
const limit = (maxAmount: string, gone = true): LiveRateLimit => ({
  key: KEY, configured: { maxAmount, slope: "0" }, setAt: { block: 1, time: "", tx: "" }, changes: 1, data: null, available: null,
  derived: { constant: "LIMIT_7540_DEPOSIT", args: [retired.address], ...(gone ? { retired } : {}) },
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
