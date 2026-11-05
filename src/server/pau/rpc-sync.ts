// Reads PAU admin-event history from a source that filters on many addresses and
// topic0s at once: HyperSync where the chain registry flags it and
// ENVIO_API_TOKEN is set, else the registry's logsRpcs (scripts/lib/log-sources.ts
// chooses). Explorer log APIs filter on one topic0, so sync-events.ts keeps one
// cursor per (contract, event). These sources take every address and topic0 in
// one request, so this reader keeps one cursor per contract
// (pau_rpc_cursor) and reads every contract at the same position in one window.
// A window stops short of the next contract's position, so a contract that
// starts later catches up and then shares requests.
//
// A cold cursor first finds its contract's deploy block. pau_cursor rows are
// written only when a contract's crawl reaches the confirmed head, so
// historyComplete stays false through the backfill. When the registry's events
// for a contract change, its crawl restarts at the deploy block, because the new
// event has no history read yet. Sources rotate per window; one that fails is
// left out for the rest of the run, and its error is stored on the cursors.
// A source may answer for less of a window than it was asked (HyperSync stops
// after its time limit); the cursors advance only as far as the answer reached.
import type { PauRegistry } from "../../lib/pauRegistry.ts";
import type { SqlTag } from "../sql-types.ts";
import { loadCursors, markRead, saveCursor, topicKey, topicsByContract, type RpcCursor } from "./rpc-cursor.ts";
import { CONFIRMATIONS, ensureCursors, eventTargets, storeLog, type EventTarget, type PauLog } from "./sync-events.ts";

/** One reader of a chain's logs: a JSON-RPC endpoint (scripts/lib/rpc-logs.ts) or HyperSync (scripts/lib/hypersync-logs.ts). */
export interface LogSource {
  /** Names the source in errors; also its identity in the rotation. */
  url: string;
  /** Most blocks one window may span. */
  blocks: number;
  head: () => Promise<number>;
  /** First block to read for `address`; null when it has no code at `head`. */
  deployBlock: (address: string, head: number) => Promise<number | null>;
  /** Logs of any of `addresses` with any of `topic0s` in [from, to], and the last block the answer covers (at most `to`). */
  logs: (addresses: string[], topic0s: string[], from: number, to: number) => Promise<{ logs: (PauLog & { address: string })[]; to: number }>;
}

export interface RpcSyncDeps {
  sources: (chain: string) => LogSource[];
  /** Epoch ms after which no new request starts. */
  deadline: number;
  now?: () => number;
}

export interface RpcChainResult {
  windows: number;
  events: number;
  /** Blocks between the slowest contract's cursor and the confirmed head. */
  behind: number;
  error: string | null;
}

interface Crawl {
  db: SqlTag;
  chain: string;
  tip: number;
  topicsOf: Map<string, Set<string>>;
  rows: RpcCursor[];
  deps: RpcSyncDeps;
}

const clock = (deps: RpcSyncDeps) => (deps.now ?? Date.now)();
const message = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);

/** The chains the registry needs that have a log source. */
export function rpcChains(reg: PauRegistry, sources: RpcSyncDeps["sources"]): Set<string> {
  return new Set(eventTargets(reg).map((t) => t.chain).filter((c) => sources(c).length > 0));
}

const save = (c: Crawl, r: RpcCursor, error: string | null = null) => saveCursor(c.db, c.chain, r, new Date(clock(c.deps)), error);

/** Restarts a cursor whose events changed, and finds the deploy block of a cold one. */
async function prepare(c: Crawl, src: LogSource): Promise<void> {
  for (const r of c.rows) {
    const key = topicKey(c.topicsOf.get(r.contract)!);
    if (r.topics !== key) Object.assign(r, { topics: key, next: r.deploy ?? 0 });
    if (r.deploy === null) {
      if (clock(c.deps) >= c.deps.deadline) continue;
      const at = await src.deployBlock(r.contract, c.tip);
      if (at === null) {
        await save(c, r, `no code at block ${c.tip}`);
        continue;
      }
      Object.assign(r, { deploy: at, next: at });
    }
    await save(c, r);
  }
}

