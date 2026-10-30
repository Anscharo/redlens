// /api/balances — on-chain token balances for the addresses report.
//   GET  → cached balances (whatever's in atlas_addresses.balances).
//   POST → refresh every row whose balances_checked_at is NULL or older than
//          an hour. Rows the worker wrote in the last hour are skipped, so a
//          click during a rolling cycle does not re-RPC the same addresses.
//          A POST that finds nothing due returns the cache with refreshed:false.
//          The atlas worker writes the same columns on a rolling 24h batch
//          (balances/refresh.ts), under its own once-an-hour MAX ceiling.
// Balances are written here and by the worker — never by sync (see migration 015).
import { sql } from "../db.ts";
import { json } from "../http.ts";
import { REFRESH_INTERVAL_MS, type BalancesResponse, type BalanceMap, type SafeState } from "../../lib/balances.ts";
import { fetchBalances } from "./fetch-balances.ts";
import { toAddressInput, type AddressRow } from "./address-input.ts";
import { loadBalanceStats, persistBalanceResults } from "./refresh.ts";

interface CachedRow {
  address: string;
  chain: string;
  balances: BalanceMap | string | null;
  balances_checked_at: string | Date | null;
  has_code: boolean | null;
  safe: SafeState | string | null;
}

// A prior version of doRefresh() double-JSON-encoded balances before the
// ::jsonb cast, storing a JSON *string* scalar instead of an object. Parse it
// transparently on read so already-corrupted rows self-heal without a manual
// DB fix — the next successful refresh overwrites them with a real object.
function normalizeJson<T>(v: T | string | null): T | null {
  if (!v) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }
  return v;
}

const normalizeBalances = (v: BalanceMap | string | null): BalanceMap => normalizeJson(v) ?? {};

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

// Read the stored balances and shape the wire response. `refreshed` is
// caller-set. Exported for the on-chain addresses report tool, which reads
// the same cache the /reports/onchain-addresses page shows (never triggers a
// refresh itself — that stays a user-initiated POST).
export async function readCache(refreshed: boolean): Promise<BalancesResponse> {
  const rows = await sql<CachedRow[]>`
    SELECT address, chain, balances, balances_checked_at, has_code, safe
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
      safe: normalizeJson<SafeState>(r.safe),
    };
  }
  const stats = await loadBalanceStats(sql);
  const lastCheckedAt = toIso(stats.maxCheckedAt);
  const oldestCheckedAt = toIso(stats.minCheckedAt);
  // Button enables when any fetched row is older than the interval — MIN+1h,
  // not MAX. The worker moves MAX every cycle; POST itself only selects rows
  // past that age, so the button and the sweep agree on "what's due". SQL MIN
  // skips NULLs: a never-fetched row is still selected by POST (IS NULL), and
  // the worker picks those up first, so they don't need to hold the button open.
  const minMs = toMs(oldestCheckedAt);
  const nextRefreshAt = minMs != null ? new Date(minMs + REFRESH_INTERVAL_MS).toISOString() : null;
  return { lastCheckedAt, oldestCheckedAt, nextRefreshAt, refreshed, addresses };
}

// In-process dedupe: a second POST while a refresh is running awaits the same
// promise instead of launching a parallel multicall sweep.
let inFlight: Promise<BalancesResponse> | null = null;

async function doRefresh(): Promise<BalancesResponse> {
  // Only rows actually due: never-fetched, or last stamped more than an hour
  // ago. The worker's last hour of writes is skipped, so a public POST during
  // a rolling cycle cannot re-RPC those addresses — and a chain that failed
  // this sweep stays due, so the next click retries only that residue, not
  // the chains that already answered.
  const cutoff = new Date(Date.now() - REFRESH_INTERVAL_MS);
  const rows = await sql<AddressRow[]>`
    SELECT address, chain, expected_tokens, is_contract, roles, etherscan_name FROM atlas_addresses
    WHERE balances_checked_at IS NULL OR balances_checked_at < ${cutoff}
  `;
  if (rows.length === 0) return readCache(false);

  const inputs = rows.map(toAddressInput);

  const results = await fetchBalances(inputs);
  if (results.length > 0) {
    await persistBalanceResults(sql, results);
    console.log(`balances: refreshed ${results.length}/${rows.length} due addresses`);
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
