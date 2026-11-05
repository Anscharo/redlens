// Boot hook for the diff-base backfill (diff-base-backfill.ts). One pass per
// process, behind an advisory lock so two web replicas don't each download
// every archive. Every failure stays inside this module: the server boots
// without a database (DEV_NO_DB), so a pass that cannot run logs once and
// retries on a timer instead of rejecting into the process.
import { config } from "../config.ts";
import { sql } from "../db.ts";
import { backfillPreviewDiffBases, type BackfillResult } from "./diff-base-backfill.ts";

const LOCK_KEY = 4711_2033;
const RETRY_MS = 5 * 60_000;

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
  retryMs: RETRY_MS,
  // unref: a pending retry never keeps a finished process alive.
  schedule: (fn, ms) => void setTimeout(fn, ms).unref?.(),
};

// Returns why the pass could not run, or null once it ran or another replica
// holds the lock. A failed backfill reports only the error's name: a fetch
// error's message can carry a URL.
async function backfillUnderLock(deps: BackfillBootDeps, reserved: Reserved): Promise<string | null> {
  let locked = false;
  try {
    const got = (await reserved`SELECT pg_try_advisory_lock(${LOCK_KEY})`) as { pg_try_advisory_lock: boolean }[];
    locked = !!got[0]?.pg_try_advisory_lock;
    if (!locked) return null;
    const r = await deps.backfill();
    if (r.filled || r.skipped || r.failed) {
      console.log(`[preview] diff-base backfill: filled ${r.filled}, skipped ${r.skipped}, failed ${r.failed}`);
    }
    return null;
  } catch (e) {
    return `failed (${(e as Error).name || "Error"})`;
  } finally {
    if (locked) {
      try {
        await reserved`SELECT pg_advisory_unlock(${LOCK_KEY})`;
      } catch {
        /* connection already dead — the lock dies with the session */
      }
    }
  }
}

/** One pass. Returns why it could not run — no connection, or a query or the
 *  backfill failed (a DB that came up after boot may not be migrated yet) —
 *  and null once it ran. Never rejects. */
export async function runBackfillPass(deps: BackfillBootDeps): Promise<string | null> {
  let reserved: Reserved;
  try {
    reserved = await deps.reserve();
  } catch (e) {
    return `database unavailable (${(e as Error).message})`;
  }
  try {
    return await backfillUnderLock(deps, reserved);
  } finally {
    try {
      reserved.release();
    } catch {
      /* the connection is already gone */
    }
  }
}

/** Detached boot hook; quiet when there is nothing to fill. A pass that could
 *  not run logs once and retries every retryMs until one does. Returns the
 *  first attempt so a test can settle it (boot does not await it), or
 *  undefined when no service token is configured. */
export function startPreviewDiffBaseBackfill(over: Partial<BackfillBootDeps> = {}): Promise<void> | undefined {
  if (!config.githubToken) return;
  const deps: BackfillBootDeps = { ...realDeps, ...over };
  let warned = false;
  const attempt = async (): Promise<void> => {
    const why = await runBackfillPass(deps);
    if (!why) {
      if (warned) console.log("[preview] diff-base backfill: pass ran after retrying");
      return;
    }
    if (!warned) {
      const mins = Math.round(deps.retryMs / 60_000);
      console.warn(`[preview] diff-base backfill: ${why}; retrying every ${mins}m`);
      warned = true;
    }
    deps.schedule(() => void attempt(), deps.retryMs);
  };
  return attempt();
}
