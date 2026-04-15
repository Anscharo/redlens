#!/usr/bin/env node
/**
 * Import docs.json + atlas-graph.json into D1.
 *
 * Usage:
 *   node scripts/import-d1.mjs [--remote]
 *
 * Reads:
 *   ../../public/docs.json       (AtlasNode records)
 *   ../../public/atlas-graph.json (edge records, optional)
 *
 * Writes batched SQL via: npx wrangler d1 execute redlens-atlas [--remote] --command "..."
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const REMOTE = process.argv.includes("--remote");
const FLAG = REMOTE ? "--remote" : "--local";
const DB = "redlens-atlas";
const BATCH = 200; // rows per wrangler execute call

function run(sql) {
  const escaped = sql.replace(/'/g, "''").replace(/\n/g, " ");
  execSync(`npx wrangler@latest d1 execute ${DB} ${FLAG} --command '${escaped}'`, {
    stdio: "inherit",
    cwd: path.resolve(__dirname, ".."),
  });
}

function runFile(filePath) {
  execSync(`npx wrangler@latest d1 execute ${DB} ${FLAG} --file="${filePath}"`, {
    stdio: "inherit",
    cwd: path.resolve(__dirname, ".."),
  });
}

// ---------------------------------------------------------------------------
// 1. Load docs.json
// ---------------------------------------------------------------------------
console.log("Loading docs.json…");
const docsPath = path.join(ROOT, "public", "docs.json");
const docs = JSON.parse(fs.readFileSync(docsPath, "utf8"));
const nodes = Object.values(docs);
console.log(`  ${nodes.length} nodes`);

// ---------------------------------------------------------------------------
// 2. Build node INSERT SQL in batches
// ---------------------------------------------------------------------------
function escape(s) {
  if (s == null) return "NULL";
  return "'" + String(s).replace(/'/g, "''") + "'";
}

console.log("Writing nodes to temp SQL file…");
const tmpNodes = path.join(__dirname, "_nodes.sql");
const out = fs.createWriteStream(tmpNodes);

out.write("DELETE FROM nodes;\n");

let i = 0;
for (const node of nodes) {
  if (i % BATCH === 0) {
    if (i > 0) out.write(";\n");
    out.write("INSERT INTO nodes (id,doc_no,title,type,depth,parent_id,\"order\",content) VALUES\n");
  } else {
    out.write(",\n");
  }
  const content = (node.content ?? "").slice(0, 50000); // D1 row size limit
  out.write(
    `(${escape(node.id)},${escape(node.doc_no)},${escape(node.title)},${escape(node.type)},` +
    `${node.depth ?? 0},${escape(node.parentId ?? null)},${node.order ?? 0},${escape(content)})`
  );
  i++;
}
out.write(";\n");
out.end();

await new Promise((r) => out.on("finish", r));
console.log(`  Written ${i} rows to ${tmpNodes}`);

// ---------------------------------------------------------------------------
// 3. Load atlas-graph.json for edges (if present)
// ---------------------------------------------------------------------------
const graphPath = path.join(ROOT, "public", "atlas-graph.json");
let edges = [];
if (fs.existsSync(graphPath)) {
  console.log("Loading atlas-graph.json…");
  const graph = JSON.parse(fs.readFileSync(graphPath, "utf8"));
  // Shape: { edges: [{ from, to, type }] } or array
  edges = Array.isArray(graph) ? graph : (graph.edges ?? []);
  console.log(`  ${edges.length} edges`);
}

// Also extract UUID citation edges from node content
console.log("Extracting UUID citation edges from content…");
const UUID_RE = /\([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\)/gi;
const nodeIds = new Set(nodes.map((n) => n.id));
let citationCount = 0;
for (const node of nodes) {
  const matches = node.content?.matchAll(UUID_RE) ?? [];
  for (const m of matches) {
    const targetId = m[0].slice(1, -1);
    if (nodeIds.has(targetId) && targetId !== node.id) {
      edges.push({ from: node.id, to: targetId, type: "cites" });
      citationCount++;
    }
  }
}
console.log(`  ${citationCount} citation edges extracted`);

// ---------------------------------------------------------------------------
// 4. Write edges SQL
// ---------------------------------------------------------------------------
const tmpEdges = path.join(__dirname, "_edges.sql");
const outE = fs.createWriteStream(tmpEdges);
outE.write("DELETE FROM edges;\n");

let j = 0;
for (const edge of edges) {
  if (j % BATCH === 0) {
    if (j > 0) outE.write(";\n");
    outE.write("INSERT INTO edges (from_id,to_id,type) VALUES\n");
  } else {
    outE.write(",\n");
  }
  const from = edge.from ?? edge.from_id;
  const to = edge.to ?? edge.to_id;
  outE.write(`(${escape(from)},${escape(to)},${escape(edge.type)})`);
  j++;
}
if (j > 0) outE.write(";\n");
outE.end();
await new Promise((r) => outE.on("finish", r));
console.log(`  Written ${j} edges to ${tmpEdges}`);

// ---------------------------------------------------------------------------
// 5. Execute
// ---------------------------------------------------------------------------
console.log(`\nApplying to D1 ${REMOTE ? "(remote)" : "(local)"}…`);
runFile(tmpNodes);
console.log("  nodes done");
runFile(tmpEdges);
console.log("  edges done");

// Clean up
fs.unlinkSync(tmpNodes);
fs.unlinkSync(tmpEdges);
console.log("\nDone.");
