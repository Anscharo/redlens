// Which chains the explorer path (sync-events.ts) leaves to the crawl
// (rpc-sync.ts). A chain whose only reader is the crawl (logsRpcs: no free
// explorer serves it) is left at once. A chain the crawl reads only because
// HyperSync serves it stays on the explorer until the crawl has read every one
// of its contracts at least as far as the explorer had: until then
// historyComplete reads the explorer's cursors, so leaving earlier would show a
// history as read to the head while nothing reads the chain. Both paths write
// the same pau_events rows (ON CONFLICT DO NOTHING) and markRead never moves a
// pau_cursor back, so the overlap only costs requests.
import type { PauRegistry } from "../../lib/pauRegistry.ts";
import type { SqlTag } from "../sql-types.ts";
import { rpcChains, type RpcSyncDeps } from "./rpc-sync.ts";

/** Whether the crawl has a cursor on `chain` and every contract the explorer read there is read at least as far by it. */
export async function crawlCaughtUp(db: SqlTag, chain: string): Promise<boolean> {
  const rows = (await db`
    SELECT
      (SELECT count(*)::int FROM pau_rpc_cursor WHERE chain = ${chain}) AS crawled,
      (SELECT count(*)::int FROM (
        SELECT c.contract FROM pau_cursor c
        LEFT JOIN pau_rpc_cursor r ON r.chain = c.chain AND r.contract = c.contract
        WHERE c.chain = ${chain}
        GROUP BY c.contract, r.next_block
        HAVING r.next_block IS NULL OR r.next_block < max(c.next_block)
      ) behind) AS behind`) as { crawled: number; behind: number }[];
  return (rows[0]?.crawled ?? 0) > 0 && rows[0].behind === 0;
}

/** The chains sync-events.ts skips: every crawl-only chain, and each HyperSync chain once its crawl has caught up. */
export async function crawlOwnedChains(
  db: SqlTag,
  reg: PauRegistry,
  sources: RpcSyncDeps["sources"],
  crawlOnly: (chain: string) => boolean,
): Promise<Set<string>> {
  const out = new Set<string>();
  for (const chain of rpcChains(reg, sources)) {
    if (crawlOnly(chain) || (await crawlCaughtUp(db, chain))) out.add(chain);
  }
  return out;
}
