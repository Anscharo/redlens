#!/usr/bin/env node
/**
 * Reproducible atlas build at a specific submodule commit.
 *
 *   pnpm build:at <atlas-commit-sha> [--block <number>]
 *
 * Offline artifact set (deterministic, no external APIs required):
 *   build:index    → docs.json, search-index.json
 *   build:graph    → graph.json, relations.json
 *   build:manifest → manifest.json
 *
 * Conditional steps (run when credentials / block are available):
 *   build:addresses  — runs if ETHERSCAN_API_KEY is set
 *   build:snapshot   — runs if --block is provided or a block is already pinned
 *                      for this atlas SHA in .cache/block-pins.json
 *
 * Block pinning (.cache/block-pins.json):
 *   The first time you build at a given atlas SHA, the block number used for
 *   build:snapshot is written here. Subsequent builds without --block reuse
 *   the pinned block, keeping chain-state.json byte-identical across runs.
 *   Pass --block explicitly to override a missing pin; edit the JSON file to
 *   override an existing one.
 *
 * Leaves the atlas submodule checked out at <sha>. To restore:
 *   git submodule update
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ATLAS = path.join(ROOT, "vendor/next-gen-atlas");
const PINS_PATH = path.join(ROOT, ".cache/block-pins.json");

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const sha = args[0];
if (!sha || !/^[0-9a-f]{7,40}$/i.test(sha)) {
  console.error("Usage: pnpm build:at <atlas-commit-sha> [--block <number>]");
  console.error("       sha must be 7–40 hex chars");
  process.exit(1);
}

let blockArg = null;
const blockIdx = args.indexOf("--block");
if (blockIdx !== -1) {
  const raw = args[blockIdx + 1];
  blockArg = raw ? parseInt(raw, 10) : NaN;
  if (!raw || isNaN(blockArg)) {
    console.error("--block requires an integer argument");
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Block-pin helpers
// ---------------------------------------------------------------------------
function readPins() {
  try {
    return JSON.parse(fs.readFileSync(PINS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function pinBlock(atlasSha, block) {
  const pins = readPins();
  if (pins[atlasSha] != null) return; // already pinned — don't override
  pins[atlasSha] = block;
  fs.mkdirSync(path.dirname(PINS_PATH), { recursive: true });
  fs.writeFileSync(PINS_PATH, JSON.stringify(pins, null, 2) + "\n");
  console.log(`Pinned block ${block} for atlas ${atlasSha.slice(0, 12)} → .cache/block-pins.json`);
}

// ---------------------------------------------------------------------------
// Build helpers
// ---------------------------------------------------------------------------
function run(cmd, cwd = ROOT) {
  console.log(`$ ${cmd}${cwd === ROOT ? "" : `   (in ${path.relative(ROOT, cwd)})`}`);
  execSync(cmd, { cwd, stdio: "inherit" });
}

function runWithEnv(cmd, extra, cwd = ROOT) {
  console.log(`$ ${cmd}${cwd === ROOT ? "" : `   (in ${path.relative(ROOT, cwd)})`}`);
  execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, ...extra } });
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------
run("git fetch origin --quiet", ATLAS);
run(`git checkout --quiet ${sha}`, ATLAS);

const resolvedSha = execSync("git rev-parse HEAD", { cwd: ATLAS, encoding: "utf8" }).trim();
console.log(`atlas checked out at ${resolvedSha}\n`);

// ---------------------------------------------------------------------------
// Determine block number (--block arg > existing pin > nothing)
// ---------------------------------------------------------------------------
const pins = readPins();
const block = blockArg ?? pins[resolvedSha] ?? null;

if (block != null) {
  console.log(`Block: ${block}${blockArg != null ? " (from --block)" : " (from pin)"}`);
} else {
  console.log("Block: none — build:snapshot will be skipped (pass --block to enable)");
}

// ---------------------------------------------------------------------------
// Build pipeline
// ---------------------------------------------------------------------------
run("pnpm build:index");

if (process.env.ETHERSCAN_API_KEY) {
  console.log("\nETHERSCAN_API_KEY present — running build:addresses");
  run("pnpm build:addresses");
} else {
  console.log("\nNo ETHERSCAN_API_KEY — skipping build:addresses");
}

run("pnpm build:graph");

if (block != null) {
  console.log(`\nRunning build:snapshot at block ${block}`);
  runWithEnv("pnpm snap:chainstate", { BLOCK_NUMBER: String(block) });

  // Pin this block for future reproducible builds at this atlas SHA
  pinBlock(resolvedSha, block);
} else {
  console.log("\nSkipping build:snapshot (no block number)");
}

run("pnpm build:manifest");

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "public/manifest.json"), "utf8"));
console.log("\n=== Reproducible build ===");
console.log(`atlas:   ${manifest.atlasCommit}`);
console.log(`app:     ${manifest.appCommit}`);
const chainStatePath = path.join(ROOT, "public/chain-state.json");
const blockNum = fs.existsSync(chainStatePath)
  ? (() => { const cs = JSON.parse(fs.readFileSync(chainStatePath, "utf8")); return cs.block ?? Object.values(cs.chains ?? {})[0]?.block ?? null; })()
  : null;
if (blockNum) console.log(`block:   ${blockNum}`);
console.log("");
for (const [name, info] of Object.entries(manifest.artifacts)) {
  console.log(`  ${name.padEnd(22)} ${info.sha256}`);
}
console.log(`\nAtlas submodule is now at ${resolvedSha.slice(0, 12)}.`);
console.log(`To restore the pinned commit: git submodule update`);
