// What a diamond facet's keys mean beyond their shape (facet-source.ts gives
// the shape): which argument says which contract a key is for (`via`), and
// what its amounts are counted in (`unit`). One entry per facet key getter,
// each read from the facet's verified source; a getter with no entry is still
// named, but gets no `via` and no unit. HOOKS read the values a facet itself
// reads on chain to build a key, for shapes the candidate addresses cannot
// reach.
import type { DerivedKey } from "../../lib/pau.ts";

/** A fixed unit, or the token at an argument: the address itself ("self") or the aToken's UNDERLYING_ASSET_ADDRESS() ("underlying"). */
export type FacetUnit = { fixed: number; symbol: string | null } | { role: string; via: "self" | "underlying" };

interface FacetKeyRule {
  facet: string;
  getter: RegExp;
  via?: string;
  unit?: FacetUnit;
}

const USDS = { fixed: 18, symbol: "USDS" };
const USDC = { fixed: 6, symbol: "USDC" };

export const FACET_KEYS: FacetKeyRule[] = [
  // USDSFacet.mint(usdsAmount) / burn(usdsAmount).
  { facet: "USDSFacet", getter: /^(mint|burn)RateLimitKey$/, unit: USDS },
  // PSMFacet.swapUSDSToUSDC(usdcAmount) / swapUSDCToUSDS(usdcAmount) decrease both keys by usdcAmount.
  { facet: "PSMFacet", getter: /^(usdsToUSDC|usdcToUSDS)SwapRateLimitKey$/, unit: USDC },
  // CCTPFacet.transfer(amount, …) moves `amount` of usdc.
  { facet: "CCTPFacet", getter: /^(toCCTPRateLimitKey|getToDomainRateLimitKey)$/, unit: USDC },
  // BasinFacet.deposit(basin, asset, amount) / withdraw: `amount` and assetsWithdrawn are in `asset`.
  { facet: "BasinFacet", getter: /^get(Deposit|Withdraw)RateLimitKey$/, via: "basin", unit: { role: "asset", via: "self" } },
  // UniswapV3Facet: the aggregate keys take _toNormalizedAmount (amount * 1e18 / 10 ** decimals) summed over both tokens.
  { facet: "UniswapV3Facet", getter: /^getAggregate(Deposit|Withdraw)RateLimitKey$/, via: "pool", unit: { fixed: 18, symbol: null } },
  // UniswapV3Facet: per-token keys take that token's own amount (amounts.amount0/1, amountSpent of tokenIn).
  { facet: "UniswapV3Facet", getter: /^get(Asset(Deposit|Withdraw)|Swap)RateLimitKey$/, via: "pool", unit: { role: "token", via: "self" } },
  // AaveFacet.deposit(aToken, amount) supplies `amount` of the underlying.
  { facet: "AaveFacet", getter: /^getDepositRateLimitKey$/, via: "aToken", unit: { role: "underlyingAsset", via: "self" } },
  // AaveFacet.withdraw decreases by amountWithdrawn, the underlying balance gained.
  { facet: "AaveFacet", getter: /^getWithdrawRateLimitKey$/, via: "aToken", unit: { role: "aToken", via: "underlying" } },
];

/** The registry entry for a derivation's facet getter. */
export const facetKeyRule = (d: Pick<DerivedKey, "facet" | "getter">): FacetKeyRule | undefined =>
  FACET_KEYS.find((r) => r.facet === d.facet && r.getter.test(d.getter ?? ""));

/** The address at a named argument of a derivation. */
export const argAt = (d: DerivedKey, role: string): string | undefined => d.args[d.roles?.indexOf(role) ?? -1];

/** A view a hook reads on each subject. */
export type HookRead = "POOL" | "UNDERLYING_ASSET_ADDRESS";

export interface FacetHook {
  facet: string;
  /** The diamond parameter event whose argument names each subject, and that argument. */
  event: string;
  arg: string;
  /** The role the subject itself fills, and what is read from it for the other roles. */
  role: string;
  reads: { fn: HookRead; role: string }[];
}

export const HOOKS: FacetHook[] = [
  // AaveFacet.deposit/withdraw read pool = aToken.POOL() and underlying = aToken.UNDERLYING_ASSET_ADDRESS();
  // deposit requires setMaxSlippage(aToken), whose AaveMaxSlippageSet names every aToken.
  { facet: "AaveFacet", event: "AaveMaxSlippageSet", arg: "aToken", role: "aToken", reads: [{ fn: "POOL", role: "pool" }, { fn: "UNDERLYING_ASSET_ADDRESS", role: "underlyingAsset" }] },
];
