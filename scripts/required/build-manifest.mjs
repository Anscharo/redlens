#!/usr/bin/env node
/**
 * Emits public/manifest.json — a sha256 digest of every shipping artifact.
 *
 * Runs last in `pnpm build`. The digest is a provenance / reproducibility
 * record: graph.json is gitignored but built deterministically, so a committed
 * manifest hash should always match a fresh rebuild.
 *
 * Also pins the atlas submodule SHA and the app commit SHA so the
 * manifest is a self-contained provenance record for this build.
 *
 * Run: node scripts/build-manifest.mjs
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC = path.join(ROOT, "public");
const OUT = path.join(PUBLIC, "manifest.json");

// Every shipping artifact gets a sha256 here for provenance. graph.json is
// included as a reproducibility check — it's gitignored but built
// deterministically, so the committed manifest's hash should always match a
// fresh rebuild.
// Out of scope:
//   - addresses.merged.json — intermediate, gitignored
//   - history/** — too many files, fetched on demand
//   - atlas-vectors — backend-only; lives in .cache/atlas-vectors/ and is
//     not bundled with the frontend. Provenance lives in D1 kv_meta
//     (vectorsAtlasCommit etc.) to avoid coupling the frontend manifest to
//     Workers AI availability in CI.
const ARTIFACTS = [
  // Frontend-fetched
  "docs.json", // internal/server artifact + bundle diff source (not browser-fetched)
  "docs-shallow.json", // browser: depth ≤ 5 full nodes (initial visible tree + content)
  "docs-deep.json", // browser: depth > 5 full nodes (background / on-expand)
  "search-index.json",
  "addresses.atlas.json",
  "addresses.json",
  // chain-state.json excluded — its blockNumber increments on every build:snapshot
  // run, which would change the manifest hash even when atlas content is unchanged.
  // Block number is read from chain-state.json directly by sync-d1.mjs at sync time.
  "glossary.json",
  "relations.json",
  "oea-report.json",
  // Reproducibility check
  "graph.json",
];

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function gitRev(cwd) {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

const artifacts = {};
for (const name of ARTIFACTS) {
  const p = path.join(PUBLIC, name);
  if (!fs.existsSync(p)) {
    console.warn(`  skip ${name} — not present`);
    continue;
  }
  const buf = fs.readFileSync(p);
  artifacts[name] = {
    sha256: sha256(buf),
    bytes: buf.length,
  };
}

const manifest = {
  generatedAt: new Date().toISOString(),
  appCommit: gitRev(ROOT),
  atlasCommit: gitRev(path.join(ROOT, "vendor/next-gen-atlas")),
  artifacts,
};

fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2) + "\n");

console.log("=== Manifest ===");
console.log(`app:     ${manifest.appCommit?.slice(0, 12) ?? "unknown"}`);
console.log(`atlas:   ${manifest.atlasCommit?.slice(0, 12) ?? "unknown"}`);
for (const [name, info] of Object.entries(artifacts)) {
  const kb = (info.bytes / 1024).toFixed(1).padStart(8);
  console.log(`  ${name.padEnd(22)} ${kb} KB  ${info.sha256.slice(0, 12)}…`);
}
console.log(`\nWrote ${path.relative(ROOT, OUT)}`);
