// MEASURE intra-era split / merge lineage (prototype B, plan §4.1) before wiring it into
// the freeze. The reverse thread marks a doc with no predecessor as a "birth" and a doc
// with no successor as a "death" — but some births are really EXTRACTIONS (the new doc's
// prose was carved out of an older parent that persists = a split) and some deaths are
// really MERGES (the gone doc's prose was absorbed into a newer successor). This finds
// those with the ported relocationTarget / findContainer (ordered, distinctive, unique,
// proper-container guards) at EVERY HTML hop — today only the #117 seam gets this (matchNodes
// tier-4 containment). Offline; writes nothing (a measurement, like the audit + trace).
//
//   bun scripts/aux/measure-lineage.mjs               # same-section search (fast, local)
//   bun scripts/aux/measure-lineage.mjs --any-section # widen the container search

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { loadHtmlAt } from "../lib/atlas-html.mjs";
import { matchNodes } from "../lib/history-identity.mjs";
import { findContainer } from "../lib/ordered-containment.mjs";

const ROOT = process.cwd();
const REPO = path.join(ROOT, "vendor/next-gen-atlas");
const LAST_HTML_SHA = "7b43d159";
const HTML = "Sky Atlas/Sky Atlas.html";
const ANY_SECTION = process.argv.includes("--any-section");
const git = (a) => execSync(`git -C "${REPO}" ${a}`, { maxBuffer: 1 << 30 }).toString();
const t0 = Date.now();
const log = (m) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

log("loading HTML commits (turndown — slow)…");
const shas = git(`log --reverse --format=%H ${LAST_HTML_SHA} -- '${HTML}'`).trim().split("\n");
const meta = new Map(); // sha8 -> pr
for (const line of git(`log --format=%H%x09%s ${LAST_HTML_SHA} -- '${HTML}'`).trim().split("\n")) {
  const [full, ...rest] = line.split("\t");
  meta.set(full.slice(0, 8), (rest.join("\t").match(/\(#(\d+)\)/) || [])[1] || null);
}
const commits = shas.map((full, i) => {
  if (i % 20 === 0) log(`  …${i}/${shas.length}`);
  return { sha: full.slice(0, 8), nodes: loadHtmlAt(full, REPO) };
});

// curation queue (for the overlap read): which split children are already a human case?
const CURATION = path.join(ROOT, "public/history-curation.json");
const caseKind = new Map(); // `${sha}:${contentHash}` -> kind
if (fs.existsSync(CURATION)) for (const c of JSON.parse(fs.readFileSync(CURATION, "utf8")).cases || []) caseKind.set(c.key, c.kind);

const inSection = (node, pool) => (ANY_SECTION ? pool : pool.filter((p) => p.section === node.section));
const splits = [], merges = [];
let births = 0, deaths = 0;

for (let i = 1; i < commits.length; i++) {
  const older = commits[i - 1], newer = commits[i];
  const { olderUnmatched, newerUnmatched } = matchNodes(older.nodes, newer.nodes);
  births += newerUnmatched.length;
  deaths += olderUnmatched.length;
  for (const child of newerUnmatched) {
    const parent = findContainer(child.content, inSection(child, older.nodes));
    if (parent && parent !== child) splits.push({ sha: newer.sha, pr: meta.get(newer.sha), child, parent });
  }
  for (const gone of olderUnmatched) {
    const succ = findContainer(gone.content, inSection(gone, newer.nodes));
    if (succ && succ !== gone) merges.push({ sha: newer.sha, pr: meta.get(newer.sha), gone, succ });
  }
  if (i % 20 === 0) log(`  hop ${i}/${commits.length - 1}: splits ${splits.length}, merges ${merges.length}`);
}

const key = (sha, n) => `${sha}:${n.contentHash}`;
const ntitle = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
// a same-title "split" is more likely a CONTINUATION the matcher missed (false birth) than a
// genuine extraction — a different (matcher-recall) signal. Different titles = a true carve-out.
const sameTitleSplits = splits.filter((s) => ntitle(s.child.title) === ntitle(s.parent.title));
const trueExtractions = splits.filter((s) => ntitle(s.child.title) !== ntitle(s.parent.title));
const genesisSha = commits[1]?.sha;
const splitInQueue = splits.filter((s) => caseKind.has(key(s.sha, s.child)));
const byKind = (list) => list.reduce((m, s) => ((m[caseKind.get(key(s.sha, s.child))] = (m[caseKind.get(key(s.sha, s.child))] || 0) + 1), m), {});
const byCommit = (list) => Object.entries(list.reduce((m, s) => ((m[`${s.sha}${s.pr ? ` #${s.pr}` : ""}`] = (m[`${s.sha}${s.pr ? ` #${s.pr}` : ""}`] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 8);

console.error(`\n=== intra-era split / merge lineage  (${ANY_SECTION ? "any-section" : "same-section"} search) ===`);
console.error(JSON.stringify({
  htmlHops: commits.length - 1, births, deaths,
  splitsDetected: splits.length, mergesDetected: merges.length,
  trueExtractions: trueExtractions.length, // different titles → genuine carve-out (lineage)
  sameTitleSplits: sameTitleSplits.length, // same title → likely a CONTINUATION the matcher missed
  splitsAtGenesisCommit: splits.filter((s) => s.sha === genesisSha).length,
  splitsExcludingGenesis: splits.filter((s) => s.sha !== genesisSha).length,
  splitsAlreadyInCurationQueue: splitInQueue.length, splitQueueByKind: byKind(splitInQueue),
  topSplitCommits: byCommit(splits), topMergeCommits: byCommit(merges),
}, null, 2));
console.error("\n--- sample TRUE extractions (child ⟵ different-titled parent) ---");
for (const s of trueExtractions.slice(0, 12)) console.error(`  ${s.sha}${s.pr ? ` #${s.pr}` : ""}  "${(s.child.title || "").slice(0, 38)}"  ⟵  "${(s.parent.title || "").slice(0, 38)}"`);
console.error("\n--- sample merges (gone  ⟶merged into⟶  successor) ---");
for (const m of merges.slice(0, 10)) console.error(`  ${m.sha}${m.pr ? ` #${m.pr}` : ""}  "${(m.gone.title || "").slice(0, 38)}"  ⟶  "${(m.succ.title || "").slice(0, 38)}"`);
log("done");
