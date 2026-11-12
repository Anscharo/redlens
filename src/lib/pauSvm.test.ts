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
const INT = (sym: string) => `Kamino${sym}`.padEnd(44, "A");
const [RESERVE_USDS, SWAP, CCTP_A, CCTP_B] = ["ReserveUSDS", "SwapUSDSUSDC", "CctpUSDCa", "CctpUSDCb"].map((n) => n.padEnd(44, "A"));
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
      limit(INT("USDS"), { account: "integration", type: "Kamino", mint: USDS, status: "Active" }, "25000000000000"),
      limit(RESERVE_USDS, { account: "reserve", type: "Reserve", mint: USDS, status: "Active" }, "25000000000000"),
      limit(SWAP, { account: "integration", type: "AtomicSwap", mint: USDS, output: USDC, status: "Active" }, "25000000000000"),
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
  instance("USDS", USDS, INT("USDS")), instance("USDC", USDC, INT("USDC")), instance("USDG", USDG, INT("USDG")),
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
  it("keeps the key in the chain's own case", () => {
    const keys = new Set(checkAtlasValues(sources, [snap]).map((c) => c.key));
    expect(keys.has(INT("USDS"))).toBe(true);
    expect(keys.has(`reserve:${USDG}`)).toBe(true);
  });
  it("names no account for an Integration address that is not one, or a symbol stated with two mints", () => {
    const unnamed = { ...instance("USDS", USDS, "To be specified"), name: "Solana - Drift USDS" };
    const status = (ss: ValueSource[], label: string) => checkAtlasValues(ss, [snap]).find((c) => `${c.instance} · ${c.label}` === label)?.status;
    expect(status([unnamed], "Solana - Drift USDS · Deposit maxAmount")).toBe("no-key");
    const clash = [...sources, instance("USDS", USDC, INT("USDT"))];
    expect(status(clash, "Solana - USDS Reserve · USDS Reserve maxAmount")).toBe("no-key");
  });
  it("reads a title two accounts fit as ambiguous unless both agree", () => {
    const cctp = (key: string, max: string) => limit(key, { account: "integration", type: "CctpBridge", mint: USDC, status: "Active" }, max);
    const withBridges = (b: string): StoredPauSnapshot => ({ ...snap, contracts: [{ ...snap.contracts[0], rateLimits: [...snap.contracts[0].rateLimits!, cctp(CCTP_A, "25000000000000"), cctp(CCTP_B, b)] }] });
    const bridge = primeLevel("Maximum USDC Bridged To Ethereum Mainnet Via Circle CCTP", "25,000,000 USDC");
    const statuses = (b: string) => checkAtlasValues([...sources, bridge], [withBridges(b)]).filter((c) => c.instance === bridge.name).map((c) => c.status);
    expect(statuses("25000000000000")).toEqual(["match", "match"]);
    expect(statuses("5000000000000")).toEqual(["ambiguous", "ambiguous"]);
  });
  it("says nothing more than no deployment where the chain is not read", () => {
    expect(new Set(checkAtlasValues(sources, []).map((c) => c.status))).toEqual(new Set(["no-deployment"]));
  });
});
