// Postgres client — Bun's native SQL (no `pg` dependency). One pooled instance
// shared across the process. pgvector values are passed as `[a,b,c]` bracket
// strings with a `::vector` cast appended after the placeholder (see search.ts
// and sync-embeddings.ts).
import { SQL } from "bun";
import { config } from "./config.ts";

export const sql = new SQL(config.databaseUrl);

// host:port/db with NO credentials — safe to log when diagnosing connectivity.
export function dbTarget(): string {
  try {
    const u = new URL(config.databaseUrl);
    return `${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

// Wait for Postgres to accept connections before the first real query. On Railway
// the private network + a freshly-provisioned PG can take several seconds after
// the container boots; without this, sync:atlas throws ERR_POSTGRES_CONNECTION_
// CLOSED on its first query and the container restart-loops (never healthy).
// Retries `SELECT 1` with capped exponential backoff (~45s total), logging the
// target so a wrong/unset DATABASE_URL (e.g. the localhost default) is obvious.
export async function waitForDb(attempts = 12): Promise<void> {
  let delay = 500;
  for (let i = 1; i <= attempts; i++) {
    try {
      await sql`SELECT 1`;
      console.log(`db: connected to ${dbTarget()}${i > 1 ? ` (after ${i} attempts)` : ""}`);
      return;
    } catch (e) {
      const msg = (e as Error).message;
      if (i === attempts) {
        console.error(`db: gave up connecting to ${dbTarget()} after ${attempts} attempts: ${msg}`);
        throw e;
      }
      console.warn(`db: ${dbTarget()} not ready (attempt ${i}/${attempts}): ${msg}; retrying in ${delay}ms`);
      await Bun.sleep(delay);
      delay = Math.min(delay * 2, 5000);
    }
  }
}

// Format a number[] as a pgvector literal: [0.1,0.2,…]. Pair with `::vector`.
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
