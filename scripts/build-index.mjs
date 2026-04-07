#!/usr/bin/env node
/**
 * Parses Sky Atlas.md and emits:
 *   public/docs.json        — id → node (uuid, doc_no, title, type, depth, parentId, content)
 *   public/search-index.json — serialized lunr index
 *
 * Run: node scripts/build-index.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import lunr from "lunr";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ATLAS_PATH = path.join(
  ROOT,
  "vendor/next-gen-atlas/Sky Atlas/Sky Atlas.md"
);
const OUT_DIR = path.join(ROOT, "public");

// ---------------------------------------------------------------------------
// Heading pattern: `## A.0.1 - Title [Type]  <!-- UUID: <uuid> -->`
// ---------------------------------------------------------------------------
const HEADING_RE =
  /^(#{1,6}) ([\w.]+) - (.+?) \[([^\]]+)\]\s+<!-- UUID: ([0-9a-f-]{36}) -->$/;

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------
function parse(src) {
  const lines = src.split("\n");
  const nodes = []; // ordered list of nodes as we encounter headings
  const nodeMap = {}; // uuid → node

  let current = null; // node currently accumulating content lines

  for (const line of lines) {
    const m = line.match(HEADING_RE);
    if (m) {
      // Seal previous node's content
      if (current) {
        current.content = cleanContent(current._lines);
        delete current._lines;
      }

      const depth = m[1].length;
      const node = {
        id: m[5],
        doc_no: m[2],
        title: m[3].trim(),
        type: m[4],
        depth,
        parentId: null,
        order: nodes.length,
        content: "",
        _lines: [],
      };

      nodes.push(node);
      nodeMap[node.id] = node;
      current = node;
    } else if (current) {
      current._lines.push(line);
    }
  }

  // Seal last node
  if (current) {
    current.content = cleanContent(current._lines);
    delete current._lines;
  }

  // ---------------------------------------------------------------------------
  // Resolve parent IDs using depth-based ancestor tracking
  // ---------------------------------------------------------------------------
  const ancestors = []; // stack indexed by depth (1-based)

  for (const node of nodes) {
    ancestors[node.depth] = node.id;
    // clear deeper slots so they don't leak across siblings
    for (let d = node.depth + 1; d <= 6; d++) ancestors[d] = undefined;

    const parentDepth = node.depth - 1;
    node.parentId = parentDepth >= 1 ? (ancestors[parentDepth] ?? null) : null;
  }

  return { nodes, nodeMap };
}

// Strip leading/trailing backtick delimiters from multi-line backtick blocks.
// A multi-line backtick block opens when a line STARTS with ` and doesn't
// close on the same line, and ends at a line that is just ` or ends with `.
function cleanContent(lines) {
  const out = [];
  let inBlock = false;

  for (const line of lines) {
    if (!inBlock) {
      // Detect opening: line starts with backtick and either the line is
      // longer than 1 char (opening backtick + content) and the line does NOT
      // end with another backtick that closes it on the same line, OR the
      // line is solely a backtick (unusual but handle it).
      if (line.startsWith("`")) {
        const inner = line.slice(1);
        if (inner.endsWith("`") && inner.length > 0) {
          // Closed on same line — just strip the wrapping backticks
          out.push(inner.slice(0, -1));
        } else {
          // Multi-line block opens
          inBlock = true;
          if (inner.trim()) out.push(inner); // keep first-line content if any
        }
      } else {
        out.push(line);
      }
    } else {
      // Inside a multi-line block
      if (line === "`" || line.endsWith("`")) {
        inBlock = false;
        const inner = line.endsWith("`") ? line.slice(0, -1) : "";
        if (inner.trim()) out.push(inner);
      } else {
        out.push(line);
      }
    }
  }

  return out.join("\n").trim();
}

// ---------------------------------------------------------------------------
// Build lunr index
// ---------------------------------------------------------------------------
function buildIndex(nodes) {
  return lunr(function () {
    this.ref("id");
    this.field("title", { boost: 10 });
    this.field("doc_no", { boost: 5 });
    this.field("type", { boost: 2 });
    this.field("content");

    for (const node of nodes) {
      this.add({
        id: node.id,
        title: node.title,
        doc_no: node.doc_no,
        type: node.type,
        content: node.content,
      });
    }
  });
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
const src = fs.readFileSync(ATLAS_PATH, "utf8");
console.log("Parsing Atlas…");
const { nodes } = parse(src);

printStats(nodes);

console.log("\nBuilding lunr index…");
const idx = buildIndex(nodes);

fs.mkdirSync(OUT_DIR, { recursive: true });

// docs.json — strip content for the initial load; full content is only needed
// for the detail view and snippet generation (kept in same file for simplicity
// at this scale — we can split later if needed)
const docs = {};
for (const node of nodes) {
  docs[node.id] = {
    id: node.id,
    doc_no: node.doc_no,
    title: node.title,
    type: node.type,
    depth: node.depth,
    parentId: node.parentId,
    order: node.order,
    content: node.content,
  };
}

fs.writeFileSync(path.join(OUT_DIR, "docs.json"), JSON.stringify(docs));
fs.writeFileSync(
  path.join(OUT_DIR, "search-index.json"),
  JSON.stringify(idx)
);

const docsSize = (
  fs.statSync(path.join(OUT_DIR, "docs.json")).size / 1024
).toFixed(1);
const idxSize = (
  fs.statSync(path.join(OUT_DIR, "search-index.json")).size / 1024
).toFixed(1);

console.log(
  `\nWrote public/docs.json (${docsSize} KB) and public/search-index.json (${idxSize} KB)`
);
