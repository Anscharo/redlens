// The atlas updater's upstream: sync_state.atlas_sha, polled every tick over the
// process's own DB connection. Never throws — a failed read is "no upstream",
// which the tick treats as idle.
import { sql } from "./db.ts";

// An unreachable DB (DEV_NO_DB) fails every tick, so a repeat of the same
// error stays quiet: it logs when it starts, changes, and clears.
let lastError: string | null = null;

/** Tests: forget the last error, so the next failure logs whatever ran before. */
export function _resetDbAtlasShaLog(): void {
  lastError = null;
}

export async function getDbAtlasSha(): Promise<string | null> {
  try {
    const rows = await sql`SELECT atlas_sha FROM sync_state WHERE id = 1`;
    if (lastError) console.log("getDbAtlasSha: database reachable again");
    lastError = null;
    return (rows[0] as { atlas_sha?: string } | undefined)?.atlas_sha ?? null;
  } catch (e) {
    const msg = (e as Error).message;
    if (msg !== lastError) console.warn(`getDbAtlasSha: ${msg} (repeats are not logged)`);
    lastError = msg;
    return null;
  }
}
