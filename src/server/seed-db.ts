import type { BootDeps } from "./boot.ts";

/** What seedDbIfEmpty decided — returned (not just logged) so it's assertable. */
export type SeedOutcome = "seeded" | "already-seeded" | "undetermined";

// Applies migrations at boot (race-safe via advisory lock), so a redeploy that
// ships one never leaves DB routes erroring until the worker's next cron.
// Non-fatal: the reader serves from disk artifacts, and skew shows at /api/freshness.
async function migrateAtBoot(deps: BootDeps): Promise<void> {
  try {
    const ran = await deps.runMigrations();
    if (ran.length) console.log(`migrations: applied ${ran.length} → ${ran.join(", ")}`);
  } catch (e) {
    console.error(`migrations: boot run failed (${(e as Error).message}) — serving on existing schema; see /api/freshness`);
  }
}

// to_regclass is NULL (not an error) for a missing table, which tells a fresh DB from a failed query.
async function isSeeded(deps: BootDeps): Promise<boolean> {
  const reg = await deps.query`SELECT to_regclass('public.sync_state') AS t`;
  if (reg[0]?.t == null) return false;
  const row = await deps.query`SELECT 1 FROM sync_state WHERE id = 1`;
  return row.length > 0;
}

// Seeds Postgres from the baked-in atlas ONLY when it has never been initialized
// (no sync_state row). Afterwards the atlas worker is the sole writer; re-seeding
// on boot would roll the DB, and every reader via the updater, back to this
// image's older atlas.
export async function seedDbIfEmpty(deps: BootDeps): Promise<SeedOutcome> {
  try {
    await deps.waitForDb();
    await migrateAtBoot(deps);
    if (await isSeeded(deps)) {
      console.log("sync:atlas — skipped (DB already seeded; atlas worker owns updates)");
      return "already-seeded";
    }
  } catch {
    // Fail closed: if we can't confirm the DB is empty, a regressive write is worse than waiting for the worker.
    console.warn("sync:atlas — skipped (could not determine seed state)");
    return "undetermined";
  }
  void deps.spawnSync().exited.then((code) => {
    if (code !== 0) console.warn(`sync:atlas exited ${code} — server continues with baked-in data`);
  });
  return "seeded";
}
