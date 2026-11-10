// Reads each svm deployment's configuration history (svm-events.ts) from
// HyperSync into pau_events, as the EVM crawl reads logs (rpc-sync.ts), and
// runs in the same sync:pau-rpc tail, after it, on the same deadline and the
// same HyperSync budget. One pau_svm_cursor row per program: one query reads
// every event the program emits, and only events of a controller the registry
// lists are stored. The same query reads every LzReceive of the chain's
// LayerZero governance programs (registry `shared`, role `lzGovernance`;
// svm-receipts.ts), whatever program the message calls, stored as an
// `LzReceive` row of the governance program with a negative `log_index` (-1
// for the transaction's first), so it orders before the changes it ran and
// never takes their places; origin-svm.ts and history-queued.ts read them.
//
// A cold cursor starts at the first slot HyperSync holds (svm-hypersync.ts),
// so the history is a window that starts there, not the program's whole life;
// svm-history.ts says when it is long enough to judge. When the registry's
// controllers or governance programs change (the cursor's `controllers`
// stamp holds both: `stampOf`), the cursor re-reads from the same start,
// adding what it now reads to the rows it holds. Reads stop
// SVM_CONFIRMATIONS slots behind HyperSync's head. Each pass that reaches the
// head stamps `reached_at`; a failure other than a rate limit is stored in
// `last_error` until a later pass reaches the head, and a rate limit only
// delays the read.
import { membersOf, type PauRegistry } from "../../lib/pauRegistry.ts";
import { isRateLimited } from "../../lib/upstreamBackoff.ts";
import type { SqlTag } from "../sql-types.ts";
import { decodeEmitEvent } from "./svm-events.ts";
import { decodeLzReceive } from "./svm-receipts.ts";
import type { SvmEmit, SvmEventSource } from "./svm-hypersync.ts";

/** Slots left unread behind HyperSync's head, so a fork it rolls back leaves no stored event. */
export const SVM_CONFIRMATIONS = 150;

export interface SvmSyncDeps {
  /** The chain's HyperSync source; null without a token. */
  source: (chain: string) => SvmEventSource | null;
  /** Epoch ms after which no new request starts. */
  deadline: number;
  now?: () => number;
}

export interface SvmSyncResult {
  queries: number;
  events: number;
  /** Slots between the cursor and the confirmed head. */
  behind: number;
  error: string | null;
}

interface Program {
  chain: string;
  program: string;
  controllers: string[];
  /** The chain's LayerZero governance programs, whose receipts are read beside the changes. */
  governance: string[];
}

/** What a cursor has read for: the sorted controllers, then `|` and the governance programs when there are any. */
export const stampOf = (p: Pick<Program, "controllers" | "governance">): string =>
  p.controllers.join(",") + (p.governance.length ? `|${p.governance.join(",")}` : "");

interface Cursor {
  controllers: string;
  startSlot: number;
  next: number;
  reachedAt: Date | null;
}

/** Each svm program the registry lists, with the controllers (its deployments' rateLimits) whose events are stored. */
export function svmPrograms(reg: PauRegistry): Program[] {
  const out = new Map<string, Program>();
  for (const d of reg.deployments.filter((x) => x.kind === "svm")) {
    for (const { address } of membersOf(d, "program")) {
      const governance = reg.shared.filter((s) => s.chain === d.chain).flatMap((s) => s.members.filter((m) => m.role === "lzGovernance").map((m) => m.address)).sort();
      const p = out.get(`${d.chain}:${address}`) ?? { chain: d.chain, program: address, controllers: [], governance };
      p.controllers = [...new Set([...p.controllers, ...membersOf(d, "rateLimits").map((m) => m.address)])].sort();
      out.set(`${d.chain}:${address}`, p);
    }
  }
  return [...out.values()];
}

