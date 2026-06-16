#!/usr/bin/env node
/**
 * Apply a triage decisions file to public/processes.json + public/processes-ignored.json.
 *
 * Separates the analytical step (the processes-triage skill writes decisions)
 * from the deterministic mutation step (this script applies them). Lets the
 * skill batch its verdicts in one place and keeps file-write logic reviewable.
 *
 * Decisions file format — an array of objects:
 *
 *   [
 *     { "uuid": "...", "verdict": "add",
 *       "category": "Settlement & Financial",
 *       "shape": "child" | "inline",
 *       "status": "active" | "deferred-stub",
 *       "stepCount": <actual integer count> },         // optional — overrides heuristic; NOT a placeholder
 *     { "uuid": "...", "verdict": "ignore",
 *       "reason": "schema template | category container | role definition | requirement spec | other (...)" }
 *   ]
 *
 * Usage:
 *   node scripts/aux/processes-apply-decisions.mjs <decisions.json>
 *   pnpm processes:apply-decisions .cache/processes-decisions.json
 *
 * The script:
 *   1. Validates every decision has a uuid that exists in public/docs.json
 *      (warns on UUIDs not in current audit's new_candidates list — these are
 *      usually manual additions).
 *   2. Appends "add" entries to public/processes.json, "ignore" entries to
 *      public/processes-ignored.json.
 *   3. Sorts processes.json by category, then doc_no from current docs.json.
 *   4. Prints a per-category summary.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const PROCESSES = path.join(ROOT, "public/processes.json");
const IGNORED = path.join(ROOT, "public/processes-ignored.json");
const DOCS = path.join(ROOT, "public/docs.json");
const AUDIT = path.join(ROOT, ".cache/processes-audit.json");

const decisionsPath = process.argv[2];
if (!decisionsPath) {
  console.error("Usage: processes-apply-decisions.mjs <decisions.json>");
  process.exit(1);
}

const decisions = JSON.parse(fs.readFileSync(decisionsPath, "utf8"));
const docs = JSON.parse(fs.readFileSync(DOCS, "utf8")).nodes;
const processes = JSON.parse(fs.readFileSync(PROCESSES, "utf8"));
const ignored = JSON.parse(fs.readFileSync(IGNORED, "utf8"));

const audit = fs.existsSync(AUDIT) ? JSON.parse(fs.readFileSync(AUDIT, "utf8")) : null;

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

if (!Array.isArray(decisions)) {
  console.error("Decisions file must be a JSON array.");
  process.exit(1);
}

const seen = new Set();
for (const d of decisions) {
  if (!d.uuid || !docs[d.uuid]) {
    console.error(`Unknown uuid: ${d.uuid}`);
    process.exit(1);
  }
  if (seen.has(d.uuid)) {
    console.error(`Duplicate decision for ${d.uuid}`);
    process.exit(1);
  }
  seen.add(d.uuid);
  if (d.verdict === "add") {
    for (const f of ["category", "shape", "status"]) {
      if (!d[f]) {
        console.error(`Add decision for ${d.uuid} missing ${f}`);
        process.exit(1);
      }
    }
    if (d.stepCount !== undefined && (!Number.isInteger(d.stepCount) || d.stepCount < 1)) {
      console.error(`Add decision for ${d.uuid}: stepCount must be a positive integer`);
      process.exit(1);
    }
  } else if (d.verdict === "ignore") {
    if (!d.reason) {
      console.error(`Ignore decision for ${d.uuid} missing reason`);
      process.exit(1);
    }
  } else {
    console.error(`Unknown verdict "${d.verdict}" for ${d.uuid}`);
    process.exit(1);
  }
}

// Audit cross-check — warn (don't fail) on decisions for UUIDs that weren't in
// the candidate list. This catches stale decisions but allows manual additions.
if (audit) {
  const auditUuids = new Set(audit.new_candidates.map((c) => c.uuid));
  const orphans = [...seen].filter((u) => !auditUuids.has(u));
  if (orphans.length) {
    console.warn(`Note: ${orphans.length} decision(s) for UUIDs not in current audit (manual additions?)`);
  }
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

const processesByUuid = new Map(processes.map((p) => [p.uuid, p]));
const ignoredByUuid = new Map(ignored.map((i) => [i.uuid, i]));

const summary = { add: {}, ignore: {} };
let added = 0;
let ignoredCount = 0;
let skipped = 0;

for (const d of decisions) {
  if (d.verdict === "add") {
    if (processesByUuid.has(d.uuid)) {
      skipped++;
      continue;
    }
    processes.push({
      uuid: d.uuid,
      category: d.category,
      shape: d.shape,
      status: d.status,
      ...(d.stepCount !== undefined ? { stepCount: d.stepCount } : {}),
    });
    summary.add[d.category] = (summary.add[d.category] ?? 0) + 1;
    added++;
  } else {
    if (ignoredByUuid.has(d.uuid)) {
      skipped++;
      continue;
    }
    ignored.push({
      uuid: d.uuid,
      reason: d.reason,
    });
    summary.ignore[d.reason] = (summary.ignore[d.reason] ?? 0) + 1;
    ignoredCount++;
  }
}

// Stable sort: category, then doc_no from current docs (numeric).
processes.sort((a, b) => {
  if (a.category !== b.category) return (a.category ?? "").localeCompare(b.category ?? "");
  const docNoA = docs[a.uuid]?.doc_no ?? "";
  const docNoB = docs[b.uuid]?.doc_no ?? "";
  return docNoA.localeCompare(docNoB, undefined, { numeric: true });
});

// Sort ignored by uuid for stable diffs.
ignored.sort((a, b) => a.uuid.localeCompare(b.uuid));

fs.writeFileSync(PROCESSES, JSON.stringify(processes, null, 2) + "\n");
fs.writeFileSync(IGNORED, JSON.stringify(ignored, null, 2) + "\n");

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log(`Applied: +${added} processes, +${ignoredCount} ignored, ${skipped} skipped (already present)`);
if (added) {
  console.log("\nAdds by category:");
  for (const [cat, n] of Object.entries(summary.add).sort()) {
    console.log(`  ${n.toString().padStart(3)}  ${cat}`);
  }
}
if (ignoredCount) {
  console.log("\nIgnores by reason:");
  for (const [reason, n] of Object.entries(summary.ignore).sort()) {
    console.log(`  ${n.toString().padStart(3)}  ${reason}`);
  }
}
