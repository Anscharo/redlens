#!/usr/bin/env node
/**
 * A/B equivalence harness for the compose→parseTree switch.
 *
 *   A = parse(python3 compose.py(content/))   — the old monolith round-trip
 *   B = parseTree(content/)                    — the new direct parser
 *
 * Byte-compares the 9 node fields that flow into docs.json (and therefore into
 * every downstream artifact: search-index, graph/relations, glossary). If the
 * node arrays are identical, all four artifacts are identical — so this is the
 * tightest, most diagnostic gate for the switch.
 *
 * Note: `REPRO=1 pnpm test` only proves determinism (rebuild matches rebuild
 * with current code); it does NOT prove old↔new equivalence. This does.
 *
 * Run: node scripts/aux/ab-parse-check.mjs
 * Exit 0 = identical; exit 1 = drift (prints first mismatches).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parse, parseTree } from "../lib/atlas-parser.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CONTENT_DIR = path.join(ROOT, "vendor/next-gen-atlas/content");
const COMPOSE_SCRIPT = path.join(ROOT, "vendor/next-gen-atlas/sync/compose.py");

const FIELDS = ["id", "doc_no", "title", "type", "depth", "parentId", "order", "content", "contentHash"];

function project(node) {
  const o = {};
  for (const f of FIELDS) o[f] = node[f];
  return o;
}

if (!fs.existsSync(CONTENT_DIR)) {
  console.error(`No content/ tree at ${CONTENT_DIR} — nothing to check.`);
  process.exit(2);
}
if (!fs.existsSync(COMPOSE_SCRIPT)) {
  console.error(`No compose.py at ${COMPOSE_SCRIPT} — cannot build side A.`);
  process.exit(2);
}

// ---- Side A: compose + parse --------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ab-parse-"));
const composed = path.join(tmp, "Sky Atlas.md");
console.log("A: composing via python3 compose.py…");
execFileSync("python3", [COMPOSE_SCRIPT, "--input", CONTENT_DIR, "--output", composed], { stdio: "inherit" });
const { nodes: A } = parse(fs.readFileSync(composed, "utf8"));
fs.rmSync(tmp, { recursive: true, force: true });

// ---- Side B: parseTree --------------------------------------------------------
console.log("B: parsing directly via parseTree…");
const { nodes: B } = parseTree(CONTENT_DIR);

// ---- Compare ------------------------------------------------------------------
console.log(`\nA (compose+parse): ${A.length} nodes`);
console.log(`B (parseTree):     ${B.length} nodes`);

const diffs = [];
const n = Math.max(A.length, B.length);
for (let i = 0; i < n && diffs.length < 30; i++) {
  const a = A[i];
  const b = B[i];
  if (!a) { diffs.push({ i, kind: "extra-in-B", b: b && b.doc_no }); continue; }
  if (!b) { diffs.push({ i, kind: "missing-in-B", a: a.doc_no }); continue; }
  for (const f of FIELDS) {
    if (a[f] !== b[f]) {
      diffs.push({ i, doc_no: a.doc_no, field: f, a: preview(a[f]), b: preview(b[f]) });
      break; // one field per node keeps the report readable
    }
  }
}

function preview(v) {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 120 ? s.slice(0, 117) + "…" : s;
}

if (A.length === B.length && diffs.length === 0) {
  console.log("\n✅ IDENTICAL — parseTree matches compose+parse byte-for-byte across all 9 fields.");
  process.exit(0);
}

console.log(`\n❌ DRIFT — ${diffs.length}${diffs.length >= 30 ? "+" : ""} mismatch(es):`);
for (const d of diffs) {
  if (d.kind) console.log(`  [${d.i}] ${d.kind} ${d.a ?? d.b ?? ""}`);
  else console.log(`  [${d.i}] ${d.doc_no} field=${d.field}\n        A=${d.a}\n        B=${d.b}`);
}
process.exit(1);
