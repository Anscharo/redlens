// sync:pau-rpc — the atlas worker tail that reads PAU admin-event history over
// JSON-RPC for chains no free explorer serves (pau/rpc-sync.ts). Each run crawls
// until PAU_RPC_DEADLINE_MS after it starts, then stops between requests; the
// next tick resumes from the stored cursors.
//
//   bun src/server/sync-pau-rpc.ts
import { sql } from "./db.ts";
import { runMigrations } from "./migrate.ts";
import { syncPauRpc } from "./pau/rpc-sync.ts";
import reg from "../data/pau-registry.json" with { type: "json" };
import type { PauRegistry } from "../lib/pauRegistry.ts";
import { logsRpcsFor, rpcDeployBlock, rpcHeadBlock, rpcLogs } from "../../scripts/lib/rpc-logs.ts";

// One run at a time across callers. Arbitrary fixed key; it only has to differ
// from the others (sync-briefings.ts lists them).
const LOCK_KEY = 4711_2063;
const T0 = Date.now();

/** The lane's time budget (declared in env/integrations.ts), read here because only this process reads it. */
export const deadlineMs = (env: NodeJS.ProcessEnv = process.env): number => Number(env.PAU_RPC_DEADLINE_MS ?? 480_000);

async function run(): Promise<void> {
  await runMigrations();
  const out = await syncPauRpc(sql, reg as unknown as PauRegistry, {
    providers: logsRpcsFor,
    head: rpcHeadBlock,
    deployBlock: rpcDeployBlock,
    logs: rpcLogs,
    deadline: T0 + deadlineMs(),
  });
  for (const [chain, r] of Object.entries(out)) {
    const error = r.error ? `, error: ${r.error}` : "";
    console.log(`sync:pau-rpc ${chain} — ${r.windows} windows, ${r.events} new events, ${r.behind} blocks behind${error}`);
  }
}

async function withLock(fn: () => Promise<void>): Promise<void> {
  const reserved = await sql.reserve();
  try {
    const rows = (await reserved`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS ok`) as { ok: boolean }[];
    if (!rows[0]?.ok) return console.log("sync:pau-rpc — another run holds the lock; skipping");
    try {
      await fn();
    } finally {
      await reserved`SELECT pg_advisory_unlock(${LOCK_KEY})`.catch(() => {});
    }
  } finally {
    reserved.release();
  }
}

// Only when launched directly, so a test can import the pieces.
if (import.meta.main) {
  try {
    // --no-fetch (local dev) never crawls a public RPC.
    if (process.env.ATLAS_WORKER_NO_FETCH === "1") console.log("sync:pau-rpc — skipped (--no-fetch)");
    else await withLock(run);
  } finally {
    await sql.end();
  }
}
