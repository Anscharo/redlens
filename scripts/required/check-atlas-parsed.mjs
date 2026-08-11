#!/usr/bin/env node
/**
 * Merge gate: refuse to ship a build that didn't read the whole atlas.
 *
 * The hourly submodule bump (`.github/workflows/atlas-update.yml`) opens a PR
 * with auto-merge enabled, so a build that silently produces a smaller — or
 * empty — atlas would land on main unattended, and from there into Postgres and
 * the live site. This is the check that stops it.
 *
 * Three questions, cheapest first:
 *
 *   1. Did we parse anything at all?  (absolute floor)
 *   2. Did we parse EVERYTHING the source tree contains?  (independent recount)
 *   3. Did the atlas suddenly lose a large share of its documents?  (--against)
 *
 * (2) is the load-bearing one. It counts documents in the source by a
 * deliberately dumb, layout-blind scan — every `.md` under content/, matching
 * the two forms that define a document — and compares that with what the build
 * actually emitted. It is INDEPENDENT of atlas-source.mjs on purpose: the whole
 * failure class here is the loader not recognising how the atlas stores its
 * files, so a check that asks the loader how many documents there are would
 * agree with itself and pass. This one disagrees.
 *
 * Usage:
 *   node scripts/required/check-atlas-parsed.mjs
 *   node scripts/required/check-atlas-parsed.mjs --against <atlas-sha>
 *
 * Env: ATLAS_SRC_DIR, ATLAS_OUT_DIR, ATLAS_MIN_DOCS, ATLAS_MAX_DOC_DROP (0–1).
 * Exit 0 = safe to ship; exit 1 = do not merge.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { makeAtlasGitSource } from "../lib/atlas-git-source.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SRC_DIR = process.env.ATLAS_SRC_DIR ?? path.join(ROOT, "vendor/next-gen-atlas");
const OUT_DIR = process.env.ATLAS_OUT_DIR ?? path.join(ROOT, "public");

// Deliberately far below the real atlas (~11k documents today, never fewer than
// ~7,700): this is a "something is catastrophically wrong" tripwire, not a size
// assertion. Anything under 1,000 is a truncated checkout or a parser that
// stopped understanding the format.
const MIN_DOCS = Number(process.env.ATLAS_MIN_DOCS ?? 1000);
// Share of documents that may disappear in one bump before a human must look.
const MAX_DROP = Number(process.env.ATLAS_MAX_DOC_DROP ?? 0.1);

const againstIdx = process.argv.indexOf("--against");
const AGAINST = againstIdx >= 0 ? process.argv[againstIdx + 1] : null;

// The two forms that define a document, in every layout the atlas has shipped:
//   atomized      frontmatter `id: <uuid>` (the heading carries no uuid)
//   consolidated  a heading line ending `<!-- UUID: <uuid> -->`
//   monolith      same heading form, in one file
// Both are line-anchored, so a uuid merely quoted in prose cannot match.
const FRONTMATTER_ID_RE = /^id: ([0-9a-f-]{36})$/;
const HEADING_UUID_RE = /^#{1,6} .+<!-- UUID: ([0-9a-f-]{36}) -->\s*$/;

/** Every document uuid in the source tree, found without asking the loader. */
function scanSourceUuids(srcDir) {
  const uuids = new Set();
  const files = [];

  const contentRoot = path.join(srcDir, "content");
  if (fs.existsSync(contentRoot)) {
    const stack = [contentRoot];
    while (stack.length) {
      for (const e of fs.readdirSync(stack.pop(), { withFileTypes: true })) {
        const full = path.join(e.parentPath ?? e.path, e.name);
        if (e.isDirectory()) stack.push(full);
        else if (e.name.endsWith(".md")) files.push(full);
      }
    }
  } else {
    const monolith = path.join(srcDir, "Sky Atlas/Sky Atlas.md");
    if (fs.existsSync(monolith)) files.push(monolith);
  }

  for (const f of files) {
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      const m = FRONTMATTER_ID_RE.exec(line) ?? HEADING_UUID_RE.exec(line);
      if (m) uuids.add(m[1]);
    }
  }
  return { uuids, fileCount: files.length };
}

// ---------------------------------------------------------------------------

const failures = [];
const docsPath = path.join(OUT_DIR, "docs.json");

if (!fs.existsSync(docsPath)) {
  console.error(`check:atlas — no docs.json at ${docsPath}. Run build:index first.`);
  process.exit(1);
}
const parsed = JSON.parse(fs.readFileSync(docsPath, "utf8")).nodes;
const parsedIds = new Set(Object.keys(parsed));

console.log(`check:atlas — ${parsedIds.size} documents in ${docsPath}`);

// 1. Absolute floor. Also catches the case a recount alone cannot: a truncated
//    checkout where source and build are BOTH empty and therefore agree.
if (parsedIds.size < MIN_DOCS) {
  failures.push(
    `parsed ${parsedIds.size} documents, below the floor of ${MIN_DOCS}. The atlas has ` +
      "never been this small — this is a truncated checkout or a parser that no longer " +
      "recognises the source layout.",
  );
}

// 2. Independent recount of the source tree.
const { uuids: srcIds, fileCount } = scanSourceUuids(SRC_DIR);
console.log(`check:atlas — ${srcIds.size} documents found in ${SRC_DIR} (${fileCount} .md files)`);

if (srcIds.size === 0) {
  failures.push(
    `no documents found in ${SRC_DIR}. The atlas submodule is empty or not populated ` +
      "(`pnpm pull-atlas`), so nothing built from it can be trusted.",
  );
} else if (srcIds.size !== parsedIds.size) {
  const missing = [...srcIds].filter((id) => !parsedIds.has(id));
  const extra = [...parsedIds].filter((id) => !srcIds.has(id));
  failures.push(
    `the source tree holds ${srcIds.size} documents but the build emitted ${parsedIds.size}. ` +
      `${missing.length} in source but not built${missing.length ? ` (e.g. ${missing.slice(0, 5).join(", ")})` : ""}; ` +
      `${extra.length} built but not in source${extra.length ? ` (e.g. ${extra.slice(0, 5).join(", ")})` : ""}. ` +
      "The loader is not reading every file the atlas stores — most likely the atlas " +
      "regrouped its files again (see scripts/lib/atlas-source.mjs).",
  );
}

// 3. Drop vs the atlas commit we are bumping FROM.
if (AGAINST) {
  try {
    const before = makeAtlasGitSource(SRC_DIR).loadSnapshot(AGAINST).size;
    const drop = before ? (before - parsedIds.size) / before : 0;
    console.log(
      `check:atlas — ${before} documents at ${AGAINST.slice(0, 7)} → ${parsedIds.size} now ` +
        `(${(drop * 100).toFixed(1)}% ${drop >= 0 ? "drop" : "growth"})`,
    );
    if (drop > MAX_DROP) {
      failures.push(
        `${(drop * 100).toFixed(1)}% of documents disappeared since ${AGAINST.slice(0, 7)} ` +
          `(${before} → ${parsedIds.size}), over the ${(MAX_DROP * 100).toFixed(0)}% limit. ` +
          "If upstream really did delete this much, re-run the workflow with a higher " +
          "max_doc_drop to accept it deliberately.",
      );
    }
  } catch (e) {
    // A missing object (shallow clone) must not silently pass this check.
    failures.push(`could not count documents at ${AGAINST}: ${e.message}`);
  }
}

if (failures.length) {
  console.error(`\n❌ check:atlas — DO NOT MERGE (${failures.length} problem(s)):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("\n✅ check:atlas — the build accounts for every document in the source.");
