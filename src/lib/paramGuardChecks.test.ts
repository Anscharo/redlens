import { describe, expect, it } from "vitest";
import type { BeamDefault, ContractState, LiveRateLimit, PauParam, StoredPauSnapshot } from "./pau.ts";
import { addressCheckId } from "./pauAddressChecks.ts";
import type { ValueSource } from "./pauInstanceKeys.ts";
import { checkGuardParams } from "./paramGuardChecks.ts";

const [POOL, VAULT, USDC] = ["1", "2", "3"].map((c) => "0x" + c.repeat(40));
const POOL_ID = "0x" + "9".repeat(64);
const V4_ID = "0x" + "a".repeat(24) + "b".repeat(40);
const at = { block: 1, time: "t", tx: "0xt" };
const param = (event: string, subject: string, args: Record<string, unknown>, extra: Partial<PauParam> = {}): PauParam => ({ event, subject, args, setAt: at, ...extra });

const vaultToken = { decimals: 18, symbol: "grove-bbqUSDC", token: VAULT, source: "token" as const };
const usdc = { decimals: 6, symbol: "USDC", token: USDC, source: "token" as const };
const held: LiveRateLimit = {
  key: "0xkey", configured: { maxAmount: "1", slope: "0" }, setAt: at, changes: 1, data: null, available: null,
  derived: { constant: "LIMIT_4626_DEPOSIT", args: [VAULT] }, unit: usdc,
};
const def: BeamDefault = { key: "0xkey", maxAmount: "5000000000000", slope: "7523148", scope: "contract", setAt: at };
const contracts: ContractState[] = [
  { role: "controller", address: "0xc", events: 1, historyComplete: true, params: [
    param("MaxSlippageSet", POOL, { maxSlippage: "999000000000000000" }),
    param("MaxSlippageSet", "0x" + "b".repeat(40), { maxSlippage: "998000000000000000" }),
    param("MaxExchangeRateSet", VAULT, { maxExchangeRate: "2000000000000000000000000" }, { subjectToken: vaultToken, asset: usdc }),
  ] },
  { role: "rateLimits", address: "0xrl", events: 1, historyComplete: true, rateLimits: [held], beam: { beamState: "0xb", hop: null, maxChange: null, historyComplete: true, defaults: [def] } },
];
const snaps: StoredPauSnapshot[] = [{ deployment: "d", prime: "p", primeName: "P", chain: "ethereum", kind: "monolithic", contracts, fetchedAt: "t" }];

const src = (params: Record<string, string>): ValueSource => ({
  name: "Ethereum Mainnet - X", docId: "i", params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, [v, "i"]])),
});
const get = (params: Record<string, string>, name: string) => checkGuardParams([src(params)], snaps).get(addressCheckId("i", name));

