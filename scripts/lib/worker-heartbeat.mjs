// Shared with scripts/required/atlas-worker.mjs (imported there, not run
// standalone). Split out so it's independently unit-testable without pulling
// in the whole worker script's git/spawn side effects.

// synced_at doubles as the worker heartbeat — /api/freshness flags "stale"
// when it exceeds ATLAS_STALE_SECONDS (1h). A no-op tick that cannot touch
// that row (wrong DATABASE_URL, empty sync_state, read-only replica) must
// fail the run: swallowing it is how a "green" cron left production stale
// for days while Railway showed no failed execution.
export async function touchSyncHeartbeat(db) {
  const rows = await db`UPDATE sync_state SET synced_at = now() WHERE id = 1 RETURNING atlas_sha`;
  const n = Array.isArray(rows) ? rows.length : 0;
  if (n !== 1) {
    throw new Error(
      `heartbeat updated ${n} row(s), expected 1 — worker DATABASE_URL is not the web service's Postgres (or sync_state is empty)`,
    );
  }
  const sha = rows[0]?.atlas_sha ?? "";
  console.log(`atlas-worker: heartbeat ok — sha ${String(sha).slice(0, 12)}`);
  return rows[0];
}
