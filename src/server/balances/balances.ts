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
import { REFRESH_INTERVAL_MS, type BalancesResponse, type BalanceMap } from "../../lib/balances.ts";
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
  const rows = await sql<
    { address: string; chain: string; expected_tokens: string[] | null; is_contract: boolean | null }[]
  >`
    SELECT address, chain, expected_tokens, is_contract FROM atlas_addresses
    WHERE balances_checked_at IS NULL OR balances_checked_at < ${cutoff}
  `;
  if (rows.length === 0) return readCache(false);

  const inputs: AddressInput[] = rows.map((r) => ({
    address: r.address,
    chain: r.chain,
    expectedTokens: Array.isArray(r.expected_tokens) ? r.expected_tokens : [],
    isContract: r.is_contract ?? false,
  }));

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
