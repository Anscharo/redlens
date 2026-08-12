// Runtime freshness / consistency health. Evaluates the single invariant the
// in-process updater is meant to maintain:
//
//   live in-memory sha === sync_state.atlas_sha   (updater has converged)
//   sync_state.synced_at is recent                (the worker is alive)
//   applied schema >= the schema this code needs  (no migration skew)
//
// Surfaced two ways:
//   GET /api/health     — ALWAYS 200 (liveness); body carries the snapshot.
//   GET /api/freshness  — status-coded (200 healthy / 503 alertable) for an
//                         external uptime monitor to alarm on.
//
// Liveness and freshness are deliberately separate: a stale snapshot must never
// fail the container's health check, or the platform would restart-loop a
// process that is perfectly alive (restarting can't un-stale upstream data).
import { sql } from "../db.ts";
import { getIndexes } from "../retrieval/indexes.ts";
import { migrationFiles } from "../migrate.ts";
import { getUpdaterState, isUpdaterEnabled, type UpdaterState } from "../atlas-updater.ts";
import { config } from "../config.ts";

// The worker cron runs every 12 minutes and (as of the sync_state.synced_at
// touch-on-every-run change) advances synced_at on every run, including
// no-ops — not just on structural syncs like it used to. So >1h of silence
// means the worker is genuinely dead, not just quiet; the old 48h window
// existed only to tolerate long stretches with no structural sync.
const STALE_SECONDS = config.atlasStaleSeconds;

// How long live may lag db before the updater is "stuck" (vs benignly syncing).
// Much shorter than STALE: a live process failing to converge is an active
// problem, where a quiet worker is not. Covers a poison-commit retry loop.
const STUCK_SECONDS = config.atlasStuckSeconds;

// How long the updater loop may go without a tick before it's treated as dead
// (vs. just booted). 10 poll intervals at the default 30s cadence. A disabled
// updater (ATLAS_UPDATE_ENABLED=0) or a loop that silently stopped ticking
// would otherwise leave a later-diverged db sha reporting "syncing" 200
// forever — nothing ever advances divergedAgeSeconds past STUCK without a
// live tick loop to run nextDivergedSince.
const UPDATER_DEAD_SECONDS = config.atlasUpdaterDeadSeconds;

// The latest migration bundled in this image = the schema the running code
// requires. Computed once at module load (shares migrate.ts's file listing).
export const REQUIRED_SCHEMA: string = migrationFiles().at(-1) ?? "";

export type FreshnessStatus = "ok" | "syncing" | "stuck" | "stale" | "schema_behind" | "degraded";

export interface FreshnessInput {
  liveSha: string | null;
  dbSha: string | null;
  ageSeconds: number | null;
  divergedAgeSeconds: number | null;
  schemaVersion: string | null;
  dbReachable: boolean;
  requiredSchema?: string;
  staleSeconds?: number;
  stuckSeconds?: number;
  // ms-age of the oldest still-pending publishBundle() failure (see
  // UpdaterState.pendingPublishSinceMs); null/omitted = nothing pending.
  // A publish that never succeeds leaves live===db converged forever while
  // clients on the new sha 404/reload-loop — this is the only signal that
  // catches that case, since the liveSha!==dbSha branch never sees it.
  pendingPublishAgeSeconds?: number | null;
  // False when the updater is disabled or its tick loop has gone silent past
  // UPDATER_DEAD_SECONDS. Omitted/true = old behavior (assume alive).
  updaterAlive?: boolean;
}

export interface FreshnessSnapshot extends FreshnessInput {
  status: FreshnessStatus;
  requiredSchema: string;
  docs: number;
  consecutiveFailures: number;
  lastError: string | null;
  // Informational only — not inputs to deriveFreshnessStatus.
  updaterEnabled: boolean;
  lastTickAgeSeconds: number | null;
  pendingPublishSha: string | null;
}

// Pure ms-epoch-to-age-seconds conversion (unit-tested), shared by
// divergedAgeSeconds and lastTickAgeSeconds. Clamps at 0 so a slightly-future
// timestamp (clock skew) never reports a negative age.
export function msAgeSeconds(now: number, thenMs: number | null): number | null {
  return thenMs !== null ? Math.max(0, Math.round((now - thenMs) / 1000)) : null;
}

