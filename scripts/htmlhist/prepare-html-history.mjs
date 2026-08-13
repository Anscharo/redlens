// Offline one-shot freeze runner for the pre-#117 (HTML) atlas history (plan §7.1).
// Composes the §3 converter + §4 passes against the REAL submodule, with the real
// diffCore.lineDiff, and writes the frozen artifact public/history-html-era.json.
// Runs under bun (imports the .ts diffCore). Rerun only as a deliberate, reviewed
// act — historical diffs must not silently change (plan §7.1).
//
//   bun scripts/htmlhist/prepare-html-history.mjs            # write the artifact
//   bun scripts/htmlhist/prepare-html-history.mjs --measure  # print stats, write nothing
//
// commit_seq is reconciled by SHA at load time (plan §7.1, decision 6); the
// artifact stores 7-char shas + a baked seq for reference only.

import fs from "node:fs";
import path from "node:path";
import { buildEvents } from "./history-html-era.mjs";
import { isSynthetic, syntheticUuid } from "../lib/history-identity.mjs";
import { detectLineage } from "./history-lineage.mjs";
import { classifyDiff } from "../lib/history-classify.mjs";
import { lineDiff } from "../../src/lib/diffCore.ts";
import { threadHtmlEra, SEED_HTML, MD117 } from "../lib/run-thread.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/history-html-era.json");
const MEASURE = process.argv.includes("--measure");
// Content-recovery tier (plan §4.2 follow-up): recover bulk-rename continuations the
// structural-key tiers drop to death+birth. ON by default; `--no-recover` reverts.
const RECOVER = !process.argv.includes("--no-recover");
const DIFF = !process.argv.includes("--no-diff"); // tier-1.7 changed-lines threading (history-diff.mjs)
// `--decisions [file]` applies the human-confirmed curation choices (plan §10.4). With no
// path (the bare `pnpm htmlhist:apply`), it defaults to the COMMITTED decisions file so the
// applied freeze reproduces from git on any checkout. `--decisions` absent = plain prepare.
const DEFAULT_DECISIONS = path.join(ROOT, "public/history-decisions.json");
const DECISIONS_PATH = (() => {
  const i = process.argv.indexOf("--decisions");
  if (i < 0) return null; // no curation overrides → plain auto-threaded freeze
  const next = process.argv[i + 1];
  if (next && !next.startsWith("--")) return next; // explicit path
  return fs.existsSync(DEFAULT_DECISIONS) ? DEFAULT_DECISIONS : null; // committed default
})();

