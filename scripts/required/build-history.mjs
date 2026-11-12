#!/usr/bin/env node
/**
 * Walks the git history of vendor/next-gen-atlas and emits per-node history
 * files at public/history/<uuid>.json.
 *
 * Only processes commits that touch Sky Atlas.md. For each commit, parses the
 * atlas at that revision and the previous revision, diffs per-node content
 * hashes, and records which nodes changed.
 *
 * PR metadata (title, body, author, review/comment counts) comes from the
 * committed read-through cache in scripts/lib/github-pr-cache.mjs, which
 * fetches a missing record with `gh` and degrades to null without it.
 *
 * For "Atlas Edit Proposal" PRs, the script attempts to match each bullet in
 * the PR body to the specific nodes it affected (by keyword overlap between
 * the bullet title and node titles).
 *
 * Run: node scripts/build-history.mjs
 * Requires: gh CLI authenticated with access to sky-ecosystem/next-gen-atlas
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ATLAS_FILE, CONTENT_DIR, makeAtlasGitSource } from "../lib/atlas-git-source.ts";
import { loadAgentNamePrefixes } from "../lib/history-agent-scopes.ts";
import { PR_CACHE_DIR } from "../lib/github-pr-cache.mjs";
import { openHistoryWalk } from "./history-cursor.mjs";
import { walkCommits } from "./history-walk.mjs";
import { writeDbSink, writeJsonSink } from "./history-sink.mjs";

const OUT_JSON = process.argv.includes("--out-json");
const FULL = process.argv.includes("--full");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ATLAS_REPO = path.join(ROOT, "vendor/next-gen-atlas");
const OUT_DIR = path.join(ROOT, "public/history");
const { atlasCommits, loadSnapshot } = makeAtlasGitSource(ATLAS_REPO);

async function main() {
  fs.mkdirSync(PR_CACHE_DIR, { recursive: true });
  if (OUT_JSON) fs.mkdirSync(OUT_DIR, { recursive: true });
  const agentNamePrefixes = loadAgentNamePrefixes(ROOT);
  console.error(`  ${agentNamePrefixes.length} agent name → doc_no scopes`);
  console.error("loading commits…");
  const commits = atlasCommits();
  console.error(`  ${commits.length} commits touch ${ATLAS_FILE} or ${CONTENT_DIR}/`);
  const opened = await openHistoryWalk({ outJson: OUT_JSON, full: FULL, outDir: OUT_DIR, loadSnapshot, commits });
  if (opened.commits.length === 0 && OUT_JSON) {
    console.error("no new commits to process");
    return;
  }
  const walked = await walkCommits({ ...opened, loadSnapshot, agentNamePrefixes });
  if (!OUT_JSON) {
    await writeDbSink(ROOT, walked.newHistory);
    return;
  }
  writeJsonSink(OUT_DIR, opened.existingManifest, walked);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
