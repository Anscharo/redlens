// The sync:pau-rpc worker tail's settings, run and lock, kept apart from its
// entry (src/server/sync-pau-rpc.ts) so tests drive them with fakes.
import type { PauRegistry } from "../../lib/pauRegistry.ts";
import type { SqlTag } from "../sql-types.ts";
import { syncPauRpc, type RpcSyncDeps } from "./rpc-sync.ts";
import { syncSvmHistory, type SvmSyncDeps } from "./svm-sync.ts";

type Log = (line: string) => void;

/** A reserved connection: the tag a lock must be taken and released on, and its release. */
export type Reserved = SqlTag & { release(): void };

/** The lane's time budget (declared in env/integrations.ts), read here because only this lane reads it. */
export const deadlineMs = (env: NodeJS.ProcessEnv = process.env): number => Number(env.PAU_RPC_DEADLINE_MS ?? 480_000);

/** The lane's sources: the EVM log sources, and the svm programs' HyperSync source (svm-sync.ts), absent without a token. */
export type LaneDeps = RpcSyncDeps & { svmSource?: SvmSyncDeps["source"] };

/** Reads every EVM chain the registry needs that has a log source, then every svm program, and logs one line per chain and program. */
export async function runPauRpc(db: SqlTag, reg: PauRegistry, deps: LaneDeps, log: Log = console.log): Promise<void> {
  const out = await syncPauRpc(db, reg, deps);
  const error = (e: string | null) => (e ? `, error: ${e}` : "");
  for (const [chain, r] of Object.entries(out)) log(`sync:pau-rpc ${chain} — ${r.windows} windows, ${r.events} new events, ${r.behind} blocks behind${error(r.error)}`);
  if (!deps.svmSource) return;
  const svm = await syncSvmHistory(db, reg, { source: deps.svmSource, deadline: deps.deadline, now: deps.now });
  for (const [program, r] of Object.entries(svm)) log(`sync:pau-rpc ${program} — ${r.queries} queries, ${r.events} new events, ${r.behind} slots behind${error(r.error)}`);
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
