// Diamond key naming: a diamond's keys are named only by the facets its
// Controller integrates, from the shapes their verified source proves, with
// arguments from the candidate addresses, the diamond's own events and what
// the facet reads on chain; monolithic constants never name a diamond key. The
// vectors are keys Grove's and Osero's diamond RateLimits hold, each confirmed
// by calling the facet's own pure getter on Ethereum.
import { describe, expect, it } from "bun:test";
import path from "node:path";
import { encodeAbiParameters, keccak256, toHex } from "viem";
import type { DerivedKey, LiveRateLimit, PauSnapshot } from "../../lib/pau.ts";
import { keyNamer, withDiamondKeys } from "./diamond-derive.ts";
import { facetShapesAt } from "./facet-source.ts";
import type { ChainCall } from "./snapshot.ts";

const CACHE = path.join(import.meta.dir, "../../../.cache/etherscan");
const USDS = "0xdc035d45d973e3ec169d2276ddab16f1e407384f";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const AUSD = "0x00000000efe302beaa2b3e6e1b18d08d69a9012a";
const BASIN = "0xf08943f817e1f902debc884c7b19ea5764594ac9";
const UNI_POOL = "0xbafead7c60ea473758ed6c6021505e8bbd7e8e5d";
const SPARKLEND_POOL = "0xc13e21b648a5ee794902342038ff3adab66be987";
const SP_USDS = "0xc02ab1a5eaa8d1b114ef786d9bde108cd4364359";
const FACET = { usds: "0x1221cc4b85ab260660ad21c2829e0eb516dffbc7", psm: "0xe4a5dac768a310cc2316f258901b32e499653064", basin: "0xc84825bcd13aeddc372400239499380376a44a39", uni: "0x445d9dc752f269be48250f1a180cac4c61ce4bab", aave: "0x8ce890a96a193ff2dd4b2ea3c682326f655f6b62" };

const KEY = {
  usdsBurn: "0x844d35ae585cfdeed0a77b7724286a1d4b5718bf8663d85e55396062b1cbe38c",
  usdcToUsds: "0x87835797fec2ad9575bc1a7035e3c27b8a8b7db2c3d7118513baf081b3af06b3",
  basinDeposit: "0x44ad4f925dffddd260f6ba5813208bf35b11b254e79611cbc8443c1504f68e68",
  basinWithdrawUsdc: "0xdfd7309f2f1b84a83ada77042d91e79a9cb3daf3ecd4c5335dede65b95c888f5",
  uniSwapUsdc: "0x6e850dcb18bea10055c82d1e3753f551b1228d04b81350ba117235de19f9a0da",
  uniDepositAusd: "0x89c0cb8c17898781d7c1776eafcf73fd0b570659ad5c3791ddcbefe66b001541",
  uniAggregateDeposit: "0xd3384d5424cd179640223010fed859f38b86b26e5e0b9ee88b87321b98882f57",
  aaveDeposit: "0x5534da2f28b3dd200cb0042c0876cd6e2beca93d3232c366ec077018c82da73d",
  aaveWithdraw: "0xf9ac1455c7ba8e0bacb7a3eca4a2cf412eda3cbc0f6aa1b071d73b37d49925d8",
};

const at = { block: 1, time: "t", tx: "0xt" };
const lim = (key: string): LiveRateLimit => ({ key, configured: { maxAmount: "1", slope: "0" }, setAt: at, changes: 1, data: null, available: null });
const integration = (facet: string) => ({ id: "0x01", config: { facet, wires: [] }, setAt: at });

function diamond(facets: string[], keys: string[], params: PauSnapshot["contracts"][number]["params"] = []): PauSnapshot {
  return {
    deployment: "d", prime: "p", primeName: "P", chain: "ethereum", kind: "diamond",
    contracts: [
      { role: "controller", address: "0xc", events: 1, historyComplete: true, integrations: facets.map(integration), params },
      { role: "rateLimits", address: "0xrl", events: 1, historyComplete: true, rateLimits: keys.map(lim) },
    ],
  };
}

const named = (s: PauSnapshot) => Object.fromEntries(s.contracts[1].rateLimits!.map((r) => [r.key, r.derived ?? null]));
const shapesOf = (_chain: string, facet: string) => facetShapesAt(CACHE, 1, facet);
const reads: ChainCall[] = [];
const aTokenRead = async (_chain: string, calls: ChainCall[]) => {
  reads.push(...calls);
  return calls.map((c) => (c.address !== SP_USDS ? null : c.functionName === "POOL" ? SPARKLEND_POOL : c.functionName === "UNDERLYING_ASSET_ADDRESS" ? USDS : null));
};

