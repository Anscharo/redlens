import { describe, it, expect } from "vitest";
import {
  normalizeSymbol,
  tokensForAddress,
  formatUnits,
  compactAmount,
  NATIVE_TOKEN,
  ALWAYS_TOKENS,
} from "./tokens";

describe("normalizeSymbol", () => {
  it("uppercases and trims (sUSDS -> SUSDS)", () => {
    expect(normalizeSymbol("sUSDS")).toBe("SUSDS");
    expect(normalizeSymbol(" eth ")).toBe("ETH");
  });
});

describe("tokensForAddress", () => {
  it("always includes USDS + SKY on ethereum", () => {
    const syms = tokensForAddress([], "ethereum").map((t) => t.symbol);
    expect(syms).toContain("USDS");
    expect(syms).toContain("SKY");
  });

  it("adds resolvable expected tokens and drops native ETH", () => {
    const toks = tokensForAddress(["ETH", "DAI", "USDC"], "ethereum");
    const syms = toks.map((t) => t.symbol);
    expect(syms).toContain("DAI");
    expect(syms).toContain("USDC");
    expect(syms).not.toContain("ETH"); // native, not an ERC20 here
    // USDC is 6-decimals in the registry.
    expect(toks.find((t) => t.symbol === "USDC")!.decimals).toBe(6);
  });

  it("normalizes sUSDS to the SUSDS registry entry", () => {
    const syms = tokensForAddress(["sUSDS"], "ethereum").map((t) => t.symbol);
    expect(syms).toContain("SUSDS");
  });

  it("drops symbols with no contract on the chain (GROVE, PATTERN)", () => {
    const syms = tokensForAddress(["GROVE", "PATTERN"], "ethereum").map((t) => t.symbol);
    expect(syms).not.toContain("GROVE");
    expect(syms).not.toContain("PATTERN");
  });

  it("returns no ERC20 on a chain with no registry entries (native-only)", () => {
    // base has native ETH but no ERC20 registry entries in v1.
    expect(tokensForAddress(["USDS"], "base")).toEqual([]);
    expect(NATIVE_TOKEN.base.symbol).toBe("ETH");
  });

  it("addresses are lowercase and deterministic order", () => {
    const toks = tokensForAddress(["USDC", "DAI"], "ethereum");
    expect(toks.map((t) => t.symbol)).toEqual([...toks].map((t) => t.symbol).sort());
    for (const t of toks) expect(t.address).toBe(t.address.toLowerCase());
  });
});

describe("formatUnits", () => {
  it("formats with decimals and trims trailing zeros", () => {
    expect(formatUnits("1234500000000000000000", 18)).toBe("1234.5");
    expect(formatUnits("1000000000000000000", 18)).toBe("1");
    expect(formatUnits("0", 18)).toBe("0");
  });
  it("handles sub-one and 6-decimal values", () => {
    expect(formatUnits("500000", 6)).toBe("0.5");
    expect(formatUnits("1", 18)).toBe("0.000000000000000001");
  });
  it("decimals=0 returns the integer", () => {
    expect(formatUnits("42", 0)).toBe("42");
  });
  it("non-numeric input is 0", () => {
    expect(formatUnits("0xdead", 18)).toBe("0");
  });
});

describe("compactAmount", () => {
  it("compacts magnitudes with K/M/B", () => {
    expect(compactAmount("1500000000000000000000000", 18)).toBe("1.50M");
    expect(compactAmount("2500000000000000000000", 18)).toBe("2.50K");
    expect(compactAmount("12340000000000000000", 18)).toBe("12.34");
  });
  it("zero and tiny values", () => {
    expect(compactAmount("0", 18)).toBe("0");
    expect(compactAmount("1", 18)).toBe("<0.0001");
  });
});

it("ALWAYS_TOKENS is USDS + SKY", () => {
  expect([...ALWAYS_TOKENS]).toEqual(["USDS", "SKY"]);
});
