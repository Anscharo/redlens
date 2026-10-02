#!/usr/bin/env bun
/**
 * build-doc-versions.mjs
 *
 * Walks the atlas submodule's git history and records, per document, every
 * change of its fingerprint (body + title + doc number) into Postgres
 * `atlas_doc_versions` — upstream's per-document version record. A preview of a
 * repo that shares no git history with nga main uses it to find the upstream
 * commit its CONTENT was last in sync with (see scripts/lib/doc-versions.mjs and
 * migrations/034_atlas_doc_versions.sql).
 *
 * Its own pass, with its own cursor in its own table — not a rider on
 * build-history: the first run after the migration finds no cursor and walks
 * the whole history by itself (about a minute: ~100–200 ms per commit), so there
 * is no backfill step to remember. Later runs walk only new commits.
 *
 *   --full      discard the table and rewalk everything
 *   --dry-run   walk and report, write nothing (no DB needed)
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeAtlasGitSource } from "../lib/atlas-git-source.mjs";
import { fingerprintSnapshot, versionRows } from "../lib/doc-versions.mjs";

const FULL = process.argv.includes("--full");
const DRY_RUN = process.argv.includes("--dry-run");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const ATLAS_REPO = path.join(ROOT, "vendor/next-gen-atlas");

const { git, atlasCommits, loadSnapshot } = makeAtlasGitSource(ATLAS_REPO);

/** Position of every commit in the submodule's FULL log (oldest = 1) — the same
 *  numbering atlas_history.commit_seq uses (history-db.ts gitCommitSeq), so the
 *  two tables order commits identically. Keyed by full sha here. */
function commitSeqs() {
  const m = new Map();
  git(`log --reverse --format=%H`)
    .split("\n")
    .forEach((h, i) => h && m.set(h, i + 1));
  return m;
}

async function main() {
  let sql = null;
  let db = null;
  let cursor = null;
  if (!DRY_RUN) {
    ({ sql } = await import("../../src/server/db.ts"));
    const { waitForDb } = await import("../../src/server/db.ts");
    const { runMigrations } = await import("../../src/server/migrate.ts");
    db = await import("../../src/server/history/doc-versions-db.ts");
    await waitForDb();
    await runMigrations();
    if (!FULL) cursor = await db.readDocVersionsCursor(sql);
  }
  console.error(`doc-versions: cursor = ${cursor ? cursor.slice(0, 7) : "none (full walk)"}`);

  const commits = atlasCommits();
  const seqs = commitSeqs();
  let start = 0;
  let prev = new Map();
  if (cursor) {
    const idx = commits.findIndex((c) => c.hash === cursor);
    if (idx >= 0) {
      start = idx + 1;
      prev = fingerprintSnapshot(loadSnapshot(commits[idx].hash));
    } else {
      // Upstream's history no longer contains the cursor (a rewritten main, or a
      // different clone). Rows keyed to the old numbering would corrupt every
      // interval — start over, and REPLACE rather than append.
      console.error(`  cursor ${cursor.slice(0, 7)} is not in the atlas history — full rewalk`);
      cursor = null;
    }
  }
  console.error(`  ${commits.length} atlas commits, ${commits.length - start} to walk`);

  const rows = [];
  const t0 = Date.now();
  for (let i = start; i < commits.length; i++) {
    const c = commits[i];
    const seq = seqs.get(c.hash);
    if (seq === undefined) throw new Error(`commit ${c.hash} is missing from the submodule's full log`);
    const curr = fingerprintSnapshot(loadSnapshot(c.hash));
    const r = versionRows(prev, curr, { sha: c.hash, seq });
    for (const row of r) rows.push(row);
    prev = curr;
    if ((i - start) % 25 === 24 || i === commits.length - 1) {
      console.error(`  [${i + 1}/${commits.length}] ${c.hash.slice(0, 7)} — ${rows.length} version rows so far`);
    }
  }
  const removals = rows.filter((r) => r.fingerprint === null).length;
  console.error(
    `doc-versions: ${rows.length} rows (${removals} removals) over ${commits.length - start} commits in ${((Date.now() - t0) / 1000).toFixed(1)}s; ` +
      `${prev.size} documents live at ${commits.at(-1)?.hash.slice(0, 7) ?? "—"}`,
  );

  if (DRY_RUN) return;
  if (cursor) await db.upsertDocVersions(sql, rows);
  else await db.replaceDocVersions(sql, rows);
  console.error(`doc-versions: ${cursor ? "appended" : "replaced table"} ✓`);
  await sql.end?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
