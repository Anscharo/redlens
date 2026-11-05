/**
 * Event logs from Envio HyperSync, as a source for the PAU crawl
 * (src/server/pau/rpc-sync.ts). One query names every contract and topic0 and
 * scans until HyperSync's time limit (about 10 seconds), so it answers for as
 * far as it got (`next_block`), never past the window it was asked. The blocks
 * holding the logs come in the same answer, with their timestamps.
 *
 * The token's rate limit is one budget across every chain's host (15,000 units
 * a minute on the free plan, 1,000 a request), so every request waits on one
 * clock (GAP_MS) and one cooldown key (ACCOUNT): a refusal on one chain holds
 * every chain.
 */
import { CHAIN_HYPERSYNC } from "./chains.mjs";
import { holdOff, politeFetch } from "../../src/lib/upstreamBackoff.ts";
import { refused } from "../../src/lib/upstreamRefusal.ts";
import type { LogSource, SourceLog } from "../../src/server/pau/rpc-sync.ts";

const ACCOUNT = "https://hypersync.xyz/";
/** Between request starts: 75% of 15 requests a minute. */
const GAP_MS = 5_334;
const TIMEOUT_MS = 60_000;
/** A 503 is HyperSync's "queue full, not counted, retry": asked again after these waits before the source fails. */
const BUSY_WAITS_MS = [10_000, 30_000];
const FIELDS = {
  log: ["block_number", "log_index", "transaction_hash", "address", "topic0", "topic1", "topic2", "topic3", "data"],
  block: ["number", "timestamp"],
};

/** How a source paces itself; tests shorten both. */
export interface HypersyncTiming {
  gapMs: number;
  busyWaitsMs: number[];
}

let nextStart = 0;

/** Reserves the next request slot on the account's clock and waits for it. */
async function pace(gapMs: number): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextStart);
  nextStart = at + gapMs;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

/**
 * One HTTP attempt on the account's clock and cooldown: GET without a body,
 * POST with one. The cooldown is waited out before the request's timeout is
 * built, so a wait does not use up the request's own time.
 */
async function send(url: string, token: string, body: unknown, t: HypersyncTiming): Promise<Response> {
  await pace(t.gapMs);
  await holdOff(ACCOUNT);
  const init = {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  };
  return politeFetch(url, init, { cooldownKey: ACCOUNT });
}

/** One HyperSync request, with a busy (503) answer asked again after each of `busyWaitsMs`. */
async function call(url: string, token: string, body: unknown, t: HypersyncTiming): Promise<Record<string, unknown>> {
  let res = await send(url, token, body, t);
  for (const wait of t.busyWaitsMs) {
    if (res.status !== 503) break;
    await new Promise((r) => setTimeout(r, wait));
    res = await send(url, token, body, t);
  }
  // politeFetch has already started the account's cooldown.
  if (await refused(res)) throw new Error(`hypersync: HTTP ${res.status} rate limited`);
  if (!res.ok) throw new Error(`hypersync: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as Record<string, unknown>;
}

type Row = Record<string, unknown>;

/** A HyperSync log as the crawl stores it; a log whose block came without a usable timestamp (absent, null, zero) throws rather than store a wrong time. */
function toLog(l: Row, times: Map<number, number>): SourceLog {
  const block = Number(l.block_number);
  const timeStamp = times.get(block);
  if (timeStamp === undefined || !Number.isFinite(timeStamp) || timeStamp <= 0) throw new Error(`hypersync: no timestamp for block ${block}`);
  return {
    address: String(l.address).toLowerCase(),
    topics: [l.topic0, l.topic1, l.topic2, l.topic3].filter((t): t is string => typeof t === "string" && t.length > 0),
    data: String(l.data),
    blockNumber: block,
    timeStamp,
    transactionHash: String(l.transaction_hash),
    logIndex: Number(l.log_index),
  };
}

/** The chain's indexed height; an answer without a positive one throws, so the crawl never runs against a NaN tip. */
async function readHeight(base: string, token: string, t: HypersyncTiming): Promise<number> {
  const j = await call(`${base}/height`, token, null, t);
  const height = Number(j.height);
  if (!Number.isFinite(height) || height <= 0) throw new Error(`hypersync: no height in ${JSON.stringify(j).slice(0, 120)}`);
  return height;
}

/** Logs in [from, to] as far as one query reaches, and the last block it covered. */
async function readLogs(base: string, token: string, t: HypersyncTiming, q: { addresses: string[]; topic0s: string[]; from: number; to: number }) {
  const body = { from_block: q.from, to_block: q.to + 1, logs: [{ address: q.addresses, topics: [q.topic0s] }], field_selection: FIELDS };
  const j = await call(`${base}/query`, token, body, t);
  const next = Number(j.next_block);
  if (!(next > q.from)) throw new Error(`hypersync: no progress from block ${q.from} (next_block ${String(j.next_block)})`);
  const batches = (j.data ?? []) as { logs?: Row[]; blocks?: Row[] }[];
  const times = new Map(batches.flatMap((d) => d.blocks ?? []).map((b) => [Number(b.number), Number(b.timestamp)] as [number, number]));
  const logs = batches.flatMap((d) => d.logs ?? []).map((l) => toLog(l, times));
  logs.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  return { logs, to: Math.min(next - 1, q.to) };
}

/**
 * The chain's HyperSync source; null when the registry does not flag it. A
 * window is whatever one query reaches, so `blocks` leaves the cap to the crawl
 * (the tip, the next contract's position). HyperSync skips blocks holding no
 * match quickly, so a cold contract starts at block 0 rather than bisecting for
 * its deploy block, which HyperSync could not do (it has no eth_getCode).
 */
export function hypersyncSource(chain: string, token: string, timing: Partial<HypersyncTiming> = {}): LogSource | null {
  const base = CHAIN_HYPERSYNC[chain];
  if (!base) return null;
  const t: HypersyncTiming = { gapMs: GAP_MS, busyWaitsMs: BUSY_WAITS_MS, ...timing };
  return {
    url: base,
    blocks: Number.MAX_SAFE_INTEGER,
    head: () => readHeight(base, token, t),
    deployBlock: async () => 0,
    logs: (addresses, topic0s, from, to) => readLogs(base, token, t, { addresses, topic0s, from, to }),
  };
}
