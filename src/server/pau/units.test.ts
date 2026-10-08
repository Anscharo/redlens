// The unit a rate limit is counted in: fixed by its constant, read from a
// vault's asset() or an OFT adapter's token() (else the address itself), or
// from the address itself; a key no rule covers, or a token whose decimals()
// fails, keeps inferred decimals. BeamState defaults get the same.
import { describe, expect, it } from "bun:test";
import type { LiveRateLimit, PauSnapshot } from "../../lib/pau.ts";
import type { ChainCall } from "./snapshot.ts";
import { withUnits } from "./units.ts";

const [VAULT, USDC, OFT, NATIVE_OFT, ATOKEN, BROKEN] = ["1", "2", "3", "4", "5", "6"].map((c) => "0x" + c.repeat(40));
const TOKEN_OF: Record<string, string> = { [`asset:${VAULT}`]: USDC, [`token:${OFT}`]: USDC };
const DECIMALS: Record<string, number> = { [USDC]: 6, [NATIVE_OFT]: 18, [ATOKEN]: 6 };
const SYMBOL: Record<string, string> = { [USDC]: "USDC", [ATOKEN]: "aEthUSDC" };

const seen: ChainCall[] = [];
const read = async (_chain: string, calls: ChainCall[]) => {
  seen.push(...calls);
  return calls.map((c) => {
    if (c.functionName === "asset" || c.functionName === "token") return TOKEN_OF[`${c.functionName}:${c.address}`]?.toUpperCase().replace("0X", "0x") ?? null;
    if (c.functionName === "decimals") return DECIMALS[c.address] ?? null;
    return SYMBOL[c.address] ?? null;
  });
};

const at = { block: 1, time: "t", tx: "0xt" };
const lim = (key: string, constant?: string, args: string[] = []): LiveRateLimit => ({
  key, configured: { maxAmount: "1", slope: "0" }, setAt: at, changes: 1, data: null, available: null, ...(constant ? { derived: { constant, args } } : {}),
});
const snap: PauSnapshot = {
  deployment: "p:ethereum:monolithic", prime: "p", primeName: "P", chain: "ethereum", kind: "monolithic",
  contracts: [
    { role: "rateLimits", address: "0xrl", events: 0, historyComplete: true, rateLimits: [
      lim("k-mint", "LIMIT_USDS_MINT"), lim("k-curve", "LIMIT_CURVE_SWAP", [VAULT]), lim("k-4626", "LIMIT_4626_DEPOSIT", [VAULT]),
      lim("k-oft", "LIMIT_LAYERZERO_TRANSFER", [OFT, "30110"]), lim("k-native", "LIMIT_LAYERZERO_TRANSFER", [NATIVE_OFT, "30110"]),
      lim("k-aave", "LIMIT_AAVE_DEPOSIT", [ATOKEN]), lim("k-broken", "LIMIT_ASSET_TRANSFER", [BROKEN, USDC]), lim("k-pendle", "LIMIT_PENDLE_PT_REDEEM", [VAULT]), lim("k-none"),
    ],
      beam: { beamState: "0xbeam", hop: null, maxChange: null, historyComplete: true, defaults: [{ key: "k-4626", maxAmount: "5", slope: "0", scope: "general", setAt: null, derived: { constant: "LIMIT_4626_DEPOSIT", args: [VAULT] } }] } },
    { role: "controller", address: "0xc", events: 0, historyComplete: true },
  ],
};

describe("withUnits", async () => {
  const out = await withUnits(snap, read);
  const unit = (key: string) => out.contracts[0].rateLimits!.find((r) => r.key === key)!.unit;
  it("takes a constant's fixed unit, a vault's asset and an OFT adapter's token", () => {
    expect(unit("k-mint")).toEqual({ decimals: 18, symbol: "USDS", source: "constant" });
    expect(unit("k-curve")).toEqual({ decimals: 18, symbol: null, source: "constant" });
    expect(unit("k-4626")).toEqual({ decimals: 6, symbol: "USDC", token: USDC, source: "token" });
    expect(unit("k-oft")).toMatchObject({ decimals: 6, token: USDC });
  });
  it("reads the address itself for a native OFT and a self-denominated key", () => {
    expect(unit("k-native")).toEqual({ decimals: 18, symbol: null, token: NATIVE_OFT, source: "token" });
    expect(unit("k-aave")).toMatchObject({ decimals: 6, symbol: "aEthUSDC" });
  });
  it("leaves a key no rule covers, or whose token cannot be read, to inferred decimals", () => {
    expect([unit("k-broken"), unit("k-pendle"), unit("k-none")]).toEqual([undefined, undefined, undefined]);
  });
  it("gives a BeamState default its key's unit, and leaves a contract with no limits as it was", () => {
    expect(out.contracts[0].beam!.defaults[0].unit).toMatchObject({ decimals: 6, symbol: "USDC" });
    expect(out.contracts[1]).toBe(snap.contracts[1]);
  });
  it("reads each token once", () => {
    const decimals = seen.filter((c) => c.functionName === "decimals").map((c) => c.address);
    expect(decimals.length).toBe(new Set(decimals).size);
  });
  it("asserts on a diamond only the units its facets state, and counts a monolithic Uniswap V3 key in its token", async () => {
    const diamond = await withUnits({ ...snap, kind: "diamond", contracts: [{ role: "rateLimits", address: "0xrl", events: 0, historyComplete: true, rateLimits: [lim("d-mint", "LIMIT_USDS_MINT"), lim("d-uni", "LIMIT_UNISWAP_V3_DEPOSIT", [VAULT]), lim("d-4626", "LIMIT_4626_DEPOSIT", [VAULT])] }] }, read);
    expect(diamond.contracts[0].rateLimits!.map((r) => r.unit?.symbol ?? null)).toEqual(["USDS", null, null]);
    const mono = await withUnits({ ...snap, contracts: [{ role: "rateLimits", address: "0xrl", events: 0, historyComplete: true, rateLimits: [lim("m-uni", "LIMIT_UNISWAP_V3_SWAP", [ATOKEN, VAULT])] }] }, read);
    expect(mono.contracts[0].rateLimits![0].unit).toMatchObject({ decimals: 6, symbol: "aEthUSDC", source: "token" });
  });
});
