// How the atlas states a rate limit: which operation a param is about, and
// what its stated maxAmount or slope reads as.
import { describe, expect, it } from "vitest";
import { paramQualifier, paramSide, parseStated, shiftDecimal, VALUE_PARAM_RE } from "./pauParams.ts";

describe("paramSide", () => {
  it("reads the operation a param names", () => {
    expect(["Aggregate Deposit RateLimitID", "Inflow Rate Limits", "Withdrawal", "Rate Limit IDs / redeem", "Swap RateLimitID (AUSD)", "Rate Limit IDs"].map(paramSide)).toEqual(["in", "in", "out", "out", "swap", ""]);
  });
});

describe("paramQualifier", () => {
  it("reads the asset a key or value names in brackets, or a leading Aggregate", () => {
    expect(["Deposit RateLimitID (AUSD)", "Deposit Rate Limits / slope (AUSD)", "Aggregate Deposit RateLimitID", "Deposit Rate Limits / maxAmount (Aggregate)"].map(paramQualifier))
      .toEqual(["ausd", "ausd", "aggregate", "aggregate"]);
  });
  it("reads no asset from other leading words, so a name like a venue's is never taken for one", () => {
    expect(["Inflow Rate Limits / maxAmount", "Uniswap v3 Swap Rate Limits / maxAmount", "Inflow RateLimitID", "Rate Limit IDs / deposit"].map(paramQualifier)).toEqual(["", "", "", ""]);
  });
});

describe("VALUE_PARAM_RE", () => {
  it("reads a value's operation and field with or without an asset after it, and leaves a venue-bracketed name alone", () => {
    expect(["Deposit Rate Limits / slope (AUSD)", "Inflow Rate Limits / maxAmount"].map((n) => VALUE_PARAM_RE.exec(n)?.slice(1, 3))).toEqual([["Deposit", "slope"], ["Inflow", "maxAmount"]]);
    expect(VALUE_PARAM_RE.test("Deposit Rate Limits (via FalconX) / maxAmount")).toBe(false);
  });
});

describe("parseStated", () => {
  it("reads amounts with separators, scale words, tokens, alternatives and a per-day suffix", () => {
    expect(parseStated("50,000,000 USDC per day")).toEqual({ kind: "amount", units: "50000000", symbol: "USDC" });
    expect(parseStated("2.5 million RLUSD")).toEqual({ kind: "amount", units: "2500000", symbol: "RLUSD" });
    expect(parseStated("25,000,000 RLUSD or USDC per day")).toEqual({ kind: "amount", units: "25000000", symbol: "RLUSD or USDC" });
    expect(parseStated("100,000,000 per day")).toEqual({ kind: "amount", units: "100000000", symbol: null });
    expect(parseStated("0")).toEqual({ kind: "amount", units: "0", symbol: null });
    expect(parseStated("25,000,000 (normalized) per day")).toEqual({ kind: "amount", units: "25000000", symbol: null });
  });
  it("reads unlimited, says when the atlas sets nothing yet, and declines other text", () => {
    expect(["Unlimited", "unlimited", "`type(uint256).max`"].map(parseStated)).toEqual(Array(3).fill({ kind: "unlimited" }));
    expect(["N/A - swaps only", "This parameter will be specified in a future iteration"].map(parseStated)).toEqual(Array(2).fill({ kind: "none" }));
    expect(parseStated("half of the buffer")).toBeNull();
  });
});

describe("shiftDecimal", () => {
  it("scales a decimal string without floating point", () => {
    expect([shiftDecimal("1.5", 6), shiftDecimal("25000000", 18), shiftDecimal("0.0000001", 6), shiftDecimal("0", 6)]).toEqual(["1500000", "25000000000000000000000000", "0.1", "0"]);
  });
});
