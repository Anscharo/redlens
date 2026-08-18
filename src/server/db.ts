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
// `sleep` is injectable purely as a test seam: db.test.ts asserts the retry
// schedule without burning the real backoff on the wall clock (and without the
// assertion breaking whenever the 500ms base is tuned).
export async function waitForDb(attempts = 12, sleep: (ms: number) => Promise<unknown> = Bun.sleep): Promise<void> {
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
      await sleep(delay);
      delay = Math.min(delay * 2, 5000);
    }
  }
}

// Format a number[] as a pgvector literal: [0.1,0.2,…]. Pair with `::vector`.
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

// Format a uuid[] as a Postgres array literal: {a,b,c}. Pair with `::uuid[]`.
//
// REQUIRED — do not pass a JS array as a bound parameter for an array column.
// Bun.sql does not encode JS arrays as Postgres arrays: it sends the first element
// as a scalar, and Postgres fails with `malformed array literal` / "Array value
// must start with {". This surfaced as the noisy boot-embeddings failure on
// atlas_doc_embeddings.member_ids.
//
// Safe unquoted for UUIDs specifically: they can't contain a comma, brace or quote,
// and the `::uuid[]` cast validates every element. For text[] use a jsonb round-trip
// (`${JSON.stringify(xs)}::jsonb`) instead — arbitrary strings need real quoting.
export function toUuidArrayLiteral(ids: readonly string[]): string {
  return `{${ids.join(",")}}`;
}

// Inverse of toUuidArrayLiteral. Bun.sql does not decode uuid[] into a JS array
// — SELECT returns the Postgres text form `{uuid,uuid}` (or `{}`). Passing that
// string through as Hit.memberIds made rewriteSemanticHit throw `ids.map is not
// a function` and fail the e2e atlas_query smoke (PR #286).
//
// Also accepts a real string[] so a future bun that does decode arrays still
// works, and a bare uuid (one-element column read as a scalar).
export function fromUuidArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter((s) => s.length > 0);
  if (typeof value !== "string" || value.length === 0) return [];
  const inner = value.startsWith("{") && value.endsWith("}") ? value.slice(1, -1) : value;
  if (!inner) return [];
  const out: string[] = [];
  for (const part of inner.split(",")) {
    const s = part.trim().replace(/^"|"$/g, "");
    if (s) out.push(s);
  }
  return out;
}