describe("checkGuardParams: max slippage", () => {
  it("matches a stated loss against the guard set on the instance's address", () => {
    expect(get({ "Pool Address": POOL, "Swap Rate Limit / maxSlippage": "0.1%" }, "Swap Rate Limit / maxSlippage")).toMatchObject({ status: "match", lines: [{ value: "at most 0.1% loss (≥ 99.9% back)" }] });
    expect(get({ "Pool Address": POOL, "Max Slippage": "The `maxSlippage` for this Instance is 0.2%." }, "Max Slippage")).toMatchObject({ status: "mismatch", lines: [{ label: "On-chain" }, { label: "Atlas", value: "at most 0.2% loss" }] });
  });
  it("flags a slippage the atlas leaves to be specified while the chain holds one", () => {
    expect(get({ "Pool Address": POOL, "Max Slippage": "The `maxSlippage` will be specified in a future iteration." }, "Max Slippage")?.status).toBe("candidate");
  });
  it("reads a Uniswap v4 pool's guard where the monolithic controller keys it, by the pool id's low 20 bytes", () => {
    const v4 = { "Token Address": POOL, "Pool ID": V4_ID, "Maximum Slippage": "Max slippage: 0.2%" };
    expect(get(v4, "Maximum Slippage")).toMatchObject({ status: "match", lines: [{ value: "at most 0.2% loss (≥ 99.8% back)" }] });
  });
  it("never reads another integration's guard on an address a v4 instance also lists, and says an unset pool guard is not set", () => {
    expect(get({ "Token Address": POOL, "Pool ID": POOL_ID, "Maximum Slippage": "Max slippage: 0.1%" }, "Maximum Slippage")).toMatchObject({ status: "not-set", lines: [{ text: "No max slippage is set on-chain for this pool." }] });
  });
  it("reads a value the atlas leaves to be specified, with nothing on-chain, as unstated", () => {
    expect(get({ "Token Address": USDC, "Max Slippage": "The `maxSlippage` will be specified in a future iteration." }, "Max Slippage")?.status).toBe("not-stated");
  });
  it("reads a guard left to be specified on a chain with nothing indexed as unstated, and a stated one as not yet indexed", () => {
    const onBase = (value: string) => checkGuardParams([{ name: "Base - X", docId: "b", params: { "Max Slippage": [value, "b"] } }], snaps).get(addressCheckId("b", "Max Slippage"));
    expect(onBase("This will be specified in a future iteration.")?.status).toBe("not-stated");
    expect(onBase("0.1%")).toMatchObject({ status: "unsure", lines: [{ text: "Param or contract not yet indexed." }] });
  });
  it("stays unsure where nothing is set on the addresses an instance lists, since the guard may sit on one it does not", () => {
    expect(get({ "Token Address": USDC, "TransferAssets Rate Limit / maxSlippage": "0.2%" }, "TransferAssets Rate Limit / maxSlippage")).toMatchObject({ status: "unsure", lines: [{ text: "No max slippage is set on-chain for the addresses this instance lists." }] });
  });
});

describe("checkGuardParams: max exchange rate", () => {
  it("reads setMaxExchangeRate(vault, shares, assets) as 1e36 * assets / shares", () => {
    expect(get({ "Token Address": VAULT, "Max Exchange Rate": "- `setMaxExchangeRate(GROVE_VAULT, 1e18, 2e6)`" }, "Max Exchange Rate")).toMatchObject({ status: "match", lines: [{ value: "≤ 2 USDC per share" }] });
    expect(get({ "Token Address": VAULT, "Max Exchange Rate": "setMaxExchangeRate(GROVE_VAULT, 1e18, 1.15e6)" }, "Max Exchange Rate")).toMatchObject({ status: "mismatch", lines: [{ value: "≤ 2 USDC per share" }, { label: "Atlas", value: "≤ 1.15 USDC per share" }] });
  });
  it("says it cannot read an atlas value written another way", () => {
    expect(get({ "Token Address": VAULT, "Max Exchange Rate": "At most two USDC per share." }, "Max Exchange Rate")?.status).toBe("unsure");
  });
});

describe("checkGuardParams: Configurator default limits", () => {
  const vault = { "Token Address": VAULT, "Rate Limit IDs": "To be specified" };
  it("judges a stated default against the default for the instance's key, in the key's units", () => {
    expect(get({ ...vault, "Deposit Rate Limit Default / maxAmount": "5,000,000 USDC" }, "Deposit Rate Limit Default / maxAmount")).toMatchObject({ status: "match", lines: [{ label: "On-chain default", value: "5M" }] });
    expect(get({ ...vault, "Deposit Rate Limit Default / slope": "650,000 USDC per day" }, "Deposit Rate Limit Default / slope")?.status).toBe("match");
    expect(get({ ...vault, "Deposit Rate Limit Default / maxAmount": "6,000,000 USDC" }, "Deposit Rate Limit Default / maxAmount")?.status).toBe("mismatch");
  });
  it("says no default is set for a side the Configurator has none for", () => {
    expect(get({ ...vault, "Withdraw Rate Limit Default / maxAmount": "1 USDC" }, "Withdraw Rate Limit Default / maxAmount")?.status).toBe("not-set");
  });
});
