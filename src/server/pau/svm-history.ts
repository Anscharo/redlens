// What an svm deployment's stored history (svm-sync.ts) says about when each
// limit and Permission was last set, for its snapshot (svm-snapshot.ts).
//
// The history is a window, not the program's life: it starts at the first slot
// HyperSync held when the cursor was made. A disagreement only waits on a step
// for PENDING_DAYS (an executive filed within its slip, cast before it
// expires, then read), so a window that starts at least that far back, holds no
// error and reached the head within FRESH_MS holds every change that can still
// be pending: the history is complete. A limit with no change in a complete
// window was set before it (`SetAt.before`), which the ordering rule reads as
// the chain having moved before the atlas (`setOrder`, pauValueDate.ts).
// `changes` counts the window's changes only.
import type { SetAt } from "../../lib/pau.ts";
import { deploymentId, membersOf, type PauDeployment } from "../../lib/pauRegistry.ts";
import { READ_DAYS, SPELL_EXPIRY_DAYS } from "../../lib/pauSpellStep.ts";
import { SLIP_DAYS } from "../../lib/votes/vote-index.ts";
import type { SqlTag } from "../sql-types.ts";
import { setAt, type PauEventRow } from "./replay.ts";

const DAY_MS = 86_400_000;
export const PENDING_DAYS = SLIP_DAYS + SPELL_EXPIRY_DAYS + READ_DAYS;
/** How long a pass to the head vouches for the slots after it: a stopped crawl must not keep a window complete. */
const FRESH_MS = DAY_MS;
const LIMIT_EVENTS = new Set(["ReserveUpdate", "IntegrationUpdate"]);
const LIMIT_FIELDS = ["status", "slope", "maxOutflow"];

/** The window the cursor read: its start, its last pass to the head and its error, as stored. */
export interface SvmWindow {
  startTime: string;
  reachedAt: string | null;
  error: string | null;
}

export interface SvmHistory {
  /** Stored changes, oldest first. */
  events: PauEventRow[];
  window: SvmWindow | null;
}

/** When each limit and Permission was last set, as far as the history knows. */
export interface SvmSetTimes {
  complete: boolean;
  limit: (account: string) => { setAt: SetAt; changes: number };
  /** A Permission's last change; null when the window holds none. */
  since: (permission: string) => SetAt | null;
  events: (account: string) => number;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

/** The deployment's stored history: its program's cursor and every configuration change stored on its chain. */
export async function svmHistory(db: SqlTag, d: PauDeployment): Promise<SvmHistory> {
  const program = membersOf(d, "program")[0]?.address;
  if (!program) throw new Error(`${deploymentId(d)} lists no program`);
  const [w] = (await db`SELECT start_time, reached_at, last_error FROM pau_svm_cursor WHERE chain = ${d.chain} AND program = ${program}`) as Record<string, unknown>[];
  const rows = (await db`
    SELECT contract, event, args, block, block_time, tx_hash FROM pau_events
    WHERE chain = ${d.chain} ORDER BY block, log_index`) as Record<string, unknown>[];
  const events = rows.map((r) => ({
    contract: String(r.contract), event: String(r.event), args: (typeof r.args === "string" ? JSON.parse(r.args) : r.args) as Record<string, unknown>,
    block: Number(r.block), block_time: iso(r.block_time)!, tx_hash: String(r.tx_hash),
  }));
  return { events, window: w ? { startTime: iso(w.start_time)!, reachedAt: iso(w.reached_at), error: iso(w.last_error) } : null };
}

/** Whether the window holds every change that can still be pending. */
export function windowComplete(w: SvmWindow | null, now: number): boolean {
  if (!w || w.error || !w.reachedAt) return false;
  return now - Date.parse(w.reachedAt) <= FRESH_MS && Date.parse(w.startTime) <= now - PENDING_DAYS * DAY_MS;
}

/** A change to a limit: a Reserve or Integration created, or its status, slope or maximum changed. */
function setsLimit(e: PauEventRow): boolean {
  if (!LIMIT_EVENTS.has(e.event)) return false;
  const [old, now] = [e.args.old as Record<string, unknown> | null, e.args.new as Record<string, unknown> | null];
  return !old || !now || LIMIT_FIELDS.some((f) => old[f] !== now[f]);
}

export function svmSetTimes(h: SvmHistory | null, now: number): SvmSetTimes {
  const complete = windowComplete(h?.window ?? null, now);
  const of = (account: string) => (h?.events ?? []).filter((e) => e.contract === account);
  const unset: SetAt = { block: 0, time: "", tx: "", ...(complete ? { before: h!.window!.startTime } : {}) };
  return {
    complete,
    limit: (a) => {
      const sets = of(a).filter(setsLimit);
      return { setAt: sets.length ? setAt(sets.at(-1)!) : unset, changes: sets.length };
    },
    since: (p) => {
      const last = of(p).at(-1);
      return last ? setAt(last) : null;
    },
    events: (a) => of(a).length,
  };
}
