/**
 * Event logs read straight from a chain's JSON-RPC, for a chain no free explorer
 * serves (base). One eth_getLogs names every contract and every topic0 at once,
 * so a block window costs one request however many cursors it serves. Each
 * endpoint caps the span of one request (`blocks` in the chain registry's
 * logsRpcs). Requests pace through the per-host clocks in explorer-api.ts.
 */
import { CHAIN_LOGS_RPCS, type LogsRpc } from "./chains.mjs";
import { throttleExplorer } from "./explorer-api.ts";

export interface RpcLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: number;
  timeStamp: number;
  transactionHash: string;
  logIndex: number;
}

const TIMEOUT_MS = 20_000;
const hex = (n: number) => `0x${n.toString(16)}`;

/** The chain's logsRpcs; empty when its history comes from an explorer. */
export const logsRpcsFor = (chain: string): LogsRpc[] => CHAIN_LOGS_RPCS[chain] ?? [];

/** One JSON-RPC call. A non-2xx answer or a JSON-RPC error throws with the provider's code and message. */
async function call(url: string, method: string, params: unknown[]): Promise<unknown> {
  await throttleExplorer(url);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`rpc ${method}: HTTP ${res.status}`);
  const body = (await res.json()) as { result?: unknown; error?: { code?: number; message?: string } };
  if (body.error) throw new Error(`rpc ${method}: ${body.error.code ?? ""} ${body.error.message ?? "error"}`);
  return body.result;
}

export const rpcHeadBlock = async (url: string): Promise<number> => Number(await call(url, "eth_blockNumber", []));

/** First block at which `address` has code, by bisection; null when it has none at `head`. */
export async function rpcDeployBlock(url: string, address: string, head: number): Promise<number | null> {
  const hasCode = async (block: number) => !/^0x0*$/.test(String(await call(url, "eth_getCode", [address, hex(block)])));
  if (!(await hasCode(head))) return null;
  let lo = 0;
  let hi = head;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (await hasCode(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

async function blockTime(url: string, block: number): Promise<number> {
  const b = (await call(url, "eth_getBlockByNumber", [hex(block), false])) as { timestamp?: string } | null;
  if (!b?.timestamp) throw new Error(`rpc eth_getBlockByNumber: no block ${block}`);
  return Number(b.timestamp);
}

/**
 * Logs of any of `addresses` whose topic0 is any of `topic0s`, in the inclusive
 * window. eth_getLogs carries no timestamp, so each block holding a log is read
 * once for it.
 */
export async function rpcLogs(url: string, addresses: string[], topic0s: string[], fromBlock: number, toBlock: number): Promise<RpcLog[]> {
  const params = { address: addresses, topics: [topic0s], fromBlock: hex(fromBlock), toBlock: hex(toBlock) };
  const raw = (await call(url, "eth_getLogs", [params])) as Record<string, string & string[]>[];
  const times = new Map<number, number>();
  const out: RpcLog[] = [];
  for (const l of raw) {
    const block = Number(l.blockNumber);
    if (!times.has(block)) times.set(block, await blockTime(url, block));
    out.push({
      address: String(l.address).toLowerCase(),
      topics: l.topics,
      data: l.data,
      blockNumber: block,
      timeStamp: times.get(block)!,
      transactionHash: l.transactionHash,
      logIndex: Number(l.logIndex),
    });
  }
  return out;
}
