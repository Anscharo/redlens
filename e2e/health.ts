import type { APIRequestContext } from "@playwright/test";

// The e2e target is a live Railway PR environment, not a server this repo boots.
// Railway emits `deployment_status: success` as soon as the *container* passes
// its healthcheck — the app's index load and its Postgres are still converging
// behind that. Everything here exists so the suite waits for the deploy to be
// genuinely ready, and so a deploy that never gets there reports one legible
// reason instead of a scatter of unrelated timeouts.

export interface Health {
  status?: string;
  atlas_sha?: string | null;
  db_sha?: string | null;
  app_commit?: string | null;
  age_seconds?: number | null;
  schema?: string | null;
  db_reachable?: boolean;
  docs?: number;
}

export interface Readiness {
  /** Last /api/health body we managed to read; null if it never answered. */
  health: Health | null;
  /** The process answered /api/health at least once. */
  serving: boolean;
  /** Atlas indexes are loaded (docs > 0) — every UI spec needs this. */
  docsReady: boolean;
  /** Postgres answered the sync_state read — the DB-backed specs need this. */
  dbReady: boolean;
  /** Did the deploy confirm it is serving the commit we asked for? `null` when no
   *  commit was expected (manual dispatch) or the deploy reports none at all —
   *  i.e. "unverifiable", as distinct from `false`, "verified as something else". */
  commitMatched: boolean | null;
  /** One-line summary, safe to paste into a skip reason or an assertion message. */
  detail: string;
}

const NOT_MEASURED: Readiness = {
  health: null,
  serving: false,
  docsReady: false,
  dbReady: false,
  commitMatched: null,
  detail: "readiness was never measured (global setup did not run)",
};

export async function probeHealth(ctx: APIRequestContext): Promise<Health | null> {
  try {
    const res = await ctx.get("/api/health", { timeout: 15_000 });
    if (!res.ok()) return null;
    return (await res.json()) as Health;
  } catch {
    // A cold container refuses the connection outright — that's a "not yet",
    // not a failure, so it reads the same as a non-200 to the caller.
    return null;
  }
}

function summarize(h: Health | null, expectedCommit?: string): string {
  if (!h) return "/api/health never answered";
  const bits = [
    `status=${h.status ?? "?"}`,
    `db_reachable=${h.db_reachable ?? "?"}`,
    `docs=${h.docs ?? 0}`,
    `atlas_sha=${h.atlas_sha ?? "none"}`,
    `db_sha=${h.db_sha ?? "none"}`,
  ];
  if (expectedCommit) bits.push(`app_commit=${h.app_commit ?? "unset"} (want ${expectedCommit.slice(0, 7)})`);
  return bits.join(" ");
}

/**
 * Poll /api/health until the deploy is serving its indexes with a reachable DB.
 *
 * `expectedCommit` (the SHA the workflow deployed) gates the wait, and the two
 * ways it can fail to match are NOT the same thing:
 *
 *  · The deploy reports no `app_commit` at all — an older image, or
 *    `RAILWAY_GIT_COMMIT_SHA` unset. There is nothing to wait for, so COMMIT_GRACE
 *    releases the wait rather than spending the whole budget on a match that can
 *    never happen.
 *  · The deploy reports a DIFFERENT commit — a previous container is still
 *    serving. Releasing here would assert against the wrong build, which is
 *    precisely the race this gate exists to close, so the grace does NOT apply:
 *    keep polling until the right commit appears or the overall deadline hits.
 *
 * Never throws: an unreachable deploy comes back as `serving: false`, and a
 * deadline reached on a mismatched commit comes back as `commitMatched: false`,
 * so the caller decides whether either is fatal.
 */
const COMMIT_GRACE = 60_000;

/** Poll timings. Overridable only so health.test.ts can exercise the grace
 *  window without spending a real minute per case. */
export interface WaitTiming {
  commitGraceMs?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

export async function waitForReady(
  ctx: APIRequestContext,
  timeoutMs: number,
  expectedCommit?: string,
  timing: WaitTiming = {},
): Promise<Readiness> {
  const grace = timing.commitGraceMs ?? COMMIT_GRACE;
  const maxDelay = timing.maxDelayMs ?? 10_000;
  const deadline = Date.now() + timeoutMs;
  let health: Health | null = null;
  let serving = false;
  let commitSeen = false;
  let convergedAt: number | null = null;
  let delay = timing.initialDelayMs ?? 2_000;

  for (;;) {
    const probe = await probeHealth(ctx);
    if (probe) {
      health = probe;
      serving = true;
      // Sticky: during a rolling swap both containers answer, so requiring the
      // CURRENT probe to match would flap. Having seen the new build once is
      // enough to say it is live.
      if (expectedCommit && probe.app_commit && probe.app_commit.startsWith(expectedCommit.slice(0, 7))) {
        commitSeen = true;
      }
      const converged = (probe.docs ?? 0) > 0 && probe.db_reachable === true;
      if (converged && convergedAt === null) convergedAt = Date.now();
      if (!converged) convergedAt = null;
      // The grace window only releases a deploy that reports NO commit. One
      // reporting a different commit stays gated — see the note above.
      const graceApplies = !probe.app_commit && convergedAt !== null && Date.now() - convergedAt >= grace;
      if (converged && (!expectedCommit || commitSeen || graceApplies)) break;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(delay, remaining)));
    delay = Math.min(Math.round(delay * 1.5), maxDelay);
  }

  return {
    health,
    serving,
    docsReady: (health?.docs ?? 0) > 0,
    dbReady: health?.db_reachable === true,
    // false ONLY when the deploy told us it is serving some other commit — that
    // is the case worth shouting about, and it is distinct from a deploy that
    // reports nothing (null: unverifiable, not contradicted).
    commitMatched: !expectedCommit || !health?.app_commit ? null : commitSeen,
    detail: summarize(health, expectedCommit),
  };
}

/**
 * The readiness snapshot global setup recorded, available to every spec.
 * Workers are forked after global setup, so they inherit it through the env.
 */
export function readiness(): Readiness {
  const raw = process.env.E2E_READINESS;
  if (!raw) return NOT_MEASURED;
  try {
    return JSON.parse(raw) as Readiness;
  } catch {
    return NOT_MEASURED;
  }
}
