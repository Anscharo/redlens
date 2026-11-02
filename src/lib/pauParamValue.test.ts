// Guard values read as words, and addresses (bare or left-padded bytes32) are
// handed back to be rendered as addresses.
import { describe, expect, it } from "vitest";
import type { PauParam } from "./pau.ts";
import { exchangeRateText, paddedAddress, paramValue, scaled, slippageText } from "./pauParamValue.ts";

const at = { block: 1, time: "t", tx: "0xt" };
const param = (extra: Partial<PauParam> = {}): PauParam => ({ event: "MaxExchangeRateSet", subject: "0x" + "1".repeat(40), args: {}, setAt: at, ...extra });

describe("pauParamValue", () => {
  it("formats scaled integers", () => {
    expect(scaled(1500n, 3)).toBe("1.5");
    expect(scaled(12345678n, 2)).toBe("123,456.78");
    expect(scaled(1234567n, 6, 2)).toBe("1.23");
  });

  it("reads a max slippage as the most that may be lost", () => {
    expect(slippageText("999000000000000000")).toBe("at most 0.1% loss (≥ 99.9% back)");
    expect(slippageText("999990000000000000")).toBe("at most 0.001% loss (≥ 99.999% back)");
    expect(slippageText("997500000000000000")).toBe("at most 0.25% loss (≥ 99.75% back)");
  });

  it("reads a max exchange rate as assets per whole share, only with both decimals", () => {
    expect(exchangeRateText("10000000000000000000000000", 18, { decimals: 6, symbol: "USDC" })).toBe("≤ 10 USDC per share");
    expect(exchangeRateText("3000000000000000000000000000000000000", 18, { decimals: 18, symbol: "RLUSD" })).toBe("≤ 3 RLUSD per share");
    expect(exchangeRateText("1000000000000000000000000000000", 6, { decimals: 6, symbol: "USDT" })).toBe("≤ 0.000001 USDT per share");
    expect(exchangeRateText("1", undefined, { decimals: 6, symbol: "USDC" })).toBeNull();
  });

  it("unpads a bytes32 that holds an address", () => {
    expect(paddedAddress("0x000000000000000000000000" + "ab".repeat(20))).toBe("0x" + "ab".repeat(20));
    expect(paddedAddress("0x" + "1".repeat(64))).toBeNull();
  });

  it("returns a raw exchange rate with a note when the decimals are unknown", () => {
    const v = paramValue(param(), "maxExchangeRate", "10000000000000000000000000");
    expect(v).toMatchObject({ kind: "text", text: "10000000000000000000000000" });
    expect(v?.title).toMatch(/not read yet/);
    expect(paramValue(param({ subjectToken: { decimals: 18, symbol: "sv", source: "token" }, asset: { decimals: 6, symbol: "USDC", source: "token" } }), "maxExchangeRate", "10000000000000000000000000")).toMatchObject({ text: "≤ 10 USDC per share" });
  });

  it("hands back addresses to render as addresses", () => {
    const a = "0x" + "c".repeat(40);
    expect(paramValue(param(), "mintRecipient", "0x000000000000000000000000" + "c".repeat(40))).toMatchObject({ kind: "address", address: a });
    expect(paramValue(param(), "recipient", a)).toMatchObject({ kind: "address", address: a });
    expect(paramValue(param(), "domain", "3")).toBeNull();
  });
});
