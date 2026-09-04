import { describe, it, expect } from "vitest";
import { isCleanLabel, resolveAddressName, resolveOwner, hasResolvedName } from "./addressName";

const EVM = "0xae7ab96520de3a18e5e111b5eaab095312d7fe84";

describe("isCleanLabel", () => {
  it("accepts real names — single tokens, tickers, Title-Cased phrases", () => {
    for (const good of [
      "Bonapublica",
      "BLUE",
      "Cloaky",
      "AegisD",
      "The Sky Frontier Foundation's multisig",
      "Spark Foundation",
      "ALM Proxy",
    ]) {
      expect(isCleanLabel(good), good).toBe(true);
    }
  });

  it("rejects scraped prose fragments (the entityLabel defect)", () => {
    for (const bad of [
      "ALM Proxy's entire native ETH balance into WETH. It",
      "Basin in exchange for Basin shares. It",
      "Sky Governance through the Pause Proxy. The Beacon",
      "DAI and the Lite PSM's no-fee path. It",
      "Synthetix-style reward farm and claims accrued rewards. It",
      "the current whitelisted SparkLend Security Access Multisig",
    ]) {
      expect(isCleanLabel(bad), bad).toBe(false);
    }
  });

  it("rejects empty, too-short, and over-long values", () => {
    expect(isCleanLabel(null)).toBe(false);
    expect(isCleanLabel(undefined)).toBe(false);
    expect(isCleanLabel("")).toBe(false);
    expect(isCleanLabel("  ")).toBe(false);
    expect(isCleanLabel("ab")).toBe(false);
    expect(isCleanLabel("A".repeat(49))).toBe(false);
  });

  it("rejects phrases ending on a dangling function word", () => {
    expect(isCleanLabel("Rewards paid to the")).toBe(false);
    expect(isCleanLabel("Transfers made by")).toBe(false);
  });
});

describe("resolveAddressName", () => {
  it("prefers chainlogId, then etherscanName, and never entityLabel", () => {
    expect(resolveAddressName(EVM, { chainlogId: "MCD_VAT", etherscanName: "Vat", entityLabel: "Sky Vat" })).toBe(
      "MCD_VAT",
    );
    expect(resolveAddressName(EVM, { etherscanName: "SafeProxy", entityLabel: "Bonapublica" })).toBe("SafeProxy");
  });

  it("falls back to shortAddr when there is no authoritative name — even with a clean entityLabel", () => {
    expect(resolveAddressName(EVM, { entityLabel: "Bonapublica" })).toBe("0xae7a…fe84");
    expect(resolveAddressName(EVM, null)).toBe("0xae7a…fe84");
  });
});

describe("resolveOwner", () => {
  it("returns a clean entityLabel and suppresses a fragment", () => {
    expect(resolveOwner({ entityLabel: "Bonapublica" })).toBe("Bonapublica");
    expect(resolveOwner({ entityLabel: "…into WETH. It" })).toBe(null);
    expect(resolveOwner({})).toBe(null);
  });
});

describe("hasResolvedName", () => {
  it("is true only when a chainlog id or etherscan name exists", () => {
    expect(hasResolvedName({ chainlogId: "MCD_VAT" })).toBe(true);
    expect(hasResolvedName({ etherscanName: "Vat" })).toBe(true);
    expect(hasResolvedName({ entityLabel: "Bonapublica" })).toBe(false);
    expect(hasResolvedName(null)).toBe(false);
  });
});