const t0 = Date.now();
if (DECISIONS_PATH) console.error(`decisions: applying ${path.relative(ROOT, DECISIONS_PATH)}`);
// commits/threading extracted to run-thread.mjs (shared with scripts/prehist/genesis-bridge.mjs,
// which needs the SAME real root-commit uuid assignment — not a re-derivation from this artifact).
const { commits, commitMeta, seed, thread, methodPins, splitOf, applied, lastSha } = threadHtmlEra({
  decisionsPath: DECISIONS_PATH, recover: RECOVER, diff: DIFF,
});
console.error(`loaded ${commits.length} html commits in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (applied) console.error(`decisions: applied ${applied.seed} seed + ${applied.hop} hop, ${applied.unresolved} unresolved (of ${applied.total})`);
if (splitOf.size) console.error(`decisions: ${splitOf.size} split copies pointed extracted_from their #117 source`);
const rawEvents = buildEvents(commits, { lineDiff });

// resolve the ai/human method pins to `${uuid}:${sha}` now that threading assigned uuids.
// hop decisions land on the change-event at the decided (newer) commit; seed (cross-format)
// decisions land on the doc's last-HTML event (the boundary occurrence).
const methodByDocCommit = new Map();
for (const p of methodPins) {
  if (p.kind === "hop") { if (p.newer.uuid) methodByDocCommit.set(`${p.newer.uuid}:${p.newerSha}`, p.method); }
  else methodByDocCommit.set(`${p.mdUuid}:${lastSha}`, p.method);
}

// per-doc seam metadata (plan §4.1/§7): kept/split/merged/untraced/created + the
// extracted_from / merged_into pointers, keyed by uuid. `seamTier: "positional"` marks
// the docs threaded by tier S2 (seed-positional.mjs) — matched on title + order between
// two anchors rather than on body content, because their bodies are too short to shingle.
const docMeta = new Map();
for (const [uuid, s] of seed.seam) {
  const m = { seam: s };
  if (seed.extractedFrom.has(uuid)) m.extractedFrom = seed.extractedFrom.get(uuid);
  if (seed.positionalUuids.has(uuid)) m.seamTier = "positional";
  docMeta.set(uuid, m);
}
for (const [row, successor] of seed.mergedInto) docMeta.set(syntheticUuid(row, lastSha), { seam: "merged", mergedInto: successor });
// duplication-split copies (from the decisions): mark seam "split" + point at the #117 source.
for (const [splitUuid, sourceUuid] of splitOf) docMeta.set(splitUuid, { seam: "split", extractedFrom: sourceUuid });

// intra-era split/merge lineage (plan §4.1, prototype B): generalise the seam's
// extracted_from / merged_into to every HTML hop. Runs after threadBackward (nodes carry
// uuids); deterministic; ADDITIVE — never overwrites a seed-recorded relationship. The
// findContainer scan is the slow part, so `--no-lineage` skips it.
let lineageStats = null;
if (!process.argv.includes("--no-lineage")) {
  const lineage = detectLineage(commits, { recover: RECOVER });
  for (const [childUuid, parentUuid] of lineage.extractedFrom) {
    const dm = docMeta.get(childUuid) || {};
    if (!dm.extractedFrom) { dm.extractedFrom = parentUuid; dm.seam = dm.seam || "split"; docMeta.set(childUuid, dm); }
  }
  for (const [goneUuid, succUuid] of lineage.mergedInto) {
    const dm = docMeta.get(goneUuid) || {};
    if (!dm.mergedInto) { dm.mergedInto = succUuid; dm.seam = dm.seam || "merged"; docMeta.set(goneUuid, dm); }
  }
  lineageStats = { extractedFrom: lineage.extractedFrom.size, mergedInto: lineage.mergedInto.size };
  console.error(`intra-era lineage: ${lineageStats.extractedFrom} extracted_from + ${lineageStats.mergedInto} merged_into`);
}

// Re-introductions (plan §4.1 extension): docs whose #117 migration REVIVED a name the live HTML had
// ALREADY retired (e.g. "Launch Agent 2" → "Keel" at PR #66, revived at #117, re-fixed at #172). Their
// true predecessor lives under the NEW name and is degenerate among identical-body siblings, so the
// seed can't thread them and they'd ship as a bare seam:"created" ("introduced here"). This committed,
// hand-authored ledger (git-history forensics — see scripts/htmlhist/HISTORY.md) re-tags each listed uuid
// seam:"reintroduced" and attaches a `reintroducedFrom` backlink (retirement commit + true predecessor
// + canonical name), so the reconstruction records "revived, not born". ADDITIVE; only the listed uuids.
let reintroStats = null;
try {
  const ledger = JSON.parse(fs.readFileSync(path.join(ROOT, "public/history-reintroductions.json"), "utf8"));
  let n = 0;
  for (const e of ledger.entries || []) {
    if (!e.uuid) continue;
    const dm = docMeta.get(e.uuid) || {};
    dm.seam = "reintroduced";
    dm.reintroducedFrom = {
      canonicalName: e.canonicalName, revivedName: e.revivedName, predecessorKey: e.predecessorKey,
      renamedAwayAt: e.renamedAwayAt, reintroducedAt: e.reintroducedAt, refixedAt: e.refixedAt,
    };
    docMeta.set(e.uuid, dm);
    n++;
  }
  reintroStats = n;
  if (n) console.error(`re-introductions: ${n} doc(s) re-tagged seam:"reintroduced" from public/history-reintroductions.json`);
} catch (err) {
  if (err.code !== "ENOENT") console.error(`re-introductions ledger skipped: ${err.message}`);
}

// map pass events → the eventToRow HistoryEvent shape (+ additive era/synthetic/seam)
const events = rawEvents.map((e) => {
  const meta = commitMeta.get(e.sha) || {};
  const ev = { docId: e.uuid, commitHash: e.sha, changeType: e.type, date: meta.date ?? null, pr: meta.pr ?? null, era: e.era };
  if (e.doc_no != null) ev.docNo = e.doc_no;
  if (e.title != null) ev.title = e.title;
  if (e.type === "moved") { ev.movedFrom = e.movedFrom; ev.movedTo = e.movedTo; ev.moveKind = e.moveKind; }
  if (e.diff) { ev.diff = e.diff; const k = classifyDiff(e.diff); if (k) ev.changeKind = k; }
  if (e.synthetic) ev.synthetic = true;
  // per-change provenance: only ai/human links are tagged; everything else is deterministic.
  const method = methodByDocCommit.get(`${e.uuid}:${e.sha}`);
  if (method) ev.method = method;
  // seam + lineage land on the doc's birth (added) event (additive fields)
  const dm = e.type === "added" && docMeta.get(e.uuid);
  if (dm) { ev.seam = dm.seam; if (dm.extractedFrom) ev.extractedFrom = dm.extractedFrom; if (dm.mergedInto) ev.mergedInto = dm.mergedInto; if (dm.reintroducedFrom) ev.reintroducedFrom = dm.reintroducedFrom; }
  return ev;
});

const byType = {};
for (const e of events) byType[e.changeType] = (byType[e.changeType] || 0) + 1;
const seamCounts = {};
for (const m of docMeta.values()) seamCounts[m.seam] = (seamCounts[m.seam] || 0) + 1;
const distinct = new Set(events.map((e) => e.docId));
const synthCount = [...distinct].filter(isSynthetic).length;

const summary = {
  htmlCommits: commits.length,
  seed: seed.stats,
  seam: seamCounts,
  decisions: thread.decisions.length,
  syntheticTombstones: thread.synthetics.length,
  distinctUuids: distinct.size,
  realUuids: distinct.size - synthCount,
  events: events.length,
  eventsByType: byType,
  prCoverage: `${[...commitMeta.values()].filter((c) => c.pr).length}/${commitMeta.size}`,
  appliedDecisions: applied, // null unless --decisions was passed (plan §10.4 provenance)
  intraEraLineage: lineageStats, // null with --no-lineage (plan §4.1, prototype B)
  reintroductions: reintroStats, // null if the ledger is absent (public/history-reintroductions.json)
};
console.error("\n=== freeze summary ===");
console.error(JSON.stringify(summary, null, 2));

if (MEASURE) {
  console.error("\n--measure: artifact NOT written.");
} else {
  const artifact = {
    meta: { kind: "html-era-history", migrationCommit: MD117, lastHtmlCommit: SEED_HTML, ...summary },
    commits: commits.map((c) => ({ sha: c.sha, seq: c.seq, pr: commitMeta.get(c.sha)?.pr ?? null })),
    docMeta: Object.fromEntries(docMeta), // uuid → { seam, extractedFrom?, mergedInto?, reintroducedFrom? } (§4.1)
    events,
    decisions: thread.decisions,
  };
  fs.writeFileSync(OUT, JSON.stringify(artifact));
  console.error(`\nwrote ${path.relative(ROOT, OUT)}  (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
}
console.error(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
