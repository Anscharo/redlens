// The on-chain contract-state snapshot: storage, the worker's cadence gate, and
// the public read route.
//
//   GET /api/chain-state → the whole stored snapshot ({ block, values, fetchedAt })
//
// The snapshot used to be a committed artifact (public/chain-state.json)
// refreshed by a weekly PR; it now lives in Postgres (migration 020), written by
// the atlas worker's chain-state step and read back here. Frontend degradation
// is unchanged: src/lib/chainstate.ts catches a failure to empty values, so a
// DB-less dev box (or a fresh DB with no row yet) renders no on-chain values
// rather than breaking.
import { sql } from "./db.ts";
import { json } from "./http.ts";
import { config } from "./config.ts";

// Minimal structural type so the atlas worker can pass its own Bun.sql client
// without importing the web service's config-bound `sql` — same seam as
// preview/pr-state.ts's sweepPrStates.
type SqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

export interface ChainStateSnapshot {
  /** Decimal block number as a string — a bigint past JSON's safe integer range. */
  block: string;
  /** { [addressLower]: { [viewFnName]: value | null } } */
  values: Record<string, Record<string, unknown>>;
}
export interface StoredChainState extends ChainStateSnapshot {
  fetchedAt: string | null;
}

// jsonb comes back parsed, but a historically double-encoded write would arrive
// as a JSON *string* — parse it transparently rather than serving a scalar the
// frontend can't index (same defensive read as balances.ts's normalizeBalances).
function normalizeValues(v: unknown): ChainStateSnapshot["values"] {
  if (!v) return {};
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as ChainStateSnapshot["values"];
    } catch {
      return {};
    }
  }
  return v as ChainStateSnapshot["values"];
}

function toIso(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

interface Row {
  block: string | null;
  values?: unknown;
  fetched_at?: string | Date | null;
}

/** The stored snapshot, or null when nothing has been fetched yet. */
export async function readChainState(db: SqlTag = sql): Promise<StoredChainState | null> {
  const rows = (await db`SELECT block, "values", fetched_at FROM chain_state WHERE id = 1`) as Row[];
  const r = rows[0];
  if (!r) return null;
  return { block: r.block ?? "", values: normalizeValues(r.values), fetchedAt: toIso(r.fetched_at) };
}

/**
 * Store a freshly fetched snapshot (upsert onto the single row).
 *
 * REFUSES an empty snapshot. A fetch that produced no values means the ABI cache
 * or the RPC failed, not that the chain has no state — writing it would replace
 * a good snapshot with nothing until the next interval. Mirrors the same refusal
 * fetch-chain-state.mjs makes when the chainlog address list comes back empty.
 */
export async function upsertChainState(
  db: SqlTag,
  snap: ChainStateSnapshot,
  now: Date = new Date(),
): Promise<void> {
  const n = Object.keys(snap.values ?? {}).length;
  if (n === 0) {
    throw new Error("refusing to store an empty chain-state snapshot (no addresses returned values)");
  }
  await db`
    INSERT INTO chain_state (id, block, "values", fetched_at)
    VALUES (1, ${snap.block}, ${snap.values}::jsonb, ${now})
    ON CONFLICT (id) DO UPDATE
      SET block = excluded.block, "values" = excluded."values", fetched_at = excluded.fetched_at
  `;
}

export interface RefreshResult {
  refreshed: boolean;
  /** Why the gate decided as it did — logged by the worker step. */
  reason: "fresh" | "no-row" | "stale" | "no-timestamp";
  ageSeconds: number | null;
  block: string | null;
}

export interface RefreshDeps {
  /** Injected so the cadence gate is testable without an RPC round-trip. */
  fetchSnapshot: () => Promise<ChainStateSnapshot>;
  now?: () => number;
  refreshSeconds?: number;
}

/**
 * The cadence gate. One cheap SELECT per worker cycle; the multicall sweep only
 * runs when the stored snapshot is older than `refreshSeconds`. Missing row,
 * NULL timestamp and unparseable timestamp all fetch — failing toward spending
 * one RPC batch beats failing toward never refreshing again.
 */
export async function maybeRefreshChainState(db: SqlTag, deps: RefreshDeps): Promise<RefreshResult> {
  const now = deps.now?.() ?? Date.now();
  const refreshSeconds = deps.refreshSeconds ?? config.chainstateRefreshSeconds;

  const rows = (await db`SELECT block, fetched_at FROM chain_state WHERE id = 1`) as Row[];
  const row = rows[0];
  const fetchedAt = row ? toIso(row.fetched_at) : null;
  const ageSeconds = fetchedAt ? Math.floor((now - new Date(fetchedAt).getTime()) / 1000) : null;

  if (row && ageSeconds !== null && ageSeconds < refreshSeconds) {
    return { refreshed: false, reason: "fresh", ageSeconds, block: row.block ?? null };
  }
  const reason: RefreshResult["reason"] = !row ? "no-row" : ageSeconds === null ? "no-timestamp" : "stale";

  const snap = await deps.fetchSnapshot();
  await upsertChainState(db, snap, new Date(now));
  return { refreshed: true, reason, ageSeconds, block: snap.block };
}

// Public, ungated (like /api/balances): the reader needs the snapshot on every
// page, signed in or not. 503 when no row exists yet — the frontend treats any
// failure as "no on-chain values" and retries on the next call.
export async function handleChainState(): Promise<Response> {
  try {
    const stored = await readChainState();
    if (!stored) return json({ error: "unavailable" }, 503);
    return json(stored, 200, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (e) {
    console.error(`chain-state: ${(e as Error).message}`);
    return json({ error: "unavailable" }, 503);
  }
}
