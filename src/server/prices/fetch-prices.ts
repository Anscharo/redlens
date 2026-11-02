// DefiLlama's current-price endpoint: every symbol in one GET, keyed by coin id
// (tokenPrices.ts priceCoinIds). Free and keyless; politeFetch holds the host
// through any rate-limit cooldown.
import { politeFetch } from "../../lib/upstreamBackoff.ts";
import { priceCoinIds, type PriceMap } from "../../lib/tokenPrices.ts";

const ENDPOINT = "https://coins.llama.fi/prices/current/";
// How far back DefiLlama may reach for a quote when a coin has none right now.
const SEARCH_WIDTH = "6h";
// Below this DefiLlama is guessing (thin or conflicting sources).
const MIN_CONFIDENCE = 0.5;

interface LlamaCoin {
  price?: number;
  timestamp?: number; // unix seconds of the quote
  confidence?: number;
}
export interface LlamaReply {
  coins?: Record<string, LlamaCoin>;
}

/** The reply as symbol → price; a coin absent, unpriced or low-confidence is left out. */
export function parsePrices(ids: Record<string, string>, reply: LlamaReply): PriceMap {
  const out: PriceMap = {};
  for (const [symbol, id] of Object.entries(ids)) {
    const c = reply.coins?.[id];
    if (!c || typeof c.price !== "number" || !Number.isFinite(c.price) || c.price < 0) continue;
    if (typeof c.confidence === "number" && c.confidence < MIN_CONFIDENCE) continue;
    const asOf = typeof c.timestamp === "number" ? new Date(c.timestamp * 1000) : new Date();
    out[symbol] = { usd: c.price, asOf: asOf.toISOString() };
  }
  return out;
}

export function pricesUrl(ids: Record<string, string>): string {
  return `${ENDPOINT}${[...new Set(Object.values(ids))].join(",")}?searchWidth=${SEARCH_WIDTH}`;
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Every known symbol's current USD price. Throws when DefiLlama does not answer. */
export async function fetchTokenPrices(fetchFn: FetchFn = politeFetch): Promise<PriceMap> {
  const ids = priceCoinIds();
  const res = await fetchFn(pricesUrl(ids), { headers: { accept: "application/json", "user-agent": "redlens-prices" } });
  if (!res.ok) throw new Error(`DefiLlama prices answered HTTP ${res.status}`);
  return parsePrices(ids, (await res.json()) as LlamaReply);
}
