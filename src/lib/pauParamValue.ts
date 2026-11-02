// A PAU parameter's value in plain words. The controllers store both guards as
// scaled integers: a max slippage is the WAD (1e18) share of the input's value
// that must come back (MainnetController: minimumMinAmountOut = value *
// maxSlippage / 1e18), and a max exchange rate is 1e36 * assets / shares in raw
// token units (EXCHANGE_RATE_PRECISION = 1e36). A rate reads as assets per
// whole share only with both tokens' decimals; without them it stays raw and
// says so. Pure.
import type { PauParam } from "./pau.ts";

export type ParamValue = { kind: "text"; text: string; title: string } | { kind: "address"; address: string; title: string };

const WAD = 10n ** 18n;
const RATE_PRECISION = 10n ** 36n;

/** `n / 10^scale` as a decimal string, trailing zeros trimmed, fraction cut to `maxFraction` digits. */
export function scaled(n: bigint, scale: number, maxFraction = scale): string {
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const unit = 10n ** BigInt(scale);
  const whole = (abs / unit).toLocaleString("en-US");
  const frac = (abs % unit).toString().padStart(scale, "0").slice(0, maxFraction).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** "at most 0.1% loss (≥ 99.9% back)" for 999000000000000000. */
export function slippageText(raw: string): string {
  const v = BigInt(raw);
  if (v > WAD) return `≥ ${scaled(v * 100n, 18)}% back`;
  return `at most ${scaled((WAD - v) * 100n, 18)}% loss (≥ ${scaled(v * 100n, 18)}% back)`;
}

/** "≤ 10 USDC per share" from the 1e36-scaled raw rate and both tokens' decimals, else null. */
export function exchangeRateText(raw: string, shareDecimals?: number, asset?: { decimals: number; symbol: string | null }): string | null {
  if (shareDecimals === undefined || !asset) return null;
  const scale = 18;
  const perShare = (BigInt(raw) * 10n ** BigInt(shareDecimals + scale)) / (RATE_PRECISION * 10n ** BigInt(asset.decimals));
  return `≤ ${scaled(perShare, scale, 6)} ${asset.symbol ?? "assets"} per share`;
}

/** The address a bytes32 holds when it is one left-padded with zeros (a CCTP or LayerZero recipient), else null. */
export function paddedAddress(v: string): string | null {
  const m = /^0x0{24}([0-9a-fA-F]{40})$/.exec(v);
  return m ? `0x${m[1]}` : null;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** One argument's value: a guard as words, an address (padded or not) to render as one, else null (shown as is). */
export function paramValue(p: PauParam, name: string, v: string): ParamValue | null {
  if (name === "maxSlippage" && /^\d+$/.test(v)) return { kind: "text", text: slippageText(v), title: `maxSlippage ${v} (1e18 = nothing may be lost)` };
  if (name === "maxExchangeRate" && /^\d+$/.test(v)) {
    const text = exchangeRateText(v, p.subjectToken?.decimals, p.asset);
    return { kind: "text", text: text ?? v, title: `maxExchangeRate ${v} (1e36 × assets ÷ shares, raw units)${text ? "" : "; the vault's decimals are not read yet"}` };
  }
  const address = ADDRESS_RE.test(v) ? v : paddedAddress(v);
  return address ? { kind: "address", address, title: `${name} ${v}` } : null;
}
