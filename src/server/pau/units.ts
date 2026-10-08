// The token each rate limit is counted in. A controller limits an amount in the
// units of what it moves: a vault deposit in the vault's asset, a transfer in
// the token sent, a CCTP transfer in USDC, a Curve action in the pool's
// 18-decimal normalized value. A unit is asserted only where the source of the
// generation holding the key says so: the monolithic rules are read from
// MainnetController, ForeignController and their libraries, and a diamond's
// facets run their own code, so a diamond key gets a unit only from the facet
// rules. The key's derivation (key-derive.ts) names the address a "via" rule
// reads. A key no rule covers keeps decimals inferred from its size (pauView.ts),
// and says so.
import type { AmountUnit, DerivedKey, PauSnapshot } from "../../lib/pau.ts";
import type { PauKind } from "../../lib/pauRegistry.ts";
import { mapLimits, type ChainReader } from "./snapshot.ts";

type Via = "asset" | "token" | "self";
type Rule = { fixed: number; symbol: string | null } | { via: Via };

const MONOLITHIC: [RegExp, Rule][] = [
  // depositToFarm / withdrawFromFarm limit the usdsAmount, whatever the farm.
  [/^LIMIT_(USDS_MINT|FARM_DEPOSIT|FARM_WITHDRAW)$/, { fixed: 18, symbol: "USDS" }],
  [/^LIMIT_(USDE_BURN|SUSDE_COOLDOWN)$/, { fixed: 18, symbol: "USDe" }],
  [/^LIMIT_(USDE_MINT|USDS_TO_USDC|USDC_TO_CCTP|USDC_TO_DOMAIN|BUIDL_REDEEM_CIRCLE|SUPERSTATE_SUBSCRIBE)$/, { fixed: 6, symbol: "USDC" }],
  // CurveLib limits the value moved, normalized by the pool's rates to 18 decimals.
  [/^LIMIT_CURVE_/, { fixed: 18, symbol: null }],
  // Amounts in the vault's underlying asset, not its shares (redeems are converted to assets first).
  [/^LIMIT_(4626|7540)_|^LIMIT_(MAPLE_REDEEM|SPARK_VAULT_TAKE)$/, { via: "asset" }],
  // An OFT adapter moves its token(); a native OFT is the token itself.
  [/^LIMIT_LAYERZERO_TRANSFER$/, { via: "token" }],
  // The token itself: an aToken has its underlying's decimals, and UniswapV3Lib keys each token of a pool with its own amount.
  [/^LIMIT_(AAVE_DEPOSIT|AAVE_WITHDRAW|ASSET_TRANSFER|CENTRIFUGE_TRANSFER|PSM_DEPOSIT|PSM_WITHDRAW|UNISWAP_V3_\w+)$/, { via: "self" }],
];

// USDSFacet limits the usdsAmount and PSMFacet the usdcAmount; no other facet's key is derived from a LIMIT_* constant with a unit it states.
const DIAMOND: [RegExp, Rule][] = [
  [/^LIMIT_USDS_MINT$/, { fixed: 18, symbol: "USDS" }],
  [/^LIMIT_USDS_TO_USDC$/, { fixed: 6, symbol: "USDC" }],
];

const RULES: Record<PauKind, [RegExp, Rule][]> = { monolithic: MONOLITHIC, diamond: DIAMOND };

export const unitRule = (d: DerivedKey | undefined, kind: PauKind = "monolithic"): Rule | null =>
  d ? (RULES[kind].find(([re]) => re.test(d.constant))?.[1] ?? null) : null;
const firstAddress = (d: DerivedKey) => d.args.find((a) => a.startsWith("0x"))?.toLowerCase() ?? null;
const viaKey = (d: DerivedKey | undefined, kind: PauKind): string | null => {
  const r = unitRule(d, kind);
  const a = d ? firstAddress(d) : null;
  return r && "via" in r && a ? `${r.via}:${a}` : null;
};

/** The token behind each `via:address`: the vault's asset(), the adapter's token() (else itself), or the address itself. */
async function tokensOf(read: ChainReader, chain: string, wanted: string[]): Promise<Map<string, string | null>> {
  const lookups = wanted.filter((w) => !w.startsWith("self:"));
  const res = await read(chain, lookups.map((w) => ({ address: w.split(":")[1], functionName: w.split(":")[0] as "asset" | "token", args: [] })));
  const out = new Map<string, string | null>(wanted.filter((w) => w.startsWith("self:")).map((w) => [w, w.split(":")[1]]));
  lookups.forEach((w, i) => {
    const found = typeof res[i] === "string" ? (res[i] as string).toLowerCase() : null;
    out.set(w, found ?? (w.startsWith("token:") ? w.split(":")[1] : null));
  });
  return out;
}

/** Each token's decimals and symbol; a token whose decimals() fails is left out. */
async function tokenUnits(read: ChainReader, chain: string, tokens: string[]): Promise<Map<string, AmountUnit>> {
  const res = await read(chain, tokens.flatMap((t) => (["decimals", "symbol"] as const).map((functionName) => ({ address: t, functionName, args: [] }))));
  const out = new Map<string, AmountUnit>();
  tokens.forEach((t, i) => {
    const [decimals, symbol] = [res[2 * i], res[2 * i + 1]];
    if (typeof decimals === "number") out.set(t, { decimals, symbol: typeof symbol === "string" ? symbol : null, token: t, source: "token" });
  });
  return out;
}

/** The snapshot with each rate limit's and BeamState default's unit attached where a rule finds one. */
export async function withUnits(snap: PauSnapshot, read: ChainReader): Promise<PauSnapshot> {
  const derived = snap.contracts.flatMap((c) => [...(c.rateLimits ?? []), ...(c.beam?.defaults ?? [])].map((x) => x.derived));
  const wanted = [...new Set(derived.map((d) => viaKey(d, snap.kind)).filter((w): w is string => !!w))];
  const tokens = wanted.length ? await tokensOf(read, snap.chain, wanted) : new Map<string, string | null>();
  const tokenList = [...new Set([...tokens.values()].filter((t): t is string => !!t))];
  const units = tokenList.length ? await tokenUnits(read, snap.chain, tokenList) : new Map<string, AmountUnit>();
  const unitOf = (d: DerivedKey | undefined): AmountUnit | undefined => {
    const r = unitRule(d, snap.kind);
    if (r && "fixed" in r) return { decimals: r.fixed, symbol: r.symbol, source: "constant" };
    const token = tokens.get(viaKey(d, snap.kind) ?? "");
    return token ? units.get(token) : undefined;
  };
  return mapLimits(snap, (x) => {
    const unit = unitOf(x.derived);
    return unit ? { ...x, unit } : x;
  });
}
