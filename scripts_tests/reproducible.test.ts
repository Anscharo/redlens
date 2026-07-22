// Determinism: running the build twice on a clean checkout should produce
// byte-identical artifacts. Only runs in REPRO=1 mode because each build
// takes ~10s — it's a CI check, not part of every local `pnpm test`.
//
// Why this matters: ci.yml drops `build:manifest` and uses the committed
// manifest as the source of truth. The manifest test asserts disk hashes
// match committed hashes, which only works if every build is deterministic.
// If determinism breaks here, CI starts flaking on the manifest test.
//
// Rebuilds go through ATLAS_OUT_DIR into a scratch dir rather than
// overwriting the live public/ artifacts in place: other test files (e.g.
// preview-isolation.test.ts) read public/ and assume it's stable for the
// duration of the run, and vitest may run test files concurrently.

import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { execFileSync } from "child_process";

const ROOT = path.resolve(__dirname, "..");
const run = process.env.REPRO === "1";

function sha256(p: string) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

describe.runIf(run)("reproducible build:index", () => {
  it("docs.json and search-index.json are byte-identical across two runs", () => {
    const before = {
      docs: sha256(path.join(ROOT, "public/docs.json")),
      idx: sha256(path.join(ROOT, "public/search-index.json")),
    };
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "repro-index-"));
    execFileSync("node", ["scripts/required/build-index.mjs"], {
      cwd: ROOT,
      stdio: "pipe",
      env: { ...process.env, ATLAS_OUT_DIR: out },
    });
    const after = {
      docs: sha256(path.join(out, "docs.json")),
      idx: sha256(path.join(out, "search-index.json")),
    };
    expect(after.docs).toBe(before.docs);
    expect(after.idx).toBe(before.idx);
  }, 120_000);
});

describe.runIf(run)("reproducible build:graph", () => {
  it("graph.json and relations.json are byte-identical across two runs", () => {
    const before = {
      graph: sha256(path.join(ROOT, "public/graph.json")),
      rels: sha256(path.join(ROOT, "public/relations.json")),
    };
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "repro-graph-"));
    // build-graph reads docs.json/addresses.atlas.json from ATLAS_OUT_DIR —
    // seed the scratch dir with the current public/ inputs before rebuilding.
    fs.copyFileSync(path.join(ROOT, "public/docs.json"), path.join(out, "docs.json"));
    fs.copyFileSync(path.join(ROOT, "public/addresses.atlas.json"), path.join(out, "addresses.atlas.json"));
    execFileSync("node", ["scripts/required/build-graph.mjs"], {
      cwd: ROOT,
      stdio: "pipe",
      env: { ...process.env, ATLAS_OUT_DIR: out, ATLAS_ONCHAIN_DIR: path.join(ROOT, "public") },
    });
    const after = {
      graph: sha256(path.join(out, "graph.json")),
      rels: sha256(path.join(out, "relations.json")),
    };
    expect(after.graph).toBe(before.graph);
    expect(after.rels).toBe(before.rels);
  }, 120_000);
});
