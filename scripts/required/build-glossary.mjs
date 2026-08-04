#!/usr/bin/env node
/**
 * build-glossary.mjs
 *
 * Extracts glossary entries from the Atlas. Any node whose title is exactly
 * "Definitions" is treated as a glossary section; its direct [Core] children
 * become defined terms (title = term, body = definition).
 *
 * The atlas has several Definitions sections at different scopes, and some
 * terms (e.g. "Universal Alignment") are redefined. We keep all of them — the
 * frontend shows every variant with its source context.
 *
 * Reads:
 *   public/docs.json
 *
 * Writes:
 *   public/glossary.json  — { [lowercasedTerm]: GlossaryEntry[] }
 *
 * Run: node scripts/build-glossary.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
// Isolation override (preview builds) — see build-index.mjs. Glossary reads the
// preview's own docs.json and writes its own glossary.json, both in OUT_DIR, so
// a preview build never reads main's docs nor clobbers the live glossary.
const OUT_DIR = process.env.ATLAS_OUT_DIR ?? path.join(ROOT, "public");
const DOCS_PATH = path.join(OUT_DIR, "docs.json");
const OUT_PATH = path.join(OUT_DIR, "glossary.json");

function buildGlossary(nodeMap) {
  const nodes = Object.values(nodeMap);
  const definitionsSections = nodes.filter((n) => n.title === "Definitions");

  const childrenByParent = {};
  for (const n of nodes) {
    if (!n.parentId) continue;
    (childrenByParent[n.parentId] ??= []).push(n);
  }

  const glossary = {};
  for (const def of definitionsSections) {
    const parent = def.parentId ? nodeMap[def.parentId] : null;
    const sourceContext = parent ? `${parent.doc_no} ${parent.title}` : null;

    const children = childrenByParent[def.id] ?? [];
    for (const child of children) {
      if (child.type !== "Core") continue;
      const term = child.title.trim();
      if (!term) continue;
      const key = term.toLowerCase();
      (glossary[key] ??= []).push({
        term,
        content: child.content,
        nodeId: child.id,
        docNo: child.doc_no,
        sourceDocNo: def.doc_no,
        sourceContext,
      });
    }
  }

  return { glossary, definitionsSections };
}

function printStats(glossary, definitionsSections) {
  const keys = Object.keys(glossary);
  const totalEntries = keys.reduce((s, k) => s + glossary[k].length, 0);
  const dupes = keys
    .filter((k) => glossary[k].length > 1)
    .sort((a, b) => glossary[b].length - glossary[a].length);

  console.log("\n=== Glossary Stats ===");
  console.log(`Definitions sections: ${definitionsSections.length}`);
  for (const d of definitionsSections) {
    console.log(`  ${d.doc_no.padEnd(20)} (depth ${d.depth})`);
  }
  console.log(`Unique terms:  ${keys.length}`);
  console.log(`Total entries: ${totalEntries}`);
  console.log(`Multi-definition terms: ${dupes.length}`);

  if (dupes.length) {
    console.log("\nMulti-definition terms:");
    for (const k of dupes) {
      console.log(`  ${glossary[k][0].term}  (${glossary[k].length}×)`);
      for (const e of glossary[k]) {
        console.log(`    ${e.sourceDocNo.padEnd(16)} ${e.sourceContext ?? "?"}`);
      }
    }
  }

}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log(`Reading ${path.relative(ROOT, DOCS_PATH)}…`);
const docsFile = JSON.parse(fs.readFileSync(DOCS_PATH, "utf8"));
const atlasCommit = docsFile.atlasCommit ?? "unknown";

const { glossary, definitionsSections } = buildGlossary(docsFile.nodes);

// The section gate is an exact title match and the term gate an exact type
// match — a retitle/rename empties the glossary with no error. Only these
// [drift] stderr lines (picked up by atlas-update.yml + the atlas-healer)
// notice the collapse.
if (definitionsSections.length === 0) {
  console.warn(
    '[drift] tripwire: 0 "Definitions" sections found — the exact-title gate in build-glossary.mjs no longer matches the atlas',
  );
} else if (Object.keys(glossary).length === 0) {
  console.warn(
    "[drift] tripwire: Definitions sections exist but yielded 0 terms — the [Core] child-type gate in build-glossary.mjs no longer matches",
  );
}

printStats(glossary, definitionsSections);

fs.writeFileSync(OUT_PATH, JSON.stringify({ atlasCommit, terms: glossary }));
const size = (fs.statSync(OUT_PATH).size / 1024).toFixed(1);
console.log(`\nWrote ${path.relative(ROOT, OUT_PATH)} (${size} KB)`);
