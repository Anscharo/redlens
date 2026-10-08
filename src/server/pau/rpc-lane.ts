// The sync:pau-rpc worker tail's settings, run and lock, kept apart from its
// entry (src/server/sync-pau-rpc.ts) so tests drive them with fakes.
import type { PauRegistry } from "../../lib/pauRegistry.ts";
import type { SqlTag } from "../sql-types.ts";
import { syncPauRpc, type RpcSyncDeps } from "./rpc-sync.ts";

type Log = (line: string) => void;

/** A reserved connection: the tag a lock must be taken and released on, and its release. */
export type Reserved = SqlTag & { release(): void };

/** The lane's time budget (declared in env/integrations.ts), read here because only this lane reads it. */
export const deadlineMs = (env: NodeJS.ProcessEnv = process.env): number => Number(env.PAU_RPC_DEADLINE_MS ?? 480_000);

/** Reads every logsRpcs chain the registry needs and logs one line per chain. */
export async function runPauRpc(db: SqlTag, reg: PauRegistry, deps: RpcSyncDeps, log: Log = console.log): Promise<void> {
  const out = await syncPauRpc(db, reg, deps);
  for (const [chain, r] of Object.entries(out)) {
    const error = r.error ? `, error: ${r.error}` : "";
    log(`sync:pau-rpc ${chain} — ${r.windows} windows, ${r.events} new events, ${r.behind} blocks behind${error}`);
  }
}

/** Runs `fn` under a session advisory lock, so two runs never crawl at once; skips when another run holds it. */
export async function withLock(reserve: () => Promise<Reserved>, key: number, fn: () => Promise<void>, log: Log = console.log): Promise<void> {
  const reserved = await reserve();
  try {
    const rows = (await reserved`SELECT pg_try_advisory_lock(${key}) AS ok`) as { ok: boolean }[];
    if (!rows[0]?.ok) return log("sync:pau-rpc — another run holds the lock; skipping");
    try {
      await fn();
    } finally {
      await reserved`SELECT pg_advisory_unlock(${key})`.catch(() => {});
    }
  } finally {
    reserved.release();
  }
}
