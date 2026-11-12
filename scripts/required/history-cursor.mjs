import fs from "node:fs";
import path from "node:path";
import { sql } from "../../src/server/db.ts";
import { runMigrations } from "../../src/server/migrate.ts";
import { waitForDb } from "../../src/server/db.ts";
import { hasBackfilledRows, readHistoryCursor } from "../../src/server/history/history-db.ts";

export async function openHistoryWalk({ outJson, full, outDir, loadSnapshot, commits }) {
  const stored = await readStoredCursor({ outJson, full, outDir });
  return applyCursor(stored, { outJson, loadSnapshot, commits });
}

async function readStoredCursor({ outJson, full, outDir }) {
  const lastCommitFile = path.join(outDir, "_last_commit.txt");
  const manifestFile = path.join(outDir, "_manifest.json");
  if (!outJson) return readDbCursor(full);
  if (full || !fs.existsSync(lastCommitFile) || !fs.existsSync(manifestFile)) return emptyCursor();
  const lastCommitHash = fs.readFileSync(lastCommitFile, "utf8").trim();
  const existingManifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  console.error(`incremental mode: last processed commit ${lastCommitHash.slice(0, 7)}, ${Object.keys(existingManifest).length} nodes in manifest`);
  return { lastCommitHash, existingManifest, prevSnapshot: new Map(), startIndex: 0, backfillBelow: 0 };
}

async function readDbCursor(full) {
  await waitForDb();
  await runMigrations();
  const lastCommitHash = full ? null : await readHistoryCursor(sql);
  console.error(`db sink: history cursor = ${lastCommitHash ? lastCommitHash.slice(0, 7) : "none (full)"}`);
  return { ...emptyCursor(), lastCommitHash };
}

function emptyCursor() {
  return { lastCommitHash: null, existingManifest: {}, prevSnapshot: new Map(), startIndex: 0, backfillBelow: 0 };
}

async function applyCursor(stored, { outJson, loadSnapshot, commits }) {
  if (!stored.lastCommitHash) return { ...stored, commits };
  const idx = commits.findIndex((c) => c.hash.startsWith(stored.lastCommitHash));
  if (idx < 0) {
    console.error(`  last commit not found in history, falling back to full rebuild`);
    return { ...emptyCursor(), commits };
  }
  if (!outJson && !(await hasBackfilledRows(sql))) {
    console.error(`  no retitle, renumbering or type-change rows yet: walking all ${commits.length} commits once to add them`);
    return { ...stored, backfillBelow: idx + 1, commits };
  }
  const startIndex = idx + 1;
  console.error(`  skipping ${startIndex} already-processed commits, ${commits.length - startIndex} new`);
  return { ...stored, startIndex, prevSnapshot: await loadSnapshot(commits[idx].hash), commits: commits.slice(startIndex) };
}
