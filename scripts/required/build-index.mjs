#!/usr/bin/env node
/**
 * Parses Sky Atlas.md and emits:
 *   public/docs.json          — id → node (uuid, doc_no, title, type, depth, parentId, content, addressRefs)
 *   public/docs-shallow.json  — browser first-paint tier: full nodes for depth ≤ 5 (the initial visible tree + content)
 *   public/docs-deep.json     — browser background tier: full nodes for depth > 5 (on-expand / search / deep-links)
 *   public/search-index.json  — serialized MiniSearch index
 *   public/addresses.atlas.json — address → { chain }  (minimal; build-graph Phase 2.6 adds annotation)
 *
 * Run: node scripts/required/build-index.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import MiniSearch from "minisearch";

import { parse, parseTree } from "../lib/atlas-parser.mjs";
import { ETH_ADDR_RE, SOL_ADDR_RE, normalizeAddress, detectChain } from "../lib/address-chains.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

// Isolation overrides (preview builds). Default to the main ROOT-relative paths
// so the steady-state build is byte-identical. A preview points ATLAS_SRC_DIR at
// its extracted tarball and ATLAS_OUT_DIR at a private temp dir, so it can never
// clobber the live main artifacts the singleton server serves. ATLAS_COMMIT lets
// a preview stamp the known SHA (a tarball extract has no .git to rev-parse).
const ATLAS_SRC_DIR = process.env.ATLAS_SRC_DIR ?? path.join(ROOT, "vendor/next-gen-atlas");
const OUT_DIR = process.env.ATLAS_OUT_DIR ?? path.join(ROOT, "public");
const ATLAS_PATH = path.join(ATLAS_SRC_DIR, "Sky Atlas/Sky Atlas.md");
const CONTENT_DIR = path.join(ATLAS_SRC_DIR, "content");

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
// This file produces search-index.json, which the worker + server deserialize
// via MiniSearch.loadJSON — so these options MUST stay byte-identical to the
// canonical copy in src/lib/searchOptions.ts (this .mjs runs under node and
// can't import that .ts, hence the duplicated literal). Mirror any change there.
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
// Decomposed tree → parse content/**/document.md directly (no python/compose).
// Falls back to the legacy composed monolith if content/ is absent (e.g. a
// pre-decomposition checkout or a pre-composed Sky Atlas.md).
let nodes;
if (fs.existsSync(CONTENT_DIR)) {
  console.log("Parsing Atlas directly from content/ tree…");
  ({ nodes } = parseTree(CONTENT_DIR));
} else {
  console.log("No content/ tree — parsing composed Sky Atlas.md…");
  ({ nodes } = parse(fs.readFileSync(ATLAS_PATH, "utf8")));
}

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

const atlasCommit = process.env.ATLAS_COMMIT ?? (() => {
  try { return execSync("git rev-parse HEAD", { cwd: ATLAS_SRC_DIR, encoding: "utf8" }).trim(); }
  catch { return "unknown"; }
})();

fs.writeFileSync(path.join(OUT_DIR, "addresses.atlas.json"), JSON.stringify({ atlasCommit, addresses: chainMap }));
fs.writeFileSync(path.join(OUT_DIR, "docs.json"), JSON.stringify({ atlasCommit, nodes: docs }));
if (idx) fs.writeFileSync(path.join(OUT_DIR, "search-index.json"), JSON.stringify(idx));

// Browser-facing split of docs.json (see docs/plans/docs-split.md). Split by TREE
// DEPTH, not by field — each file holds SELF-CONTAINED full nodes (id-bearing, so
// there's no positional cross-file stitching to keep aligned). The reader gates
// depth-6 nodes behind a "view all descendants" affordance, so the initial visible
// tree is only depth ≤ SHALLOW_MAX_DEPTH (~1095 nodes). Ship those first; defer the
// depth-6 bulk (~9261 nodes, ~89% of the payload) to a background fetch that fills
// in on expand / search / deep-links.
//   docs-shallow.json — depth ≤ N full nodes: the entire initial tree, content
//                       included, so on-screen nodes need no second fetch.
//   docs-deep.json    — depth > N full nodes: loaded after first paint.
// `contentHash` stays server-only; `order` is KEPT (a depth split breaks the
// array-position-as-order assumption, so buildMaps needs the explicit field).
// docs.json itself remains the full internal/server artifact (id-keyed, with content).
const SHALLOW_MAX_DEPTH = 5; // KEEP IN SYNC with writeDocsSplit() in src/server/retrieval/indexes.ts
const toBrowserNode = (n) => ({
  id: n.id,
  doc_no: n.doc_no,
  title: n.title,
  type: n.type,
  depth: n.depth,
  parentId: n.parentId,
  order: n.order,
  content: n.content,
  addressRefs: n.addressRefs ?? [],
});
const docsShallow = [];
const docsDeep = [];
for (const id of Object.keys(docs)) {
  const n = docs[id];
  (n.depth <= SHALLOW_MAX_DEPTH ? docsShallow : docsDeep).push(toBrowserNode(n));
}
fs.writeFileSync(path.join(OUT_DIR, "docs-shallow.json"), JSON.stringify({ atlasCommit, nodes: docsShallow }));
fs.writeFileSync(path.join(OUT_DIR, "docs-deep.json"), JSON.stringify({ atlasCommit, nodes: docsDeep }));

const kb = (f) => (fs.statSync(path.join(OUT_DIR, f)).size / 1024).toFixed(1);
console.log(
  `\nsplit: docs.json ${kb("docs.json")} KB → docs-shallow.json ${kb("docs-shallow.json")} KB ` +
    `(${docsShallow.length} nodes) + docs-deep.json ${kb("docs-deep.json")} KB (${docsDeep.length} nodes)`,
);

const docsSize = (fs.statSync(path.join(OUT_DIR, "docs.json")).size / 1024).toFixed(1);
const idxNote = idx
  ? `, search-index.json (${(fs.statSync(path.join(OUT_DIR, "search-index.json")).size / 1024).toFixed(1)} KB)`
  : " (search-index.json skipped)";
console.log(`\nWrote docs.json (${docsSize} KB)${idxNote}, addresses.atlas.json`);
