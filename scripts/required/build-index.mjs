#!/usr/bin/env node
/**
 * Parses Sky Atlas.md and emits:
 *   public/docs.json          — id → node (uuid, doc_no, title, type, depth, parentId, content, addressRefs)
 *   public/search-index.json  — serialized MiniSearch index
 *   public/addresses.atlas.json — address → { chain }  (minimal; build-graph Phase 2.6 adds annotation)
 *
 * Run: node scripts/required/build-index.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import MiniSearch from "minisearch";

import { sha256, HEADING_RE, parse, cleanContent } from "../lib/atlas-parser.mjs";
import { ETH_ADDR_RE, SOL_ADDR_RE, normalizeAddress, detectChain } from "../lib/address-chains.mjs";

// Avoid unused-import noise — keep these here so the file documents the full
// surface of atlas-parser even though parse() is the only caller.
void HEADING_RE;
void cleanContent;
void sha256;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const ATLAS_PATH = path.join(ROOT, "vendor/next-gen-atlas/Sky Atlas/Sky Atlas.md");
const OUT_DIR = path.join(ROOT, "public");

// ---------------------------------------------------------------------------
// Per-node address extraction — chain detection only.
// Annotation (roles, entityLabel, expectedTokens) runs in build-graph Phase 2.6
// so it has access to the full entity graph and ICD param data.
// ---------------------------------------------------------------------------
function extractAddresses(content) {
  const result = {};

  ETH_ADDR_RE.lastIndex = 0;
  let m;
  while ((m = ETH_ADDR_RE.exec(content)) !== null) {
    const key = normalizeAddress(m[0]);
    if (!result[key]) result[key] = { chain: detectChain(content, m.index) };
  }

  SOL_ADDR_RE.lastIndex = 0;
  while ((m = SOL_ADDR_RE.exec(content)) !== null) {
    const key = normalizeAddress(m[0]);
    if (!result[key]) result[key] = { chain: "solana" };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Build MiniSearch index
// KEEP IN SYNC WITH src/workers/search.worker.ts (same processTerm config)
// ---------------------------------------------------------------------------
function buildIndex(nodes) {
  const ms = new MiniSearch({
    fields: ["title", "doc_no", "type", "content"],
    idField: "id",
    processTerm: (term) => {
      // Strip leading/trailing non-alphanumeric chars so backtick-wrapped tokens
      // like `delegatedSigners` index as "delegatedsigners" not "`delegatedsigners`".
      const lower = term.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "").toLowerCase();
      return lower.length >= 2 ? lower : null;
    },
  });
  ms.addAll(
    nodes.map((n) => ({
      id: n.id,
      title: n.title,
      doc_no: n.doc_no,
      type: n.type,
      content: n.content,
    })),
  );
  return ms.toJSON();
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
function printStats(nodes) {
  const byType = {};
  const byDepth = {};
  let emptyContent = 0;
  for (const node of nodes) {
    byType[node.type] = (byType[node.type] ?? 0) + 1;
    byDepth[node.depth] = (byDepth[node.depth] ?? 0) + 1;
    if (!node.content) emptyContent++;
  }
  console.log("\n=== Atlas Parse Stats ===");
  console.log(`Total nodes:   ${nodes.length}`);
  console.log(`Empty content: ${emptyContent}`);
  console.log("\nBy type:");
  for (const [t, n] of Object.entries(byType).sort((a, b) => b[1] - a[1]))
    console.log(`  ${t.padEnd(24)} ${n}`);
  console.log("\nBy depth:");
  for (const [d, n] of Object.entries(byDepth).sort((a, b) => +a[0] - +b[0]))
    console.log(`  depth ${d}: ${n}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const ATLAS_ROOT = path.join(ROOT, "vendor/next-gen-atlas");
const COMPOSE_SCRIPT = path.join(ATLAS_ROOT, "sync/compose.py");
const CONTENT_DIR = path.join(ATLAS_ROOT, "content");

if (fs.existsSync(COMPOSE_SCRIPT) && fs.existsSync(CONTENT_DIR)) {
  console.log("Composing Sky Atlas.md from content/ folder tree…");
  fs.mkdirSync(path.dirname(ATLAS_PATH), { recursive: true });
  execFileSync("python3", [COMPOSE_SCRIPT, "--input", CONTENT_DIR, "--output", ATLAS_PATH], {
    stdio: "inherit",
  });
}

const src = fs.readFileSync(ATLAS_PATH, "utf8");
console.log("Parsing Atlas…");
const { nodes } = parse(src);

printStats(nodes);

// BUILD_SKIP_SEARCH_INDEX=1 emits docs.json without building search-index.json —
// for the in-process self-updater's subprocess-shrink (the server owns + serializes
// the index incrementally). DORMANT: only safe once the server maintains the index
// (patchDocs + toJSON); otherwise rebuildFromDisk falls back to addAll and the
// 316 MB build just moves into the live server. See atlas-runtime-freshness-inprocess.md.
const skipSearchIndex = process.env.BUILD_SKIP_SEARCH_INDEX === "1";
let idx = null;
if (skipSearchIndex) {
  console.log("\nSkipping MiniSearch index build (BUILD_SKIP_SEARCH_INDEX=1)");
} else {
  console.log("\nBuilding MiniSearch index…");
  idx = buildIndex(nodes);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

// Build docs and extract address refs + chain map in one pass.
const docs = {};
const chainMap = {}; // addr → { chain }  (most specific chain wins over ethereum)

for (const node of nodes) {
  const addrs = extractAddresses(node.content);
  for (const [addr, info] of Object.entries(addrs)) {
    const existing = chainMap[addr];
    if (!existing || existing.chain === "ethereum") chainMap[addr] = info;
  }
  docs[node.id] = {
    id: node.id,
    doc_no: node.doc_no,
    title: node.title,
    type: node.type,
    depth: node.depth,
    parentId: node.parentId,
    order: node.order,
    content: node.content,
    contentHash: node.contentHash,
    addressRefs: Object.keys(addrs).sort(),
  };
}

const total = Object.keys(chainMap).length;
const byChain = {};
for (const { chain } of Object.values(chainMap)) byChain[chain] = (byChain[chain] ?? 0) + 1;
console.log(`\n${total} unique addresses extracted`);
for (const [c, n] of Object.entries(byChain).sort((a, b) => b[1] - a[1]))
  console.log(`  ${c.padEnd(12)} ${n}`);

fs.writeFileSync(path.join(OUT_DIR, "addresses.atlas.json"), JSON.stringify(chainMap));
fs.writeFileSync(path.join(OUT_DIR, "docs.json"), JSON.stringify(docs));
if (idx) fs.writeFileSync(path.join(OUT_DIR, "search-index.json"), JSON.stringify(idx));

const docsSize = (fs.statSync(path.join(OUT_DIR, "docs.json")).size / 1024).toFixed(1);
const idxNote = idx
  ? `, search-index.json (${(fs.statSync(path.join(OUT_DIR, "search-index.json")).size / 1024).toFixed(1)} KB)`
  : " (search-index.json skipped)";
console.log(`\nWrote docs.json (${docsSize} KB)${idxNote}, addresses.atlas.json`);
