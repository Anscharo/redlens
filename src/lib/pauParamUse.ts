// Whether a per-address PAU parameter does anything, and what kind of contract
// it is set on. A controller keeps a max slippage or max exchange rate for every
// address it was ever given one for, but the operation it guards runs only while
// a rate limit derived from that address is non-zero, so a setting is "on" only
// then. A key no derivation names cannot be matched, so "unkeyed" means no
// *named* rate limit uses the address, never that none does. Pure.
import type { LiveRateLimit, PauParam, PauSnapshot } from "./pau.ts";

export type ParamUseState = "on" | "off" | "unkeyed";

export interface ParamUse {
  /** "Curve pool", "Aave market", ...; null when neither the event nor a key says. */
  kind: string | null;
  state: ParamUseState;
  /** The rate-limit constants derived from the subject, each once. */
  constants: string[];
}

const KIND_BY_CONSTANT: [RegExp, string][] = [
  [/LIMIT_CURVE_/, "Curve pool"],
  [/LIMIT_AAVE_/, "Aave market"],
  [/LIMIT_(4626|7540)_|LIMIT_MAPLE_REDEEM/, "ERC-4626 vault"],
  [/LIMIT_OTC_/, "OTC exchange"],
  [/LIMIT_UNISWAP_V3_/, "Uniswap V3 pool"],
  [/LIMIT_UNISWAP_V4_/, "Uniswap V4 pool"],
];

const KIND_BY_EVENT: [RegExp, string][] = [
  [/^Curve/, "Curve pool"],
  [/^Aave/, "Aave market"],
  [/^OTC/, "OTC exchange"],
  [/^UniswapV3/, "Uniswap V3 pool"],
  [/^UniswapV4/, "Uniswap V4 pool"],
  [/MaxExchangeRateSet$/, "ERC-4626 vault"],
];

const firstMatch = (table: [RegExp, string][], s: string) => table.find(([re]) => re.test(s))?.[1] ?? null;

/**
 * The rate limits each guard event protects, by constant. A guard's subject can
 * also be an argument of a key for a different operation (a vault token moved
 * by LIMIT_ASSET_TRANSFER), which says nothing about whether the guarded
 * operation can run, so only these count.
 */
const GUARDED: [RegExp, RegExp][] = [
  [/^MaxSlippageSet$/, /LIMIT_(CURVE|AAVE|OTC|UNISWAP_V3|UNISWAP_V4)_/],
  [/^Curve/, /LIMIT_CURVE_/],
  [/^Aave/, /LIMIT_AAVE_/],
  [/^OTC/, /LIMIT_OTC_/],
  [/^UniswapV3/, /LIMIT_UNISWAP_V3_/],
  [/^UniswapV4/, /LIMIT_UNISWAP_V4_/],
  [/MaxExchangeRateSet$/, /LIMIT_(4626|7540)_|LIMIT_MAPLE_REDEEM/],
];

const guards = (event: string, constant: string) => GUARDED.find(([re]) => re.test(event))?.[1].test(constant) ?? false;

/** A limit is switched on when its live maxAmount is non-zero, else (live read failed) its configured one. */
const isOn = (r: LiveRateLimit) => BigInt((r.data ?? r.configured).maxAmount || "0") > 0n;

/** The rate limits on this deployment whose derivation takes the address. */
export function limitsUsing(snap: PauSnapshot, address: string): LiveRateLimit[] {
  const a = address.toLowerCase();
  return snap.contracts.flatMap((c) => c.rateLimits ?? []).filter((r) => r.derived?.args.some((x) => x.toLowerCase() === a));
}

/** What the parameter's subject is and whether a rate limit for the operation it guards lets that operation run. */
export function paramUse(snap: PauSnapshot, p: PauParam): ParamUse {
  const limits = limitsUsing(snap, p.subject).filter((r) => guards(p.event, r.derived!.constant));
  const constants = [...new Set(limits.map((r) => r.derived!.constant))];
  const kind = firstMatch(KIND_BY_EVENT, p.event) ?? constants.map((c) => firstMatch(KIND_BY_CONSTANT, c)).find(Boolean) ?? null;
  const state: ParamUseState = limits.length === 0 ? "unkeyed" : limits.some(isOn) ? "on" : "off";
  return { kind, state, constants };
}

/** True for the events whose subject is a contract the controller acts on (a pool, market, vault or exchange), so in-use is meaningful. */
export const isGuardParam = (event: string) => /MaxSlippageSet$|MaxExchangeRateSet$/.test(event);
