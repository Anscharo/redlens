// Offline builder for the HTML-era history CURATION tool (plan §10.4).
//
//   bun scripts/aux/build-history-curation.mjs            # build + write the case file
//   bun scripts/aux/build-history-curation.mjs --stats    # just print counts + samples
//   bun scripts/aux/build-history-curation.mjs --auto     # build queue AND auto-resolve
//                                                         #   (forward∩reverse + LLM∩matcher,
//                                                         #    reusing the loaded commits)
//   ... --auto --no-llm | --limit N | --concurrency N | --threshold X   # tune the auto pass
//   ... --auto --frontier [--frontier-limit N] [--frontier-model M]     # pass 3: escalate the
//                                                         #   uncertain residual to a frontier model
//                                                         #   (locks on agreement w/ an independent
//                                                         #    signal, else writes a UI hint)
//
// `--auto` is what `pnpm htmlhist:curate` runs: it writes BOTH public/history-curation.json
// (the queue) and public/history-auto-decisions.json (the pre-filled baseline) in one shot.
//
// It replays the real seed + backward thread and collects every NON-EXACT identity
// decision — the ones a human should confirm: seed close-calls, fuzzy/bucket sibling
// pairings (tiers 2.5/2.7/3), and flagged-ambiguous rows. Each case is framed the way
// a human reviews it: "here is a document (the newer version); which older document is
// its PREVIOUS version?" — with ranked candidate predecessors and the matcher's own
// auto-pick. The curation UI (/reports/history-curate) loads this, the human picks,
// and the choices are exported to a decisions.json that the build applies (plan §10.4).
//
// Output: public/history-curation.json
//   { meta, commits:[{sha,date,pr}], nodes:{ key -> {sha,title,doc_no,type,content} },
//     cases:[ { key, kind, newerSha, olderSha, subjectKey, autoKey|null, candidates:[{key,score}] } ] }
// Node content is stored ONCE in `nodes` and referenced by key, so the file stays small
// even though a doc is a candidate in many cases. A key is content-addressed:
// `${sha}:${md5(content)}` — stable across renumbering, so recorded decisions survive
// an atlas re-number (plan: never key on doc_no).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { loadHtmlAt } from "../lib/atlas-html.mjs";
import { matchNodes } from "../lib/history-identity.mjs";
import { runAutoCurate } from "../lib/auto-curate-run.mjs";
import { reportAutoCuration, writeAutoDecisions, writeProposals } from "../lib/auto-curate-io.mjs";

const ROOT = process.cwd();
const REPO = path.join(ROOT, "vendor/next-gen-atlas");
const OUT = path.join(ROOT, "public/history-curation.json");
const arg = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; };
const STATS_ONLY = process.argv.includes("--stats");
const AUTO = process.argv.includes("--auto"); // also auto-resolve, reusing the loaded commits
const RECOVER = !process.argv.includes("--no-recover"); // tier-3.5 content recovery (trusted, not curated)
const AUTO_OUT = path.resolve(ROOT, arg("--out") || "public/history-auto-decisions.json");
const PROPOSALS_OUT = path.resolve(ROOT, arg("--proposals-out") || "public/history-curation-proposals.json");
const FRONTIER_MODEL_ARG = arg("--frontier-model"); // default resolved from config below
const autoOpts = {
  noLlm: process.argv.includes("--no-llm"),
  containment: !process.argv.includes("--no-containment"),
  limit: arg("--limit") ? Number(arg("--limit")) : Infinity,
  threshold: arg("--threshold") ? Number(arg("--threshold")) : undefined,
  concurrency: arg("--concurrency") ? Math.max(1, Number(arg("--concurrency"))) : 5,
  // pass 3 (frontier escalation): off unless --frontier; --frontier-limit caps spend
  frontier: process.argv.includes("--frontier"),
  frontierLimit: arg("--frontier-limit") ? Number(arg("--frontier-limit")) : Infinity,
  frontierConcurrency: arg("--frontier-concurrency") ? Math.max(1, Number(arg("--frontier-concurrency"))) : 3,
};
const MIGRATION_SHA = "22cc27b5", LAST_HTML_SHA = "7b43d159";
const CANDIDATES_PER_CASE = 6;

