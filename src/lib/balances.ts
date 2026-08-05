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
}

export interface BalancesResponse {
  // MAX(balances_checked_at) across the table — the last global refresh.
  lastCheckedAt: string | null;
  // When a refresh is next allowed (lastCheckedAt + interval), or null if never fetched.
  nextRefreshAt: string | null;
  // Whether the request that produced this response actually fetched fresh data
  // (POST only; false when the hourly gate short-circuited or on GET).
  refreshed: boolean;
  // address(lowercase) → its balances. Absent addresses have no cached balances.
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

// POST triggers a server-side refresh, gated to once per hour globally. Returns
// the same shape; `refreshed` says whether new data was actually fetched.
export async function requestBalancesRefresh(): Promise<BalancesResponse> {
  const res = await fetch("/api/balances", { method: "POST" });
  if (!res.ok) throw new Error(`balances refresh: ${res.status}`);
  return (await res.json()) as BalancesResponse;
}
