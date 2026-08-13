// Preview build isolation + branch-new-address tolerance (step 2).
//
// Exercises the exact path a preview build takes: run build-index then
// build-graph into a private ATLAS_OUT_DIR, reusing main's on-chain artifact
// (addresses.json) from public/ via ATLAS_ONCHAIN_DIR, and stamping a known SHA
// via ATLAS_COMMIT. Guards two things at once:
//
//   1. Isolation — an isolated build never writes to public/ (the live artifacts
//      the singleton server serves).
//   2. Branch-new-address tolerance — a doc carrying an address absent from
//      main's addresses.json completes the build and keeps its atlas-derived
//      annotation, with no on-chain enrichment (acceptable MVP behavior; the
//      preview reuses main's on-chain data rather than re-fetching Etherscan).
//
// has_address (Phase 2.5, ICD-param) edge emission is covered by the graph
// snapshot tests; this fixture targets the not-in-on-chain reuse path.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const SRC = path.join(ROOT, "vendor/next-gen-atlas");
const COMMIT = "preview-test-sha-000000000000000000000000";

// Lowercase 40-hex address that should not occur anywhere in the real atlas.
const NEW_ADDR = "0xabcdef0123456789abcdef0123456789abcdef01";

function sha256(p: string) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

const haveInputs =
  fs.existsSync(path.join(SRC, "content")) &&
  fs.existsSync(path.join(PUBLIC, "docs.json")) &&
  fs.existsSync(path.join(PUBLIC, "addresses.json")) &&
  fs.existsSync(path.join(PUBLIC, "glossary.json"));

describe.runIf(haveInputs)("preview build isolation", () => {
  let out: string;
  let publicHashesBefore: Record<string, string>;

  beforeAll(() => {
    // Precondition: the synthetic address must be genuinely new.
    const onChain = JSON.parse(fs.readFileSync(path.join(PUBLIC, "addresses.json"), "utf8"));
    expect(onChain[NEW_ADDR], "test address must be absent from main on-chain data").toBeUndefined();
    expect(
      fs.readFileSync(path.join(PUBLIC, "docs.json"), "utf8").includes(NEW_ADDR),
      "test address must be absent from real docs",
    ).toBe(false);

    publicHashesBefore = {
      docs: sha256(path.join(PUBLIC, "docs.json")),
      relations: sha256(path.join(PUBLIC, "relations.json")),
      addressesAtlas: sha256(path.join(PUBLIC, "addresses.atlas.json")),
      glossary: sha256(path.join(PUBLIC, "glossary.json")),
    };

    out = fs.mkdtempSync(path.join(os.tmpdir(), "preview-iso-"));

    // 1. build-index into the isolated out dir (skip the heavy MiniSearch step).
    execFileSync("node", ["scripts/required/build-index.mjs"], {
      cwd: ROOT,
      stdio: "pipe",
      env: { ...process.env, ATLAS_SRC_DIR: SRC, ATLAS_OUT_DIR: out, ATLAS_COMMIT: COMMIT, BUILD_SKIP_SEARCH_INDEX: "1" },
    });

    // 2. Inject a brand-new address as if a branch doc introduced it: add it to
    //    one node's content + addressRefs, and to addresses.atlas.json with a
    //    chain (mirrors what build-index's content scan would emit).
    const docsPath = path.join(out, "docs.json");
    const docs = JSON.parse(fs.readFileSync(docsPath, "utf8"));
    const firstId = Object.keys(docs.nodes)[0];
    const node = docs.nodes[firstId];
    node.content = `${node.content}\n\nProposed address: ${NEW_ADDR}.`;
    node.addressRefs = [...new Set([...(node.addressRefs ?? []), NEW_ADDR])].sort();
    fs.writeFileSync(docsPath, JSON.stringify(docs));

    const atlasPath = path.join(out, "addresses.atlas.json");
    const atlas = JSON.parse(fs.readFileSync(atlasPath, "utf8"));
    atlas.addresses[NEW_ADDR] = { chain: "ethereum" };
    fs.writeFileSync(atlasPath, JSON.stringify(atlas));

    // 3. build-graph into the same out dir, reusing main's on-chain artifacts.
    execFileSync("node", ["scripts/required/build-graph.mjs"], {
      cwd: ROOT,
      stdio: "pipe",
      env: { ...process.env, ATLAS_SRC_DIR: SRC, ATLAS_OUT_DIR: out, ATLAS_ONCHAIN_DIR: PUBLIC, ATLAS_COMMIT: COMMIT },
    });

    // 4. build-glossary — the third pipeline stage; reads/writes only OUT_DIR.
    execFileSync("node", ["scripts/required/build-glossary.mjs"], {
      cwd: ROOT,
      stdio: "pipe",
      env: { ...process.env, ATLAS_OUT_DIR: out },
    });
  }, 120_000);

  it("produces a full bundle in the isolated dir, stamped with the preview SHA", () => {
    for (const f of ["docs.json", "addresses.atlas.json", "graph.json", "relations.json", "glossary.json"]) {
      expect(fs.existsSync(path.join(out, f)), `${f} missing`).toBe(true);
    }
    const docs = JSON.parse(fs.readFileSync(path.join(out, "docs.json"), "utf8"));
    expect(docs.atlasCommit).toBe(COMMIT);
    const rels = JSON.parse(fs.readFileSync(path.join(out, "relations.json"), "utf8"));
    expect(rels.meta.atlasCommit).toBe(COMMIT);
  });

  it("keeps the branch-new address's atlas annotation with no on-chain enrichment", () => {
    const atlas = JSON.parse(fs.readFileSync(path.join(out, "addresses.atlas.json"), "utf8"));
    // Build completed and the new address survived build-graph with atlas annotation.
    expect(atlas.addresses[NEW_ADDR]).toBeDefined();
    expect(atlas.addresses[NEW_ADDR].chain).toBe("ethereum");
    // It is genuinely absent from the reused on-chain data — no Etherscan fields.
    const onChain = JSON.parse(fs.readFileSync(path.join(PUBLIC, "addresses.json"), "utf8"));
    expect(onChain[NEW_ADDR]).toBeUndefined();
  });

  it("never touches the live public/ artifacts", () => {
    expect(sha256(path.join(PUBLIC, "docs.json"))).toBe(publicHashesBefore.docs);
    expect(sha256(path.join(PUBLIC, "relations.json"))).toBe(publicHashesBefore.relations);
    expect(sha256(path.join(PUBLIC, "addresses.atlas.json"))).toBe(publicHashesBefore.addressesAtlas);
    expect(sha256(path.join(PUBLIC, "glossary.json"))).toBe(publicHashesBefore.glossary);
  });
});
