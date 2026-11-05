// Which chains the explorer path (sync-events.ts) leaves to the crawl
// (rpc-sync.ts): every chain the crawl has a source for, once no contract's
// explorer cursor is ahead of its crawl cursor (a missing crawl cursor is at
// block 0). Until then historyComplete reads the explorer's cursors, so leaving
// earlier would show a history as read to the head while nothing read the
// chain. A chain no explorer has read (Base, a fresh database) is the crawl's
// at once. Both paths write the same pau_events rows (ON CONFLICT DO NOTHING)
// and markRead never moves a pau_cursor back, so the overlap only costs
// requests.
import type { PauRegistry } from "../../lib/pauRegistry.ts";
import type { SqlTag } from "../sql-types.ts";
import { rpcChains, type RpcSyncDeps } from "./rpc-sync.ts";

/** The chains sync-events.ts skips. */
export async function crawlOwnedChains(db: SqlTag, reg: PauRegistry, sources: RpcSyncDeps["sources"]): Promise<Set<string>> {
  const crawled = rpcChains(reg, sources);
  if (!crawled.size) return crawled;
  const ahead = (await db`
    SELECT DISTINCT c.chain FROM pau_cursor c
    LEFT JOIN pau_rpc_cursor r ON r.chain = c.chain AND r.contract = c.contract
    WHERE c.next_block > COALESCE(r.next_block, 0)`) as { chain: string }[];
  for (const { chain } of ahead) crawled.delete(chain);
  return crawled;
}
