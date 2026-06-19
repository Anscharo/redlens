#!/usr/bin/env node
/**
 * One-shot bootstrap for public/processes.json.
 *
 * Parses docs/process-inventory.md (the research doc that catalogued 55
 * processes by hand) and resolves the 8-char UUID prefixes to full UUIDs by
 * looking them up in public/docs.json. Emits public/processes.json.
 *
 * Re-run only if the research doc is updated; normal updates go through the
 * check-processes-dirty.mjs flow.
 *
 * Run: node scripts/aux/processes-bootstrap.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const RESEARCH = path.join(ROOT, "docs/process-inventory.md");
const DOCS = path.join(ROOT, "public/docs.json");
const OUT = path.join(ROOT, "public/processes.json");

// ---------------------------------------------------------------------------
// Parse the research doc tables.
// ---------------------------------------------------------------------------
// Each table is preceded by a "### Category" heading. Rows look like:
//   | 83edd4e1 | A.1.10 | Weekly Governance Cycle | <steps> |
// We capture: prefix, doc_no, title, steps.
// ---------------------------------------------------------------------------

function parseResearchDoc(md) {
  const lines = md.split("\n");
  let category = null;
  const rows = [];

  for (const line of lines) {
    const h = line.match(/^### (.+?)\s*$/);
    if (h) {
      category = h[1].trim();
      continue;
    }
    // Match table data rows (not header/separator) starting with `| <hex>`
    const m = line.match(/^\|\s*([0-9a-f]{8})\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*$/);
    if (m && category) {
      const [, prefix, doc_no, title, steps] = m;
      rows.push({
        prefix,
        doc_no: doc_no.trim(),
        title: title.trim(),
        steps_note: steps.trim(),
        category,
      });
    }
  }
  return rows;
}

function resolvePrefix(prefix, docs) {
  const hits = Object.keys(docs).filter((id) => id.startsWith(prefix));
  if (hits.length === 0) return { error: "not found" };
  if (hits.length > 1) return { error: `ambiguous: ${hits.length} matches` };
  return { uuid: hits[0] };
}

// Inline-step processes from the research doc — those whose steps live in the
// node's content, not as children. The research doc marks these with "(inline)"
// in the Steps column.
function inferShape(steps_note) {
  return steps_note.includes("inline") ? "inline" : "child";
}

// Stubs flagged in the research doc — kept in inventory but incomplete.
function inferStatus(steps_note) {
  if (steps_note.includes("stub") || steps_note.includes("defers")) {
    return "deferred-stub";
  }
  return "active";
}

// ---------------------------------------------------------------------------

const md = fs.readFileSync(RESEARCH, "utf8");
const docs = JSON.parse(fs.readFileSync(DOCS, "utf8")).nodes;

const rows = parseResearchDoc(md);
console.log(`Parsed ${rows.length} rows from research doc.`);

const entries = [];
const errors = [];

for (const row of rows) {
  const r = resolvePrefix(row.prefix, docs);
  if (r.error) {
    errors.push({ ...row, error: r.error });
    continue;
  }
  const node = docs[r.uuid];
  entries.push({
    uuid: r.uuid,
    category: row.category,
    shape: inferShape(row.steps_note),
    status: inferStatus(row.steps_note),
    // Title/doc_no are resolved from docs.json at read time — not stored here.
    _node: node,
    // For human reference / cross-check vs. the research doc.
    research_title: row.title,
    research_doc_no: row.doc_no,
  });
}

if (errors.length > 0) {
  console.error(`\n${errors.length} unresolved prefixes:`);
  for (const e of errors) {
    console.error(`  ${e.prefix}  ${e.doc_no}  ${e.title}  — ${e.error}`);
  }
}

// Sanity check: title/doc_no in atlas should match research doc.
const mismatches = entries.filter(
  (e) => e._node.title !== e.research_title || e._node.doc_no !== e.research_doc_no,
);
if (mismatches.length > 0) {
  console.warn(`\n${mismatches.length} entries where current atlas differs from research doc snapshot:`);
  for (const m of mismatches) {
    if (m._node.title !== m.research_title) {
      console.warn(`  ${m.uuid}  title: "${m.research_title}" → "${m._node.title}"`);
    }
    if (m._node.doc_no !== m.research_doc_no) {
      console.warn(`  ${m.uuid}  doc_no: ${m.research_doc_no} → ${m._node.doc_no}`);
    }
  }
}

// Sort by category, then current doc_no for stable diffs.
entries.sort((a, b) => {
  if (a.category !== b.category) return a.category.localeCompare(b.category);
  return a._node.doc_no.localeCompare(b._node.doc_no, undefined, { numeric: true });
});

// Strip the helper fields from the final output — they were verification only.
const final = entries.map(({ _node, research_title, research_doc_no, ...rest }) => {
  void _node;
  void research_title;
  void research_doc_no;
  return rest;
});

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(final, null, 2) + "\n");
console.log(`\nWrote ${final.length} entries to ${path.relative(ROOT, OUT)}`);