/** The contracts at the lowest position and the window they read next; null when every one is at the head. */
function nextWindow(c: Crawl, blocks: number): { group: RpcCursor[]; from: number; to: number } | null {
  const ready = c.rows.filter((r) => r.deploy !== null);
  const live = ready.filter((r) => r.next <= c.tip);
  if (!live.length) return null;
  const from = Math.min(...live.map((r) => r.next));
  const later = ready.filter((r) => r.next > from).map((r) => r.next - 1);
  return { group: live.filter((r) => r.next === from), from, to: Math.min(from + blocks - 1, c.tip, ...later) };
}

async function readWindow(c: Crawl, src: LogSource, w: NonNullable<ReturnType<typeof nextWindow>>): Promise<number> {
  const mine = new Set(w.group.map((r) => r.contract));
  const topics = new Set(w.group.flatMap((r) => [...c.topicsOf.get(r.contract)!]));
  const { logs, to } = await src.logs([...mine], [...topics], w.from, w.to);
  if (!(to >= w.from && to <= w.to)) throw new Error(`${src.url}: answered to block ${to} for window ${w.from}-${w.to}`);
  let stored = 0;
  for (const l of logs) {
    if (l.blockNumber <= to && mine.has(l.address) && c.topicsOf.get(l.address)!.has(l.topics[0]) && (await storeLog(c.db, c.chain, l.address, l))) stored++;
  }
  for (const r of w.group) {
    r.next = to + 1;
    await save(c, r);
    if (to === c.tip) await markRead(c.db, c.chain, r.contract, r.next, new Date(clock(c.deps)));
  }
  return stored;
}

/** Reads windows, rotating sources, until every contract is at the head, the deadline passes or every source failed. */
async function crawl(c: Crawl, sources: LogSource[], res: RpcChainResult): Promise<void> {
  const failed = new Set<string>();
  for (let turn = 0; clock(c.deps) < c.deps.deadline; turn++) {
    const live = sources.filter((p) => !failed.has(p.url));
    const p = live[turn % live.length];
    const w = p && nextWindow(c, p.blocks);
    if (!w) return;
    try {
      res.events += await readWindow(c, p, w);
      res.windows++;
    } catch (e) {
      failed.add(p.url);
      res.error = message(e);
      for (const r of w.group) await save(c, r, res.error);
    }
  }
}

async function syncChain(db: SqlTag, chain: string, targets: EventTarget[], deps: RpcSyncDeps): Promise<RpcChainResult> {
  const res: RpcChainResult = { windows: 0, events: 0, behind: 0, error: null };
  const sources = deps.sources(chain);
  const c: Crawl = { db, chain, tip: 0, topicsOf: topicsByContract(targets), rows: [], deps };
  try {
    await ensureCursors(db, targets);
    await db`UPDATE pau_cursor SET last_error = NULL WHERE chain = ${chain} AND next_block = 0`;
    c.rows = await loadCursors(db, chain, c.topicsOf);
    c.tip = (await sources[0].head()) - CONFIRMATIONS;
    await prepare(c, sources[0]);
    await crawl(c, sources, res);
  } catch (e) {
    res.error = message(e);
  }
  res.behind = Math.max(0, c.tip + 1 - Math.min(c.tip + 1, ...c.rows.map((r) => r.next)));
  return res;
}

/** Reads every chain the registry needs that has a log source, until the deadline; one result per chain. */
export async function syncPauRpc(db: SqlTag, reg: PauRegistry, deps: RpcSyncDeps): Promise<Record<string, RpcChainResult>> {
  const targets = eventTargets(reg);
  const out: Record<string, RpcChainResult> = {};
  for (const chain of rpcChains(reg, deps.sources)) out[chain] = await syncChain(db, chain, targets.filter((t) => t.chain === chain), deps);
  return out;
}
