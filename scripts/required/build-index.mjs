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
import {
  ETH_ADDR_RE,
  SOL_ADDR_RE,
  normalizeAddress,
  detectChainOrNull,
  chainFromLabel,
} from "../lib/address-chains.mjs";

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
function extractAddresses(content, titleChain) {
  const result = {};

  ETH_ADDR_RE.lastIndex = 0;
  let m;
  while ((m = ETH_ADDR_RE.exec(content)) !== null) {
    const key = normalizeAddress(m[0]);
    // Prose first, then the doc's heading context, then the ethereum default.
    // `detected` records whether anything actually named a chain, so the
    // cross-doc merge below can tell a stated ethereum from a defaulted one.
    //
    // When prose and heading name DIFFERENT chains the doc is genuinely
    // ambiguous — "Grove Arbitrum governance relay receiver on Robinhood
    // Chain" is titled for one and bodied for the other. Both become
    // candidates and build-addresses settles it on-chain; guessing here just
    // moves the coin flip earlier.
    if (!result[key]) {
      const prose = detectChainOrNull(content, m.index);
      const detected = prose ?? titleChain;
      const candidates =
        prose && titleChain && titleChain !== prose ? [prose, titleChain] : detected ? [detected] : [];
      result[key] = { chain: detected ?? "ethereum", candidates, detected: detected != null };
    }
  }

  SOL_ADDR_RE.lastIndex = 0;
  while ((m = SOL_ADDR_RE.exec(content)) !== null) {
    const key = normalizeAddress(m[0]);
    // The base58 shape is itself the signal, so this counts as detected.
    if (!result[key]) result[key] = { chain: "solana", candidates: ["solana"], detected: true };
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
const chainMap = {}; // addr → { chain, detected }  (first detected chain wins)

// Chain named by a node's own title, else by its nearest doc_no ancestor that
// names one. Atomized docs put the chain in a heading — either inline
// ("ALM Proxy (Optimism) Contract") or as a bare per-chain grouping heading
// ("Monolithic ALM Contracts" > "Robinhood Chain" > "ALM Proxy Contract") — and
// the one-line body never repeats it. Walks doc_no rather than parentId because
// heading depth is capped at 6, which collapses the parent chain for the deeply
// nested artifact subtrees where this pattern lives.
const nodeByDocNo = new Map(nodes.map((n) => [n.doc_no, n]));
function titleChainFor(node) {
  const parts = node.doc_no.split(".");
  for (let i = parts.length; i > 0; i--) {
    const ancestor = i === parts.length ? node : nodeByDocNo.get(parts.slice(0, i).join("."));
    const hit = ancestor && chainFromLabel(ancestor.title);
    if (hit) return hit;
  }
  return null;
}

for (const node of nodes) {
  const addrs = extractAddresses(node.content, titleChainFor(node));
  for (const [addr, info] of Object.entries(addrs)) {
    // An address can legitimately live on several chains — Safes and the
    // deterministically-deployed ALM contracts are at the same address
    // everywhere — so collect every chain the atlas actually names for it
    // rather than picking one winner. atlas_addresses is keyed (address, chain)
    // precisely for this.
    //
    // `chain` stays the single primary: the first *detected* chain, or ethereum
    // when nothing named one. A defaulted ethereum is not evidence, so it never
    // joins `chains` and never outranks a real detection — without that, an
    // address the atlas placed on Mainnet outright was re-pointed by any later
    // doc that merely filed it under another chain's heading.
    const existing = chainMap[addr];
    if (!existing) {
      chainMap[addr] = { ...info, chains: info.detected ? [...info.candidates] : [] };
    } else {
      if (info.detected) {
        for (const c of info.candidates) if (!existing.chains.includes(c)) existing.chains.push(c);
      }
      if (!existing.detected && info.detected) {
        existing.chain = info.chain;
        existing.detected = true;
      }
    }
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

// `detected` is merge bookkeeping, not part of the artifact contract. `chains`
// is: it lists every chain the atlas places this address on, and always
// contains `chain` (which falls back to ethereum when nothing named one).
const addressesOut = Object.fromEntries(
  Object.entries(chainMap).map(([addr, { chain, chains }]) => [
    addr,
    { chain, chains: chains.length ? chains : [chain] },
  ]),
);

fs.writeFileSync(path.join(OUT_DIR, "addresses.atlas.json"), JSON.stringify({ atlasCommit, addresses: addressesOut }));
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
