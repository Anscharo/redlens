// Worker-side address-balance refresh + the shared persist path the HTTP
// POST also uses. Cadence is the inverse of chain-state: that gate fires one
// full sweep when a single timestamp ages out; this one fires a small batch,
// picking addresses whose own balances_checked_at is older than
// BALANCES_REFRESH_SECONDS (default daily).
//
// TWO gates, because they answer different questions:
//   1. How often may THIS lookup happen? At most once an hour, off
//      MAX(balances_checked_at) — the most recent reading from any source, so
//      a manual /api/balances sweep also stands the worker down for an hour.
//      The worker ticks every ~12 minutes; only every fifth or so does work.
//      Note the gate is one-directional: POST does not gate on MAX. It
//      selects every row older than an hour (REFRESH_INTERVAL_MS) and
//      refreshes those — so a click during a rolling cycle skips the
//      addresses the worker just wrote, instead of blanking the button
//      (a MAX gate) or re-RPCing them (a full-table sweep). Each worker
//      lookup is capped at one an hour; POST's cap is "only what's due".
//      A human clicking Refresh in the same hour the worker ran is the
//      one way to get two lookups, and the second only covers the residue.
//   2. Which addresses are due? Those past BALANCES_REFRESH_SECONDS, oldest
//      first, capped at BALANCES_REFRESH_BATCH — and all on ONE chain, so a
//      cycle is a single multicall against a single endpoint.
// A full-table sweep once a day would still be one burst; this spreads the
// same daily work over 24 batches and staggers timestamps so the next day's
// work arrives pre-spread.
//
// Never-fetched rows (NULL balances_checked_at) sort first, so a new address
// from an atlas sync gets a reading on the next eligible cycle rather than
// waiting out the 24h clock.
//
// PROGRESS INVARIANT — a cycle that writes nothing selects the same rows next
// time, so a batch that can never be read would stall the rotation for every
// other address, permanently. That is why the fetchers must return one result
// per address they were ASKED about whenever the RPC answered (empty balances
// allowed — persistBalanceResults COALESCEs those onto the stored value, so
// they only advance the timestamp). An empty result set therefore means "the
// RPC did not answer", which is the one case where not writing is correct.
import { config } from "../config.ts";
import { REFRESH_INTERVAL_MS, refreshAllowed } from "../../lib/balances.ts";
import { fetchBalances, type AddressInput, type BalanceResult } from "./fetch-balances.ts";

type SqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
interface SqlWithTx extends SqlTag {
  begin?: <T>(fn: (tx: SqlTag) => Promise<T>) => Promise<T>;
}

export interface BalanceStats {
  /** Oldest reading: the age every fetched address is at least as fresh as. */
  minCheckedAt: string | Date | null;
  /** Most recent reading anywhere — the hourly ceiling both paths gate on. */
  maxCheckedAt: string | Date | null;
}

