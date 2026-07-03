// Offline one-shot freeze runner for the pre-#117 (HTML) atlas history (plan §7.1).
// Composes the §3 converter + §4 passes against the REAL submodule, with the real
// diffCore.lineDiff, and writes the frozen artifact public/history-html-era.json.
// Runs under bun (imports the .ts diffCore). Rerun only as a deliberate, reviewed
// act — historical diffs must not silently change (plan §7.1).
//
//   bun scripts/aux/prepare-html-history.mjs            # write the artifact
//   bun scripts/aux/prepare-html-history.mjs --measure  # print stats, write nothing
//
// commit_seq is reconciled by SHA at load time (plan §7.1, decision 6); the
// artifact stores 7-char shas + a baked seq for reference only.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { loadHtmlAt } from "./atlas-html.mjs";
import { seedFromMd, threadBackward, buildEvents } from "./history-html-era.mjs";
import { isSynthetic, syntheticUuid } from "./history-identity.mjs";
import { detectLineage } from "./history-lineage.mjs";
import { classifyDiff } from "../lib/history-classify.mjs";
import { mechanismToMethod } from "./auto-curate.mjs";
import { contentDupCounts, occKey } from "./history-occkey.mjs";
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
const splitOf = new Map(); // duplication-split copy uuid -> its #117 source (a kept identical sibling)
// ai/human decisions to tag for per-change provenance (plan §10.4). Collected here (before
// threading) and resolved to `${uuid}:${sha}` once nodes carry uuids; deterministic links
// are the unbadged default, so only ai/human are pinned.
const methodPins = [];
if (DECISIONS_PATH) {
  console.error(`decisions: applying ${path.relative(ROOT, DECISIONS_PATH)}`);
  const file = JSON.parse(fs.readFileSync(DECISIONS_PATH, "utf8"));
  // md5(raw #117 body) → uuid, matching build-history-curation.mjs's content-address; and uuid →
  // body (to detect duplication-splits: identical md docs where some got an html predecessor and the
  // rest are copies #117 created).
  const rawUuid = new Map();
  const mdContentByUuid = new Map();
  { const HRE = /^(#{1,6}) (\S+) - (.*?) \[([^\]]+)\]\s+<!-- UUID: ([0-9a-f-]{36}) -->/;
    let cur = null, body = [];
    const flush = () => { if (cur) { const b = body.join("\n").trim(); rawUuid.set(md5(b), cur); mdContentByUuid.set(cur, b); } };
    for (const line of git(`show ${MD117}:'${MD}'`).split("\n")) {
      const m = line.match(HRE);
      if (m) { flush(); cur = m[5]; body = []; }
      else if (cur) body.push(line);
    }
    flush();
  }
  // content-address index over every html node (8-char sha, matching the curation file). Index
  // BOTH the plain key (subject keys, unique-content candidates; last-wins on dups as before) and
  // the occurrence-precise key (identical stubs → `${sha}:${hash}#${order}`), so a decision that
  // picked a specific stub resolves to THAT node, not just any row with the same content.
  const nodeIndex = new Map();
  shas.forEach((full, idx) => {
    const sha8 = full.slice(0, 8);
    const dupCounts = contentDupCounts(commits[idx].nodes);
    for (const n of commits[idx].nodes) {
      nodeIndex.set(`${sha8}:${n.contentHash}`, n);
      nodeIndex.set(occKey(sha8, n, dupCounts), n);
    }
  });

  seedOverrides = new Map(); hopOverrides = new Map();
  let unresolved = 0;
  for (const d of file.decisions || []) {
    const chosen = d.chosenKey === "none" ? null : nodeIndex.get(d.chosenKey);
    if (d.chosenKey !== "none" && !chosen) { unresolved++; continue; } // chosen doc not found this build
    // provenance: prefer the committed `method`; fall back to deriving it from a raw baseline
    // file's `auto` mechanism. Only ai/human are surfaced as badges.
    const method = d.method ?? mechanismToMethod(d.auto);
    if (d.newerSha === MD117) {               // seed decision: subject is an #117 md doc
      // subjectKey is now `${sha}:${uuid}` (uuid-keyed, so identical-content md docs stay distinct);
      // fall back to the old content-address form (`${sha}:${md5}` → rawUuid) for legacy decisions.
      const part = String(d.subjectKey).split(":")[1];
      const mdUuid = /^[0-9a-f-]{36}$/.test(part) ? part : rawUuid.get(part);
      if (!mdUuid) { unresolved++; continue; }
      seedOverrides.set(mdUuid, chosen);
      if (method === "ai" || method === "human") methodPins.push({ kind: "seed", mdUuid, method });
    } else {                                   // backward-hop decision: subject is a newer html node
      const newer = nodeIndex.get(d.subjectKey);
      if (!newer) { unresolved++; continue; }
      hopOverrides.set(newer, chosen);
      if (method === "ai" || method === "human") methodPins.push({ kind: "hop", newer, newerSha: d.newerSha, method });
    }
  }
  applied = { total: (file.decisions || []).length, seed: seedOverrides.size, hop: hopOverrides.size, unresolved };
  console.error(`decisions: applied ${applied.seed} seed + ${applied.hop} hop, ${unresolved} unresolved (of ${applied.total})`);

  // duplication-split provenance: among identical-content md docs, some got a real html predecessor
  // ("kept") and the rest resolved to "none" — #117 duplicated the doc into more copies than existed
  // in html. Point each "none" copy extracted_from a kept sibling (deterministic: the first by uuid),
  // so the artifact records the split lineage instead of a bare "created". Derived from the decisions
  // themselves, so it works for both the auto baseline and human-saved files.
  const uuidOf = (sk) => { const p = String(sk).split(":")[1]; return /^[0-9a-f-]{36}$/.test(p) ? p : rawUuid.get(p); };
  const byContent = new Map(); // md content -> { kept:[uuid], none:[uuid] }
  for (const d of file.decisions || []) {
    if (d.newerSha !== MD117) continue;
    const uuid = uuidOf(d.subjectKey);
    const content = uuid && mdContentByUuid.get(uuid);
    if (content == null) continue;
    let g = byContent.get(content); if (!g) byContent.set(content, (g = { kept: [], none: [] }));
    (d.chosenKey === "none" ? g.none : g.kept).push(uuid);
  }
  for (const { kept, none } of byContent.values()) {
    if (!kept.length || !none.length) continue;
    const source = kept.slice().sort()[0];
    for (const u of none) splitOf.set(u, source);
  }
  if (splitOf.size) console.error(`decisions: ${splitOf.size} split copies pointed extracted_from their #117 source`);
}

const lastSha = commits[commits.length - 1].sha;
const seed = seedFromMd(md, commits[commits.length - 1].nodes, seedOverrides ? { overrides: seedOverrides } : {});
const thread = threadBackward(commits, { seed: seed.uuidByRow, recover: RECOVER, diff: DIFF, ...(hopOverrides ? { overrides: hopOverrides } : {}) });
const rawEvents = buildEvents(commits, { lineDiff });

// resolve the ai/human method pins to `${uuid}:${sha}` now that threading assigned uuids.
// hop decisions land on the change-event at the decided (newer) commit; seed (cross-format)
// decisions land on the doc's last-HTML event (the boundary occurrence).
const methodByDocCommit = new Map();
for (const p of methodPins) {
  if (p.kind === "hop") { if (p.newer.uuid) methodByDocCommit.set(`${p.newer.uuid}:${p.newerSha}`, p.method); }
  else methodByDocCommit.set(`${p.mdUuid}:${lastSha}`, p.method);
}

// per-doc seam metadata (plan §4.1/§7): kept/split/merged/created + the
// extracted_from / merged_into pointers, keyed by uuid.
const docMeta = new Map();
for (const [uuid, s] of seed.seam) docMeta.set(uuid, seed.extractedFrom.has(uuid) ? { seam: s, extractedFrom: seed.extractedFrom.get(uuid) } : { seam: s });
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
// hand-authored ledger (git-history forensics — see scripts/aux/HISTORY.md) re-tags each listed uuid
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
