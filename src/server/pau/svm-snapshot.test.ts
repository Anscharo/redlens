// Keel's Solana ALM accounts as mainnet answered when the fixture was taken (svm-accounts.fixture.json):
// decoded at their known layouts, turned into the PAU snapshot every reader
// takes, a stated account or Reserve that does not exist marked not set, and a
// suspended Permission read as not holding its role.
import { describe, expect, it } from "bun:test";
import fixture from "./svm-accounts.fixture.json" with { type: "json" };
import { decodeBase58 } from "../../../scripts/lib/solana-pda.mjs";
import type { PauDeployment } from "../../lib/pauRegistry.ts";
import registry from "../../data/pau-registry.json" with { type: "json" };
import { decodeIntegration, decodeReserve } from "./svm-layout.ts";
import { driftMarket, reserveAddress, svmSnapshot } from "./svm-snapshot.ts";
import type { SvmAccounts } from "./svm-reader.ts";

const MINT = { USDS: "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA", USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", USDG: "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH" };
const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const accounts = new Map(Object.entries(fixture as Record<string, string>).map(([a, b]) => [a, bytes(b)]));
const keel = (registry.deployments as PauDeployment[]).find((d) => d.kind === "svm")!;

/** A mint of 6 decimals; a Drift spot market naming `mint`. */
const mint = () => Object.assign(new Uint8Array(82), { 44: 6 });
const market = (m: string) => { const b = new Uint8Array(136); b.set(decodeBase58(m), 72); return b; };
const DRIFT = new Map([[driftMarket(0), market(MINT.USDC)], [driftMarket(5), market(MINT.USDT)], [driftMarket(28), market(MINT.USDS)]]);

const SWAP = "3vAnLvHHERj4xdnrGhMcBpdL7p4RtyisgggHq78MWGSw";
const read: SvmAccounts = async (as) => new Map(as.map((a) => [a, accounts.get(a) ?? DRIFT.get(a) ?? (Object.values(MINT).includes(a) ? mint() : null)]));

describe("svm-layout", () => {
  it("decodes a Reserve and an Integration, and refuses any other layout", () => {
    expect(decodeReserve(accounts.get("FfpyJhTfxKfDJSode3YNZCxEkPRZ2shBv9gU5PTWCCEk")!)).toMatchObject({ mint: MINT.USDS, status: "Active", slope: 10_000_000_000_000n, maxOutflow: 25_000_000_000_000n });
    expect(decodeIntegration(accounts.get("3vAnLvHHERj4xdnrGhMcBpdL7p4RtyisgggHq78MWGSw")!)).toMatchObject({ description: "USDS->USDC AtomicSwap", config: { type: "AtomicSwap", input: MINT.USDS, output: MINT.USDC } });
    expect(() => decodeReserve(accounts.get("3vAnLvHHERj4xdnrGhMcBpdL7p4RtyisgggHq78MWGSw")!)).toThrow(/not a reserve account/);
  });
  it("reads when each limit last accrued, and refuses an enum byte it has no name for", () => {
    expect(decodeReserve(accounts.get("FfpyJhTfxKfDJSode3YNZCxEkPRZ2shBv9gU5PTWCCEk")!).refreshedAt).toBe(1769450220);
    expect(decodeIntegration(accounts.get(SWAP)!).refreshedAt).toBe(1764971050);
    const status = accounts.get(SWAP)!.slice();
    status[1 + 32 + 32 + 32] = 2;
    expect(() => decodeIntegration(status)).toThrow(/unknown status 2/);
    const config = accounts.get(SWAP)!.slice();
    config[1 + 32 + 32 + 32 + 1 + 6 * 8] = 7;
    expect(() => decodeIntegration(config)).toThrow(/unknown integration config 7/);
  });
  it("finds a Reserve where the program derives it", () => {
    expect(reserveAddress("ALM1JSnEhc5PkNecbSZotgprBuJujL5objTbwGtpTgTd", "EeobZr57FSmNvw8Hs719iULJNqv3XLrTB5uPezvC2ND3", MINT.USDC)).toBe("ELdtQWuDKswV5ddhWqHn1EgRDdv5E6mtuhEVhqksYEpi");
  });
});

describe("svmSnapshot", () => {
  it("keys every limit by its account, in the EVM controllers' units, with its token's decimals", async () => {
    const s = await svmSnapshot(keel, read, { integrations: ["H5Vix4RGchYq1cemoe61y7J4j4v3XgWPGLBeqvPEgvzr"], mints: [MINT.USDC] });
    const limits = s.contracts.find((c) => c.role === "rateLimits")!.rateLimits!;
    expect(limits).toHaveLength(15);
    expect(limits.every((r) => r.unit?.decimals === 6)).toBe(true);
    expect(limits.find((r) => r.key === "3vAnLvHHERj4xdnrGhMcBpdL7p4RtyisgggHq78MWGSw")).toMatchObject({ data: { maxAmount: "25000000000000", slope: "115740740" }, svm: { type: "AtomicSwap", mint: MINT.USDS, output: MINT.USDC } });
    expect(limits.find((r) => r.key === "DFrV1Nyfvoucz3nofVRGFmhWAxV1qz1xQxz5rQi4MNot")?.svm?.mint).toBe(MINT.USDS);
  });
  it("works out what is available now from the last refresh, up to the maximum", async () => {
    const at = async (seconds: number) => (await svmSnapshot(keel, read, undefined, undefined, seconds * 1000)).contracts.find((c) => c.role === "rateLimits")!.rateLimits!.find((r) => r.key === SWAP)!;
    expect(await at(1764971050)).toMatchObject({ available: "24999998000000", data: { lastAmount: "24999998000000", lastUpdated: "1764971050" } });
    expect((await at(1764971050 - 60)).available).toBe("24999998000000");
    expect((await at(1764971050 + 1)).available).toBe("25000000000000");
  });
  it("passes over an atlas-stated address that holds some other account, and stops on a listed one that does", async () => {
    const wallet = "99J5Vcf3tav2dorWmB1qxdXtD4MKk6pyayQwS8RCXZKc";
    const others: SvmAccounts = async (as) => new Map([...(await read(as))].map(([a, b]) => [a, a === wallet ? new Uint8Array(0) : b]));
    const s = await svmSnapshot(keel, others, { integrations: [wallet, "FfpyJhTfxKfDJSode3YNZCxEkPRZ2shBv9gU5PTWCCEk"], mints: [] });
    const limits = s.contracts.find((c) => c.role === "rateLimits")!;
    expect(limits.rateLimits).toHaveLength(15);
    expect(limits.unsetKeys).toEqual([]);
    const broken: SvmAccounts = async (as) => new Map([...(await read(as))].map(([a, b]) => [a, a === SWAP ? new Uint8Array(0) : b]));
    await expect(svmSnapshot(keel, broken)).rejects.toThrow(/not a integration account/);
  });
  it("marks a stated account or Reserve that does not exist as not set, lowercased", async () => {
    const s = await svmSnapshot(keel, read, { integrations: ["5JYk4vbZTFcBiHK5HzQTmYcT6kosEKJV62tYTCTpT6xy"], mints: [MINT.USDG] });
    expect(s.contracts.find((c) => c.role === "rateLimits")!.unsetKeys).toEqual(["5jyk4vbztfcbihk5hzqtmyct6kosekjv62tytctpt6xy", `reserve:${MINT.USDG.toLowerCase()}`]);
  });
  it("reads each Permission's authority as holding its role only while Active", async () => {
    const s = await svmSnapshot(keel, read);
    const holder = (a: string) => s.contracts.find((c) => c.address === a)!.roles![0];
    expect(holder("2MeJkkKPfHs6qJgTKZJGnrpq8jBRsvty6zB5iA8SkoVU")).toMatchObject({ name: "RELAYER", account: "99J5Vcf3tav2dorWmB1qxdXtD4MKk6pyayQwS8RCXZKc", holds: false, since: null });
    expect(holder("Gwn4JH8UZYxtx1w5WAwapJSFw97Pwo6gzRF3hSvCmC81")).toMatchObject({ name: "DEFAULT_ADMIN_ROLE", holds: true });
  });
  it("fails the rebuild when a read fails, so the last snapshot is kept", async () => {
    await expect(svmSnapshot(keel, async () => Promise.reject(new Error("Solana accounts not read")))).rejects.toThrow(/not read/);
  });
});