function toMs(v: string | Date | null): number | null {
  if (v == null) return null;
  const ms = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

export async function loadBalanceStats(db: SqlTag): Promise<BalanceStats> {
  const rows = (await db`
    SELECT MIN(balances_checked_at) AS min, MAX(balances_checked_at) AS max
    FROM atlas_addresses
  `) as { min?: string | Date | null; max?: string | Date | null }[];
  const r = rows[0];
  return { minCheckedAt: r?.min ?? null, maxCheckedAt: r?.max ?? null };
}

/**
 * Write one sweep's results. Empty balance maps COALESCE onto the stored
 * value (a failed multicall reports by omission, so empty ≠ "holds nothing").
 * has_code likewise: undefined/null means this sweep didn't check, so a
 * verified contract's flag isn't cleared.
 *
 * Uses db.begin when the client has it (the web pool, the worker's Bun SQL)
 * so a mid-loop failure doesn't leave a half-written batch; tests that pass
 * a fake tag without begin still write sequentially.
 */
export async function persistBalanceResults(
  db: SqlWithTx,
  results: BalanceResult[],
  now: Date = new Date(),
): Promise<number> {
  if (results.length === 0) return 0;
  const nowIso = now.toISOString();
  const write = async (tx: SqlTag) => {
    for (const r of results) {
      const balances = Object.keys(r.balances).length > 0 ? r.balances : null;
      await tx`
        UPDATE atlas_addresses
        SET balances = COALESCE(${balances}::jsonb, balances), balances_checked_at = ${nowIso},
            has_code = COALESCE(${r.hasCode ?? null}, has_code)
        WHERE address = ${r.address} AND chain = ${r.chain}
      `;
    }
  };
  if (typeof db.begin === "function") await db.begin(write);
  else await write(db);
  return results.length;
}

export interface BalanceRefreshResult {
  refreshed: boolean;
  /**
   * Why the gate decided as it did — logged by the worker step.
   *   cooldown — an RPC was touched less than an hour ago (by anyone)
   *   fresh    — nothing is past its staleness window
   *   stale    — a batch was fetched and written
   *   empty    — rows were due but the RPC answered nothing; nothing written
   */
  reason: "cooldown" | "fresh" | "stale" | "empty";
  selected: number;
  fetched: number;
  chain: string | null;
}

export interface BalanceRefreshDeps {
  /** Injected so the cadence gate is testable without an RPC round-trip. */
  fetch?: (inputs: AddressInput[]) => Promise<BalanceResult[]>;
  now?: () => number;
  maxAgeSeconds?: number;
  batchSize?: number;
  /** Minimum spacing between lookups, from either path. Hourly by default. */
  intervalMs?: number;
}

interface StaleRow {
  address: string;
  chain: string;
  expected_tokens: string[] | null;
  is_contract: boolean | null;
}

/**
 * One worker cycle of the rolling refresh. Cheap when the hourly ceiling hasn't
 * elapsed or nothing is older than `maxAgeSeconds` (one or two aggregate reads,
 * no RPC). Otherwise fetches up to `batchSize` oldest-stale addresses on the
 * chain that currently has the oldest stale row — one multicall, then persist.
 */
export async function maybeRefreshBalances(
  db: SqlWithTx,
  deps: BalanceRefreshDeps = {},
): Promise<BalanceRefreshResult> {
  const nowMs = deps.now?.() ?? Date.now();
  const maxAgeSeconds = deps.maxAgeSeconds ?? config.balancesRefreshSeconds;
  const batchSize = deps.batchSize ?? config.balancesRefreshBatch;
  const intervalMs = deps.intervalMs ?? REFRESH_INTERVAL_MS;
  const cutoff = new Date(nowMs - maxAgeSeconds * 1000);

  // Gate 1 — anyone's last lookup, not just ours: a manual POST refresh writes
  // the same column, so pressing the button also buys the worker an hour off.
  const stats = await loadBalanceStats(db);
  const lastMs = toMs(stats.maxCheckedAt);
  if (!refreshAllowed(lastMs, nowMs, intervalMs)) {
    return { refreshed: false, reason: "cooldown", selected: 0, fetched: 0, chain: null };
  }

  // Gate 2 — the due rows, all on the chain holding the single oldest of them.
  // The inner ORDER BY breaks ties on chain so the pick is deterministic while
  // a fresh table is still full of NULLs.
  const rows = (await db`
    SELECT address, chain, expected_tokens, is_contract
    FROM atlas_addresses
    WHERE chain = (
      SELECT chain FROM atlas_addresses
      WHERE balances_checked_at IS NULL OR balances_checked_at < ${cutoff}
      ORDER BY balances_checked_at ASC NULLS FIRST, chain
      LIMIT 1
    )
    AND (balances_checked_at IS NULL OR balances_checked_at < ${cutoff})
    ORDER BY balances_checked_at ASC NULLS FIRST, address
    LIMIT ${batchSize}
  `) as StaleRow[];

  if (rows.length === 0) {
    return { refreshed: false, reason: "fresh", selected: 0, fetched: 0, chain: null };
  }

  const inputs: AddressInput[] = rows.map((r) => ({
    address: r.address,
    chain: r.chain,
    expectedTokens: Array.isArray(r.expected_tokens) ? r.expected_tokens : [],
    isContract: r.is_contract ?? false,
  }));
  const fetch = deps.fetch ?? fetchBalances;
  const results = await fetch(inputs);
  if (results.length === 0) {
    return {
      refreshed: false,
      reason: "empty",
      selected: rows.length,
      fetched: 0,
      chain: rows[0].chain,
    };
  }
  await persistBalanceResults(db, results, new Date(nowMs));
  return {
    refreshed: true,
    reason: "stale",
    selected: rows.length,
    fetched: results.length,
    chain: rows[0].chain,
  };
}
