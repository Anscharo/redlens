#!/usr/bin/env bun
// One-shot backfill for the quoteHash staleness guard added to
// src/lib/data/risk-non-rule-docs.json (see FIX 4 / riskRules.ts). Existing
// entries were curated before quoteHash existed and fall back to the old
// unconditional-exclude behavior until this is run once. Requires
// public/docs.json (pnpm build:index).
//
//   bun scripts/aux/backfill-risk-non-rule-hashes.ts
//
// Rewrites src/lib/data/risk-non-rule-docs.json in place, adding a
// `quoteHash` field to every entry that lacks one and whose uuid is still
// present in the atlas. Entries that ALREADY carry a quoteHash are left
// untouched — this only ever seeds a missing hash, never re-stamps an existing
// one to current content. That keeps it idempotent and safe to re-run (or to
// misfire from CI): it can't silently re-bless a doc whose content has already
// drifted, which would defeat the staleness guard. Entries whose uuid is
// missing (doc deleted/renumbered) are left untouched with a console warning —
// a human should review whether to drop them.

import fs from "node:fs";
import path from "node:path";
import type { AtlasNode } from "../../src/types";
import { riskDocContentHash } from "../../src/lib/riskRules";

const ROOT = path.resolve(import.meta.dir, "../..");
const DOCS_PATH = path.join(ROOT, "public/docs.json");
const JSON_PATH = path.join(ROOT, "src/lib/data/risk-non-rule-docs.json");

if (!fs.existsSync(DOCS_PATH)) {
  console.error(`Missing ${DOCS_PATH} — run "pnpm build:index" first.`);
  process.exit(1);
}

const { nodes: docs } = JSON.parse(fs.readFileSync(DOCS_PATH, "utf8")) as {
  nodes: Record<string, AtlasNode>;
};
const entries: { uuid: string; docNo: string; reason: string; quoteHash?: string }[] = JSON.parse(
  fs.readFileSync(JSON_PATH, "utf8"),
);

let backfilled = 0;
let missing = 0;
let skipped = 0;
const out = entries.map((entry) => {
  if (entry.quoteHash != null) {
    skipped++;
    return entry; // already seeded — never re-stamp to current content
  }
  const doc = docs[entry.uuid];
  if (!doc) {
    missing++;
    console.warn(`uuid ${entry.uuid} (${entry.docNo}) not found in docs.json — left without quoteHash`);
    return entry;
  }
  backfilled++;
  return { ...entry, quoteHash: riskDocContentHash(doc.content.trim()) };
});

fs.writeFileSync(JSON_PATH, `${JSON.stringify(out, null, 2)}\n`);
console.log(
  `Backfilled ${backfilled} entries, ${skipped} already had a hash, ${missing} missing from the current atlas.`,
);
