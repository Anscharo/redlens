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
  /** One-line summary, safe to paste into a skip reason or an assertion message. */
  detail: string;
}

const NOT_MEASURED: Readiness = {
  health: null,
  serving: false,
  docsReady: false,
  dbReady: false,
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
 * `expectedCommit` (the SHA the workflow deployed) is a SOFT gate: we wait for
 * the deploy to report it so the suite can't assert against the previous build,
 * but a deploy that never reports it — an older image, or `RAILWAY_GIT_COMMIT_SHA`
 * unset — proceeds after COMMIT_GRACE rather than becoming a new source of red
 * (or, worse, spending the whole budget waiting for a match that can't happen).
 *
 * Never throws: an unreachable deploy comes back as `serving: false` so the
 * caller decides whether that's fatal.
 */
const COMMIT_GRACE = 60_000;

export async function waitForReady(
  ctx: APIRequestContext,
  timeoutMs: number,
  expectedCommit?: string,
): Promise<Readiness> {
  const deadline = Date.now() + timeoutMs;
  let health: Health | null = null;
  let serving = false;
  let commitSeen = false;
  let convergedAt: number | null = null;
  let delay = 2_000;

  for (;;) {
    const probe = await probeHealth(ctx);
    if (probe) {
      health = probe;
      serving = true;
      if (expectedCommit && probe.app_commit && probe.app_commit.startsWith(expectedCommit.slice(0, 7))) {
        commitSeen = true;
      }
      const converged = (probe.docs ?? 0) > 0 && probe.db_reachable === true;
      if (converged && convergedAt === null) convergedAt = Date.now();
      if (!converged) convergedAt = null;
      const commitOk =
        !expectedCommit || commitSeen || (convergedAt !== null && Date.now() - convergedAt >= COMMIT_GRACE);
      if (converged && commitOk) break;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(delay, remaining)));
    delay = Math.min(Math.round(delay * 1.5), 10_000);
  }

  return {
    health,
    serving,
    docsReady: (health?.docs ?? 0) > 0,
    dbReady: health?.db_reachable === true,
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
