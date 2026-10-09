// sync:pau-rpc — the atlas worker tail that reads PAU admin-event history over
// JSON-RPC for chains no free explorer serves (pau/rpc-sync.ts). Each run crawls
// until PAU_RPC_DEADLINE_MS after it starts, then stops between requests; the
// next tick resumes from the stored cursors.
//
//   bun src/server/sync-pau-rpc.ts
import { sql } from "./db.ts";
import { runMigrations } from "./migrate.ts";
import { useDbCooldowns } from "./upstream-cooldowns.ts";
import { deadlineMs, runPauRpc, withLock, type Reserved } from "./pau/rpc-lane.ts";
import reg from "../data/pau-registry.json" with { type: "json" };
import type { PauRegistry } from "../lib/pauRegistry.ts";
import { logsRpcsFor, rpcDeployBlock, rpcHeadBlock, rpcLogs } from "../../scripts/lib/rpc-logs.ts";

// One run at a time across callers. Arbitrary fixed key; it only has to differ
// from the others (sync-briefings.ts lists them).
const LOCK_KEY = 4711_2063;
const T0 = Date.now();

async function run(): Promise<void> {
  await runMigrations();
  useDbCooldowns(sql);
  const deps = { providers: logsRpcsFor, head: rpcHeadBlock, deployBlock: rpcDeployBlock, logs: rpcLogs, deadline: T0 + deadlineMs() };
  await runPauRpc(sql, reg as unknown as PauRegistry, deps);
}

if (import.meta.main) {
  try {
    // --no-fetch (local dev) never crawls a public RPC.
    if (process.env.ATLAS_WORKER_NO_FETCH === "1") console.log("sync:pau-rpc — skipped (--no-fetch)");
    else await withLock(async () => (await sql.reserve()) as unknown as Reserved, LOCK_KEY, run);
  } finally {
    await sql.end();
  }
}
