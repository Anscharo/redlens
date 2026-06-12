// Subprocess entry for the in-process atlas updater (Alternative A — see
// docs/plans/atlas-runtime-freshness-inprocess.md). Pulls the atlas submodule to
// upstream main and regenerates the markdown-derived data artifacts into public/.
// The parent server then rebuildFromDisk()-swaps the in-memory indexes.
//
// Deliberately NOT run here: vite/tsc (code unchanged), build:addresses /
// build:snapshot (need API keys), build:history (separate cadence — see the
// "History is NOT refreshed by this loop" note in the plan).
//
// Exits nonzero on any step failure (execFileSync throws) so the parent treats
// it as a failed build and retries next interval without swapping.
import { execFileSync } from "node:child_process";
import { readdirSync, copyFileSync, existsSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SUBMODULE = path.join(ROOT, "vendor/next-gen-atlas");

function run(cmd, args, opts = {}) {
  console.log(`refresh-atlas-build: $ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", cwd: ROOT, ...opts });
}

// 1. Advance the atlas submodule to upstream main.
run("git", ["-C", SUBMODULE, "fetch", "origin", "main"]);
run("git", ["-C", SUBMODULE, "checkout", "origin/main"]);

// 2. Regenerate markdown-derived artifacts (data only; order matches build:railway).
run("bun", ["scripts/required/build-index.mjs"]);
run("bun", ["scripts/required/build-graph.mjs"]);
run("bun", ["scripts/required/build-glossary.mjs"]);
run("bun", ["scripts/required/build-manifest.mjs"]);

// 3. Publish browser-facing artifacts. The SPA is served from dist/, but the
// build writes public/; vite mirrors public/→dist/ only at image-build time, so
// without this the in-memory/MCP indexes go fresh while client-side search stays
// stale. Mirror the top-level JSON artifacts now. (Per-file copy; atomic temp+
// rename publish is a later refinement — see the plan's atomic-publish note.)
const PUB = path.join(ROOT, "public");
const DIST = path.join(ROOT, "dist");

// When the index build was skipped (in-process updater owns + serializes the
// index), drop any stale search-index.json from both dirs so nothing loads a
// mismatched index; the server writes a fresh one after patching its live index.
if (process.env.BUILD_SKIP_SEARCH_INDEX === "1") {
  for (const dir of [PUB, DIST]) {
    const p = path.join(dir, "search-index.json");
    if (existsSync(p)) unlinkSync(p);
  }
  console.log("refresh-atlas-build: dropped stale search-index.json (server owns the index)");
}

if (existsSync(DIST)) {
  let n = 0;
  for (const f of readdirSync(PUB)) {
    if (f.endsWith(".json")) {
      copyFileSync(path.join(PUB, f), path.join(DIST, f));
      n++;
    }
  }
  console.log(`refresh-atlas-build: mirrored ${n} public/*.json → dist/`);
} else {
  console.log("refresh-atlas-build: no dist/ (dev) — skipped public→dist mirror");
}

console.log("refresh-atlas-build: done");
