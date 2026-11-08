import { describe, it, expect } from "vitest";
import type { AddressBalances } from "@/lib/balances";
import { resolveAddressLabel, resolveAddressHoldings, addressHeadlineBalance } from "./addressTooltip";
import { makeAddressInfo } from "../test/fixtures";

const EVM = "0xae7ab96520de3a18e5e111b5eaab095312d7fe84";

// The hover card reads its label and its holdings from two resolvers; most
// cases here assert on both at once.
const resolveAddressTooltip = (...args: Parameters<typeof resolveAddressHoldings>) => ({
  ...resolveAddressLabel(args[0], args[1]),
  ...resolveAddressHoldings(...args),
});

function bal(balances: AddressBalances["balances"]): AddressBalances {
  return { chain: "ethereum", checkedAt: null, hasCode: null, balances };
}

describe("resolveAddressLabel + resolveAddressHoldings", () => {
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
      { symbol: "USDS", amount: "0.5", chain: "base", usd: "<$1" },
    ]);
  });

  it("does not chain-tag a single-chain address even when chains has one entry", () => {
    const addrMap = { [EVM]: makeAddressInfo({ chainlogId: "MCD_VAT", chains: ["ethereum"] }) };
    const balancesByAddress = { [`${EVM}|ethereum`]: bal({ ETH: { raw: "1000000000000000000", decimals: 18 } }) };
    const result = resolveAddressTooltip(EVM, addrMap, balancesByAddress);
    expect(result.held).toEqual([{ symbol: "ETH", amount: "1.00" }]);
  });
});

describe("addressHeadlineBalance", () => {
  const map = { [EVM]: makeAddressInfo({ chains: ["ethereum"] }) };

  it("sums stablecoins into a compact dollar figure", () => {
    const b = { [`${EVM}|ethereum`]: bal({ USDS: { raw: "3200000000000000000000", decimals: 18 } }) };
    expect(addressHeadlineBalance(EVM, map, b)).toBe("$3.20K");
  });

  it("shows the top non-stable holding as a token amount when there is no stable value", () => {
    const b = { [`${EVM}|ethereum`]: bal({ SKY: { raw: "35440000000000000000000000", decimals: 18 } }) };
    expect(addressHeadlineBalance(EVM, map, b)).toBe("35.44M SKY");
  });

  it("marks the dollar figure as a floor when some holding has no price", () => {
    const b = {
      [`${EVM}|ethereum`]: bal({
        USDS: { raw: "5000000000000000000000", decimals: 18 }, // $5k
        SKY: { raw: "1000000000000000000", decimals: 18 }, // 1 SKY
      }),
    };
    expect(addressHeadlineBalance(EVM, map, b)).toBe("≈$5.00K+");
  });

  it("ignores sub-dollar stable dust and falls back to the token holding", () => {
    const b = {
      [`${EVM}|ethereum`]: bal({
        USDS: { raw: "780000000000000000", decimals: 18 }, // $0.78 — dust
        SKY: { raw: "35440000000000000000000000", decimals: 18 },
      }),
    };
    expect(addressHeadlineBalance(EVM, map, b)).toBe("35.44M SKY");
  });

  it("floors dust token balances at <0.01", () => {
    const b = { [`${EVM}|ethereum`]: bal({ ETH: { raw: "5000000000000000", decimals: 18 } }) }; // 0.005 ETH
    expect(addressHeadlineBalance(EVM, map, b)).toBe("<0.01 ETH");
  });

  describe("with prices", () => {
    const prices = {
      SKY: { usd: 0.05, asOf: "2026-11-02T11:00:00Z" },
      ETH: { usd: 3000, asOf: "2026-11-02T11:00:00Z" },
      SUSDS: { usd: 1.08, asOf: "2026-11-02T11:00:00Z" },
    };

    it("sums every priced holding across chains into one dollar figure", () => {
      const multi = { [EVM]: makeAddressInfo({ chains: ["ethereum", "base"] }) };
      const b = {
        [`${EVM}|ethereum`]: bal({ SKY: { raw: "1000000000000000000000000", decimals: 18 } }), // 1M SKY = $50K
        [`${EVM}|base`]: bal({ ETH: { raw: "2000000000000000000", decimals: 18 } }), // 2 ETH = $6K
      };
      expect(addressHeadlineBalance(EVM, multi, b, prices)).toBe("$56.00K");
    });

    it("values xDAI at $1 when no price came for it, like the other pegged stables", () => {
      const gnosis = { [EVM]: makeAddressInfo({ chains: ["gnosis"] }) };
      const b = { [`${EVM}|gnosis`]: { ...bal({ xDAI: { raw: "50000000000000000000000", decimals: 18 } }), chain: "gnosis" } };
      expect(addressHeadlineBalance(EVM, gnosis, b, {})).toBe("$50.00K");
    });

    it("shows a USDS holding's value at the precision of its amount, so the peg reads as a peg", () => {
      const usds = { USDS: { usd: 0.9998, asOf: "2026-11-02T11:00:00Z" } };
      const cases = [
        ["4749749000000000000000000", "4.75M", "$4.75M"],
        ["1460000000000000000", "1.46", "$1.46"],
        ["243450000000000000000", "243.45", "$243.40"],
      ];
      for (const [raw, amount, usd] of cases) {
        const b = { [`${EVM}|ethereum`]: bal({ USDS: { raw, decimals: 18 } }) };
        expect(resolveAddressTooltip(EVM, map, b, usds).held).toEqual([{ symbol: "USDS", amount, chain: undefined, usd }]);
      }
    });

    it("values sUSDS at its price, not at $1", () => {
      const b = { [`${EVM}|ethereum`]: bal({ SUSDS: { raw: "1000000000000000000000", decimals: 18 } }) };
      expect(addressHeadlineBalance(EVM, map, b, prices)).toBe("$1.08K");
      expect(addressHeadlineBalance(EVM, map, b, {})).toBe("1.00K SUSDS");
    });

    it("stops using a price two days behind the newest one, but not prices that all aged together", () => {
      const b = { [`${EVM}|ethereum`]: bal({ SKY: { raw: "35440000000000000000000000", decimals: 18 } }) };
      const leftBehind = { SKY: { usd: 0.05, asOf: "2026-10-30T11:00:00Z" }, ETH: { usd: 3000, asOf: "2026-11-02T11:00:00Z" } };
      expect(addressHeadlineBalance(EVM, map, b, leftBehind)).toBe("35.44M SKY");
      const allOld = { SKY: { usd: 0.05, asOf: "2026-10-01T11:00:00Z" }, ETH: { usd: 3000, asOf: "2026-10-01T11:00:00Z" } };
      expect(addressHeadlineBalance(EVM, map, b, allOld)).toBe("$1.77M");
    });

    it("gives each held token its USD value and the total in the hover", () => {
      const b = {
        [`${EVM}|ethereum`]: bal({
          SKY: { raw: "1000000000000000000000000", decimals: 18 },
          MKR: { raw: "1000000000000000000", decimals: 18 },
        }),
      };
      const { held, value } = resolveAddressTooltip(EVM, map, b, prices);
      expect(held.map((h) => [h.symbol, h.usd])).toEqual([["SKY", "$50.00K"], ["MKR", undefined]]);
      expect(value).toBe("≈$50.00K+");
    });
  });

  it("returns null when nothing is held", () => {
    expect(addressHeadlineBalance(EVM, map, {})).toBe(null);
    expect(addressHeadlineBalance(EVM, map, { [`${EVM}|ethereum`]: bal({ ETH: { raw: "0", decimals: 18 } }) })).toBe(null);
  });
});