/** The program's cursor; a cold one starts at the first slot HyperSync holds, and one whose stamp changed re-reads from its start. */
async function cursorFor(db: SqlTag, p: Program, src: SvmEventSource, height: number): Promise<Cursor> {
  const controllers = stampOf(p);
  const [row] = (await db`SELECT controllers, start_slot, start_time, next_slot, reached_at FROM pau_svm_cursor WHERE chain = ${p.chain} AND program = ${p.program}`) as Record<string, unknown>[];
  if (row?.controllers === controllers) return { controllers, startSlot: Number(row.start_slot), next: Number(row.next_slot), reachedAt: row.reached_at ? new Date(row.reached_at as string) : null };
  const start = row ? { slot: Number(row.start_slot), time: new Date(row.start_time as string) } : await src.firstHeld(height).then((f) => ({ slot: f.slot, time: new Date(f.time * 1000) }));
  await db`
    INSERT INTO pau_svm_cursor (chain, program, controllers, start_slot, start_time, next_slot)
    VALUES (${p.chain}, ${p.program}, ${controllers}, ${start.slot}, ${start.time}, ${start.slot})
    ON CONFLICT (chain, program) DO UPDATE SET controllers = excluded.controllers, next_slot = excluded.next_slot, reached_at = NULL`;
  return { controllers, startSlot: start.slot, next: start.slot, reachedAt: null };
}

async function saveCursor(db: SqlTag, p: Program, c: Cursor, at: Date, error: string | null): Promise<void> {
  await db`UPDATE pau_svm_cursor SET next_slot = ${c.next}, reached_at = ${c.reachedAt}, checked_at = ${at}, last_error = ${error} WHERE chain = ${p.chain} AND program = ${p.program}`;
}

/** Stores one call's configuration change if it is one and its controller is listed. */
async function storeEmit(db: SqlTag, p: Program, e: SvmEmit): Promise<boolean> {
  const ev = decodeEmitEvent(e.data);
  if (!ev || !p.controllers.includes(ev.controller)) return false;
  await db`
    INSERT INTO pau_events (chain, tx_hash, log_index, contract, event, args, block, block_time)
    VALUES (${p.chain}, ${e.signature}, ${e.index}, ${ev.account}, ${ev.event}, ${{ authority: ev.authority, old: ev.old, new: ev.new }}::jsonb, ${e.slot}, ${new Date(e.time * 1000)})
    ON CONFLICT DO NOTHING`;
  return true;
}

/** Stores one LayerZero governance receipt (svm-receipts.ts), whatever program its message calls. */
async function storeReceipt(db: SqlTag, p: Program, r: SvmEmit): Promise<void> {
  await db`
    INSERT INTO pau_events (chain, tx_hash, log_index, contract, event, args, block, block_time)
    VALUES (${p.chain}, ${r.signature}, ${-1 - r.index}, ${r.program}, ${"LzReceive"}, ${{ ...decodeLzReceive(r.data) }}::jsonb, ${r.slot}, ${new Date(r.time * 1000)})
    ON CONFLICT DO NOTHING`;
}

/** Reads one program from its cursor towards the confirmed head until the deadline. */
async function syncProgram(db: SqlTag, p: Program, src: SvmEventSource, deps: SvmSyncDeps): Promise<SvmSyncResult> {
  const clock = deps.now ?? Date.now;
  const res: SvmSyncResult = { queries: 0, events: 0, behind: 0, error: null };
  let c: Cursor | null = null;
  try {
    const tip = (await src.height()) - SVM_CONFIRMATIONS;
    c = await cursorFor(db, p, src, tip);
    while (c.next <= tip && clock() < deps.deadline) {
      const r = await src.emits(p.program, p.governance, c.next, tip);
      res.queries++;
      for (const x of r.receipts) await storeReceipt(db, p, x);
      for (const e of r.emits) if (await storeEmit(db, p, e)) res.events++;
      c.next = r.next;
      if (c.next > tip) c.reachedAt = new Date(clock());
      await saveCursor(db, p, c, new Date(clock()), null);
    }
    if (c.next > tip && res.queries === 0) await saveCursor(db, p, { ...c, reachedAt: new Date(clock()) }, new Date(clock()), null);
    res.behind = Math.max(0, tip + 1 - c.next);
  } catch (e) {
    res.error = String((e as Error)?.message ?? e).slice(0, 300);
    if (c && !isRateLimited(res.error)) await saveCursor(db, p, c, new Date(clock()), res.error).catch(() => {});
  }
  return res;
}

/** Reads every svm program the registry lists that has a source, until the deadline; one result per chain:program. */
export async function syncSvmHistory(db: SqlTag, reg: PauRegistry, deps: SvmSyncDeps): Promise<Record<string, SvmSyncResult>> {
  const out: Record<string, SvmSyncResult> = {};
  for (const p of svmPrograms(reg)) {
    const src = deps.source(p.chain);
    if (src && (deps.now ?? Date.now)() < deps.deadline) out[`${p.chain}:${p.program}`] = await syncProgram(db, p, src, deps);
  }
  return out;
}
