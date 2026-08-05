#!/usr/bin/env bun
/**
 * Concepts catalog census — drift detector for docs/crossview/concepts.md (the
 * /reports/crossview Concepts tab).
 *
 * Recomputes every deterministic census in src/lib/conceptsCensus.ts against
 * public/docs.json and diffs each census's member list against the committed
 * baseline (.github/concepts-census-baseline.json), naturalCompare-sorted by
 * doc_no.
 *
 * Warnings (stderr, picked up by atlas-update.yml's drift-issue step):
 *   - [drift] concepts-census: a NEW member entered a census that isn't in
 *     the committed baseline
 *   - [drift] concepts-census: a member's bucket (e.g. live/empty) CHANGED
 *     from what the baseline recorded
 * Resolved members (in the baseline, no longer in the census) are logged,
 * not warned — matching the govops/risk census precedent.
 *
 * Always exits 0 — like the other census checks, it must never block a
 * build. `--update` rewrites the baseline (the atlas-update workflow does
 * this in the same commit as the submodule bump).
 *
 * Runs under bun (not node) so it can import computeConceptsCensus straight
 * from the TS source — the check-risk-census.mjs precedent (riskRules.ts).
 */

import fs from "node:fs";
import path from "node:path";
import { computeConceptsCensus, CENSUS_SLUGS } from "../../src/lib/conceptsCensus.ts";
import { naturalCompare } from "../lib/natural-sort.mjs";

// Optional dependency: the GROUPS root check below wants the curated crossview
// taxonomy, but the census guard's test fixture materializes only this
// script's minimal layout (see src/server/check-concepts-census.test.ts) —
// resolve it dynamically and skip the check where it isn't present.
const GROUPS = await import("../../src/lib/crossviewShape.ts")
  .then((m) => m.GROUPS)
  .catch(() => {
    console.log("concepts-census: GROUPS root check skipped — crossviewShape.ts not importable in this layout");
    return null;
  });

const ROOT = path.resolve(import.meta.dir, "../..");
const BASELINE_PATH = path.join(ROOT, ".github/concepts-census-baseline.json");
const update = process.argv.includes("--update");

const docs = JSON.parse(fs.readFileSync(path.join(ROOT, "public/docs.json"), "utf8")).nodes;
const census = computeConceptsCensus(docs);

// ---------------------------------------------------------------------------
// Compare each census's members against the committed baseline
// ---------------------------------------------------------------------------
let baseline = null;
try {
  baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
} catch {
  console.warn("[concepts-census] no baseline found — run with --update to create it");
}

let drift = 0;
let resolved = 0;
for (const slug of CENSUS_SLUGS) {
  const result = census[slug];
  const members = [...result.members].sort((a, b) => naturalCompare(a.doc_no, b.doc_no));
  const prevMembers = baseline?.[slug]?.members ?? null;
  if (!prevMembers) continue; // no baseline entry yet for this slug — nothing to diff

  // Buckets are per-uuid SETS, not single values: a census may legitimately
  // place one doc in several buckets (normative-title-families does — a
  // derecognition-for-opsec-breach doc is genuinely both), and keying a bare
  // uuid→member map would then report those overlaps as bucket churn.
  const bucketsByUuid = (list) => {
    const m = new Map();
    for (const x of list) {
      if (!m.has(x.uuid)) m.set(x.uuid, { member: x, buckets: new Set() });
      m.get(x.uuid).buckets.add(x.bucket ?? null);
    }
    return m;
  };
  const prevByUuid = bucketsByUuid(prevMembers);
  const curByUuid = bucketsByUuid(members);
  const fmt = (s) => JSON.stringify([...s].sort());

  for (const [uuid, { member: m, buckets }] of curByUuid) {
    const prev = prevByUuid.get(uuid);
    if (!prev) {
      console.warn(`[drift] concepts-census: ${slug}: NEW member — ${m.doc_no} "${m.title}" (${m.uuid})`);
      drift++;
    } else if (fmt(prev.buckets) !== fmt(buckets)) {
      console.warn(
        `[drift] concepts-census: ${slug}: ${m.doc_no} "${m.title}" (${m.uuid}) changed bucket ` +
          `${fmt(prev.buckets)} → ${fmt(buckets)}`,
      );
      drift++;
    }
  }
  let slugResolved = 0;
  for (const prev of prevMembers) {
    if (!curByUuid.has(prev.uuid)) slugResolved++;
  }
  resolved += slugResolved;
  // A census emptying (or mostly emptying) is a regression reported as good
  // news: the title/content signature it keys on stopped matching, so the
  // docs are still there but invisible. Warn instead of counting it resolved.
  if (prevMembers.length && members.length === 0) {
    console.warn(
      `[drift] concepts-census: ${slug}: census emptied (${prevMembers.length} → 0 members) — ` +
        "its title/content signature in src/lib/conceptsCensus.ts no longer matches the atlas",
    );
    drift++;
  } else if (slugResolved >= 3 && slugResolved > prevMembers.length / 2) {
    console.warn(
      `[drift] concepts-census: ${slug}: ${slugResolved}/${prevMembers.length} members vanished at once — ` +
        "check the census signature before treating this as resolution",
    );
    drift++;
  }
}
if (resolved) console.log(`concepts-census: ${resolved} baseline member(s) resolved (no longer in any census)`);

// Crossview GROUPS roots: resolveRoots() in crossviewShape.ts warns about a
// vanished curated root UUID only in the BROWSER console — surface it here
// where atlas-update.yml and the atlas-healer capture stderr.
if (GROUPS) {
  const groupRootUuids = GROUPS.flatMap((g) =>
    "roots" in g ? g.roots : [g.complementOf, ...g.except],
  );
  for (const uuid of groupRootUuids) {
    if (!docs[uuid]) {
      console.warn(
        `[drift] concepts-census: crossview GROUPS root UUID ${uuid} no longer in the atlas — ` +
          "update src/lib/crossviewShape.ts GROUPS to the successor doc",
      );
      drift++;
    }
  }
}

// ---------------------------------------------------------------------------
// Stats + baseline write
// ---------------------------------------------------------------------------
console.log(
  `concepts-census: ${CENSUS_SLUGS.map((s) => `${s}=${census[s].counts.total}`).join(", ")}, ${drift} drift warning(s)`,
);

if (update) {
  const out = {};
  for (const slug of CENSUS_SLUGS) {
    const members = [...census[slug].members]
      .sort((a, b) => naturalCompare(a.doc_no, b.doc_no))
      .map((m) => (m.bucket !== undefined ? { uuid: m.uuid, doc_no: m.doc_no, title: m.title, bucket: m.bucket } : { uuid: m.uuid, doc_no: m.doc_no, title: m.title }));
    out[slug] = { counts: census[slug].counts, members };
  }
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(`concepts-census: baseline written → ${path.relative(ROOT, BASELINE_PATH)}`);
}
