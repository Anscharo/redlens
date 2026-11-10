// A Solana program's EmitEvent calls from Envio HyperSync, for the svm history
// crawl (svm-sync.ts). Requests go through hypersyncCall, so they share the
// token's one clock and cooldown with every EVM chain's crawl.
//
// HyperSync answers a query over slots it does not hold (before its history
// starts) with no rows and no error, so the crawl never starts below the first
// slot it holds: `firstHeld` finds it by bisecting all-blocks queries, which
// make no progress there. A query answers for [from, next_slot) in full, so
// the cursor moves exactly that far. The same query reads the LayerZero
// governance programs' LzReceive calls (svm-receipts.ts), so receipts are read
// over exactly the slots the changes are.
import { hypersyncCall, type HypersyncTiming } from "../../../scripts/lib/hypersync-logs.ts";
import { LZ_RECEIVE } from "./svm-receipts.ts";

const BASES: Record<string, string> = { solana: "https://solana.hypersync.xyz" };
/** Slots after a held slot searched for its first block's time; Solana skips few slots in a row. */
const TIME_SLOTS = 64;
const FIELDS = {
  instruction_call: ["slot", "transaction_index", "instruction_address", "data", "executing_account"],
  transaction: ["slot", "transaction_index", "transaction_id"],
  block: ["slot", "block_time"],
};

/** One call read: its transaction's signature, its place among that transaction's calls of its kind (EmitEvent, or LzReceive), its program and its data (hex). */
export interface SvmEmit {
  slot: number;
  /** Block time, unix seconds. */
  time: number;
  signature: string;
  index: number;
  program: string;
  data: string;
}

/** One query's answer: the program's EmitEvent calls, the governance programs' LzReceive calls, and the first slot not covered. */
export interface SvmRead {
  emits: SvmEmit[];
  receipts: SvmEmit[];
  next: number;
}

export interface SvmEventSource {
  url: string;
  height: () => Promise<number>;
  /** The first slot HyperSync holds, and the time of the first block at or after it (unix seconds). */
  firstHeld: (height: number) => Promise<{ slot: number; time: number }>;
  /** The program's inner EmitEvent calls and the governance programs' LzReceive calls, of successful transactions in [from, to], as far as one query reaches. */
  emits: (program: string, governance: readonly string[], from: number, to: number) => Promise<SvmRead>;
}

type Row = Record<string, unknown>;
const rows = (j: Row, table: string) => ((j[table] ?? []) as Row[][]).flat();
const txKey = (r: Row) => `${r.slot}:${r.transaction_index}`;

/** Calls in execution order: by slot, transaction, then instruction path. */
function inOrder(a: Row, b: Row): number {
  const [x, y] = [a.instruction_address as number[], b.instruction_address as number[]];
  const path = x.findIndex((v, i) => v !== y[i]);
  return Number(a.slot) - Number(b.slot) || Number(a.transaction_index) - Number(b.transaction_index) || (path < 0 ? x.length - y.length : x[path] - (y[path] ?? -1));
}

/** Each call with its transaction's signature and block time; a call missing either throws rather than be stored without them. */
function toEmits(j: Row, calls: Row[]): SvmEmit[] {
  const sigs = new Map(rows(j, "transactions").map((t) => [txKey(t), String(t.transaction_id)]));
  const times = new Map(rows(j, "blocks").map((b) => [Number(b.slot), Number(b.block_time)]));
  const seen = new Map<string, number>();
  return calls.sort(inOrder).map((c) => {
    const signature = sigs.get(txKey(c));
    const time = times.get(Number(c.slot));
    if (!signature || !(time! > 0)) throw new Error(`hypersync: no signature or time for slot ${c.slot} tx ${c.transaction_index}`);
    const index = seen.get(signature) ?? 0;
    seen.set(signature, index + 1);
    return { slot: Number(c.slot), time: time!, signature, index, program: String(c.executing_account), data: String(c.data) };
  });
}

/** The chain's source with the environment's ENVIO_API_TOKEN; null without one. */
export function svmSourceFor(chain: string, env: NodeJS.ProcessEnv = process.env): SvmEventSource | null {
  const token = env.ENVIO_API_TOKEN?.trim();
  return token ? svmEventSource(chain, token) : null;
}

/** One HyperSync request against the chain's host: GET without a body, POST with one. */
type Ask = (path: string, body: Row | null) => Promise<Row>;

/** Solana's /height answers a bare slot number, not the EVM servers' { height }. */
async function readHeight(ask: Ask): Promise<number> {
  const h = Number(await ask("/height", null));
  if (!(h > 0)) throw new Error("hypersync: no Solana height");
  return h;
}

/** The blocks HyperSync holds in [from, to), and how far its answer reached (no further than `from` below its history). */
async function blocks(ask: Ask, from: number, to: number) {
  const j = await ask("/query", { from_slot: from, to_slot: to, include_all_blocks: true, field_selection: { block: ["slot", "block_time"] } });
  return { next: Number(j.next_slot), blocks: rows(j, "blocks") };
}

async function firstHeld(ask: Ask, height: number): Promise<{ slot: number; time: number }> {
  let [lo, hi] = [-1, height];
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if ((await blocks(ask, mid, mid + 1)).next > mid) hi = mid;
    else lo = mid;
  }
  const first = (await blocks(ask, hi, hi + TIME_SLOTS)).blocks.find((b) => Number(b.block_time) > 0);
  if (!first) throw new Error(`hypersync: no block time within ${TIME_SLOTS} slots of ${hi}`);
  return { slot: hi, time: Number(first.block_time) };
}

async function readEmits(ask: Ask, program: string, governance: readonly string[], from: number, to: number): Promise<SvmRead> {
  const emitted = { executing_account: [program], d1: ["00"], is_inner: true, tx_success: true };
  const received = { executing_account: [...governance], d8: [LZ_RECEIVE], tx_success: true };
  const selections = governance.length ? [emitted, received] : [emitted];
  const j = await ask("/query", { from_slot: from, to_slot: to + 1, instruction_calls: selections, field_selection: FIELDS });
  const next = Number(j.next_slot);
  if (!(next > from)) throw new Error(`hypersync: no progress from slot ${from} (next_slot ${String(j.next_slot)})`);
  const calls = rows(j, "instruction_calls");
  const of = (want: (p: string) => boolean) => toEmits(j, calls.filter((c) => want(String(c.executing_account))));
  return { emits: of((p) => p === program), receipts: of((p) => p !== program && governance.includes(p)), next: Math.min(next, to + 1) };
}

/** The chain's HyperSync source; null where HyperSync serves no Solana chain of that name. */
export function svmEventSource(chain: string, token: string, timing?: HypersyncTiming): SvmEventSource | null {
  const base = BASES[chain];
  if (!base) return null;
  const ask: Ask = (path, body) => hypersyncCall(`${base}${path}`, token, body, timing);
  return { url: base, height: () => readHeight(ask), firstHeld: (h) => firstHeld(ask, h), emits: (p, gov, from, to) => readEmits(ask, p, gov, from, to) };
}
