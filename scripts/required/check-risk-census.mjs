#!/usr/bin/env bun
/**
 * Risk Rules Assessment census — backlog drift detector for the Risk Rules
 * Assessment report (/reports/risk-rules).
 *
 * Recomputes the live candidate universe (src/lib/riskRules.ts) against
 * public/docs.json and buckets every candidate against the committed
 * public/risk-assessment.json, using the exact same freshness keying
 * scripts/aux/assess-risk.ts uses (taskKey + quoteHash + rubricVersion):
 *   fresh    — triaged in-scope + assessed, and the live text/rubric still
 *              matches what was rated
 *   rejected — triage settled this is out of scope or not an operative rule —
 *              deliberately excluded, not backlog
 *   backlog  — needs a `pnpm risk:assess` run + human review: never triaged,
 *              triage stale (atlas text changed since), never assessed, or
 *              assessed against stale text/rubric
 *
 * Warnings (stderr, picked up by atlas-update.yml's drift-issue step):
 *   - [drift] a candidate entered the backlog that isn't in the committed
 *     baseline (.github/risk-census-baseline.json) — i.e. the assessment
 *     artifact fell further behind the atlas since the baseline was last
 *     accepted.
 *
 * Always exits 0 — like the other census checks, it must never block a
 * build. `--update` rewrites the baseline (the atlas-update workflow does
 * this in the same commit as the submodule bump).
 *
 * Runs under bun (not node) so it can import enumerateRiskCandidates
 * straight from the TS source, same as assess-risk.ts.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { enumerateRiskCandidates } from "../../src/lib/riskRules.ts";
import { normalizeAssessedText } from "../../src/lib/oeaTasks.ts";
import { naturalCompare } from "../lib/natural-sort.mjs";

const ROOT = path.resolve(import.meta.dir, "../..");
const BASELINE_PATH = path.join(ROOT, ".github/risk-census-baseline.json");
const update = process.argv.includes("--update");

const docs = JSON.parse(fs.readFileSync(path.join(ROOT, "public/docs.json"), "utf8")).nodes;
const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, "public/risk-assessment.json"), "utf8"));

const hashOf = (quote) =>
  crypto.createHash("sha256").update(normalizeAssessedText(quote)).digest("hex").slice(0, 16);

const { candidates } = enumerateRiskCandidates({ docs, byParent: new Map(), docNoToId: new Map(), atlasCommit: null });
const triageByKey = new Map(artifact.triage.map((t) => [t.taskKey, t]));
const assessByKey = new Map(artifact.assessments.map((a) => [a.taskKey, a]));

// ---------------------------------------------------------------------------
// Census
// ---------------------------------------------------------------------------
const counts = { total: candidates.length, fresh: 0, rejected: 0, backlog: 0 };
const backlog = [];

for (const c of candidates) {
  const quoteHash = hashOf(c.quote);
  const triage = triageByKey.get(c.taskKey);
  const triageFresh = !!triage && triage.quoteHash === quoteHash;
  if (!triageFresh) { counts.backlog++; backlog.push(c); continue; } // untriaged, or triage stale
  if (!triage.inScope || !triage.isRule) { counts.rejected++; continue; } // deliberately out
  const entry = assessByKey.get(c.taskKey);
  const assessFresh = !!entry && entry.quoteHash === quoteHash && entry.rubricVersion === artifact.rubricVersion;
  if (assessFresh) counts.fresh++;
  else { counts.backlog++; backlog.push(c); } // unassessed, or assessed against stale text/rubric
}
backlog.sort((a, b) => naturalCompare(a.docNo, b.docNo));

// ---------------------------------------------------------------------------
// Compare against baseline → [drift] warnings for new backlog rows
// ---------------------------------------------------------------------------
let baselineKeys = null;
try {
  baselineKeys = new Set(JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")).backlog.map((r) => r.taskKey));
} catch {
  console.warn("[risk-census] no baseline found — run with --update to create it");
}

let drift = 0;
if (baselineKeys) {
  for (const c of backlog) {
    if (!baselineKeys.has(c.taskKey)) {
      console.warn(
        `[drift] risk-census: NEW backlog row — ${c.docNo} "${c.title}" (${c.uuid}). ` +
          `Run \`pnpm risk:assess\`, review the rating, then --update the baseline.`,
      );
      drift++;
    }
  }
  const resolved = [...baselineKeys].filter((k) => !backlog.some((c) => c.taskKey === k)).length;
  if (resolved) console.log(`risk-census: ${resolved} baseline backlog row(s) resolved (now assessed or gone)`);
}

console.log(
  `risk-census: ${counts.total} candidates — ${counts.fresh} fresh, ${counts.rejected} rejected, ` +
    `${counts.backlog} backlog, ${drift} drift warning(s)`,
);

if (update) {
  fs.writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify(
      { backlog: backlog.map((c) => ({ taskKey: c.taskKey, uuid: c.uuid, docNo: c.docNo, title: c.title })) },
      null,
      2,
    )}\n`,
  );
  console.log(`risk-census: baseline written → ${path.relative(ROOT, BASELINE_PATH)}`);
}