describe("withDiamondKeys", () => {
  it("names Grove's keys from its USDS, PSM, Basin and Uniswap V3 facets, each with its roles and identifying argument", async () => {
    const snap = diamond([FACET.usds, FACET.psm, FACET.basin, FACET.uni], Object.values(KEY).slice(0, 7));
    const out = named(await withDiamondKeys(snap, aTokenRead, { addresses: [USDS, USDC, AUSD, BASIN, UNI_POOL], shapesOf }));
    expect(out[KEY.usdsBurn]).toEqual({ constant: "LIMIT_USDS_BURN", args: [], roles: [], facet: "USDSFacet", getter: "burnRateLimitKey" });
    expect(out[KEY.usdcToUsds]).toMatchObject({ constant: "LIMIT_USDC_TO_USDS", facet: "PSMFacet" });
    expect(out[KEY.basinDeposit]).toEqual({ constant: "LIMIT_BASIN_DEPOSIT", args: [USDS, BASIN], roles: ["asset", "basin"], facet: "BasinFacet", getter: "getDepositRateLimitKey", via: BASIN });
    expect(out[KEY.basinWithdrawUsdc]).toMatchObject({ constant: "LIMIT_BASIN_WITHDRAW", args: [USDC, BASIN] });
    expect(out[KEY.uniSwapUsdc]).toEqual({ constant: "LIMIT_UNISWAP_V3_SWAP", args: [USDC, UNI_POOL], roles: ["token", "pool"], facet: "UniswapV3Facet", getter: "getSwapRateLimitKey", via: UNI_POOL });
    expect(out[KEY.uniDepositAusd]).toMatchObject({ getter: "getAssetDepositRateLimitKey", args: [AUSD, UNI_POOL] });
    expect(out[KEY.uniAggregateDeposit]).toMatchObject({ getter: "getAggregateDepositRateLimitKey", args: [UNI_POOL], via: UNI_POOL });
  });
  it("names Osero's Aave keys from the pool and underlying its aToken reports, as AaveFacet reads them", async () => {
    const params = [{ event: "AaveMaxSlippageSet", subject: SP_USDS, args: { aToken: SP_USDS, maxSlippage: "1" }, setAt: at }];
    const out = named(await withDiamondKeys(diamond([FACET.aave, FACET.usds], [KEY.aaveDeposit, KEY.aaveWithdraw, KEY.usdsBurn], params), aTokenRead, { addresses: [USDS], shapesOf }));
    expect(out[KEY.aaveDeposit]).toEqual({ constant: "LIMIT_AAVE_DEPOSIT", args: [USDS, SPARKLEND_POOL, SP_USDS], roles: ["underlyingAsset", "pool", "aToken"], facet: "AaveFacet", getter: "getDepositRateLimitKey", via: SP_USDS });
    expect(out[KEY.aaveWithdraw]).toMatchObject({ constant: "LIMIT_AAVE_WITHDRAW", args: [SPARKLEND_POOL, SP_USDS], via: SP_USDS });
    expect(reads.map((c) => c.functionName).sort()).toEqual(["POOL", "UNDERLYING_ASSET_ADDRESS"]);
  });
  it("leaves the Aave keys unnamed when the aToken cannot be read, and uses no facet the diamond does not integrate", async () => {
    const params = [{ event: "AaveMaxSlippageSet", subject: SP_USDS, args: { aToken: SP_USDS }, setAt: at }];
    const failed = named(await withDiamondKeys(diamond([FACET.aave], [KEY.aaveDeposit], params), async (_c, calls) => calls.map(() => null), { addresses: [USDS], shapesOf }));
    expect(failed[KEY.aaveDeposit]).toBeNull();
    const noUni = named(await withDiamondKeys(diamond([FACET.usds], [KEY.uniSwapUsdc, KEY.usdsBurn]), aTokenRead, { addresses: [USDC, UNI_POOL], shapesOf }));
    expect([noUni[KEY.uniSwapUsdc], noUni[KEY.usdsBurn]?.constant]).toEqual([null, "LIMIT_USDS_BURN"]);
  });
});

describe("keyNamer", () => {
  const vault = UNI_POOL;
  const mono4626 = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }], [keccak256(toHex("LIMIT_4626_DEPOSIT")), vault]));
  const name = keyNamer([], { members: [{ address: vault }] }, CACHE);
  const read = async (_c: string, calls: ChainCall[]) => calls.map(() => null);

  it("names a monolithic key from the monolithic constants, and never a diamond key", async () => {
    const mono = named(await name({ ...diamond([], [mono4626]), kind: "monolithic" }, read));
    expect(mono[mono4626]).toEqual({ constant: "LIMIT_4626_DEPOSIT", args: [vault] } satisfies DerivedKey);
    const onDiamond = named(await name(diamond([FACET.usds], [mono4626]), read));
    expect(onDiamond[mono4626]).toBeNull();
  });
});