// Pure status derivation (unit-tested without a DB). Precedence, worst first:
// an unreachable DB or a schema the code is ahead of is a hard fault; staleness
// (dead worker) next; an updater that has failed to converge past STUCK is a
// live fault ("stuck"); a recently-diverged updater is benign ("syncing").
export function deriveFreshnessStatus(i: FreshnessInput): FreshnessStatus {
  const required = i.requiredSchema ?? REQUIRED_SCHEMA;
  const stale = i.staleSeconds ?? STALE_SECONDS;
  const stuck = i.stuckSeconds ?? STUCK_SECONDS;
  if (!i.dbReachable) return "degraded";
  // Lexical compare is correct: the zero-padded NNN_ prefix orders filenames.
  // Code ahead of the DB = skew we must flag; DB ahead of code (additive
  // migration deployed worker-first) is tolerated.
  if (i.schemaVersion !== null && required !== "" && i.schemaVersion < required) return "schema_behind";
  if (i.ageSeconds !== null && i.ageSeconds > stale) return "stale";
  if (i.liveSha !== i.dbSha) {
    // A dead/disabled updater can never converge or advance divergedAgeSeconds
    // past stuck on its own — report it as stuck immediately rather than
    // "syncing" forever.
    if (i.updaterAlive === false) return "stuck";
    if (i.divergedAgeSeconds !== null && i.divergedAgeSeconds > stuck) return "stuck";
    return "syncing";
  }
  // Converged, but a publish from an earlier convergence never made it to
  // disk — clients are still 404ing/reload-looping on that sha.
  if (i.pendingPublishAgeSeconds != null && i.pendingPublishAgeSeconds > stuck) return "stuck";
  return "ok";
}

// Pure assembly of the snapshot from already-fetched inputs (unit-tested
// without a DB): computes the *AgeSeconds fields + updaterAlive from the raw
// state, builds FreshnessInput, derives status, and shapes the response.
// evaluateFreshness is now just "do the SQL reads, call this."
export function assembleFreshness(a: {
  liveSha: string | null;
  dbSha: string | null;
  ageSeconds: number | null;
  schemaVersion: string | null;
  dbReachable: boolean;
  docs: number;
  upd: Readonly<UpdaterState>;
  updaterEnabled: boolean;
  now: number;
}): FreshnessSnapshot {
  const divergedAgeSeconds = msAgeSeconds(a.now, a.upd.divergedSinceMs);
  const lastTickAgeSeconds = msAgeSeconds(a.now, a.upd.lastTickMs);
  const pendingPublishAgeSeconds = msAgeSeconds(a.now, a.upd.pendingPublishSinceMs);
  // null lastTick = the process just booted and hasn't ticked yet — give it
  // grace rather than immediately reporting a dead updater.
  const updaterAlive = a.updaterEnabled && (lastTickAgeSeconds === null || lastTickAgeSeconds <= UPDATER_DEAD_SECONDS);

  const input: FreshnessInput = {
    liveSha: a.liveSha,
    dbSha: a.dbSha,
    ageSeconds: a.ageSeconds,
    divergedAgeSeconds,
    schemaVersion: a.schemaVersion,
    dbReachable: a.dbReachable,
    pendingPublishAgeSeconds,
    updaterAlive,
  };
  return {
    ...input,
    status: deriveFreshnessStatus(input),
    requiredSchema: REQUIRED_SCHEMA,
    docs: a.docs,
    consecutiveFailures: a.upd.consecutiveFailures,
    lastError: a.upd.lastError,
    updaterEnabled: a.updaterEnabled,
    lastTickAgeSeconds,
    pendingPublishSha: a.upd.pendingPublishSha,
  };
}

export async function evaluateFreshness(now: number = Date.now()): Promise<FreshnessSnapshot> {
  const ix = getIndexes();
  const liveSha = ix.meta.atlasCommit ?? null;
  const docs = ix.docMap.size;
  const upd = getUpdaterState();

  let dbSha: string | null = null;
  let ageSeconds: number | null = null;
  let schemaVersion: string | null = null;
  let dbReachable = true;
  // sync_state read defines reachability — if THIS fails, the DB is down.
  // TODO(#7): schema_migrations.max(id) is runtime-invariant (changes only at
  // boot/cron) and these two reads are serial on a frequently-polled path —
  // cache the schema version and/or batch the two queries into one round-trip.
  try {
    const [s] = await sql`SELECT atlas_sha, synced_at FROM sync_state WHERE id = 1`;
    const row = s as { atlas_sha?: string; synced_at?: string | Date } | undefined;
    dbSha = row?.atlas_sha ?? null;
    if (row?.synced_at) {
      ageSeconds = Math.max(0, Math.round((now - new Date(row.synced_at).getTime()) / 1000));
    }
  } catch {
    dbReachable = false;
  }
  // Schema version is a SEPARATE concern: a failure here (e.g. the table is
  // absent after a rolled-back boot migration) must not flip dbReachable and
  // mislabel a reachable DB as "degraded". Left null → not flagged schema_behind.
  if (dbReachable) {
    try {
      const [m] = await sql`SELECT max(id) AS v FROM schema_migrations`;
      schemaVersion = (m as { v?: string } | undefined)?.v ?? null;
    } catch {
      schemaVersion = null;
    }
  }

  return assembleFreshness({ liveSha, dbSha, ageSeconds, schemaVersion, dbReachable, docs, upd, updaterEnabled: isUpdaterEnabled(), now });
}

// ok/syncing are healthy; stuck/stale/schema_behind/degraded are worth paging on.
export function freshnessHttpStatus(s: FreshnessStatus): number {
  return s === "ok" || s === "syncing" ? 200 : 503;
}
