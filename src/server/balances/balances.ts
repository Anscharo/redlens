// /api/balances — on-chain token balances for the addresses report.
//   GET  → cached balances (whatever's in atlas_addresses.balances).
//   POST → on-demand full refresh, gated to once per hour by MIN(balances_checked_at)
//          (every fetched row is at least that fresh). A no-op POST inside the
//          window returns the cache with refreshed:false. The atlas worker also
//          writes these columns on a rolling 24h batch (balances/refresh.ts),
//          under the same once-an-hour ceiling — gating on MAX would disable
//          this button the moment the cron ticked.
// Balances are written here and by the worker — never by sync (see migration 015).
import { sql } from "../db.ts";
import { json } from "../http.ts";
import { REFRESH_INTERVAL_MS, refreshAllowed, type BalancesResponse, type BalanceMap } from "../../lib/balances.ts";
import { fetchBalances, type AddressInput } from "./fetch-balances.ts";
import { loadBalanceStats, persistBalanceResults } from "./refresh.ts";

interface CachedRow {
  address: string;
  chain: string;
  balances: BalanceMap | string | null;
  balances_checked_at: string | Date | null;
  has_code: boolean | null;
}

// A prior version of doRefresh() double-JSON-encoded balances before the
// ::jsonb cast, storing a JSON *string* scalar instead of an object. Parse it
// transparently on read so already-corrupted rows self-heal without a manual
// DB fix — the next successful refresh overwrites them with a real object.
function normalizeBalances(v: BalanceMap | string | null): BalanceMap {
  if (!v) return {};
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as BalanceMap;
    } catch {
      return {};
    }
  }
  return v;
}

function toIso(v: string | Date | null): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toMs(v: string | null): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

// Read the stored balances and shape the wire response. `refreshed` is caller-set.
async function readCache(refreshed: boolean): Promise<BalancesResponse> {
  const rows = await sql<CachedRow[]>`
    SELECT address, chain, balances, balances_checked_at, has_code
    FROM atlas_addresses
    WHERE balances IS NOT NULL
  `;
  const addresses: BalancesResponse["addresses"] = {};
  for (const r of rows) {
    const checkedAt = toIso(r.balances_checked_at);
    // Keyed by address|chain, matching atlas_addresses' PRIMARY KEY (address, chain) —
    // the same address can be cached with different balances on different chains.
    addresses[`${r.address.toLowerCase()}|${r.chain}`] = {
      chain: r.chain,
      checkedAt,
      balances: normalizeBalances(r.balances),
      hasCode: r.has_code,
    };
  }
  const stats = await loadBalanceStats(sql);
  const lastCheckedAt = toIso(stats.maxCheckedAt);
  const oldestCheckedAt = toIso(stats.minCheckedAt);
  // Button cooldown follows MIN (the stalest fetched row), not MAX: the worker
  // moves MAX every cycle, so a MAX gate would disable the button for good.
  // Never-fetched rows are NOT treated as "MIN = now-forever" — SQL MIN skips
  // NULLs, so an address the fetchers can't read (or one just added by sync)
  // can't hold the hourly gate open for every caller.
  const minMs = toMs(oldestCheckedAt);
  const nextRefreshAt = minMs != null ? new Date(minMs + REFRESH_INTERVAL_MS).toISOString() : null;
  return { lastCheckedAt, oldestCheckedAt, nextRefreshAt, refreshed, addresses };
}

// In-process dedupe: a second POST while a refresh is running awaits the same
// promise instead of launching a parallel multicall sweep.
let inFlight: Promise<BalancesResponse> | null = null;

async function doRefresh(): Promise<BalancesResponse> {
  // Gate: skip if EVERY fetched row is younger than the interval — one full
  // sweep per hour, the same ceiling the worker's rolling batch obeys. MIN
  // ignores NULLs on purpose: a fresh table (all NULL) is allowed through, but
  // a single never-fetched row among fetched ones must NOT re-open the gate on
  // every request — this endpoint is public and ungated (index.ts), so that
  // would make a full-table multicall sweep available on demand.
  const stats = await loadBalanceStats(sql);
  if (!refreshAllowed(toMs(toIso(stats.minCheckedAt)), Date.now())) return readCache(false);

  // Load every address to price. expected_tokens is jsonb (parsed to an array).
  const rows = await sql<
    { address: string; chain: string; expected_tokens: string[] | null; is_contract: boolean | null }[]
  >`
    SELECT address, chain, expected_tokens, is_contract FROM atlas_addresses
  `;
  const inputs: AddressInput[] = rows.map((r) => ({
    address: r.address,
    chain: r.chain,
    expectedTokens: Array.isArray(r.expected_tokens) ? r.expected_tokens : [],
    isContract: r.is_contract ?? false,
  }));

  const results = await fetchBalances(inputs);
  if (results.length > 0) {
    await persistBalanceResults(sql, results);
    console.log(`balances: refreshed ${results.length} addresses`);
  } else {
    console.warn("balances: refresh produced no results (RPC unreachable?) — cache unchanged");
  }
  return readCache(results.length > 0);
}

export async function handleBalances(req: Request): Promise<Response> {
  try {
    if (req.method === "GET") {
      return Response.json(await readCache(false), {
        headers: { "Cache-Control": "public, max-age=60" },
      });
    }
    if (req.method === "POST") {
      // Coalesce concurrent refreshes onto one in-flight promise.
      if (!inFlight) inFlight = doRefresh().finally(() => { inFlight = null; });
      return Response.json(await inFlight);
    }
    // Statuses unchanged; bodies now carry the shared `{ error }` envelope
    // (http.ts) so a client reads one shape across every API route.
    return json({ error: "method_not_allowed" }, 405);
  } catch (e) {
    console.error(`balances: ${(e as Error).message}`);
    return json({ error: "unavailable" }, 503);
  }
}
