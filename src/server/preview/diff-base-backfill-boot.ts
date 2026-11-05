// Boot hook for the diff-base backfill (diff-base-backfill.ts). One pass per
// process, behind an advisory lock so two web replicas don't each download
// every archive. Every failure stays inside this module: the server boots
// without a database (DEV_NO_DB), so a refused connection logs once and retries
// on a timer instead of rejecting into the process.
import { config } from "../config.ts";
import { sql } from "../db.ts";
import { backfillPreviewDiffBases, type BackfillResult } from "./diff-base-backfill.ts";

const LOCK_KEY = 4711_2033;
const DB_RETRY_MS = 5 * 60_000;

interface Reserved {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  release(): void;
}

export interface BackfillBootDeps {
  reserve: () => Promise<Reserved>;
  backfill: () => Promise<BackfillResult>;
  retryMs: number;
  schedule: (fn: () => void, ms: number) => void;
}

const realDeps: BackfillBootDeps = {
  reserve: async () => (await sql.reserve()) as unknown as Reserved,
  backfill: () => backfillPreviewDiffBases(),
  retryMs: DB_RETRY_MS,
  // unref: a pending retry never keeps a finished process alive.
  schedule: (fn, ms) => void setTimeout(fn, ms).unref?.(),
};

async function backfillUnderLock(deps: BackfillBootDeps, reserved: Reserved): Promise<void> {
  try {
    const got = (await reserved`SELECT pg_try_advisory_lock(${LOCK_KEY})`) as { pg_try_advisory_lock: boolean }[];
    if (!got[0]?.pg_try_advisory_lock) return;
    const r = await deps.backfill();
    if (r.filled || r.skipped || r.failed) {
      console.log(`[preview] diff-base backfill: filled ${r.filled}, skipped ${r.skipped}, failed ${r.failed}`);
    }
  } catch (e) {
    console.warn(`[preview] diff-base backfill failed (${(e as Error).name || "Error"})`);
  } finally {
    try {
      await reserved`SELECT pg_advisory_unlock(${LOCK_KEY})`;
    } catch {
      /* connection already dead — the lock dies with the session */
    }
    reserved.release();
  }
}

/** One pass. Returns the connection error when no connection could be
 *  reserved (the only case worth retrying), null once a pass has run. */
export async function runBackfillPass(deps: BackfillBootDeps): Promise<Error | null> {
  let reserved: Reserved;
  try {
    reserved = await deps.reserve();
  } catch (e) {
    return e as Error;
  }
  await backfillUnderLock(deps, reserved);
  return null;
}

/** Detached boot hook; quiet when there is nothing to fill. Returns the first
 *  attempt so a test can settle it (boot does not await it), or undefined when
 *  no service token is configured. */
export function startPreviewDiffBaseBackfill(over: Partial<BackfillBootDeps> = {}): Promise<void> | undefined {
  if (!config.githubToken) return;
  const deps: BackfillBootDeps = { ...realDeps, ...over };
  let warned = false;
  const attempt = async (): Promise<void> => {
    const err = await runBackfillPass(deps);
    if (!err) {
      if (warned) console.log("[preview] diff-base backfill: database reachable, pass ran");
      return;
    }
    if (!warned) {
      const mins = Math.round(deps.retryMs / 60_000);
      console.warn(`[preview] diff-base backfill: database unavailable (${err.message}); retrying every ${mins}m`);
      warned = true;
    }
    deps.schedule(() => void attempt(), deps.retryMs);
  };
  return attempt();
}
