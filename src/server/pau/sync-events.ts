// Reads the admin-event history of every registry contract into pau_events.
// One cursor per (chain, contract, event): explorer log APIs filter on a single
// topic0, and filtering is what keeps the relayers' operational events (one per
// swap or deposit) out. Backfill and catch-up are the same path: a cursor at
// block 0 reads the contract's whole history, paged by the explorer.
//
// Each tick visits the least recently checked cursors until its time budget is
// spent, so a cold database catches up over several ticks and a warm one
// revisits every cursor in rotation. A rate-limited explorer ends the tick for
// its chain only (the next request would be refused too); other chains go on.
import type { PauRegistry } from "../../lib/pauRegistry.ts";
import type { SqlTag } from "../sql-types.ts";
import { adminTopics, decodeAdminLog } from "./admin-events.ts";

/** Blocks left unread behind the head, so a reorg cannot drop a stored event. */
export const CONFIRMATIONS = 64;

export interface PauLog {
  topics: string[];
  data: string;
  blockNumber: number;
  timeStamp: number;
  transactionHash: string;
  logIndex: number;
}

export interface SyncDeps {
  /** Logs of one contract and topic0 within a block window; null when no explorer serves the chain. */
  logs: (chain: string, address: string, topics: string[], range: { fromBlock: number; toBlock: number }) => Promise<PauLog[] | null>;
  /** The chain's head block, or null when its RPC does not answer. */
  head: (chain: string) => Promise<number | null>;
  budgetMs: number;
  now?: () => number;
  /** Chains another reader owns (rpc-sync.ts); their cursors are never read or marked here. */
  skipChains?: ReadonlySet<string>;
}

export interface EventTarget {
  chain: string;
  contract: string;
  topic0: string;
  event: string;
}

const key = (t: { chain: string; contract: string; topic0: string }) => `${t.chain}:${t.contract}:${t.topic0}`;

/** Every (contract, admin event) the registry implies, once each. Shared contracts serve diamonds. */
export function eventTargets(reg: PauRegistry): EventTarget[] {
  const groups = [...reg.deployments, ...reg.shared.map((s) => ({ ...s, kind: "diamond" as const }))];
  const out = new Map<string, EventTarget>();
  for (const g of groups) {
    for (const m of g.members) {
      for (const { topic0, name } of adminTopics(g.kind, m.role)) {
        const t = { chain: g.chain, contract: m.address, topic0, event: name };
        out.set(key(t), t);
      }
    }
  }
  return [...out.values()];
}

interface CursorRow extends EventTarget {
  next_block: string | number;
}

/** One pau_cursor row per target, created at block 0 when missing. */
export async function ensureCursors(db: SqlTag, targets: EventTarget[]): Promise<void> {
  for (const t of targets) {
    await db`INSERT INTO pau_cursor (chain, contract, topic0, event) VALUES (${t.chain}, ${t.contract}, ${t.topic0}, ${t.event}) ON CONFLICT DO NOTHING`;
  }
}

async function dueCursors(db: SqlTag, targets: EventTarget[]): Promise<CursorRow[]> {
  await ensureCursors(db, targets);
  const wanted = new Set(targets.map(key));
  const rows = (await db`SELECT chain, contract, topic0, event, next_block FROM pau_cursor ORDER BY checked_at ASC NULLS FIRST, chain, contract, topic0`) as CursorRow[];
  return rows.filter((r) => wanted.has(key(r)));
}

/** Stores one log of `contract` if a catalogued event decodes it; false when none does. */
export async function storeLog(db: SqlTag, chain: string, contract: string, l: PauLog): Promise<boolean> {
  const decoded = decodeAdminLog(l.topics, l.data);
  if (!decoded) return false;
  await db`
    INSERT INTO pau_events (chain, tx_hash, log_index, contract, event, args, block, block_time)
    VALUES (${chain}, ${l.transactionHash.toLowerCase()}, ${l.logIndex}, ${contract}, ${decoded.event}, ${decoded.args}::jsonb, ${l.blockNumber}, ${new Date(l.timeStamp * 1000)})
    ON CONFLICT DO NOTHING`;
  return true;
}

async function storeLogs(db: SqlTag, c: CursorRow, logs: PauLog[]): Promise<{ stored: number; undecoded: number }> {
  let stored = 0;
  for (const l of logs) if (await storeLog(db, c.chain, c.contract, l)) stored++;
  return { stored, undecoded: logs.length - stored };
}

async function mark(db: SqlTag, c: CursorRow, at: Date, error: string | null, nextBlock?: number): Promise<void> {
  await db`UPDATE pau_cursor SET next_block = ${nextBlock ?? Number(c.next_block)}, checked_at = ${at}, last_error = ${error} WHERE chain = ${c.chain} AND contract = ${c.contract} AND topic0 = ${c.topic0}`;
}

export interface SyncResult {
  visited: number;
  pending: number;
  events: number;
  undecoded: number;
  errors: number;
  /** Chains whose explorer refused a request this tick; their remaining cursors waited. */
  rateLimited: string[];
}

const RATE_LIMITED = /\b429\b|rate.?limit|max calls per sec/i;

/** One cursor: read its window, store what decodes, advance. "limited" on an explorer rate limit; a database error propagates. */
async function visit(db: SqlTag, c: CursorRow, to: number, deps: SyncDeps, res: SyncResult): Promise<"limited" | void> {
  const at = new Date(deps.now?.() ?? Date.now());
  const from = Number(c.next_block);
  if (to < from) return mark(db, c, at, null);
  let logs: PauLog[] | null;
  try {
    logs = await deps.logs(c.chain, c.contract, [c.topic0], { fromBlock: from, toBlock: to });
  } catch (e) {
    const msg = (e as Error).message;
    res.errors++;
    // A rate-limited cursor stays unmarked, so it is first in line next tick.
    if (RATE_LIMITED.test(msg)) return "limited";
    return mark(db, c, at, msg.slice(0, 300));
  }
  if (logs === null) return mark(db, c, at, `no explorer serves ${c.chain}`);
  const { stored, undecoded } = await storeLogs(db, c, logs);
  res.events += stored;
  res.undecoded += undecoded;
  await mark(db, c, at, null, to + 1);
}

/** Each chain's head, asked once per tick; a failed lookup is null. */
function headCache(deps: SyncDeps) {
  const heads = new Map<string, Promise<number | null>>();
  return (chain: string) => {
    if (!heads.has(chain)) heads.set(chain, deps.head(chain).catch(() => null));
    return heads.get(chain)!;
  };
}

/** Visits due cursors, least recently checked first, until the budget is spent. */
export async function syncPauEvents(db: SqlTag, reg: PauRegistry, deps: SyncDeps): Promise<SyncResult> {
  const clock = deps.now ?? Date.now;
  const deadline = clock() + deps.budgetMs;
  const due = await dueCursors(db, eventTargets(reg).filter((t) => !deps.skipChains?.has(t.chain)));
  const headOf = headCache(deps);
  const res: SyncResult = { visited: 0, pending: due.length, events: 0, undecoded: 0, errors: 0, rateLimited: [] };
  for (const c of due) {
    if (clock() >= deadline) break;
    const head = res.rateLimited.includes(c.chain) ? null : await headOf(c.chain);
    if (head === null) continue;
    if ((await visit(db, c, head - CONFIRMATIONS, deps, res)) === "limited") {
      res.rateLimited.push(c.chain);
      continue;
    }
    res.visited++;
    res.pending--;
  }
  return res;
}
