/**
 * Event logs from a block explorer's `module=logs&action=getLogs` API, for
 * history public RPCs refuse to serve (their getLogs caps the block range far
 * below a contract's lifetime). Etherscan v2 covers every chain it supports
 * when ETHERSCAN_API_KEY is set; otherwise the chain's registered Blockscout
 * instance (keyless), if it has one. Requests are spaced to the same rate as
 * the address enrichment (ETHERSCAN_THROTTLE_MS).
 */
import { CHAIN_BLOCKSCOUT, CHAIN_ID, CHAIN_SUPPORTS_ETHERSCAN } from "./chains.mjs";

export interface ExplorerLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: number;
  timeStamp: number;
  transactionHash: string;
  logIndex: number;
}

/** Logs of one contract matching `topics` (null = any), oldest first; null when no explorer serves the chain. */
export type LogFetcher = (chain: string, address: string, topics: (string | null)[]) => Promise<ExplorerLog[] | null>;

const ETHERSCAN_V2 = "https://api.etherscan.io/v2/api";
const PAGE = 1000;
let last = 0;

async function throttle(): Promise<void> {
  const interval = process.env.ETHERSCAN_THROTTLE_MS != null ? Number(process.env.ETHERSCAN_THROTTLE_MS) : 1000;
  const wait = last + interval - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
}

function baseUrl(chain: string): string | null {
  const key = process.env.ETHERSCAN_API_KEY?.trim();
  if (key && CHAIN_SUPPORTS_ETHERSCAN.has(chain)) return `${ETHERSCAN_V2}?chainid=${CHAIN_ID[chain]}&apikey=${key}&`;
  const blockscout = CHAIN_BLOCKSCOUT[chain];
  if (!blockscout) return null;
  const bsKey = process.env.BLOCKSCOUT_API_KEY?.trim();
  return `${blockscout}?${bsKey ? `apikey=${bsKey}&` : ""}`;
}

const hexNum = (v: string) => (v?.startsWith("0x") ? parseInt(v, 16) : Number(v));

function parseLog(l: Record<string, unknown>): ExplorerLog {
  return {
    address: String(l.address).toLowerCase(),
    topics: (l.topics as (string | null)[]).filter((t): t is string => !!t),
    data: String(l.data),
    blockNumber: hexNum(String(l.blockNumber)),
    timeStamp: hexNum(String(l.timeStamp)),
    transactionHash: String(l.transactionHash),
    logIndex: hexNum(String(l.logIndex)),
  };
}

function topicParams(topics: (string | null)[]): string {
  const set = topics.flatMap((t, i) => (t ? [[i, t] as const] : []));
  const ops = set.slice(1).map(([i]) => `&topic${set[0][0]}_${i}_opr=and`);
  return set.map(([i, t]) => `&topic${i}=${t}`).join("") + ops.join("");
}

/** One page of logs from `fromBlock`; an explorer's "no records" answer is an empty page. */
async function page(url: string): Promise<ExplorerLog[]> {
  await throttle();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`explorer logs: HTTP ${res.status}`);
  const body = (await res.json()) as { status?: string; message?: string; result: unknown };
  if (Array.isArray(body.result)) return body.result.map((l) => parseLog(l as Record<string, unknown>));
  if (/no records/i.test(body.message ?? "")) return [];
  throw new Error(`explorer logs: ${body.message ?? "error"} ${String(body.result).slice(0, 120)}`);
}

export const explorerLogs: LogFetcher = async (chain, address, topics) => {
  const base = baseUrl(chain);
  if (!base) return null;
  const byKey = new Map<string, ExplorerLog>();
  for (let from = 0; ; ) {
    const logs = await page(`${base}module=logs&action=getLogs&address=${address}&fromBlock=${from}&toBlock=latest${topicParams(topics)}`);
    const before = byKey.size;
    for (const l of logs) byKey.set(`${l.transactionHash}:${l.logIndex}`, l);
    // A full page may end mid-block, so the next page restarts at that block
    // and the Map drops the overlap. A full page that adds nothing means one
    // block holds more logs than a page: fail rather than return part of it.
    if (logs.length < PAGE) break;
    if (byKey.size === before) throw new Error(`explorer logs: block ${from} holds more than ${PAGE} matching logs`);
    from = Math.max(...logs.map((l) => l.blockNumber));
  }
  return [...byKey.values()].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
};
