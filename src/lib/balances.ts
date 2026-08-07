// Shared wire types + frontend client for on-chain balances (/api/balances).
// The server (src/server/balances) imports the types; the report imports the
// loaders. Balances are NOT atlas-versioned — /api/balances is a fixed route
// (dev: vite proxies /api → the Bun server).
import { fetchJson } from "./verify";

export interface TokenBalance {
  raw: string; // integer balance as a decimal string
  decimals: number;
}
// symbol → balance (includes the native gas symbol, e.g. "ETH").
export type BalanceMap = Record<string, TokenBalance>;

export interface AddressBalances {
  chain: string;
  checkedAt: string | null; // ISO timestamp this address was last fetched
  balances: BalanceMap;
  // Ground-truth eth_getCode check, only run for addresses Etherscan didn't
  // verify (see classifyAddress in onchainAddressesIndex.ts). null = not
  // checked yet — the report falls back to the atlas's isContract flag.
  hasCode: boolean | null;
}

export interface BalancesResponse {
  // MAX(balances_checked_at) across the table — the last global refresh.
  lastCheckedAt: string | null;
  // When a refresh is next allowed (lastCheckedAt + interval), or null if never fetched.
  nextRefreshAt: string | null;
  // Whether the request that produced this response actually fetched fresh data
  // (POST only; false when the hourly gate short-circuited or on GET).
  refreshed: boolean;
  // "address(lowercase)|chain" → its balances (see atlas_addresses' PRIMARY KEY
  // (address, chain) — the same address can be cached per-chain). Absent
  // address|chain pairs have no cached balances.
  addresses: Record<string, AddressBalances>;
}

export const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // once per hour

// Pure gate: is a refresh allowed given the last global check time (ms epoch)?
export function refreshAllowed(
  lastCheckedAtMs: number | null,
  nowMs: number,
  intervalMs: number = REFRESH_INTERVAL_MS,
): boolean {
  return lastCheckedAtMs == null || nowMs - lastCheckedAtMs >= intervalMs;
}

export function loadBalances(): Promise<BalancesResponse> {
  return fetchJson<BalancesResponse>("/api/balances", "balances");
}

// Session-cached GET, shared by every address hover tooltip so hovering many
// addresses on a page fetches /api/balances once instead of once per hover.
// Lazy on purpose: the first fetch only starts on the first hover of any
// address tooltip, not on page load — a startup fetch nobody may need is not
// worth it, so the very first hover in a session can show the name only for
// a moment before its balances arrive.
let cachedBalances: Promise<BalancesResponse> | null = null;
// Synchronous mirror of the cache's resolved value, so a component that
// mounts/unmounts per interaction (the address tooltip, opened fresh on every
// hover) can render already-cached balances on its very first paint instead
// of always starting from "loading" and flashing in once the shared promise
// resolves again.
let resolvedBalances: BalancesResponse | null = null;
export function loadBalancesCached(): Promise<BalancesResponse> {
  if (!cachedBalances) {
    cachedBalances = loadBalances()
      .then((res) => {
        resolvedBalances = res;
        return res;
      })
      .catch((err) => {
        cachedBalances = null;
        throw err;
      });
  }
  return cachedBalances;
}

export function peekCachedBalances(): BalancesResponse | null {
  return resolvedBalances;
}

// POST triggers a server-side refresh, gated to once per hour globally. Returns
// the same shape; `refreshed` says whether new data was actually fetched. Also
// updates the loadBalancesCached()/peekCachedBalances() cache, so the next
// time any address tooltip opens (AddressTooltipContent re-seeds from the
// peek on every mount) it shows the fresh data instead of the pre-refresh
// snapshot for the rest of the session.
export async function requestBalancesRefresh(): Promise<BalancesResponse> {
  const res = await fetch("/api/balances", { method: "POST" });
  if (!res.ok) throw new Error(`balances refresh: ${res.status}`);
  const data = (await res.json()) as BalancesResponse;
  resolvedBalances = data;
  cachedBalances = Promise.resolve(data);
  return data;
}
