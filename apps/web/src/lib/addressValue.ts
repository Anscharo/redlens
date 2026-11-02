// The USD value of an address's holdings, from the DefiLlama prices
// /api/balances sends (src/lib/tokenPrices.ts): the inline figure's total and
// the hover card's per-holding values.
import { freshPrice, type PriceMap } from "@/lib/tokenPrices";

export interface Holding {
  symbol: string;
  raw: string;
  decimals: number;
}

// Dollar-pegged stablecoins, valued at $1 when no fresh price came for them.
// sUSDS is not one: it accrues the savings rate, so it is only valued at its price.
const PEGGED = new Set(["USDS", "USDC", "USDT", "DAI", "USDP", "PYUSD", "RLUSD"]);

export const isPegged = (symbol: string): boolean => PEGGED.has(symbol.toUpperCase());

/** The holding's USD value, or null when nothing prices it. */
export function holdingUsd(h: Holding, prices: PriceMap): number | null {
  const unit = freshPrice(h.symbol, prices) ?? (isPegged(h.symbol) ? 1 : null);
  return unit == null ? null : (Number(h.raw) / 10 ** h.decimals) * unit;
}

export function compactUsd(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  if (abs > 0 && abs < 1) return "<$1";
  return `$${Math.round(n)}`;
}

/**
 * The summed value of the holdings as `$1.2M`, or `≈$1.2M+` when some holding
 * has no price (the figure is then a floor). Null below $1, where a dollar
 * figure says less than the token amount does.
 */
export function holdingsTotal(items: Holding[], prices: PriceMap): string | null {
  let total = 0;
  let unpriced = false;
  for (const h of items) {
    const usd = holdingUsd(h, prices);
    if (usd == null) unpriced = true;
    else total += usd;
  }
  if (total < 1) return null;
  return unpriced ? `≈${compactUsd(total)}+` : compactUsd(total);
}
