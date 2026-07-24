// Shared with scripts/required/atlas-worker.mjs (imported there, not run
// standalone). Split out so it's independently unit-testable without pulling
// in the whole worker script's git/spawn side effects.

// synced_at doubles as the worker heartbeat — /api/freshness flags "stale"
// when it exceeds ATLAS_STALE_SECONDS (1h), and without this touch every
// quiet stretch would false-alarm. A heartbeat failure must not fail the
// no-op run, so it's best-effort.
export async function touchSyncHeartbeat(db) {
  try {
    await db`UPDATE sync_state SET synced_at = now() WHERE id = 1`;
  } catch (e) {
    console.warn(`atlas-worker: heartbeat update failed — ${e.message}`);
  }
}
