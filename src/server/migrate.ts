// Numbered-migration runner with a schema_migrations tracking table — mirrors
// the D1-side runner. Each migrations/NNN_*.sql runs once, recorded by filename.
// Idempotent: already-applied files are skipped.
//
// Concurrency + smoothness:
//   - A session-level advisory lock on a RESERVED (pinned) connection serializes
//     the web boot and the worker cron, which can run this concurrently on a
//     deploy. Second caller blocks on the lock, then sees every file recorded
//     and no-ops. (Reserved, not a single xact, so the lock can span per-file
//     commits.)
//   - Each migration commits in its OWN transaction, so a late-file failure
//     never rolls back earlier files (partial progress is durable).
//   - A migration whose first lines contain `-- migrate:no-transaction` runs in
//     autocommit instead, so future migrations can use statements Postgres
//     forbids inside a transaction block (CREATE INDEX CONCURRENTLY,
//     ALTER TYPE ... ADD VALUE, …). Such files MUST be written idempotently
//     (IF NOT EXISTS) since a mid-file failure leaves partial work committed.
//
//   bun src/server/migrate.ts        # apply pending migrations
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "./db.ts";

const MIGRATIONS_DIR = join(import.meta.dir, "migrations");

// Arbitrary fixed key shared by every caller of runMigrations(); all that
// matters is that every migration runner agrees on the same value.
const MIGRATION_LOCK_KEY = 4711_2026;

// Opt out of the per-file transaction wrapper (for non-transactional DDL).
const NO_TX_RE = /^\s*--\s*migrate:no-transaction\b/im;

// All *.sql migration filenames, ascending. The last entry is the schema this
// image's code was built against (see REQUIRED_SCHEMA in freshness.ts).
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export async function runMigrations(): Promise<string[]> {
  const ran: string[] = [];
  const reserved = await sql.reserve();
  try {
    // Serialize concurrent runners (web boot + worker cron) for the whole run.
    await reserved`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;

    await reserved`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id         TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    const applied = new Set(
      (await reserved`SELECT id FROM schema_migrations`).map((r: { id: string }) => r.id),
    );

    for (const file of migrationFiles()) {
      if (applied.has(file)) continue;
      const ddl = readFileSync(join(MIGRATIONS_DIR, file), "utf8");

      if (NO_TX_RE.test(ddl)) {
        // Autocommit on the pinned connection — supports CONCURRENTLY etc.
        await reserved.unsafe(ddl).simple();
        await reserved`INSERT INTO schema_migrations (id) VALUES (${file})`;
      } else {
        // Per-file transaction: DDL + ledger row commit atomically together.
        // Simple query protocol runs the whole multi-statement file in one call,
        // parsing dollar-quoted bodies natively — no fragile ";" splitter.
        await sql.begin(async (tx) => {
          await tx.unsafe(ddl).simple();
          await tx`INSERT INTO schema_migrations (id) VALUES (${file})`;
        });
      }
      ran.push(file);
      console.log(`migration applied: ${file}`);
    }
  } finally {
    // Must unlock explicitly: a session-level advisory lock is NOT released by
    // returning the connection to the pool (the session persists), so skipping
    // this would leak the lock and block future runners. Log if it fails rather
    // than swallowing — a live connection that can't unlock is worth seeing.
    try {
      await reserved`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
    } catch (e) {
      console.warn(`migrations: advisory unlock failed: ${(e as Error).message}`);
    }
    reserved.release();
  }
  if (ran.length === 0) console.log("migrations: up to date");
  return ran;
}

if (import.meta.main) {
  await runMigrations();
  await sql.end();
}
