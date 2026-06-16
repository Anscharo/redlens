// Numbered-migration runner with a schema_migrations tracking table — mirrors
// the D1-side runner. Each migrations/NNN_*.sql runs once, recorded by filename.
// Idempotent: already-applied files are skipped.
//
// The whole run is wrapped in one transaction guarded by a transaction-scoped
// advisory lock, so the web service (boot) and the atlas worker (cron) can call
// this concurrently without racing or double-applying: the second caller blocks
// on the lock, then sees every file already recorded and no-ops. A xact-level
// lock (not session-level) is pool-safe — it's bound to this txn's connection
// and auto-released on commit/rollback.
//
//   bun src/server/migrate.ts        # apply pending migrations
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "./db.ts";

const MIGRATIONS_DIR = join(import.meta.dir, "migrations");

// Arbitrary fixed key shared by every caller of runMigrations(); all that
// matters is that every migration runner agrees on the same value.
const MIGRATION_LOCK_KEY = 4711_2026;

// All *.sql migration filenames, ascending. The last entry is the schema this
// image's code was built against (see REQUIRED_SCHEMA in freshness.ts).
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export async function runMigrations(): Promise<string[]> {
  const ran: string[] = [];
  await sql.begin(async (tx) => {
    // Serialize concurrent migration runs (web boot + worker cron may overlap).
    await tx`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`;

    await tx`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id         TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    const applied = new Set(
      (await tx`SELECT id FROM schema_migrations`).map((r: { id: string }) => r.id),
    );

    for (const file of migrationFiles()) {
      if (applied.has(file)) continue;
      const ddl = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      // Simple query protocol runs the whole multi-statement file in one call,
      // parsing dollar-quoted bodies / string literals natively — no fragile
      // hand-rolled ";" splitter that would shred a function body or quoted ";".
      await tx.unsafe(ddl).simple();
      await tx`INSERT INTO schema_migrations (id) VALUES (${file})`;
      ran.push(file);
      console.log(`migration applied: ${file}`);
    }
  });
  if (ran.length === 0) console.log("migrations: up to date");
  return ran;
}

if (import.meta.main) {
  await runMigrations();
  await sql.end();
}
