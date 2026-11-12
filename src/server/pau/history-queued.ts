// The governance steps the stored events hold scheduled and not yet run, for
// GET /api/pau/history's `queued`: an L2 Executor's ActionsSetQueued with no
// ActionsSetExecuted or ActionsSetCanceled of the same id, and a StarGuard's
// Plot with no later Exec or Drop of the same star spell, and a LayerZero
// GovernanceCallSent no Solana receipt holds the guid of. A step is listed
// only from events stored; an Executor whose events are not read yet lists
// nothing, which a reader must not take as "nothing queued". Pure.
import type { PauQueuedStep } from "../../lib/pauHistory.ts";
import type { EventRow } from "./history-entries.ts";

type Owners = Map<string, { primes: string[] }>;

/** Seconds since the epoch, as stored (a decimal string or number), as ISO; null when absent. */
const isoSeconds = (v: unknown): string | null => {
  const n = Number(v);
  return v === undefined || v === null || !Number.isFinite(n) ? null : new Date(n * 1000).toISOString();
};

const lower = (v: unknown) => String(v).toLowerCase();

function actionSets(rows: EventRow[]): PauQueuedStep[] {
  const done = new Set(rows.filter((r) => r.event === "ActionsSetExecuted" || r.event === "ActionsSetCanceled").map((r) => `${r.chain}:${r.contract}:${String(r.args.id)}`));
  return rows
    .filter((r) => r.event === "ActionsSetQueued" && !done.has(`${r.chain}:${r.contract}:${String(r.args.id)}`))
    .map((r) => ({ kind: "action-set", chain: r.chain, contract: r.contract, id: String(r.args.id), tx: r.tx, time: r.time, at: isoSeconds(r.args.executionTime), primes: [] }));
}

/** A StarGuard's plots, each closed by the first Exec or Drop of its star spell after it. */
function starSpells(rows: EventRow[], owners: Owners): PauQueuedStep[] {
  const open = new Map<string, EventRow>();
  for (const r of rows) {
    const id = `${r.chain}:${r.contract}:${lower(r.args.addr)}`;
    if (r.event === "Plot") open.set(id, r);
    else if (r.event === "Exec" || r.event === "Drop") open.delete(id);
  }
  return [...open.values()].map((r) => ({
    kind: "star-spell", chain: r.chain, contract: r.contract, id: lower(r.args.addr), tx: r.tx, time: r.time,
    at: isoSeconds(r.args.deadline), primes: owners.get(`${r.chain}:${r.contract}`)?.primes ?? [],
  }));
}

/** The Solana window LayerZero receipts are read over (svm-sync.ts): from its start, through the last pass that reached the head. */
export interface ReceiptsRead {
  from: string;
  through: string;
}

/**
 * The LayerZero governance messages sent inside the window receipts are read
 * over that no stored receipt holds. None before a pass has read receipts; none
 * sent before the window, whose receipts were never read; and none sent after
 * the last pass reached the head, which could not have seen its receipt, so a
 * stalled crawl never reads as a message not received.
 */
function lzMessages(rows: EventRow[], read: ReceiptsRead | null): PauQueuedStep[] {
  if (!read) return [];
  const received = new Set(rows.filter((r) => r.event === "LzReceive").map((r) => lower(r.args.guid)));
  return rows
    .filter((r) => r.event === "GovernanceCallSent" && r.time >= read.from && r.time <= read.through && !received.has(lower(r.args.guid)))
    .map((r) => ({ kind: "lz-message", chain: r.chain, contract: r.contract, id: lower(r.args.guid), tx: r.tx, time: r.time, at: null, primes: [] }));
}

/** Every step still to run, oldest first; `rows` are in chain order, as `pau_events` is read. */
export function queuedSteps(rows: EventRow[], owners: Owners, receipts: ReceiptsRead | null = null): PauQueuedStep[] {
  return [...actionSets(rows), ...starSpells(rows, owners), ...lzMessages(rows, receipts)].sort((a, b) => a.time.localeCompare(b.time));
}
