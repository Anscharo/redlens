// Offline one-shot freeze runner for the pre-#117 (HTML) atlas history (plan §7.1).
// Composes the §3 converter + §4 passes against the REAL submodule, with the real
// diffCore.lineDiff, and writes the frozen artifact public/history-html-era.json.
// Runs under bun (imports the .ts diffCore). Rerun only as a deliberate, reviewed
// act — historical diffs must not silently change (plan §7.1).
//
//   bun scripts/aux/freeze-html-history.mjs            # write the artifact
//   bun scripts/aux/freeze-html-history.mjs --measure  # print stats, write nothing
//
// commit_seq is reconciled by SHA at load time (plan §7.1, decision 6); the
// artifact stores 7-char shas + a baked seq for reference only.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { loadHtmlAt } from "../lib/atlas-html.mjs";
import { seedFromMd, threadBackward, buildEvents } from "../lib/history-html-era.mjs";
import { isSynthetic, syntheticUuid } from "../lib/history-identity.mjs";
import { detectLineage } from "../lib/history-lineage.mjs";
import { classifyDiff } from "../lib/history-classify.mjs";
import { lineDiff } from "../../src/lib/diffCore.ts";

const ROOT = process.cwd();
const REPO = path.join(ROOT, "vendor/next-gen-atlas");
const OUT = path.join(ROOT, "public/history-html-era.json");
const HTML = "Sky Atlas/Sky Atlas.html", MD = "Sky Atlas/Sky Atlas.md";
const SEED_HTML = "7b43d159", MD117 = "22cc27b5";
const MEASURE = process.argv.includes("--measure");
// Content-recovery tier (plan §4.2 follow-up): recover bulk-rename continuations the
// structural-key tiers drop to death+birth. ON by default; `--no-recover` reverts.
const RECOVER = !process.argv.includes("--no-recover");
// `--decisions <file>` applies the human-confirmed curation choices (plan §10.4).
const DECISIONS_PATH = ((i) => (i >= 0 ? process.argv[i + 1] : null))(process.argv.indexOf("--decisions"));
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const git = (a) => execSync(`git -C "${REPO}" ${a}`, { maxBuffer: 1 << 30 }).toString();
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// #117 markdown monolith → nodes with real uuid4 + body prose (for the seed).
function parseMd117(blob) {
  const HRE = /^(#{1,6}) (\S+) - (.*?) \[([^\]]+)\]\s+<!-- UUID: ([0-9a-f-]{36}) -->/;
  const nodes = []; let cur = null;
  for (const line of blob.split("\n")) {
    const m = line.match(HRE);
    if (m) { if (cur) cur.content = norm(cur._b.join(" ")); cur = { uuid: m[5], doc_no: m[2], title: m[3].trim(), type: m[4], _b: [] }; nodes.push(cur); }
    else if (cur) cur._b.push(line);
  }
  if (cur) cur.content = norm(cur._b.join(" "));
  for (const n of nodes) delete n._b;
  return nodes;
}

const t0 = Date.now();
// canonical commit_seq over the FULL submodule log (oldest = 1), keyed by 7-char sha
const seqBySha = new Map();
git("log --reverse --format=%H").trim().split("\n").forEach((h, i) => h && seqBySha.set(h.slice(0, 7), i + 1));

// per-commit metadata for the HTML era (date + PR number from the subject)
const commitMeta = new Map();
for (const line of git(`log --format=%H%x09%cI%x09%s ${SEED_HTML} -- '${HTML}'`).trim().split("\n")) {
  const [full, date, ...rest] = line.split("\t");
  const subject = rest.join("\t");
  const pr = (subject.match(/\(#(\d+)\)/) || [])[1] || null;
  commitMeta.set(full.slice(0, 7), { date, pr: pr ? Number(pr) : null, subject });
}

const md = parseMd117(git(`show ${MD117}:'${MD}'`));
const shas = git(`log --reverse --format=%H ${SEED_HTML} -- '${HTML}'`).trim().split("\n");
const commits = shas.map((full) => {
  const sha = full.slice(0, 7);
  return { sha, seq: seqBySha.get(sha) ?? null, nodes: loadHtmlAt(full, REPO) };
});
console.error(`loaded ${commits.length} html commits + ${md.length} md docs in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// Resolve human-confirmed decisions (plan §10.4) into override maps the pipeline
// consumes. Decisions are content-addressed (`${sha8}:${md5(content)}`) so they bind
// to the same documents even across a renumber — we never key on doc_no. Seed
// decisions (newer = the #117 migration) override seedFromMd; the rest override the
// backward hops. Once recorded, the same decisions reproduce the same artifact.
let seedOverrides = null, hopOverrides = null, applied = null;
if (DECISIONS_PATH) {
  const file = JSON.parse(fs.readFileSync(DECISIONS_PATH, "utf8"));
  // md5(raw #117 body) → uuid, matching build-history-curation.mjs's content-address
  const rawUuid = new Map();
  { const HRE = /^(#{1,6}) (\S+) - (.*?) \[([^\]]+)\]\s+<!-- UUID: ([0-9a-f-]{36}) -->/;
    let cur = null, body = [];
    for (const line of git(`show ${MD117}:'${MD}'`).split("\n")) {
      const m = line.match(HRE);
      if (m) { if (cur) rawUuid.set(md5(body.join("\n").trim()), cur); cur = m[5]; body = []; }
      else if (cur) body.push(line);
    }
    if (cur) rawUuid.set(md5(body.join("\n").trim()), cur);
  }
  // content-address index over every html node (8-char sha, matching the curation file)
  const nodeIndex = new Map();
  shas.forEach((full, idx) => { const sha8 = full.slice(0, 8); for (const n of commits[idx].nodes) nodeIndex.set(`${sha8}:${n.contentHash}`, n); });

  seedOverrides = new Map(); hopOverrides = new Map();
  let unresolved = 0;
  for (const d of file.decisions || []) {
    const chosen = d.chosenKey === "none" ? null : nodeIndex.get(d.chosenKey);
    if (d.chosenKey !== "none" && !chosen) { unresolved++; continue; } // chosen doc not found this build
    if (d.newerSha === MD117) {               // seed decision: subject is an #117 md doc
      const mdUuid = rawUuid.get(String(d.subjectKey).split(":")[1]);
      if (!mdUuid) { unresolved++; continue; }
      seedOverrides.set(mdUuid, chosen);
    } else {                                   // backward-hop decision: subject is a newer html node
      const newer = nodeIndex.get(d.subjectKey);
      if (!newer) { unresolved++; continue; }
      hopOverrides.set(newer, chosen);
    }
  }
  applied = { total: (file.decisions || []).length, seed: seedOverrides.size, hop: hopOverrides.size, unresolved };
  console.error(`decisions: applied ${applied.seed} seed + ${applied.hop} hop, ${unresolved} unresolved (of ${applied.total})`);
}

const lastSha = commits[commits.length - 1].sha;
const seed = seedFromMd(md, commits[commits.length - 1].nodes, seedOverrides ? { overrides: seedOverrides } : {});
const thread = threadBackward(commits, { seed: seed.uuidByRow, recover: RECOVER, ...(hopOverrides ? { overrides: hopOverrides } : {}) });
const rawEvents = buildEvents(commits, { lineDiff });

// per-doc seam metadata (plan §4.1/§7): kept/split/merged/created + the
// extracted_from / merged_into pointers, keyed by uuid.
const docMeta = new Map();
for (const [uuid, s] of seed.seam) docMeta.set(uuid, seed.extractedFrom.has(uuid) ? { seam: s, extractedFrom: seed.extractedFrom.get(uuid) } : { seam: s });
for (const [row, successor] of seed.mergedInto) docMeta.set(syntheticUuid(row, lastSha), { seam: "merged", mergedInto: successor });

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

// map pass events → the eventToRow HistoryEvent shape (+ additive era/synthetic/seam)
const events = rawEvents.map((e) => {
  const meta = commitMeta.get(e.sha) || {};
  const ev = { docId: e.uuid, commitHash: e.sha, changeType: e.type, date: meta.date ?? null, pr: meta.pr ?? null, era: e.era };
  if (e.doc_no != null) ev.docNo = e.doc_no;
  if (e.title != null) ev.title = e.title;
  if (e.type === "moved") { ev.movedFrom = e.movedFrom; ev.movedTo = e.movedTo; ev.moveKind = e.moveKind; }
  if (e.diff) { ev.diff = e.diff; const k = classifyDiff(e.diff); if (k) ev.changeKind = k; }
  if (e.synthetic) ev.synthetic = true;
  // seam + lineage land on the doc's birth (added) event (additive fields)
  const dm = e.type === "added" && docMeta.get(e.uuid);
  if (dm) { ev.seam = dm.seam; if (dm.extractedFrom) ev.extractedFrom = dm.extractedFrom; if (dm.mergedInto) ev.mergedInto = dm.mergedInto; }
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
};
console.error("\n=== freeze summary ===");
console.error(JSON.stringify(summary, null, 2));

if (MEASURE) {
  console.error("\n--measure: artifact NOT written.");
} else {
  const artifact = {
    meta: { kind: "html-era-history", migrationCommit: MD117, lastHtmlCommit: SEED_HTML, ...summary },
    commits: commits.map((c) => ({ sha: c.sha, seq: c.seq, pr: commitMeta.get(c.sha)?.pr ?? null })),
    docMeta: Object.fromEntries(docMeta), // uuid → { seam, extractedFrom?, mergedInto? } (§4.1)
    events,
    decisions: thread.decisions,
  };
  fs.writeFileSync(OUT, JSON.stringify(artifact));
  console.error(`\nwrote ${path.relative(ROOT, OUT)}  (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
}
console.error(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
