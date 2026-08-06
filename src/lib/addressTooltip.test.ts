import { describe, it, expect } from "vitest";
import type { AddressBalances } from "./balances";
import { heldBalances, resolveAddressTooltip } from "./addressTooltip";
import { makeAddressInfo } from "../test/fixtures";

const EVM = "0xae7ab96520de3a18e5e111b5eaab095312d7fe84";

function bal(balances: AddressBalances["balances"]): AddressBalances {
  return { chain: "ethereum", checkedAt: null, hasCode: null, balances };
}

describe("heldBalances", () => {
  it("drops zero balances and orders primary symbols before the rest, alphabetically", () => {
    const held = heldBalances({
      ETH: { raw: "0", decimals: 18 },
      SKY: { raw: "1000000000000000000", decimals: 18 },
      USDS: { raw: "2500000000000000000", decimals: 18 },
      DAI: { raw: "500000000000000000", decimals: 18 },
    });
    expect(held.map((h) => h.symbol)).toEqual(["USDS", "SKY", "DAI"]);
    expect(held.find((h) => h.symbol === "USDS")?.amount).toBe("2.50");
  });

  it("treats an unparseable raw value as zero (not held)", () => {
    expect(heldBalances({ ETH: { raw: "not-a-number", decimals: 18 } })).toEqual([]);
  });

  it("returns an empty list when nothing is held", () => {
    expect(heldBalances({ ETH: { raw: "0", decimals: 18 } })).toEqual([]);
  });
});

describe("resolveAddressTooltip", () => {
  it("resolves the address map's label and the matching chain-keyed balance row", () => {
    const addrMap = { [EVM]: makeAddressInfo({ label: "Test Multisig" }) };
    const balancesByAddress = { [`${EVM}|ethereum`]: bal({ ETH: { raw: "2000000000000000000", decimals: 18 } }) };
    const result = resolveAddressTooltip(EVM, addrMap, balancesByAddress);
    expect(result.name).toBe("Test Multisig");
    expect(result.held).toEqual([{ symbol: "ETH", amount: "2.00" }]);
  });

  it("falls back to a shortened address when the address map has no entry", () => {
    const result = resolveAddressTooltip(EVM, {}, {});
    expect(result.name).toBe(`${EVM.slice(0, 6)}…${EVM.slice(-4)}`);
    expect(result.held).toEqual([]);
  });

  it("falls back to a shortened address when the map entry has no label", () => {
    const addrMap = { [EVM]: makeAddressInfo({ label: null }) };
    const result = resolveAddressTooltip(EVM, addrMap, {});
    expect(result.name).toBe(`${EVM.slice(0, 6)}…${EVM.slice(-4)}`);
  });

  it("is case-insensitive for EVM addresses, matching the lowercased map/balance keys", () => {
    const upper = EVM.toUpperCase().replace("0X", "0x");
    const addrMap = { [EVM]: makeAddressInfo({ label: "Test Multisig" }) };
    const balancesByAddress = { [`${EVM}|ethereum`]: bal({ SKY: { raw: "1000000000000000000", decimals: 18 } }) };
    const result = resolveAddressTooltip(upper, addrMap, balancesByAddress);
    expect(result.name).toBe("Test Multisig");
    expect(result.held).toEqual([{ symbol: "SKY", amount: "1.00" }]);
  });
});
