// Token USD prices held in memory by the API server and served with
// /api/balances. Each process asks DefiLlama at most once an hour; nothing is
// stored, so a restart (or a fresh PR environment) refetches on its first
// balances request.
import type { PriceMap } from "../../lib/tokenPrices.ts";
import { fetchTokenPrices } from "./fetch-prices.ts";

const MAX_AGE_MS = 60 * 60 * 1000;
// After a failed fetch, the next one waits this long; politeFetch holds the
// host far longer on a rate limit.
const RETRY_MS = 5 * 60 * 1000;
// The first request after boot waits this long for prices, then answers
// without them; later requests never wait, they get the last prices while a
// refresh runs behind them.
const FIRST_WAIT_MS = 3_000;

let prices: PriceMap = {};
let fetchedAt = 0;
let attemptedAt = 0;
let inFlight: Promise<void> | null = null;
let fetcher: () => Promise<PriceMap> = () => fetchTokenPrices();

function refresh(now: number): Promise<void> {
  attemptedAt = now;
  inFlight = fetcher()
    .then((next) => {
      if (Object.keys(next).length === 0) return;
      // A symbol this answer left out keeps its older price; the frontend
      // stops using it once it is too old (PRICE_MAX_AGE_MS).
      prices = { ...prices, ...next };
      fetchedAt = Date.now();
    })
    .catch((e: unknown) => console.warn(`prices: DefiLlama fetch failed — ${(e as Error).message}`))
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

function waitAtMost(p: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((r) => (timer = setTimeout(r, ms)));
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** The latest prices, starting an hourly refresh when one is due. */
export async function currentPrices(now: number = Date.now()): Promise<PriceMap> {
  const due = now - fetchedAt >= MAX_AGE_MS && now - attemptedAt >= RETRY_MS;
  if (due && !inFlight) void refresh(now);
  if (fetchedAt === 0 && inFlight) await waitAtMost(inFlight, FIRST_WAIT_MS);
  return prices;
}

/** Tests: replace the DefiLlama fetch and forget every cached price. */
export function resetPriceCache(fetch: () => Promise<PriceMap> = () => fetchTokenPrices()): void {
  prices = {};
  fetchedAt = 0;
  attemptedAt = 0;
  inFlight = null;
  fetcher = fetch;
}
