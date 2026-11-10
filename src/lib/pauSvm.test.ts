// A Solana value against the svm snapshot: an instance's deposit limit by its
// Integration account, a withdrawal the program never limits, a prime-level
// Reserve and swap found by their titles through the mints the instances
// state, a Reserve the chain never set, and a swap it holds no account for.
import { describe, expect, it } from "vitest";
import type { LiveRateLimit, StoredPauSnapshot } from "./pau.ts";
import { checkAtlasValues } from "./pauAtlasValues.ts";
import type { ValueSource } from "./pauInstanceKeys.ts";

const USDS = "USDSmintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const USDG = "USDGmintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const USDC = "USDCmintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const p = (v: string): [string, string] => [v, `doc-${v}`];

const limit = (key: string, svm: LiveRateLimit["svm"], max: string): LiveRateLimit => ({
  key, configured: { maxAmount: max, slope: "115740740" }, setAt: { block: 0, time: "", tx: "" }, changes: 0, available: max,
  data: { maxAmount: max, slope: "115740740", lastAmount: max, lastUpdated: "0" }, unit: { decimals: 6, symbol: null, source: "token" }, svm,
});
const snap: StoredPauSnapshot = {
  deployment: "keel:solana:svm", prime: "keel", primeName: "Keel", chain: "solana", kind: "svm", fetchedAt: "t",
  contracts: [{
    role: "rateLimits", address: "Controller", events: 0, historyComplete: false, unsetKeys: [`reserve:${USDG.toLowerCase()}`],
    rateLimits: [
      limit("IntKaminoUSDS", { account: "integration", type: "Kamino", mint: USDS, status: "Active" }, "25000000000000"),
      limit("ReserveUSDS", { account: "reserve", type: "Reserve", mint: USDS, status: "Active" }, "25000000000000"),
      limit("SwapUSDSUSDC", { account: "integration", type: "AtomicSwap", mint: USDS, output: USDC, status: "Active" }, "25000000000000"),
    ],
  }],
};
const instance = (sym: string, mint: string, integration: string): ValueSource => ({
  name: `Solana - Kamino ${sym}`, params: {
    Network: p("Solana"), "Asset Supplied By Keel Liquidity Layer": p(sym), "Underlying Asset Address": p(mint), "Integration Account Address": p(integration),
    "Deposit Rate Limit / maxAmount": p(`25,000,000 ${sym}`), "Withdrawal Rate Limit / maxAmount": p("Unlimited"),
  },
});
const primeLevel = (title: string, value: string): ValueSource => ({ name: `Solana - ${title}`, params: { [`${title.replace(/ Maximum$/, "")} Rate Limits / maxAmount`]: p(value) } });
const sources = [
  instance("USDS", USDS, "IntKaminoUSDS"), instance("USDC", USDC, "IntKaminoUSDC"), instance("USDG", USDG, "IntKaminoUSDG"),
  primeLevel("USDS Reserve", "25,000,000 USDS"), primeLevel("USDG Reserve", "25,000,000 USDG"),
  primeLevel("USDS For USDC Swap Maximum", "100,000,000 USDS"), primeLevel("USDC For USDG Swap Maximum", "25,000,000 USDC"),
];

describe("checkAtlasValues on an svm deployment", () => {
  it("checks every Solana value against the account it names", () => {
    const status = Object.fromEntries(checkAtlasValues(sources, [snap]).map((c) => [`${c.instance} · ${c.label}`, c.status]));
    expect(status).toMatchObject({
      "Solana - Kamino USDS · Deposit maxAmount": "match",
      "Solana - Kamino USDS · Withdrawal maxAmount": "no-limit",
      "Solana - USDS Reserve · USDS Reserve maxAmount": "match",
      "Solana - USDS For USDC Swap Maximum · USDS For USDC Swap maxAmount": "mismatch",
      "Solana - USDG Reserve · USDG Reserve maxAmount": "not-set",
      "Solana - USDC For USDG Swap Maximum · USDC For USDG Swap maxAmount": "no-key",
      "Solana - Kamino USDC · Deposit maxAmount": "unread",
    });
  });
  it("says nothing more than no deployment where the chain is not read", () => {
    expect(new Set(checkAtlasValues(sources, []).map((c) => c.status))).toEqual(new Set(["no-deployment"]));
  });
});
