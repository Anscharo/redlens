// Numbered-migration runner with a schema_migrations tracking table — mirrors
// the D1-side runner. Each migrations/NNN_*.sql runs once, in a transaction,
// recorded by filename. Idempotent: already-applied files are skipped.
//
//   bun src/server/migrate.ts        # apply pending migrations
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "./db.ts";

const MIGRATIONS_DIR = join(import.meta.dir, "migrations");

export async function runMigrations(): Promise<string[]> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  const applied = new Set(
    (await sql`SELECT id FROM schema_migrations`).map((r: { id: string }) => r.id),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const ddl = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    await sql.begin(async (tx) => {
      // Simple query protocol runs the whole multi-statement file in one call,
      // parsing dollar-quoted bodies / string literals natively — no fragile
      // hand-rolled ";" splitter that would shred a function body or quoted ";".
      await tx.unsafe(ddl).simple();
      await tx`INSERT INTO schema_migrations (id) VALUES (${file})`;
    });
    ran.push(file);
    console.log(`migration applied: ${file}`);
  }
  if (ran.length === 0) console.log("migrations: up to date");
  return ran;
}

if (import.meta.main) {
  await runMigrations();
  await sql.end();
}
