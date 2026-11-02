// Token USD prices held in memory by the API server and served with
// /api/balances. Nothing is stored, so every process start fetches them again
// on its first balances request; how often a running process refreshes them
// depends on the environment (priceRefreshMs).
import type { PriceMap } from "../../lib/tokenPrices.ts";
import { config } from "../config.ts";
import { currentPrEnvGate } from "../pr-env/gate.ts";
import { fetchTokenPrices } from "./fetch-prices.ts";

const HOUR_MS = 60 * 60 * 1000;

/**
 * How long a process keeps its prices before asking DefiLlama again:
 * production every two hours, a PR environment never (it fetches once, when
 * the deploy starts the process), development, local and any other
 * environment once a day.
 */
export function priceRefreshMs(railwayEnv: string, prEnv: boolean): number {
  if (prEnv) return Infinity;
  return railwayEnv === "production" ? 2 * HOUR_MS : 24 * HOUR_MS;
}
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
let maxAgeMs: number | null = null;
const refreshEvery = (): number => (maxAgeMs ??= priceRefreshMs(config.railwayEnv, currentPrEnvGate().inert));

function refresh(now: number): Promise<void> {
  attemptedAt = now;
  inFlight = fetcher()
    .then((next) => {
      if (Object.keys(next).length === 0) return;
      // A symbol this answer left out keeps its older price; the frontend
      // stops using it once it lags the rest (PRICE_MAX_LAG_MS).
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

/** The latest prices, starting a refresh when one is due (priceRefreshMs). */
export async function currentPrices(now: number = Date.now()): Promise<PriceMap> {
  const stale = fetchedAt === 0 || now - fetchedAt >= refreshEvery();
  const due = stale && now - attemptedAt >= RETRY_MS;
  if (due && !inFlight) void refresh(now);
  if (fetchedAt === 0 && inFlight) await waitAtMost(inFlight, FIRST_WAIT_MS);
  return prices;
}

/** Tests: replace the DefiLlama fetch and the refresh interval, and forget every cached price. */
export function resetPriceCache(fetch: () => Promise<PriceMap> = () => fetchTokenPrices(), refreshMs: number | null = null): void {
  prices = {};
  fetchedAt = 0;
  attemptedAt = 0;
  inFlight = null;
  fetcher = fetch;
  maxAgeMs = refreshMs;
}
