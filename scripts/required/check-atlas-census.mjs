#!/usr/bin/env node
/**
 * Atlas coverage census — the generalization of the Active Data drift
 * detector to every doc.
 *
 * Reads public/docs.json + public/graph.json, computes which docs the graph
 * actually consumed ("covered"), fingerprints every doc by structural shape
 * (scripts/lib/census-fingerprint.mjs), and compares the per-fingerprint
 * uncovered counts against the committed baseline
 * (.github/atlas-census-baseline.json).
 *
 * Warnings (stderr, picked up by atlas-update.yml's drift-issue step):
 *   - a NEW signal fingerprint with uncovered docs — the atlas started
 *     encoding a structure no extraction pattern handles
 *   - an existing signal fingerprint whose uncovered count GREW
 *
 * "Covered" means any of:
 *   - doc is endpoint of a non-incidental edge (anything but parent_of /
 *     cites / mentions)
 *   - doc_no appears in some edge's source_doc_nos (prose provenance)
 *   - doc is an entity's defining doc, or its uuid/doc_no appears anywhere
 *     in an entity's meta (instance params carry [value, srcUuid, srcDocNo])
 *
 * Always exits 0 — like processes:check, it must never block a build.
 * `--update` rewrites the baseline (the atlas-update workflow does this in
 * the same commit as the submodule bump, mirroring snapshot auto-accept).
 */

import fs from "node:fs";
import path from "node:path";
import { fingerprint, isSignalFingerprint } from "../lib/census-fingerprint.mjs";
import { codeUnitCompare } from "../lib/natural-sort.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const BASELINE_PATH = path.join(ROOT, ".github/atlas-census-baseline.json");
const update = process.argv.includes("--update");

const docs = JSON.parse(fs.readFileSync(path.join(ROOT, "public/docs.json"), "utf8")).nodes;
const graph = JSON.parse(fs.readFileSync(path.join(ROOT, "public/graph.json"), "utf8"));

const docByDocNo = new Map(Object.values(docs).map((d) => [d.doc_no, d]));

// ---------------------------------------------------------------------------
// Covered set
// ---------------------------------------------------------------------------
const INCIDENTAL_EDGES = new Set(["parent_of", "cites", "mentions"]);
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const DOC_NO_RE = /^(?:A(?:\.\w+)+|NR-\d+)$/;

const covered = new Set(); // doc uuids

function coverString(s) {
  for (const m of s.match(UUID_RE) ?? []) covered.add(m);
  if (DOC_NO_RE.test(s)) {
    const d = docByDocNo.get(s);
    if (d) covered.add(d.id);
  }
}
function coverDeep(v) {
  if (typeof v === "string") coverString(v);
  else if (Array.isArray(v)) v.forEach(coverDeep);
  else if (v && typeof v === "object") Object.values(v).forEach(coverDeep);
}

for (const e of graph.edges) {
  if (!INCIDENTAL_EDGES.has(e.edge_type)) {
    if (e.from_type === "doc") covered.add(e.from_id);
    if (e.to_type === "doc") covered.add(e.to_id);
  }
  if (e.source_doc_nos) {
    try {
      coverDeep(JSON.parse(e.source_doc_nos));
    } catch {
      /* malformed provenance — ignore */
    }
  }
}
for (const ent of graph.entities) {
  if (ent.defining_doc_id) covered.add(ent.defining_doc_id);
  if (ent.meta) {
    try {
      coverDeep(JSON.parse(ent.meta));
    } catch {
      /* malformed meta — ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// Census: fingerprint → { total, uncovered, samples }
// ---------------------------------------------------------------------------
const census = new Map();
for (const d of Object.values(docs)) {
  const fp = fingerprint(d);
  const c = census.get(fp) ?? { total: 0, uncovered: 0, samples: [] };
  c.total++;
  if (!covered.has(d.id)) {
    c.uncovered++;
    c.samples.push(d.doc_no);
  }
  census.set(fp, c);
}
for (const c of census.values()) {
  c.samples = c.samples.sort().slice(0, 5);
}

// ---------------------------------------------------------------------------
// Compare against baseline → [drift] warnings for signal clusters
// ---------------------------------------------------------------------------
let baseline = {};
try {
  baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")).fingerprints ?? {};
} catch {
  console.warn("[census] no baseline found — run with --update to create it");
}

let drift = 0;
for (const [fp, c] of census) {
  if (c.uncovered === 0 || !isSignalFingerprint(fp)) continue;
  const prev = baseline[fp];
  if (!prev) {
    console.warn(
      `[drift] census: NEW uncovered structure cluster "${fp}" — ${c.uncovered} doc(s), e.g. ${c.samples.join(", ")}`,
    );
    drift++;
  } else if (c.uncovered > prev.uncovered) {
    console.warn(
      `[drift] census: cluster "${fp}" uncovered grew ${prev.uncovered} → ${c.uncovered}, e.g. ${c.samples.join(", ")}`,
    );
    drift++;
  }
}

// ---------------------------------------------------------------------------
// Stats + baseline write
// ---------------------------------------------------------------------------
const totals = [...census.values()].reduce(
  (a, c) => ({ docs: a.docs + c.total, uncovered: a.uncovered + c.uncovered }),
  { docs: 0, uncovered: 0 },
);
const signalUncovered = [...census].filter(
  ([fp, c]) => c.uncovered > 0 && isSignalFingerprint(fp),
);
console.log(
  `census: ${totals.docs} docs, ${census.size} fingerprints, ${totals.uncovered} uncovered ` +
    `(${signalUncovered.length} signal clusters with uncovered docs), ${drift} drift warning(s)`,
);

if (update) {
  const fingerprints = Object.fromEntries(
    [...census].sort(([a], [b]) => codeUnitCompare(a, b)),
  );
  fs.writeFileSync(BASELINE_PATH, JSON.stringify({ fingerprints }, null, 2) + "\n");
  console.log(`census: baseline written → ${path.relative(ROOT, BASELINE_PATH)}`);
}
