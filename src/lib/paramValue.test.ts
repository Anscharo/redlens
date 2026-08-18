import { describe, expect, it } from "vitest";
import { normalizeName, parseValue, stripCodeFences, truncateContext } from "./paramValue";

// The module's stated central precision risk: attached magnitude suffixes are
// UPPERCASE-ONLY because a corpus scan found 266 lowercase `\d+b` matches that
// were hex/hash fragments, not magnitudes. That claim had no test — these lock it.
describe("attached magnitude suffixes are uppercase-only", () => {
  it.each([
    ["500K", 500_000],
    ["500M", 500_000_000],
    ["2B", 2_000_000_000],
    ["1.5T", 1.5e12],
  ])("expands uppercase %s", (raw, num) => {
    const parsed = parseValue(raw)!;
    expect(parsed.num).toBe(num);
    expect(parsed.value).toBe(raw); // multiplier kept as written
  });

  it.each(["500k", "500m", "2b", "1.5t"])("rejects lowercase %s outright rather than expanding it", (raw) => {
    // A lowercase suffix is not a magnitude AND not a unit either (the unit
    // tail requires whitespace before the word), so the whole parse fails —
    // the strictest possible outcome, and what keeps a hex fragment like
    // "6781594b" from ever becoming 6,781,594 billion.
    expect(parseValue(raw)).toBeNull();
  });

  it("does not expand a hex-like fragment into a magnitude", () => {
    expect(parseValue("6781594b")).toBeNull();
    expect(parseValue("6781594B")?.num).toBe(6.781594e15); // uppercase IS a magnitude, by design
  });

  it("expands spelled-out multipliers in either case, including the atlas's plural typo", () => {
    expect(parseValue("500 million USDS")).toEqual({ value: "500 million USDS", num: 5e8, unit: "USDS" });
    expect(parseValue("50 millions sUSDS")?.num).toBe(5e7);
  });
});

describe("unit tail", () => {
  it("keeps an internal dot in a token symbol but never a trailing sentence period", () => {
    expect(parseValue("1,000 USDC.e")?.unit).toBe("USDC.e");
    expect(parseValue("240,000,000 SKY.")?.unit).toBe("SKY");
  });

  it("parses a percentage as the written magnitude, not a fraction", () => {
    expect(parseValue("8.75%")).toEqual({ value: "8.75%", num: 8.75, unit: "%" });
  });

  it("rejects a sentence-shaped value outright (anchored both ends)", () => {
    expect(parseValue("1) a signer self-reports the breach to the Facilitator")).toBeNull();
    expect(parseValue("not specified")).toBeNull();
  });
});

describe("helpers", () => {
  it("normalizeName strips wrapping backticks, a leading article, and a trailing copula", () => {
    expect(normalizeName("`maxAmount`")).toBe("maxamount");
    expect(normalizeName("The GSM Pause Delay is")).toBe("gsm pause delay");
  });

  it("stripCodeFences removes fenced source literals", () => {
    expect(stripCodeFences("a\n```\nrequire(x <= 887272)\n```\nb")).not.toContain("887272");
  });

  it("truncateContext collapses whitespace and ellipsizes past the cap", () => {
    expect(truncateContext("  a   b  ")).toBe("a b");
    expect(truncateContext("abcdef", 4)).toBe("abc…");
  });
});
