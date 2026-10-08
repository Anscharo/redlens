// A verdict only as far as it is certain: in the key's token units where known;
// with units unknown, a mismatch only when the value is wrong at every scale and
// a match only at the inferred scale the atlas's token agrees with.
import { describe, expect, it } from "vitest";
import type { LiveRateLimit } from "./pau.ts";
import { parseStated } from "./pauParams.ts";
import { verdict } from "./pauValueVerdict.ts";

const UNL = ((1n << 256n) - 1n).toString();
const lim = (maxAmount: string, slope: string, unit?: LiveRateLimit["unit"]) => ({
  key: "0xk", configured: { maxAmount, slope }, setAt: { block: 1, time: "t", tx: "0x" }, changes: 1, available: null,
  data: { maxAmount, slope, lastAmount: "0", lastUpdated: "1" }, ...(unit ? { unit } : {}),
});
const usdc = { decimals: 6, symbol: "USDC", source: "token" as const };
const v = (text: string, field: "maxAmount" | "slope", r: ReturnType<typeof lim>, off = false) => verdict(parseStated(text) as never, field, r, off);

describe("verdict", () => {
  it("compares in the key's units, and a slope per day against its truncated per-second value", () => {
    expect(v("5,000,000 USDC", "maxAmount", lim("5000000000000", "0", usdc))).toBe("match");
    expect(v("5,000,001 USDC", "maxAmount", lim("5000000000000", "0", usdc))).toBe("mismatch");
    expect(v("5,000,000 USDC per day", "slope", lim("1", "57870370", usdc))).toBe("match");
  });
  it("needs no units for zero and unlimited, and lets a switched-off limit take any slope", () => {
    expect([v("0", "maxAmount", lim("0", "0")), v("0", "maxAmount", lim("20000000000000", "0"))]).toEqual(["match", "mismatch"]);
    expect([v("Unlimited", "maxAmount", lim(UNL, "0")), v("Unlimited", "maxAmount", lim("1", "0")), v("1", "maxAmount", lim(UNL, "0"))]).toEqual(["match", "mismatch", "mismatch"]);
    expect(v("Unlimited", "slope", lim("0", "0"), true)).toBe("match");
  });
  it("with units unknown, matches only at the inferred scale the named token agrees with, and mismatches only when wrong at every scale", () => {
    expect(v("50,000,000 USDC", "maxAmount", lim("50000000000000", "0"))).toBe("match");
    expect(v("50,000,000 USDS", "maxAmount", lim("50000000000000", "0"))).toBe("units-unknown");
    expect(v("50,000,000 USDC", "maxAmount", lim("50000000000000000000000000", "0"))).toBe("units-unknown");
    expect(v("50,000,000", "maxAmount", lim("1234", "0"))).toBe("mismatch");
  });
});
