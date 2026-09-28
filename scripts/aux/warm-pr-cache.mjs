#!/usr/bin/env node
// Fills .cache/github-prs for a range of atlas commits, so the committed cache
// covers the pull requests a bump brought in. Off the `pnpm build` chain: it
// reaches the network, and the build is offline and reproducible.
//
// The hourly bump (.github/workflows/atlas-update.yml) is the only caller that
// runs unattended, because an ephemeral worker container cannot commit what it
// fetched. It passes `--all`, which is what makes a miss recoverable: a range
// walk asks for each commit once, and the next bump starts at the SHA this one
// committed, so a PR skipped by a rejected token would never be requested again.
// `--all` re-derives the missing set from the files on disk, so the next hour
// fills whatever this hour skipped, and an already-cached PR costs one existsSync.
//
//   pnpm history:prs --all                     # every atlas commit
//   pnpm history:prs <since-sha> <until-sha>   # one range, for a targeted fill
//
// Prints a one-line count to stderr and exits 1 when a record could not be
// written, so a rejected token is visible rather than silent. The bump step sets
// continue-on-error, so that exit reports the miss without holding up the bump.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { extractPrNumber, fetchPr, PR_CACHE_DIR } from "../lib/github-pr-cache.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ATLAS_REPO = path.join(ROOT, "vendor/next-gen-atlas");

const args = process.argv.slice(2).filter((a) => a !== "--");
const all = args.includes("--all");
const [since, until] = args.filter((a) => !a.startsWith("--"));

if (!all && !since) {
  console.error("usage: warm-pr-cache.mjs <since-sha> <until-sha> | --all");
  process.exit(2);
}

const range = all ? "HEAD" : `${since}..${until || "HEAD"}`;
const subjects = execFileSync("git", ["-C", ATLAS_REPO, "log", "--format=%s", range], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
  .split("\n")
  .filter(Boolean);

const numbers = [...new Set(subjects.map(extractPrNumber).filter(Boolean))].sort((a, b) => a - b);
const missing = numbers.filter((n) => !fs.existsSync(path.join(PR_CACHE_DIR, `${n}.json`)));
console.error(`${range}: ${subjects.length} commits, ${numbers.length} PRs, ${missing.length} to fetch`);

let fetched = 0;
for (const n of missing) {
  if (await fetchPr(n)) fetched += 1;
}
const failed = missing.length - fetched;
console.error(`pr cache: ${numbers.length - missing.length} cached, ${fetched} fetched, ${failed} failed`);
if (failed > 0) process.exit(1);
