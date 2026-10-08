// The atlas against the contract: a stated key or one derived from a listed
// address, compared in token units (slopes per day); a switched-off limit
// agreeing whatever slope the atlas writes; and every reason a value cannot be
// compared kept apart from a mismatch.
import { describe, expect, it } from "vitest";
import type { LiveRateLimit, StoredPauSnapshot } from "./pau.ts";
import { checkAtlasValues, type ValueSource } from "./pauAtlasValues.ts";

const k = (c: string) => "0x" + c.repeat(64);
const a = (c: string) => "0x" + c.repeat(40);
const [K_IN, K_OUT, K_GONE, K_BOTH] = ["1", "2", "3", "4"].map(k);
const [VAULT, DEST, SHARED, USDC] = ["a", "b", "c", "d"].map(a);
const UNL = ((1n << 256n) - 1n).toString();
const at = { block: 1, time: "2026-01-01T00:00:00.000Z", tx: "0xt" };
const usdc = { decimals: 6, symbol: "USDC", source: "token" as const };
const lim = (key: string, maxAmount: string, slope: string, extra: Partial<LiveRateLimit> = {}): LiveRateLimit => ({
  key, configured: { maxAmount, slope }, setAt: at, changes: 1, data: { maxAmount, slope, lastAmount: "0", lastUpdated: "0" }, available: maxAmount, unit: usdc, ...extra,
});
const snap = (chain: string, kind: "monolithic" | "diamond", rateLimits: LiveRateLimit[] | undefined, historyComplete = true): StoredPauSnapshot => ({
  deployment: `p:${chain}:${kind}`, prime: "p", primeName: "P", chain, kind, fetchedAt: "t",
  contracts: [{ role: "rateLimits", address: a(kind === "diamond" ? "e" : "f"), events: 1, historyComplete, ...(rateLimits ? { rateLimits } : {}) }],
});
// 5M USDC per day is 57870370.37… raw per second; the chain stores it truncated.
const SNAPS = [
  snap("ethereum", "monolithic", [
    lim(K_IN, "5000000000000", "57870370"), lim(K_OUT, UNL, "0"), lim(K_BOTH, "1000000", "0"),
    lim(k("5"), "7000000000000", "0", { derived: { constant: "LIMIT_4626_DEPOSIT", args: [VAULT] } }),
    lim(k("6"), "8000000000000", "0", { derived: { constant: "LIMIT_ASSET_TRANSFER", args: [USDC, DEST] } }),
    lim(k("7"), "9000000000000", "0", { derived: { constant: "LIMIT_ASSET_TRANSFER", args: [DEST, a("9")] } }),
    lim(k("8"), "1", "0", { derived: { constant: "LIMIT_AAVE_DEPOSIT", args: [SHARED] } }),
  ]),
  snap("ethereum", "diamond", [lim(K_BOTH, "2000000", "0")]),
  snap("base", "monolithic", undefined, false),
];
const src = (name: string, params: Record<string, string>): ValueSource => ({ name, docId: `doc:${name}`, params: Object.fromEntries(Object.entries(params).map(([n, v]) => [n, [v, `${name}/${n}`]])) });
const run = (...sources: ValueSource[]) => checkAtlasValues(sources, SNAPS).map((c) => [c.label, c.status, c.kind]);

describe("checkAtlasValues", () => {
  it("compares a stated key in token units, and a slope per day against the truncated per-second value", () => {
    expect(run(src("Ethereum Mainnet - A", {
      "Inflow RateLimitID": K_IN, "Outflow RateLimitID": K_OUT,
      "Inflow Rate Limits / maxAmount": "5,000,000 USDC", "Inflow Rate Limits / slope": "5,000,000 USDC per day",
      "Outflow Rate Limits / maxAmount": "Unlimited", "Outflow Rate Limits / slope": "10 USDC per day",
    }))).toEqual([
      ["Inflow maxAmount", "match", "monolithic"], ["Inflow slope", "match", "monolithic"],
      ["Outflow maxAmount", "match", "monolithic"], ["Outflow slope", "mismatch", "monolithic"],
    ]);
  });
  it("lets any slope agree with a limit both sides switch off", () => {
    const off = [snap("ethereum", "monolithic", [lim(K_IN, "0", "0")])];
    const s = src("Ethereum Mainnet - Off", { "Inflow RateLimitID": K_IN, "Inflow Rate Limits / maxAmount": "0", "Inflow Rate Limits / slope": "Unlimited" });
    expect(checkAtlasValues([s], off).map((c) => c.status)).toEqual(["match", "match"]);
  });
  it("derives keys from listed addresses: a vault by its first argument, a transfer by its destination, never an underlying or a shared address", () => {
    const vault = src("Ethereum Mainnet - Vault", { "Token Address": VAULT, "Underlying Asset Address": USDC, "Deposit Rate Limits / maxAmount": "7,000,000 USDC" });
    const xfer = src("Ethereum Mainnet - Transfer", { "Destination Address": DEST, "TransferAssets Rate Limits / maxAmount": "8,000,000 USDC" });
    const [s1, s2] = [src("Ethereum Mainnet - S1", { "Token Address": SHARED, "Inflow Rate Limits / maxAmount": "1" }), src("Ethereum Mainnet - S2", { "Token Address": SHARED })];
    const out = checkAtlasValues([vault, xfer, s1, s2], SNAPS);
    expect(out.map((c) => [c.instance, c.status, c.via ?? null])).toEqual([
      ["Ethereum Mainnet - Vault", "match", VAULT], ["Ethereum Mainnet - Transfer", "match", DEST], ["Ethereum Mainnet - S1", "no-key", null],
    ]);
  });
  it("compares a key held on both PAUs of a chain on each", () => {
    expect(run(src("Ethereum Mainnet - Both", { "Rate Limit IDs": K_BOTH, "Rate Limits / maxAmount": "1 USDC" }))).toEqual([
      ["Rate limit maxAmount", "match", "monolithic"], ["Rate limit maxAmount", "mismatch", "diamond"],
    ]);
  });
  it("tells a key the read chain lacks from an unread chain, no deployment, no value yet and unreadable text", () => {
    expect(run(
      src("Ethereum Mainnet - Gone", { "Inflow RateLimitID": K_GONE, "Inflow Rate Limits / maxAmount": "1 USDC", "Inflow Rate Limits / slope": "N/A - swaps only", "Outflow Rate Limits / maxAmount": "most of it" }),
      src("Base - Later", { "Inflow RateLimitID": K_GONE, "Inflow Rate Limits / maxAmount": "1 USDC" }),
      src("Solana - Elsewhere", { "Inflow Rate Limits / maxAmount": "1 USDC" }),
    )).toEqual([
      ["Inflow maxAmount", "not-set", null], ["Inflow slope", "not-stated", null], ["Outflow maxAmount", "unparsed", null],
      ["Inflow maxAmount", "unread", null], ["Inflow maxAmount", "no-deployment", null],
    ]);
  });
  it("keeps the documents a value belongs to", () => {
    const [c] = checkAtlasValues([src("Ethereum Mainnet - A", { "Inflow RateLimitID": K_IN, "Inflow Rate Limits / maxAmount": "5,000,000 USDC" })], SNAPS);
    expect(c).toMatchObject({ docId: "Ethereum Mainnet - A/Inflow Rate Limits / maxAmount", instanceDocId: "doc:Ethereum Mainnet - A", chain: "ethereum", contract: a("f") });
  });
});
