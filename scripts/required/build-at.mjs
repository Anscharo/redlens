#!/usr/bin/env node
/**
 * Reproducible atlas build at a specific submodule commit.
 *
 *   pnpm build:at <atlas-commit-sha>
 *
 * The step list is the `buildAt` profile in scripts/lib/build-steps.mjs.
 *
 * Offline artifact set (deterministic, no external APIs required):
 *   build:index      → docs.json, search-index.json
 *   build:graph      → graph.json, relations.json
 *   build:oea-report → oea-report.json
 *   build:manifest   → manifest.json
 *
 * Conditional step (runs when credentials are available):
 *   build:addresses  — runs if ETHERSCAN_API_KEY is set
 *
 * The on-chain snapshot is NOT part of a reproducible build any more: it lives
 * in Postgres, fetched on a time gate by the atlas worker (see
 * scripts/required/fetch-chain-state.mjs). The block-pinning machinery this
 * script used to carry existed only to keep the committed chain-state.json
 * byte-identical across repro runs, so it retired with the file.
 *
 * Leaves the atlas submodule checked out at <sha>. To restore:
 *   git submodule update
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stepsFor } from "../lib/build-steps.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ATLAS = path.join(ROOT, "vendor/next-gen-atlas");

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const sha = args[0];
if (!sha || !/^[0-9a-f]{7,40}$/i.test(sha)) {
  console.error("Usage: pnpm build:at <atlas-commit-sha>");
  console.error("       sha must be 7–40 hex chars");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Build helpers
// ---------------------------------------------------------------------------
function run(cmd, cwd = ROOT) {
  console.log(`$ ${cmd}${cwd === ROOT ? "" : `   (in ${path.relative(ROOT, cwd)})`}`);
  execSync(cmd, { cwd, stdio: "inherit" });
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------
run("git fetch origin --quiet", ATLAS);
run(`git checkout --quiet ${sha}`, ATLAS);

const resolvedSha = execSync("git rev-parse HEAD", { cwd: ATLAS, encoding: "utf8" }).trim();
console.log(`atlas checked out at ${resolvedSha}\n`);

// ---------------------------------------------------------------------------
// Build pipeline — the `buildAt` profile of scripts/lib/build-steps.mjs (which
// also records what this profile deliberately skips, and why).
// ---------------------------------------------------------------------------
for (const step of stepsFor("buildAt")) {
  // The one conditional step: addresses needs an Etherscan key, so an offline
  // repro build runs the rest of the chain without it.
  if (step.id === "addresses") {
    if (!process.env.ETHERSCAN_API_KEY) {
      console.log("\nNo ETHERSCAN_API_KEY — skipping build:addresses");
      continue;
    }
    console.log("\nETHERSCAN_API_KEY present — running build:addresses");
  }
  run(`pnpm ${step.pnpmScript}`);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "public/manifest.json"), "utf8"));
console.log("\n=== Reproducible build ===");
console.log(`atlas:   ${manifest.atlasCommit}`);
console.log(`app:     ${manifest.appCommit}`);
console.log("");
for (const [name, info] of Object.entries(manifest.artifacts)) {
  console.log(`  ${name.padEnd(22)} ${info.sha256}`);
}
console.log(`\nAtlas submodule is now at ${resolvedSha.slice(0, 12)}.`);
console.log(`To restore the pinned commit: git submodule update`);
