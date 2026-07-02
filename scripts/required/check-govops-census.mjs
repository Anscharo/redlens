#!/usr/bin/env node
/**
 * GovOps coverage census — recall drift detector for the GovOps
 * Responsibilities report (/reports/gov-ops-responsibilities).
 *
 * Reads public/docs.json + public/relations.json, takes every doc that
 * mentions GovOps (or a GovOps org by name) and buckets it:
 *   row      — backs a report row (definition, assignment, duty_for target,
 *              GovOps-declared responsible_party_for / process-step target)
 *   excluded — deliberately out, by a named mechanical rule (see RULES below)
 *   residue  — mentions GovOps, produces no row, matches no rule: the watch
 *              list. A NEW residue doc after an atlas bump means the atlas
 *              started phrasing a GovOps duty in a way graph-duties.mjs does
 *              not recognize — exactly the silent-recall-drift this catches.
 *
 * Warnings (stderr, picked up by atlas-update.yml's drift-issue step):
 *   - [drift] a doc entered the residue that isn't in the committed baseline
 *     (.github/govops-census-baseline.json)
 *
 * Always exits 0 — like census:check, it must never block a build.
 * `--update` rewrites the baseline (the atlas-update workflow does this in
 * the same commit as the submodule bump, mirroring snapshot auto-accept).
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const BASELINE_PATH = path.join(ROOT, ".github/govops-census-baseline.json");
const update = process.argv.includes("--update");

const docs = JSON.parse(fs.readFileSync(path.join(ROOT, "public/docs.json"), "utf8")).nodes;
const relations = JSON.parse(fs.readFileSync(path.join(ROOT, "public/relations.json"), "utf8"));

const docByDocNo = new Map(Object.values(docs).map((d) => [d.doc_no, d]));
const entityById = new Map(relations.entities.map((e) => [e.id, e]));

// Curated Preamble definition docs — keep in sync with DEFINITION_UUIDS in
// src/lib/govopsResponsibilities.ts.
const DEFINITION_UUIDS = [
  "1e73ee4b-823d-406a-af54-223b43bc8e42", // A.0.1.1.47 — GovOps
  "80c7e2e1-a2af-47dd-80c7-aee6823cca91", // A.0.1.1.48 — Operational Executor GovOps
  "e512e890-629f-450f-a14d-a3ea06a369c0", // A.0.1.1.49 — Core Council GovOps
];

const ANY_GOVOPS_RE = /gov[\s-]*ops/i;
const GOV_EDGES = new Set(["operational_govops_for", "core_govops_for"]);

// GovOps org names, resolved from the graph — never hardcoded.
const orgNames = [
  ...new Set(
    relations.edges
      .filter((e) => GOV_EDGES.has(e.e))
      .map((e) => entityById.get(e.f)?.name)
      .filter(Boolean),
  ),
];
const orgRe = orgNames.length
  ? new RegExp(`\\b(?:${orgNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i")
  : /$^/;

// ---------------------------------------------------------------------------
// Row set — every doc that backs a report row
// ---------------------------------------------------------------------------
const meta = (e) => {
  try {
    return JSON.parse(e.m ?? "null") ?? {};
  } catch {
    return {};
  }
};

const rowDocs = new Set(DEFINITION_UUIDS);
for (const e of relations.edges) {
  if (GOV_EDGES.has(e.e)) {
    const d = e.s?.[0] ? docByDocNo.get(e.s[0]) : null; // assignment doc
    if (d) rowDocs.add(d.id);
  } else if (e.e === "duty_for" && e.tt === "doc" && ANY_GOVOPS_RE.test(meta(e).role_declared ?? "")) {
    rowDocs.add(e.t); // duty_for spans all acting roles — count only GovOps-declared
  } else if (
    (e.e === "responsible_party_for" || e.e === "process_step_responsible_party_for") &&
    e.tt === "doc" &&
    ANY_GOVOPS_RE.test(meta(e).role_declared ?? "")
  ) {
    rowDocs.add(e.t);
  }
}

// Non-GovOps RP holders: a doc with an RP/process-step edge whose declaration
// names someone else mentions GovOps only incidentally.
const otherRpDocs = new Set(
  relations.edges
    .filter(
      (e) =>
        (e.e === "responsible_party_for" || e.e === "process_step_responsible_party_for") &&
        e.tt === "doc" &&
        !rowDocs.has(e.t),
    )
    .map((e) => e.t),
);

// ---------------------------------------------------------------------------
// Exclusion rules — deliberately out, each nameable in the report's terms
// ---------------------------------------------------------------------------
const RULES = [
  // Preamble holds the curated definitions; other A.0 mentions are definitional.
  ["preamble", (d) => d.doc_no.startsWith("A.0.")], // fragile: doc_no prefix
  // The doc's own Responsible Party resolved to a non-GovOps actor.
  ["other-rp", (d) => otherRpDocs.has(d.id)],
  // GovOps appears only as the "GovOps meeting" / "govops channel" venue name.
  [
    "venue-only",
    (d) => {
      const stripped = `${d.title}\n${d.content}`.replace(
        /gov[\s-]*ops[\s-]+(?:meeting|channel)s?\b/gi,
        "",
      );
      return !ANY_GOVOPS_RE.test(stripped) && !orgRe.test(stripped);
    },
  ],
];

// ---------------------------------------------------------------------------
// Census
// ---------------------------------------------------------------------------
const counts = { total: 0, row: 0, residue: 0 };
for (const [rule] of RULES) counts[`excluded:${rule}`] = 0;
const residue = [];

for (const d of Object.values(docs)) {
  const text = `${d.title}\n${d.content}`;
  if (!ANY_GOVOPS_RE.test(text) && !orgRe.test(text)) continue;
  counts.total++;
  if (rowDocs.has(d.id)) {
    counts.row++;
    continue;
  }
  const rule = RULES.find(([, test]) => test(d));
  if (rule) {
    counts[`excluded:${rule[0]}`]++;
    continue;
  }
  counts.residue++;
  residue.push({ uuid: d.id, doc_no: d.doc_no, title: d.title });
}
residue.sort((a, b) => a.doc_no.localeCompare(b.doc_no, undefined, { numeric: true }));

// ---------------------------------------------------------------------------
// Compare against baseline → [drift] warnings for new residue docs
// ---------------------------------------------------------------------------
let baselineUuids = null;
try {
  baselineUuids = new Set(JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")).residue.map((r) => r.uuid));
} catch {
  console.warn("[govops-census] no baseline found — run with --update to create it");
}

let drift = 0;
if (baselineUuids) {
  for (const r of residue) {
    if (!baselineUuids.has(r.uuid)) {
      console.warn(
        `[drift] govops-census: NEW unmatched GovOps mention — ${r.doc_no} "${r.title}" (${r.uuid}). ` +
          `If it assigns GovOps a duty, extend scripts/lib/graph-duties.mjs; otherwise --update the baseline.`,
      );
      drift++;
    }
  }
  const resolved = [...baselineUuids].filter((u) => !residue.some((r) => r.uuid === u)).length;
  if (resolved) console.log(`govops-census: ${resolved} baseline residue doc(s) resolved (now covered or gone)`);
}

console.log(
  `govops-census: ${counts.total} GovOps-mentioning docs — ${counts.row} row, ` +
    RULES.map(([r]) => `${counts[`excluded:${r}`]} ${r}`).join(", ") +
    `, ${counts.residue} residue, ${drift} drift warning(s)`,
);

if (update) {
  fs.writeFileSync(BASELINE_PATH, JSON.stringify({ residue }, null, 2) + "\n");
  console.log(`govops-census: baseline written → ${path.relative(ROOT, BASELINE_PATH)}`);
}
