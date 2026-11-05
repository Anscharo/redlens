// Which source reads a chain's PAU event history in the crawl
// (src/server/pau/rpc-sync.ts): HyperSync where the chain registry flags the
// chain and ENVIO_API_TOKEN is set, else the chain's logsRpcs. A chain with
// neither is read by the explorer path (sync-events.ts). The pau worker step
// and the sync:pau-rpc tail both ask here, so no chain is read by both.
import { hypersyncSource } from "./hypersync-logs.ts";
import { logsRpcsFor, rpcSource } from "./rpc-logs.ts";
import type { LogSource } from "../../src/server/pau/rpc-sync.ts";

export function logSourcesFor(chain: string, env: NodeJS.ProcessEnv = process.env): LogSource[] {
  const token = env.ENVIO_API_TOKEN?.trim();
  const hypersync = token ? hypersyncSource(chain, token) : null;
  return hypersync ? [hypersync] : logsRpcsFor(chain).map(rpcSource);
}