const git = (args) => execSync(`git -C "${REPO}" ${args}`, { maxBuffer: 1 << 30 }).toString();
const md5 = (text) => crypto.createHash("md5").update(text).digest("hex");
const normalize = (text) => (text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// shingles = sliding windows of 8 words; shared windows ⇒ shared verbatim prose
const SHINGLE_WORDS = 8;
const shingleSet = (text) => {
  const words = normalize(text).split(" ").filter(Boolean);
  const set = new Set();
  for (let i = 0; i + SHINGLE_WORDS <= words.length; i++) set.add(words.slice(i, i + SHINGLE_WORDS).join(" "));
  return set;
};
// Jaccard similarity of two sets: |intersection| / |union|. 0 = nothing shared, 1 = identical.
const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  return intersection / (a.size + b.size - intersection);
};
const titleTokens = (title) => new Set(normalize(title).split(" ").filter(Boolean));

const log = (message) => console.error(message);

// collapse candidates that resolve to the same content-address (identical-content
// sibling rows — e.g. a dozen identical "…Directory" stubs), keeping the best score
const dedupeCandidates = (list) => {
  const best = new Map();
  for (const c of list) { const prev = best.get(c.key); if (!prev || c.score > prev.score) best.set(c.key, c); }
  return [...best.values()].sort((a, b) => b.score - a.score);
};

