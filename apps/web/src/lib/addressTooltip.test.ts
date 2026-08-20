import { describe, it, expect } from "vitest";
import type { AddressBalances } from "@/lib/balances";
import { resolveAddressTooltip } from "./addressTooltip";
import { makeAddressInfo } from "../test/fixtures";

const EVM = "0xae7ab96520de3a18e5e111b5eaab095312d7fe84";

function bal(balances: AddressBalances["balances"]): AddressBalances {
  return { chain: "ethereum", checkedAt: null, hasCode: null, balances };
}

describe("resolveAddressTooltip", () => {
  it("resolves the chainlog name and the matching chain-keyed balance row", () => {
    const addrMap = { [EVM]: makeAddressInfo({ chainlogId: "MCD_VAT" }) };
    const balancesByAddress = { [`${EVM}|ethereum`]: bal({ ETH: { raw: "2000000000000000000", decimals: 18 } }) };
    const result = resolveAddressTooltip(EVM, addrMap, balancesByAddress);
    expect(result.name).toBe("MCD_VAT");
    expect(result.held).toEqual([{ symbol: "ETH", amount: "2.00" }]);
  });

  it("drops zero balances and orders primary symbols before the rest, alphabetically", () => {
    const addrMap = { [EVM]: makeAddressInfo({ chainlogId: "MCD_VAT" }) };
    const balancesByAddress = {
      [`${EVM}|ethereum`]: bal({
        ETH: { raw: "0", decimals: 18 },
        SKY: { raw: "1000000000000000000", decimals: 18 },
        USDS: { raw: "2500000000000000000", decimals: 18 },
        WETH: { raw: "100000000000000000", decimals: 18 },
        DAI: { raw: "500000000000000000", decimals: 18 },
      }),
    };
    const result = resolveAddressTooltip(EVM, addrMap, balancesByAddress);
    // USDS/SKY keep PRIMARY_BALANCE_SYMBOLS order; DAI/WETH (both unranked)
    // fall back to alphabetical; ETH's zero balance is dropped entirely.
    expect(result.held.map((h) => h.symbol)).toEqual(["USDS", "SKY", "DAI", "WETH"]);
    expect(result.held.find((h) => h.symbol === "USDS")?.amount).toBe("2.50");
  });

  it("treats an unparseable raw value as zero (not held)", () => {
    const addrMap = { [EVM]: makeAddressInfo({ chainlogId: "MCD_VAT" }) };
    const balancesByAddress = { [`${EVM}|ethereum`]: bal({ ETH: { raw: "not-a-number", decimals: 18 } }) };
    expect(resolveAddressTooltip(EVM, addrMap, balancesByAddress).held).toEqual([]);
  });

  it("falls back to the verified on-chain name when there's no chainlog entry", () => {
    const addrMap = { [EVM]: makeAddressInfo({ etherscanName: "SafeProxy" }) };
    const result = resolveAddressTooltip(EVM, addrMap, {});
    expect(result.name).toBe("SafeProxy");
  });

  it("never falls back to entityLabel — a heuristic prose extraction, not a real name", () => {
    const addrMap = {
      [EVM]: makeAddressInfo({ entityLabel: "the receiver on Robinhood Chain", label: "the receiver on Robinhood Chain" }),
    };
    const result = resolveAddressTooltip(EVM, addrMap, {});
    expect(result.name).toBe(`${EVM.slice(0, 6)}…${EVM.slice(-4)}`);
  });

  it("falls back to a shortened address when the address map has no entry", () => {
    const result = resolveAddressTooltip(EVM, {}, {});
    expect(result.name).toBe(`${EVM.slice(0, 6)}…${EVM.slice(-4)}`);
    expect(result.held).toEqual([]);
  });

  it("falls back to a shortened address when the map entry has neither name", () => {
    const addrMap = { [EVM]: makeAddressInfo() };
    const result = resolveAddressTooltip(EVM, addrMap, {});
    expect(result.name).toBe(`${EVM.slice(0, 6)}…${EVM.slice(-4)}`);
  });

  it("is case-insensitive for EVM addresses, matching the lowercased map/balance keys", () => {
    const upper = EVM.toUpperCase().replace("0X", "0x");
    const addrMap = { [EVM]: makeAddressInfo({ chainlogId: "MCD_VAT" }) };
    const balancesByAddress = { [`${EVM}|ethereum`]: bal({ SKY: { raw: "1000000000000000000", decimals: 18 } }) };
    const result = resolveAddressTooltip(upper, addrMap, balancesByAddress);
    expect(result.name).toBe("MCD_VAT");
    expect(result.held).toEqual([{ symbol: "SKY", amount: "1.00" }]);
  });

  it("aggregates balances across every chain the address is on, tagging each row with its chain", () => {
    const addrMap = { [EVM]: makeAddressInfo({ chainlogId: "ALM_PROXY", chains: ["ethereum", "base"] }) };
    const balancesByAddress = {
      [`${EVM}|ethereum`]: bal({ ETH: { raw: "1000000000000000000", decimals: 18 } }),
      [`${EVM}|base`]: bal({ ETH: { raw: "2000000000000000000", decimals: 18 }, USDS: { raw: "500000000000000000", decimals: 18 } }),
    };
    const result = resolveAddressTooltip(EVM, addrMap, balancesByAddress);
    // ETH (rank 0) before USDS (rank 1); the two ETH rows tie-break by chain.
    expect(result.held).toEqual([
      { symbol: "ETH", amount: "2.00", chain: "base" },
      { symbol: "ETH", amount: "1.00", chain: "ethereum" },
      { symbol: "USDS", amount: "0.5", chain: "base" },
    ]);
  });

  it("does not chain-tag a single-chain address even when chains has one entry", () => {
    const addrMap = { [EVM]: makeAddressInfo({ chainlogId: "MCD_VAT", chains: ["ethereum"] }) };
    const balancesByAddress = { [`${EVM}|ethereum`]: bal({ ETH: { raw: "1000000000000000000", decimals: 18 } }) };
    const result = resolveAddressTooltip(EVM, addrMap, balancesByAddress);
    expect(result.held).toEqual([{ symbol: "ETH", amount: "1.00" }]);
  });
});
