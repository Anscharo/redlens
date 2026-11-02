// USD prices for the tokens the balance sweep reads (tokens.ts), shared by the
// server's DefiLlama fetcher (src/server/prices) and the frontend that values
// an address's holdings. Pure + DOM-free.
import { TOKEN_REGISTRY, NATIVE_TOKEN, SOLANA_NATIVE, normalizeSymbol } from "./tokens.ts";

export interface TokenPrice {
  usd: number;
  asOf: string; // ISO time DefiLlama quoted the price at
}
// UPPERCASE symbol → its latest price.
export type PriceMap = Record<string, TokenPrice>;

// A price older than this values nothing: the holding shows as unpriced
// rather than at a figure the market has left behind.
export const PRICE_MAX_AGE_MS = 48 * 60 * 60 * 1000;

// Gas tokens have no contract, so DefiLlama prices them by CoinGecko id
// (`coingecko:<id>`). A symbol missing here is fetched for nobody and stays
// unpriced.
const NATIVE_COINGECKO_IDS: Record<string, string> = {
  ETH: "ethereum",
  POL: "polygon-ecosystem-token",
  AVAX: "avalanche-2",
  XDAI: "xdai",
  XPL: "plasma",
  MON: "monad",
  PLUME: "plume",
  OKB: "okb",
  SOL: "solana",
};

/**
 * UPPERCASE symbol → DefiLlama coin id for every symbol a balance can carry:
 * ERC20s by contract (`ethereum:0x…`, Ethereum's deployment first, since
 * DefiLlama keys chains by the same lowercase names), gas tokens and SOL by
 * CoinGecko id.
 */
export function priceCoinIds(): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const [symbol, byChain] of Object.entries(TOKEN_REGISTRY)) {
    const chain = byChain.ethereum ? "ethereum" : Object.keys(byChain)[0];
    if (chain) ids[symbol] = `${chain}:${byChain[chain].address}`;
  }
  const natives = [...Object.values(NATIVE_TOKEN).map((t) => t.symbol), SOLANA_NATIVE.symbol];
  for (const raw of natives) {
    const symbol = normalizeSymbol(raw);
    const id = NATIVE_COINGECKO_IDS[symbol];
    if (id) ids[symbol] = `coingecko:${id}`;
  }
  return ids;
}

/** The symbol's USD price when one is known and recent enough to use, else null. */
export function freshPrice(symbol: string, prices: PriceMap, nowMs: number): number | null {
  const p = prices[normalizeSymbol(symbol)];
  if (!p || !Number.isFinite(p.usd)) return null;
  const at = Date.parse(p.asOf);
  return Number.isNaN(at) || nowMs - at > PRICE_MAX_AGE_MS ? null : p.usd;
}
