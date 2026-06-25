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
import { execSync } from "node:child_process";
import { loadHtmlAt } from "../lib/atlas-html.mjs";
import { seedFromMd, threadBackward, buildEvents } from "../lib/history-html-era.mjs";
import { isSynthetic } from "../lib/history-identity.mjs";
import { classifyDiff } from "../lib/history-classify.mjs";
import { lineDiff } from "../../src/lib/diffCore.ts";

const ROOT = process.cwd();
const REPO = path.join(ROOT, "vendor/next-gen-atlas");
const OUT = path.join(ROOT, "public/history-html-era.json");
const HTML = "Sky Atlas/Sky Atlas.html", MD = "Sky Atlas/Sky Atlas.md";
const SEED_HTML = "7b43d159", MD117 = "22cc27b5";
const MEASURE = process.argv.includes("--measure");
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

const seed = seedFromMd(md, commits[commits.length - 1].nodes);
const thread = threadBackward(commits, { seed: seed.uuidByRow });
const rawEvents = buildEvents(commits, { lineDiff });

// map pass events → the eventToRow HistoryEvent shape (+ additive era/synthetic)
const events = rawEvents.map((e) => {
  const meta = commitMeta.get(e.sha) || {};
  const ev = { docId: e.uuid, commitHash: e.sha, changeType: e.type, date: meta.date ?? null, pr: meta.pr ?? null, era: e.era };
  if (e.doc_no != null) ev.docNo = e.doc_no;
  if (e.title != null) ev.title = e.title;
  if (e.type === "moved") { ev.movedFrom = e.movedFrom; ev.movedTo = e.movedTo; ev.moveKind = e.moveKind; }
  if (e.diff) { ev.diff = e.diff; const k = classifyDiff(e.diff); if (k) ev.changeKind = k; }
  if (e.synthetic) ev.synthetic = true;
  return ev;
});

const byType = {};
for (const e of events) byType[e.changeType] = (byType[e.changeType] || 0) + 1;
const distinct = new Set(events.map((e) => e.docId));
const synthCount = [...distinct].filter(isSynthetic).length;

const summary = {
  htmlCommits: commits.length,
  seed: seed.stats,
  decisions: thread.decisions.length,
  syntheticTombstones: thread.synthetics.length,
  distinctUuids: distinct.size,
  realUuids: distinct.size - synthCount,
  events: events.length,
  eventsByType: byType,
  prCoverage: `${[...commitMeta.values()].filter((c) => c.pr).length}/${commitMeta.size}`,
};
console.error("\n=== freeze summary ===");
console.error(JSON.stringify(summary, null, 2));

if (MEASURE) {
  console.error("\n--measure: artifact NOT written.");
} else {
  const artifact = {
    meta: { kind: "html-era-history", migrationCommit: MD117, lastHtmlCommit: SEED_HTML, ...summary },
    commits: commits.map((c) => ({ sha: c.sha, seq: c.seq, pr: commitMeta.get(c.sha)?.pr ?? null })),
    seam: Object.fromEntries(seed.seam),
    events,
    decisions: thread.decisions,
  };
  fs.writeFileSync(OUT, JSON.stringify(artifact));
  console.error(`\nwrote ${path.relative(ROOT, OUT)}  (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
}
console.error(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
