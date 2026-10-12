// pau_tx_origin storage and the pau_events reads the origin rules take as
// evidence. Stored args come from jsonSafe (admin-events.ts): addresses
// lowercase, integers as decimal strings, so `args->>'addr'` and `args->>'id'`
// compare as text.
import type { PauOrigin } from "../../lib/pauHistory.ts";
import type { SqlTag } from "../sql-types.ts";
import { ORIGIN_EVENTS } from "./governance-events.ts";
import type { Located, TxEvent } from "./origin-rules.ts";

const ORIGIN_EVENT_LIST = `{${[...ORIGIN_EVENTS].join(",")}}`;

export interface PendingTx {
  chain: string;
  tx: string;
  block: number;
}

/**
 * Transactions holding a configuration change whose origin is not stored, plus
 * those stored as unknown or as an unproven relay before `retryBefore`, oldest first.
 */
export async function pendingTxs(db: SqlTag, limit: number, retryBefore: Date): Promise<PendingTx[]> {
  const rows = (await db`
    SELECT e.chain, e.tx_hash, min(e.block)::bigint AS block FROM pau_events e
    LEFT JOIN pau_tx_origin o ON o.chain = e.chain AND o.tx_hash = e.tx_hash
    WHERE NOT (e.event = ANY(${ORIGIN_EVENT_LIST}::text[]))
      AND (o.tx_hash IS NULL OR ((o.kind = 'unknown' OR (o.kind = 'relayed' AND o.spell IS NULL)) AND o.resolved_at < ${retryBefore}))
    GROUP BY e.chain, e.tx_hash ORDER BY min(e.block), e.chain LIMIT ${limit}`) as { chain: string; tx_hash: string; block: string | number }[];
  return rows.map((r) => ({ chain: r.chain, tx: r.tx_hash, block: Number(r.block) }));
}

const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v) as Record<string, unknown>;

export async function eventsOfTx(db: SqlTag, chain: string, tx: string): Promise<TxEvent[]> {
  const rows = (await db`SELECT contract, event, args FROM pau_events WHERE chain = ${chain} AND tx_hash = ${tx} ORDER BY log_index`) as Record<string, unknown>[];
  return rows.map((r) => ({ contract: String(r.contract), event: String(r.event), args: parse(r.args) }));
}

async function first(q: Promise<unknown>): Promise<Located | null> {
  const rows = (await q) as { tx_hash: string; block: string | number }[];
  return rows.length ? { tx: rows[0].tx_hash, block: Number(rows[0].block) } : null;
}

/** The last Plot of `starSpell` on a StarGuard at or before `block`. */
export const plotOf = (db: SqlTag, starGuard: string, starSpell: string, block: number) =>
  first(db`
    SELECT tx_hash, block FROM pau_events WHERE chain = 'ethereum' AND contract = ${starGuard} AND event = 'Plot'
      AND args->>'addr' = ${starSpell.toLowerCase()} AND block <= ${block} ORDER BY block DESC, log_index DESC LIMIT 1`);

/** The ActionsSetQueued of action set `id` on an Executor. */
export const queuedOf = (db: SqlTag, chain: string, executor: string, id: number) =>
  first(db`
    SELECT tx_hash, block FROM pau_events WHERE chain = ${chain} AND contract = ${executor} AND event = 'ActionsSetQueued'
      AND args->>'id' = ${String(id)} ORDER BY block DESC LIMIT 1`);

/**
 * Whether every cursor of `contracts` has read past `block` without an error, and there are `expected` of them.
 * `expected` counts pau_cursor rows, one per (contract, event), as eventTargets lists them, not contracts.
 */
export async function cursorsPast(db: SqlTag, chain: string, contracts: string[], expected: number, block: number): Promise<boolean> {
  if (expected === 0) return true;
  const rows = (await db`
    SELECT count(*)::int AS total, (count(*) FILTER (WHERE next_block > ${block} AND last_error IS NULL))::int AS read
    FROM pau_cursor WHERE chain = ${chain} AND contract = ANY(${`{${contracts.join(",")}}`}::text[])`) as { total: number; read: number }[];
  return rows[0]?.total === expected && rows[0].read === expected;
}

export async function saveOrigin(db: SqlTag, p: PendingTx, o: PauOrigin, at: Date): Promise<void> {
  await db`
    INSERT INTO pau_tx_origin (chain, tx_hash, kind, path, spell, star_spell, l1_tx, tx_from, tx_to, relay, evidence, resolved_at)
    VALUES (${p.chain}, ${p.tx}, ${o.kind}, ${o.path}, ${o.spell}, ${o.starSpell}, ${o.l1Tx}, ${o.from}, ${o.to}, ${o.relay}::jsonb, ${o.evidence}, ${at})
    ON CONFLICT (chain, tx_hash) DO UPDATE SET kind = excluded.kind, path = excluded.path, spell = excluded.spell,
      star_spell = excluded.star_spell, l1_tx = excluded.l1_tx, tx_from = excluded.tx_from, tx_to = excluded.tx_to,
      relay = excluded.relay, evidence = excluded.evidence, resolved_at = excluded.resolved_at`;
}
