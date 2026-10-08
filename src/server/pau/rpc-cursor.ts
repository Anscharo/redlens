// Storage for the RPC reader (rpc-sync.ts): one pau_rpc_cursor row per contract,
// and the write that marks the contract's pau_cursor rows read to the head.
import type { SqlTag } from "../sql-types.ts";
import type { EventTarget } from "./sync-events.ts";

export interface RpcCursor {
  contract: string;
  /** The sorted topic0s this cursor has read, comma-separated. */
  topics: string;
  /** null until the deploy block is found. */
  deploy: number | null;
  /** First block not yet read. */
  next: number;
}

export const topicKey = (s: Set<string>) => [...s].sort().join(",");

/** Each contract's topic0s on one chain. */
export function topicsByContract(targets: EventTarget[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const t of targets) out.set(t.contract, (out.get(t.contract) ?? new Set()).add(t.topic0));
  return out;
}

/** The chain's cursors for the contracts in `topicsOf`, created cold when missing. */
export async function loadCursors(db: SqlTag, chain: string, topicsOf: Map<string, Set<string>>): Promise<RpcCursor[]> {
  for (const [contract, topics] of topicsOf) {
    await db`INSERT INTO pau_rpc_cursor (chain, contract, topics) VALUES (${chain}, ${contract}, ${topicKey(topics)}) ON CONFLICT DO NOTHING`;
  }
  const rows = (await db`SELECT contract, topics, deploy_block, next_block FROM pau_rpc_cursor WHERE chain = ${chain}`) as Record<string, unknown>[];
  return rows
    .filter((r) => topicsOf.has(String(r.contract)))
    .map((r) => ({ contract: String(r.contract), topics: String(r.topics), deploy: r.deploy_block == null ? null : Number(r.deploy_block), next: Number(r.next_block) }));
}

export async function saveCursor(db: SqlTag, chain: string, r: RpcCursor, at: Date, error: string | null): Promise<void> {
  await db`UPDATE pau_rpc_cursor SET topics = ${r.topics}, deploy_block = ${r.deploy}, next_block = ${r.next}, checked_at = ${at}, last_error = ${error} WHERE chain = ${chain} AND contract = ${r.contract}`;
}

/** Marks every pau_cursor row of `contract` read up to `next`, which historyComplete reads. */
export async function markRead(db: SqlTag, chain: string, contract: string, next: number, at: Date): Promise<void> {
  await db`UPDATE pau_cursor SET next_block = ${next}, checked_at = ${at}, last_error = NULL WHERE chain = ${chain} AND contract = ${contract}`;
}