// #117 markdown monolith → nodes carrying the real migration UUID. Content is kept
// RAW (original case + line breaks) for readable display/diffs; all matching goes
// through shingleSet(), which normalizes internally, so storage form is display-only.
function parseMarkdownDocs(blob) {
  const HEADING_RE = /^(#{1,6}) (\S+) - (.*?) \[([^\]]+)\]\s+<!-- UUID: ([0-9a-f-]{36}) -->/;
  const nodes = [];
  let current = null;
  for (const line of blob.split("\n")) {
    const match = line.match(HEADING_RE);
    if (match) {
      if (current) current.content = current._body.join("\n").trim();
      current = { uuid: match[5], doc_no: match[2], title: match[3].trim(), type: match[4].trim(), content: "", _body: [] };
      nodes.push(current);
    } else if (current) {
      current._body.push(line);
    }
  }
  if (current) current.content = current._body.join("\n").trim();
  for (const node of nodes) delete node._body;
  return nodes;
}

// --- shared node dictionary (content stored once, referenced by content-address) ---
const nodeDict = {};
const keyOf = (sha, content) => `${sha}:${md5(content)}`;
function registerNode(sha, node) {
  const key = keyOf(sha, node.content);
  if (!nodeDict[key]) nodeDict[key] = { sha, title: node.title || "", doc_no: node.doc_no || null, type: node.type || "", content: node.content || "" };
  return key;
}

// register a node AND its nearby entries (the surrounding docs in the same commit, by
// document order) so the human can read a candidate IN CONTEXT — what sits before and
// after it is how near-identical siblings are told apart. prev/next hold neighbor keys
// nearest-first; the neighbors are themselves registered (content available) but don't
// recurse. `commitNodes` is the commit's full ordered node array, `index` the node's slot.
const NEIGHBOR_RADIUS = 3;
function attachContext(commitSha, commitNodes, index) {
  const key = registerNode(commitSha, commitNodes[index]);
  const entry = nodeDict[key];
  if (!entry.prev) {
    entry.prev = []; entry.next = [];
    for (let d = 1; d <= NEIGHBOR_RADIUS; d++) {
      if (index - d >= 0) entry.prev.push(registerNode(commitSha, commitNodes[index - d]));
      if (index + d < commitNodes.length) entry.next.push(registerNode(commitSha, commitNodes[index + d]));
    }
  }
  return key;
}

// Rank the `pool` of older nodes by shingle similarity to `subject`, return the top K
// as {key, score}. `mustInclude` (the matcher's auto-pick) is force-included so the
// human always sees what the pipeline chose, even if it scores below the cutoff.
function rankCandidates(subject, subjectShingles, olderSha, pool, poolShingles, mustIncludeNode) {
  const scored = pool.map((node, i) => ({ node, score: jaccard(subjectShingles, poolShingles[i]) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, CANDIDATES_PER_CASE);
  if (mustIncludeNode && !scored.some((c) => c.node === mustIncludeNode)) {
    const i = pool.indexOf(mustIncludeNode);
    if (i >= 0) scored.push({ node: mustIncludeNode, score: jaccard(subjectShingles, poolShingles[i]) });
  }
  return dedupeCandidates(scored.map(({ node, score }) => ({ key: attachContext(olderSha, pool, pool.indexOf(node)), score: +score.toFixed(3) })));
}

// ---------------------------------------------------------------------------------
log("curation: loading markdown + html commits…");
const markdownDocs = parseMarkdownDocs(git(`show ${MIGRATION_SHA}:'Sky Atlas/Sky Atlas.md'`));
const htmlCommitShas = git(`log --reverse --format=%H ${LAST_HTML_SHA} -- 'Sky Atlas/Sky Atlas.html'`).trim().split("\n");
const commitMeta = new Map(); // sha7 -> {date, pr}
for (const line of git(`log --format=%H%x09%cI%x09%s ${LAST_HTML_SHA} -- 'Sky Atlas/Sky Atlas.html'`).trim().split("\n")) {
  const [full, date, ...rest] = line.split("\t");
  const pr = (rest.join("\t").match(/\(#(\d+)\)/) || [])[1] || null;
  commitMeta.set(full.slice(0, 8), { date, pr: pr ? Number(pr) : null });
}
const htmlCommits = htmlCommitShas.map((full, i) => {
  if (i % 20 === 0) log(`  …converting ${i}/${htmlCommitShas.length}`);
  const sha = full.slice(0, 8);
  return { sha, nodes: loadHtmlAt(full, REPO) };
});
const newestFirst = htmlCommits.slice().reverse();
const lastHtmlNodes = htmlCommits[htmlCommits.length - 1].nodes;
log(`curation: ${markdownDocs.length} md docs, ${htmlCommits.length} html commits`);

const cases = [];
const countByKind = {};
const addCase = (kase) => { cases.push(kase); countByKind[kase.kind] = (countByKind[kase.kind] || 0) + 1; };

// === SEED boundary: each #117 md doc — which last-HTML row is its previous version? ===
// Same shingle-overlap + title-tiebreak as seedFromMd; the CLOSE calls (top-two within
// 0.1 coverage) are the ones a human should confirm.
log("curation: seed boundary…");
const markdownShingles = markdownDocs.map((d) => shingleSet(d.content));
const markdownTitleTokens = markdownDocs.map((d) => titleTokens(d.title));
const htmlShingles = lastHtmlNodes.map((n) => shingleSet(n.content));
// inverted index: shingle -> [htmlRowIndex]
const seedIndex = new Map();
lastHtmlNodes.forEach((_, i) => { for (const s of htmlShingles[i]) { let a = seedIndex.get(s); if (!a) seedIndex.set(s, (a = [])); a.push(i); } });
const TITLE_TIE_WINDOW = 0.1, TITLE_TIE_MARGIN = 0.34;

markdownDocs.forEach((mdDoc, mi) => {
  const docShingles = markdownShingles[mi];
  if (!docShingles.size) return;
  const overlap = new Map();
  for (const s of docShingles) { const list = seedIndex.get(s); if (list) for (const ri of list) overlap.set(ri, (overlap.get(ri) || 0) + 1); }
  if (!overlap.size) return;
  const ranked = [...overlap]
    .map(([ri, shared]) => [ri, shared / Math.min(docShingles.size, htmlShingles[ri].size)])
    .sort((a, b) => b[1] - a[1]);
  const [bestRow, bestCov] = ranked[0], secondCov = ranked[1]?.[1] ?? 0;
  if (bestCov < 0.5 || bestCov - secondCov >= 0.1) return; // confident or no-match → not a close call
  // title tiebreak (mirrors seedFromMd) to mark the auto-pick the pipeline would seed
  const rowTitle = titleTokens(lastHtmlNodes[bestRow].title);
  let autoRow = bestRow, autoTitleScore = jaccard(markdownTitleTokens[mi], titleTokens(lastHtmlNodes[bestRow].title)) ;
  for (const [ri, cov] of ranked) {
    if (bestCov - cov > TITLE_TIE_WINDOW) break;
    const ts = jaccard(markdownTitleTokens[mi], titleTokens(lastHtmlNodes[ri].title));
    if (ts > autoTitleScore + 1e-9) { autoTitleScore = ts; autoRow = ri; }
  }
  const subjectKey = attachContext(MIGRATION_SHA, markdownDocs, mi);
  const candidates = dedupeCandidates(ranked.slice(0, CANDIDATES_PER_CASE).map(([ri, cov]) => ({ key: attachContext(LAST_HTML_SHA, lastHtmlNodes, ri), score: +cov.toFixed(3) })));
  // subjectOrder = the #117 document order (md array index) so the UI groups this
  // commit's changes in document order.
  addCase({ key: subjectKey, kind: "seed-close", newerSha: MIGRATION_SHA, olderSha: LAST_HTML_SHA, subjectKey, subjectOrder: mi, autoKey: attachContext(LAST_HTML_SHA, lastHtmlNodes, autoRow), candidates });
});

// === BACKWARD hops: for each newer commit, which older row is each doc's previous? ===
// We re-run matchNodes per hop (like the audit) purely to CLASSIFY each decision and
// read the auto-pick; candidates are scored independently so the human sees real options.
log("curation: backward hops…");
let newerCommit = newestFirst[0];
let newerShingleByNode = new Map(newerCommit.nodes.map((n) => [n, shingleSet(n.content)]));
for (let hop = 1; hop < newestFirst.length; hop++) {
  const olderCommit = newestFirst[hop];
  const olderShingles = olderCommit.nodes.map((n) => shingleSet(n.content));
  const result = matchNodes(olderCommit.nodes, newerCommit.nodes, { recoverByContent: RECOVER });

  // map newer node -> the older node the matcher paired it with, plus the tier
  const autoOlderByNewer = new Map();
  const tierByNewer = new Map();
  for (const pair of result.pairs) { autoOlderByNewer.set(pair.newer, pair.older); tierByNewer.set(pair.newer, pair.tier); }

  // non-exact PAIRS (tiers 2.5/2.7/3): the matcher chose, but not by exact hash/key
  for (const pair of result.pairs) {
    const tier = pair.tier;
    if (tier !== 2.5 && tier !== 2.7 && tier !== 3) continue;
    const subject = pair.newer;
    const subjectShingles = newerShingleByNode.get(subject) || shingleSet(subject.content);
    const candidates = rankCandidates(subject, subjectShingles, olderCommit.sha, olderCommit.nodes, olderShingles, pair.older);
    addCase({
      key: keyOf(newerCommit.sha, subject.content), kind: `tier-${tier}`,
      newerSha: newerCommit.sha, olderSha: olderCommit.sha,
      subjectKey: attachContext(newerCommit.sha, newerCommit.nodes, subject.order),
      subjectOrder: subject.order,
      autoKey: attachContext(olderCommit.sha, olderCommit.nodes, pair.older.order), candidates,
    });
  }

  // FLAGGED-AMBIGUOUS: the matcher refused to guess. Frame around the top candidate
  // newer doc and ask the human to pick its previous version (auto = none).
  for (const flag of result.ambiguous) {
    const subject = flag.candidates?.[0]; // a newer node the older row might precede
    if (!subject) continue;
    const subjectShingles = newerShingleByNode.get(subject) || shingleSet(subject.content);
    const candidates = rankCandidates(subject, subjectShingles, olderCommit.sha, olderCommit.nodes, olderShingles, flag.older);
    addCase({
      key: keyOf(newerCommit.sha, subject.content), kind: "ambiguous", reason: flag.reason,
      newerSha: newerCommit.sha, olderSha: olderCommit.sha,
      subjectKey: attachContext(newerCommit.sha, newerCommit.nodes, subject.order),
      subjectOrder: subject.order,
      autoKey: null, candidates,
    });
  }

  newerCommit = olderCommit;
  newerShingleByNode = new Map(olderCommit.nodes.map((n, i) => [n, olderShingles[i]]));
}

// de-dupe cases that landed on the same content-addressed key (a doc unchanged across
// several hops can surface more than once); keep the first occurrence.
const seen = new Set();
const uniqueCases = cases.filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true)));

const commits = htmlCommits.map((c) => ({ sha: c.sha, date: commitMeta.get(c.sha)?.date ?? null, pr: commitMeta.get(c.sha)?.pr ?? null }));
const meta = {
  kind: "html-era-curation", migrationSha: MIGRATION_SHA, lastHtmlSha: LAST_HTML_SHA,
  htmlCommits: htmlCommits.length, totalCases: uniqueCases.length, casesByKind: countByKind,
  rawCases: cases.length, nodeCount: Object.keys(nodeDict).length,
};

log("\n=== curation cases ===");
log(JSON.stringify({ casesByKind: countByKind, totalUnique: uniqueCases.length, rawBeforeDedup: cases.length, nodes: Object.keys(nodeDict).length }, null, 2));
log("\n--- sample cases ---");
for (const kind of Object.keys(countByKind)) {
  const ex = uniqueCases.find((c) => c.kind === kind);
  if (!ex) continue;
  const subj = nodeDict[ex.subjectKey];
  log(`\n[${kind}] newer ${ex.newerSha} ▸ "${subj.title}"  (${ex.candidates.length} candidates)`);
  log(`   pick its previous version (older ${ex.olderSha}):`);
  for (const cand of ex.candidates.slice(0, 4)) {
    const n = nodeDict[cand.key];
    const mark = cand.key === ex.autoKey ? " ← auto" : "";
    log(`     ${String(cand.score).padStart(5)}  "${n.title}"${mark}`);
  }
}

const artifact = { meta, commits, nodes: nodeDict, cases: uniqueCases };
if (STATS_ONLY) {
  log("\n--stats: file NOT written.");
} else {
  fs.writeFileSync(OUT, JSON.stringify(artifact));
  log(`\nwrote ${path.relative(ROOT, OUT)}  (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
}

// --auto: auto-resolve the queue we just built, REUSING htmlCommits (oldest→newest,
// nodes carry contentHash — exactly forwardLinks' shape) so the slow turndown isn't
// repeated. The LLM proposer + key are pulled in only here (dynamic import) so a plain
// queue build stays free of any server dependency. Writes the gitignored baseline.
if (AUTO) {
  const { proposePredecessor } = await import("../../src/server/history-curate.ts");
  const { config } = await import("../../src/server/config.ts");
  const frontierModel = FRONTIER_MODEL_ARG || config.curationFrontierModel;
  log(`\nauto-curation (forward∩reverse + LLM∩matcher${autoOpts.frontier ? ` + frontier ${frontierModel}` : ""})…`);
  const { decisions, proposals, summary } = await runAutoCurate({
    data: artifact, commits: htmlCommits, propose: proposePredecessor,
    haveKey: !!config.openrouterApiKey, ...autoOpts, frontierModel, log,
  });
  reportAutoCuration(artifact, decisions, summary);
  writeAutoDecisions(AUTO_OUT, artifact, decisions, summary, autoOpts.concurrency);
  log(`wrote ${path.relative(ROOT, AUTO_OUT)}  (${decisions.length} auto-decisions)`);
  if (autoOpts.frontier) {
    writeProposals(PROPOSALS_OUT, frontierModel, proposals);
    log(`wrote ${path.relative(ROOT, PROPOSALS_OUT)}  (${proposals.length} frontier hints)`);
  }
  console.error(`\nnext: review the ${summary.residual} residual cases at /reports/history-curate (auto-resolved are pre-filled), then bake with:  pnpm htmlhist:apply ${path.relative(ROOT, AUTO_OUT)}`);
}
