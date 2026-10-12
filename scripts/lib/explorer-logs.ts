/**
 * Event logs from a block explorer's `module=logs&action=getLogs` API, for
 * history public RPCs refuse to serve (their getLogs caps the block range far
 * below a contract's lifetime). Providers come from explorerBases
 * (explorer-api.ts) in order: Etherscan v2 when ETHERSCAN_API_KEY is set and
 * covers the chain, then Routescan, then the chain's Blockscout. Requests share
 * that module's per-host clocks with the address enrichment.
 */
import { explorerBases, throttleExplorer, type ExplorerBase } from "./explorer-api.ts";
import { politeFetch } from "../../src/lib/upstreamBackoff.ts";

export interface ExplorerLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: number;
  timeStamp: number;
  transactionHash: string;
  logIndex: number;
}

/** Inclusive block window; an absent bound is the chain's genesis or head. */
export interface BlockRange {
  fromBlock?: number;
  toBlock?: number;
}

/** Logs of one contract matching `topics` (null = any), oldest first; null when no explorer serves the chain. */
export type LogFetcher = (
  chain: string,
  address: string,
  topics: (string | null)[],
  range?: BlockRange,
) => Promise<ExplorerLog[] | null>;

// Asked for explicitly: Routescan pages at 100 unless told otherwise, and a
// short page reads as the end of the history.
const PAGE = 1000;

// Etherscan v2's answer for a chain the key's plan does not cover, or a chainId
// it does not serve. Only this moves on to the next provider; any other error
// (a rate limit included) is the caller's to handle.
const REFUSED = /not supported for this chain|unsupported chainid/i;

// Etherscan writes zero as a bare "0x" (logIndex / transactionIndex 0).
const hexNum = (v: string) => (v?.startsWith("0x") ? parseInt(v.slice(2) || "0", 16) : Number(v));

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
  await throttleExplorer(url);
  const res = await politeFetch(url);
  if (!res.ok) throw new Error(`explorer logs: HTTP ${res.status}`);
  const body = (await res.json()) as { status?: string; message?: string; result: unknown };
  if (Array.isArray(body.result)) return body.result.map((l) => parseLog(l as Record<string, unknown>));
  if (/no records/i.test(body.message ?? "")) return [];
  throw new Error(`explorer logs: ${body.message ?? "error"} ${String(body.result).slice(0, 120)}`);
}

/** Every log of one provider from `range.fromBlock`, page by page. */
async function readAll(base: string, address: string, topics: (string | null)[], range: BlockRange): Promise<ExplorerLog[]> {
  const to = range.toBlock ?? "latest";
  const byKey = new Map<string, ExplorerLog>();
  for (let from = range.fromBlock ?? 0; ; ) {
    const logs = await page(`${base}module=logs&action=getLogs&address=${address}&fromBlock=${from}&toBlock=${to}${topicParams(topics)}&page=1&offset=${PAGE}`);
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
}

/**
 * A LogFetcher that tries each provider in order. A provider that refuses the
 * chain is remembered for the fetcher's lifetime, so the refusal costs one
 * request per chain, not one per cursor. When every provider refused, the
 * error names each refusal.
 */
export function explorerLogFetcher(): LogFetcher {
  const refused = new Map<string, string>();
  return async (chain, address, topics, range = {}) => {
    const bases: ExplorerBase[] = explorerBases(chain, process.env.ETHERSCAN_API_KEY?.trim());
    if (!bases.length) return null;
    for (const { name, base } of bases) {
      if (refused.has(`${chain}:${name}`)) continue;
      try {
        return await readAll(base, address, topics, range);
      } catch (e) {
        if (!REFUSED.test((e as Error).message)) throw e;
        refused.set(`${chain}:${name}`, `${name}: ${(e as Error).message.replace(/^explorer logs: /, "")}`);
      }
    }
    const why = bases.map((b) => refused.get(`${chain}:${b.name}`)).join("; ");
    throw new Error(`explorer logs: every explorer refused ${chain} (${why})`);
  };
}

export const explorerLogs: LogFetcher = explorerLogFetcher();
