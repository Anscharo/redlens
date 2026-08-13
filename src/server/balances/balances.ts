// /api/balances — on-chain token balances for the addresses report.
//   GET  → cached balances (whatever's in atlas_addresses.balances).
//   POST → refresh: fetch every address's balances via multicall and store them,
//          gated to once per hour globally (MAX(balances_checked_at)); a no-op
//          POST inside the window just returns the cache with refreshed:false.
// Balances are written only here — never by sync (see migration 015).
import { sql } from "../db.ts";
import { json } from "../http.ts";
import { REFRESH_INTERVAL_MS, refreshAllowed, type BalancesResponse, type BalanceMap } from "../../lib/balances.ts";
import { fetchBalances, type AddressInput } from "./fetch-balances.ts";

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
  let lastMs: number | null = null;
  for (const r of rows) {
    const checkedAt = toIso(r.balances_checked_at);
    const ms = toMs(checkedAt);
    if (ms != null && (lastMs == null || ms > lastMs)) lastMs = ms;
    // Keyed by address|chain, matching atlas_addresses' PRIMARY KEY (address, chain) —
    // the same address can be cached with different balances on different chains.
    addresses[`${r.address.toLowerCase()}|${r.chain}`] = {
      chain: r.chain,
      checkedAt,
      balances: normalizeBalances(r.balances),
      hasCode: r.has_code,
    };
  }
  const lastCheckedAt = lastMs != null ? new Date(lastMs).toISOString() : null;
  const nextRefreshAt = lastMs != null ? new Date(lastMs + REFRESH_INTERVAL_MS).toISOString() : null;
  return { lastCheckedAt, nextRefreshAt, refreshed, addresses };
}

// In-process dedupe: a second POST while a refresh is running awaits the same
// promise instead of launching a parallel multicall sweep.
let inFlight: Promise<BalancesResponse> | null = null;

async function doRefresh(): Promise<BalancesResponse> {
  // Gate: skip if a global refresh happened within the interval.
  const [{ max }] = await sql<{ max: string | Date | null }[]>`
    SELECT MAX(balances_checked_at) AS max FROM atlas_addresses
  `;
  const lastMs = toMs(toIso(max));
  if (!refreshAllowed(lastMs, Date.now())) return readCache(false);

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
    const now = new Date().toISOString();
    await sql.begin(async (tx) => {
      for (const r of results) {
        // Both columns COALESCE onto the existing value when this sweep had
        // nothing to say. has_code: undefined → the address wasn't checked, so
        // a verified contract's flag isn't cleared. balances: an empty map is
        // indistinguishable from a multicall whose calls all failed (viem
        // reports failures by omission), so it must not overwrite a good
        // reading — rows now reach here on a hasCode result alone.
        const balances = Object.keys(r.balances).length > 0 ? r.balances : null;
        await tx`
          UPDATE atlas_addresses
          SET balances = COALESCE(${balances}::jsonb, balances), balances_checked_at = ${now},
              has_code = COALESCE(${r.hasCode ?? null}, has_code)
          WHERE address = ${r.address} AND chain = ${r.chain}
        `;
      }
    });
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
