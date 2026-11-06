import { describe, expect, it } from "vitest";
import type { ContractState, LiveRateLimit, PauParam, StoredPauSnapshot } from "./pau.ts";
import { addressCheckId, checkAtlasAddresses } from "./pauAddressChecks.ts";
import type { ValueSource } from "./pauInstanceKeys.ts";

const [VAULT, USDC, ATOKEN, USDS, POOL, STRAY, OTHER] = ["1", "2", "3", "4", "5", "6", "7"].map((c) => "0x" + c.repeat(40));
const [HELD, UNSET, UNKNOWN] = ["a", "b", "e"].map((c) => "0x" + c.repeat(64));
const at = { block: 1, time: "2026-01-02T00:00:00Z", tx: "0xt" };

const lim = (key: string, constant: string, args: string[], unit?: LiveRateLimit["unit"]): LiveRateLimit => ({
  key, configured: { maxAmount: "1", slope: "0" }, setAt: at, changes: 1, data: { maxAmount: "1", slope: "0", lastAmount: "1", lastUpdated: "1" }, available: "1",
  derived: { constant, args }, ...(unit ? { unit } : {}),
});
const param = (event: string, subject: string, extra: Partial<PauParam> = {}): PauParam => ({ event, subject, args: {}, setAt: at, ...extra });

const rl: ContractState = {
  role: "rateLimits", address: "0xrl", events: 1, historyComplete: true, unsetKeys: [UNSET],
  rateLimits: [
    lim(HELD, "LIMIT_4626_DEPOSIT", [VAULT], { decimals: 6, symbol: "USDC", token: USDC, source: "token" }),
    lim("0xaave", "LIMIT_AAVE_DEPOSIT", [ATOKEN], { decimals: 18, symbol: "aEthUSDS", token: ATOKEN, underlying: USDS, source: "token" }),
  ],
};
const controller: ContractState = { role: "controller", address: "0xc", events: 1, historyComplete: true, params: [param("MaxSlippageSet", POOL)] };
const snaps: StoredPauSnapshot[] = [{ deployment: "d", prime: "p", primeName: "P", chain: "ethereum", kind: "monolithic", contracts: [rl, controller], fetchedAt: "2026-11-06T00:00:00Z" }];

const src = (docId: string, params: Record<string, string>, name = "Ethereum Mainnet - X"): ValueSource => ({
  name, docId, params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, [v, docId]])),
});

const run = (s: ValueSource) => checkAtlasAddresses([s], snaps);
const get = (s: ValueSource, name: string) => run(s).get(addressCheckId(s.docId!, name));

describe("checkAtlasAddresses: rate-limit IDs", () => {
  const vault = src("v", { "Inflow RateLimitID": HELD, "Outflow RateLimitID": UNSET, "Swap RateLimitID": UNKNOWN, "Rate Limit IDs": "To be specified" });
  it("finds a stated ID held, or read and never set", () => {
    expect(get(vault, "Inflow RateLimitID")).toMatchObject({ status: "match", limits: [{ key: HELD }] });
    expect(get(vault, "Outflow RateLimitID")?.status).toBe("not-set");
  });
  it("says why it cannot answer, and that an unstated ID has nothing to check", () => {
    expect(get(vault, "Swap RateLimitID")).toMatchObject({ status: "unsure", reason: "no RateLimits here holds this key" });
    expect(get(vault, "Rate Limit IDs")?.status).toBe("not-stated");
  });
  it("lists, for an ID not stated yet, the held keys derived from the instance's addresses", () => {
    const listed = src("l", { "Rate Limit IDs": "To be specified", "Token Address": VAULT });
    expect(get(listed, "Rate Limit IDs")).toMatchObject({ status: "not-stated", limits: [{ key: HELD }] });
  });
});

describe("checkAtlasAddresses: addresses", () => {
  const inst = src("i", { "Rate Limit IDs": "To be specified", "Token Address": VAULT, Pool: POOL, Other: STRAY, Network: "Ethereum Mainnet" });
  it("finds an address a held key is derived from, or a controller parameter is set on", () => {
    expect(get(inst, "Token Address")).toMatchObject({ status: "match", limits: [{ key: HELD }] });
    expect(get(inst, "Pool")).toMatchObject({ status: "match", params: [{ event: "MaxSlippageSet" }] });
  });
  it("cannot match an address nothing on the chain uses, and checks no other param", () => {
    expect(get(inst, "Other")).toMatchObject({ status: "unsure", reason: "no PAU rate limit or parameter uses this address" });
    expect(get(inst, "Network")).toBeUndefined();
  });
  it("checks only instances that state a rate limit, on their own chain", () => {
    expect(run(src("n", { "Token Address": VAULT })).size).toBe(0);
    expect(get(src("b", { "Rate Limit IDs": "x", "Token Address": VAULT }, "Base - X"), "Token Address")?.reason).toBe("no PAU indexed on base");
  });
});

describe("checkAtlasAddresses: underlying assets", () => {
  const ids = { "Rate Limit IDs": "To be specified" };
  it("matches a vault's asset() and an aToken's underlying", () => {
    expect(get(src("v", { ...ids, "Token Address": VAULT, "Underlying Asset Address": USDC }), "Underlying Asset Address")).toMatchObject({ status: "match", onchain: [USDC], symbols: { [USDC]: "USDC" } });
    expect(get(src("a", { ...ids, "Token Address": ATOKEN, "Underlying Asset Address": USDS }), "Underlying Asset Address")?.status).toBe("match");
  });
  it("flags an underlying the chain says the token does not wrap", () => {
    expect(get(src("w", { ...ids, "Token Address": VAULT, "Underlying Asset Address": OTHER }), "Underlying Asset Address")).toMatchObject({ status: "mismatch", onchain: [USDC] });
  });
  it("cannot compare where the chain records nothing the token wraps", () => {
    expect(get(src("s", { ...ids, "Token Address": STRAY, "Underlying Asset Address": USDC }), "Underlying Asset Address")?.status).toBe("unsure");
  });
});
