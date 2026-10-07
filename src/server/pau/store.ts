// pau_state storage, the worker's refresh gate, and the public read route.
//
//   GET /api/pau → { deployments: PauSnapshot & { fetchedAt } [] }
//
// `db` is a parameter so the atlas worker can pass its own client (same seam as
// chain-state.ts).
import type { PauRegistry } from "../../lib/pauRegistry.ts";
import { deploymentId } from "../../lib/pauRegistry.ts";
import { sql } from "../db.ts";
import { json } from "../http.ts";
import type { SqlTag } from "../sql-types.ts";
import type { PauEventRow } from "./replay.ts";
import { buildSnapshot, type ChainReader, type PauSnapshot } from "./snapshot.ts";

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

/** A contract's stored admin events, oldest first. BIGINT arrives as a string; timestamptz as a Date. */
export async function eventsOf(db: SqlTag, chain: string, contract: string): Promise<PauEventRow[]> {
  const rows = (await db`
    SELECT contract, event, args, block, block_time, tx_hash FROM pau_events
    WHERE chain = ${chain} AND contract = ${contract} ORDER BY block, log_index`) as Record<string, unknown>[];
  return rows.map((r) => ({
    contract: String(r.contract),
    event: String(r.event),
    args: (typeof r.args === "string" ? JSON.parse(r.args) : r.args) as Record<string, unknown>,
    block: Number(r.block),
    block_time: iso(r.block_time),
    tx_hash: String(r.tx_hash),
  }));
}

async function upsertSnapshot(db: SqlTag, s: PauSnapshot, now: Date): Promise<void> {
  await db`
    INSERT INTO pau_state (deployment, prime, chain, kind, state, fetched_at)
    VALUES (${s.deployment}, ${s.prime}, ${s.chain}, ${s.kind}, ${s}::jsonb, ${now})
    ON CONFLICT (deployment) DO UPDATE
      SET prime = excluded.prime, chain = excluded.chain, kind = excluded.kind, state = excluded.state, fetched_at = excluded.fetched_at`;
}

async function dropUnlisted(db: SqlTag, ids: string[]): Promise<number> {
  for (const id of ids) await db`DELETE FROM pau_state WHERE deployment = ${id}`;
  return ids.length;
}

export interface StateRefresh {
  refreshed: number;
  removed: number;
  reason: "fresh" | "due";
}

/**
 * Rebuilds every deployment's snapshot once the oldest is older than
 * `refreshSeconds`, or when the registry names a deployment with none; drops
 * snapshots of deployments the registry no longer lists.
 */
export async function maybeRefreshPauState(
  db: SqlTag,
  reg: PauRegistry,
  read: ChainReader,
  opts: { refreshSeconds: number; now?: number },
): Promise<StateRefresh> {
  const now = opts.now ?? Date.now();
  const rows = (await db`SELECT deployment, fetched_at FROM pau_state`) as { deployment: string; fetched_at: Date | string }[];
  const stored = new Map(rows.map((r) => [r.deployment, new Date(r.fetched_at).getTime()]));
  const ids = new Set(reg.deployments.map(deploymentId));
  const stale = (id: string) => !stored.has(id) || now - stored.get(id)! >= opts.refreshSeconds * 1000;
  const removed = await dropUnlisted(db, [...stored.keys()].filter((x) => !ids.has(x)));
  if (![...ids].some(stale)) return { refreshed: 0, removed, reason: "fresh" };
  for (const d of reg.deployments) {
    await upsertSnapshot(db, await buildSnapshot(d, read, (c, a) => eventsOf(db, c, a)), new Date(now));
  }
  return { refreshed: reg.deployments.length, removed, reason: "due" };
}

/** Every stored snapshot, ordered by prime then chain. */
export async function readPauState(db: SqlTag = sql): Promise<(PauSnapshot & { fetchedAt: string })[]> {
  const rows = (await db`SELECT state, fetched_at FROM pau_state ORDER BY deployment`) as { state: unknown; fetched_at: unknown }[];
  return rows
    .map((r) => ({ ...((typeof r.state === "string" ? JSON.parse(r.state) : r.state) as PauSnapshot), fetchedAt: iso(r.fetched_at) }))
    .sort((a, b) => a.primeName.localeCompare(b.primeName) || a.chain.localeCompare(b.chain) || a.kind.localeCompare(b.kind));
}

// Public, ungated, like /api/chain-state: an empty list until the worker has run.
export async function handlePau(): Promise<Response> {
  try {
    const deployments = await readPauState();
    return json({ deployments }, 200, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (e) {
    console.error(`pau: ${(e as Error).message}`);
    return json({ error: "unavailable" }, 503);
  }
}
