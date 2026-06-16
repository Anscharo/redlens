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
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { sql } from "./db.ts";
import { getIndexes } from "./indexes.ts";

// The atlas updates a few times a week, so a generous window catches a dead
// worker within ~2 days without false alarms on a normal quiet stretch.
const STALE_SECONDS = Number(process.env.ATLAS_STALE_SECONDS ?? 48 * 3600);

// The latest migration bundled in this image = the schema the running code
// requires. Computed once at module load.
export const REQUIRED_SCHEMA: string = (() => {
  const files = readdirSync(join(import.meta.dir, "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files[files.length - 1] ?? "";
})();

export type FreshnessStatus = "ok" | "syncing" | "stale" | "schema_behind" | "degraded";

export interface FreshnessInput {
  liveSha: string | null;
  dbSha: string | null;
  ageSeconds: number | null;
  schemaVersion: string | null;
  dbReachable: boolean;
  requiredSchema?: string;
  staleSeconds?: number;
}

export interface FreshnessSnapshot extends FreshnessInput {
  status: FreshnessStatus;
  requiredSchema: string;
  docs: number;
}

// Pure status derivation (unit-tested without a DB). Precedence, worst first:
// an unreachable DB or a schema the code is ahead of is a hard fault; staleness
// next; a not-yet-converged updater is benign and expected right after a bump.
export function deriveFreshnessStatus(i: FreshnessInput): FreshnessStatus {
  const required = i.requiredSchema ?? REQUIRED_SCHEMA;
  const stale = i.staleSeconds ?? STALE_SECONDS;
  if (!i.dbReachable) return "degraded";
  // Lexical compare is correct: the zero-padded NNN_ prefix orders filenames.
  // Code ahead of the DB = skew we must flag; DB ahead of code (additive
  // migration deployed worker-first) is tolerated.
  if (i.schemaVersion !== null && required !== "" && i.schemaVersion < required) return "schema_behind";
  if (i.ageSeconds !== null && i.ageSeconds > stale) return "stale";
  if (i.liveSha !== i.dbSha) return "syncing";
  return "ok";
}

export async function evaluateFreshness(now: number = Date.now()): Promise<FreshnessSnapshot> {
  const ix = getIndexes();
  const liveSha = ix.meta.atlasCommit ?? null;
  const docs = ix.docMap.size;

  let dbSha: string | null = null;
  let ageSeconds: number | null = null;
  let schemaVersion: string | null = null;
  let dbReachable = true;
  try {
    const [s] = await sql`SELECT atlas_sha, synced_at FROM sync_state WHERE id = 1`;
    const row = s as { atlas_sha?: string; synced_at?: string | Date } | undefined;
    dbSha = row?.atlas_sha ?? null;
    if (row?.synced_at) {
      ageSeconds = Math.max(0, Math.round((now - new Date(row.synced_at).getTime()) / 1000));
    }
    const [m] = await sql`SELECT max(id) AS v FROM schema_migrations`;
    schemaVersion = (m as { v?: string } | undefined)?.v ?? null;
  } catch {
    dbReachable = false;
  }

  const input: FreshnessInput = { liveSha, dbSha, ageSeconds, schemaVersion, dbReachable };
  return {
    ...input,
    status: deriveFreshnessStatus(input),
    requiredSchema: REQUIRED_SCHEMA,
    docs,
  };
}

// ok/syncing are healthy; stale/schema_behind/degraded are worth paging on.
export function freshnessHttpStatus(s: FreshnessStatus): number {
  return s === "ok" || s === "syncing" ? 200 : 503;
}
