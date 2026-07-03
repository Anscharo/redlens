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
import { loadHtmlAt } from "./atlas-html.mjs";
import { matchNodes } from "./history-identity.mjs";
import { diffEditsMap, diffText } from "./history-diff.mjs";
import { contentDupCounts, occKey } from "./history-occkey.mjs";
import { fetchPrContext } from "./atlas-pr-context.mjs";
import { runAutoCurate } from "./auto-curate-run.mjs";
import { reportAutoCuration, writeAutoDecisions, writeProposals, loadLlmCache, writeLlmCache } from "./auto-curate-io.mjs";

const ROOT = process.cwd();
const REPO = path.join(ROOT, "vendor/next-gen-atlas");
const OUT = path.join(ROOT, "public/history-curation.json");
const arg = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; };
const STATS_ONLY = process.argv.includes("--stats");
const AUTO = process.argv.includes("--auto"); // also auto-resolve, reusing the loaded commits
const RECOVER = !process.argv.includes("--no-recover"); // tier-3.5 content recovery (trusted, not curated)
const DIFF = !process.argv.includes("--no-diff"); // tier-1.7 changed-lines threading (history-diff.mjs) — must match prepare-html-history
const PR_CONTEXT = !process.argv.includes("--no-pr-context"); // fetch per-commit PR/forum change descriptions (cached; needs gh+network on first run)
const ATLAS_REPO = "sky-ecosystem/next-gen-atlas";
const PR_CACHE = path.join(ROOT, ".cache/github-prs"); // shared, committed PR-metadata cache (pre- + post-markdown)
const AUTO_OUT = path.resolve(ROOT, arg("--out") || "public/history-auto-decisions.json");
const PROPOSALS_OUT = path.resolve(ROOT, arg("--proposals-out") || "public/history-curation-proposals.json");
const CACHE_OUT = path.resolve(ROOT, arg("--cache") || "public/history-curation-llm-cache.json"); // resume cache
const NO_CACHE = process.argv.includes("--no-cache"); // ignore + don't persist the cache (force re-ask)
const FRONTIER_MODEL_ARG = arg("--frontier-model"); // default resolved from config below
const autoOpts = {
  noLlm: process.argv.includes("--no-llm"),
  containment: !process.argv.includes("--no-containment"),
  positional: !process.argv.includes("--no-positional"),
  limit: arg("--limit") ? Number(arg("--limit")) : Infinity,
  threshold: arg("--threshold") ? Number(arg("--threshold")) : undefined,
  concurrency: arg("--concurrency") ? Math.max(1, Number(arg("--concurrency"))) : 5,
  // pass 1.7 (cluster/matrix joint assignment): ON by default; --no-cluster disables. Models +
  // proposer are injected below (dynamic import), so cluster only runs when a key is configured.
  cluster: !process.argv.includes("--no-cluster"),
  clusterConcurrency: arg("--cluster-concurrency") ? Math.max(1, Number(arg("--cluster-concurrency"))) : 4,
  clusterMaxSize: arg("--cluster-max") ? Math.max(2, Number(arg("--cluster-max"))) : 12,
  // pass 3 (frontier escalation): off unless --frontier; --frontier-limit caps spend
  frontier: process.argv.includes("--frontier"),
  frontierLimit: arg("--frontier-limit") ? Number(arg("--frontier-limit")) : Infinity,
  frontierConcurrency: arg("--frontier-concurrency") ? Math.max(1, Number(arg("--frontier-concurrency"))) : 3,
};
const MIGRATION_SHA = "22cc27b5", LAST_HTML_SHA = "7b43d159";
const CANDIDATES_PER_CASE = 8; // DISTINCT-content candidates; identical stubs are then expanded on top

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

// Take up to CANDIDATES_PER_CASE DISTINCT content-addresses from `entries` (best-first), but
// emit EVERY occurrence of each — identical "…Directory" stubs become separate, neighbor-
// disambiguated options instead of silently collapsing to one (which hid the real choice from
// the LLM/human and let a doc thread into the wrong stub). `addrOf(e)` → the plain content-
// address (grouping key); `make(e)` → the {key,…} candidate (occurrence-precise key). `keep`
// addrs (the matcher's auto-pick) are always included, even past the distinct cap.
function expandCandidates(entries, addrOf, make, keep = null) {
  const groups = new Map(), order = [];
  for (const e of entries) {
    const addr = addrOf(e);
    if (!groups.has(addr)) {
      if (!(keep && keep.has(addr)) && order.length >= CANDIDATES_PER_CASE) continue;
      groups.set(addr, []); order.push(addr);
    }
    groups.get(addr).push(e);
  }
  return order.flatMap((addr) => groups.get(addr).map(make));
}

// The owning PROCESS/element for each #117 md doc — the "· under X" context the curation UI shows.
// HTML candidates carry it (parentTitle, from the positional breadcrumb back-scan); md docs don't,
// but the doc_no encodes the full hierarchy. Walk each doc's ancestor chain (the doc_nos that are
// exact dotted-segment truncations) and take the SHALLOWEST content-typed ancestor — i.e. skip the
// structural containers (Scope/Article/Section) and take the first real doc below them (the
// primitive/process/element). That level is what discriminates near-identical template stubs
// ("Atlas Updates" under "Distribution Reward Primitive" vs "Integration Boost Primitive"), so the
// subject shows the same disambiguating detail as its candidates instead of a shared generic parent
// ("Required Outputs"). Falls back to the immediate parent when the whole chain is containers.
const MD_CONTAINER_TYPES = new Set(["Scope", "Article", "Section"]);
function attachMarkdownParents(nodes) {
  const byDocNo = new Map();
  for (const n of nodes) if (n.doc_no) byDocNo.set(n.doc_no, n);
  for (const node of nodes) {
    if (!node.doc_no) continue;
    const segs = node.doc_no.split(".");
    const chain = []; // existing ancestors, root→parent
    for (let i = 1; i < segs.length; i++) {
      const anc = byDocNo.get(segs.slice(0, i).join("."));
      if (anc) chain.push(anc);
    }
    if (!chain.length) continue;
    const process = chain.find((a) => !MD_CONTAINER_TYPES.has(a.type)) || chain[chain.length - 1];
    if (process) node.parentTitle = process.title;
  }
}

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
  attachMarkdownParents(nodes);
  return nodes;
}

// --- shared node dictionary (content stored once, referenced by content-address) ---
const nodeDict = {};
const keyOf = (sha, content) => `${sha}:${md5(content)}`;
// `ancestors`/`section` (the breadcrumb path) are the ONLY disambiguator for identical-content
// stubs whose title also matches — measured 398 such groups at last-HTML (e.g. two "Tau Current
// Value" docs, one under "Measures For Endgame Transition", one under "SKY Staking Mechanism").
// Stored only when present (html nodes have them; #117 md subjects don't).
// Scope (Governance | Support | Stability | Protocol | Accessibility | Agent) from the doc_no's
// A.N prefix — the atlas's top-level partition. Reliable for docs that carry a doc_no (every md
// SUBJECT does), so a candidate in the SAME scope as the newer doc is a strong fit signal. The
// A.N → name map is built from the Scopes section (populated once nodes load, below).
const scopeMap = new Map();
const scopeOf = (docNo) => { const m = docNo && String(docNo).match(/^A\.\d+/); return m ? (scopeMap.get(m[0]) || null) : null; };
const pathFields = (node) => ({
  ...(node.ancestors?.length ? { ancestors: node.ancestors } : {}),
  ...(node.section ? { section: node.section } : {}),
  ...(scopeOf(node.doc_no) ? { scope: scopeOf(node.doc_no) } : {}),
  // owning parent by position — the disambiguator for orphaned template children (empty ancestors)
  ...(!node.ancestors?.length && node.parentTitle ? { parentTitle: node.parentTitle } : {}),
});
function registerNode(sha, node) {
  const key = keyOf(sha, node.content);
  if (!nodeDict[key]) nodeDict[key] = { sha, title: node.title || "", doc_no: node.doc_no || null, type: node.type || "", content: node.content || "", ...pathFields(node) };
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

// Occurrence-aware registration for CANDIDATES (older side). Identical-content stub rows in the
// SAME commit share a content-address, so key them by document order (occKey) instead — and give
// each its OWN neighbors, since attachContext stores neighbors once per content-address (the
// first occurrence wins), which is exactly wrong for stubs. Subjects stay on attachContext (plain
// key: they are the caseKey / rawUuid join). The shared occKey keeps this in step with the
// forward pass and apply.
const dupCache = new Map();
const dupFor = (sha, commitNodes) => { let d = dupCache.get(sha); if (!d) dupCache.set(sha, (d = contentDupCounts(commitNodes))); return d; };
function registerOcc(sha, commitNodes, index) {
  const node = commitNodes[index];
  const key = occKey(sha, node, dupFor(sha, commitNodes));
  if (!nodeDict[key]) nodeDict[key] = { sha, title: node.title || "", doc_no: node.doc_no || null, type: node.type || "", content: node.content || "", ...pathFields(node) };
  return key;
}
function attachOcc(sha, commitNodes, index) {
  const key = registerOcc(sha, commitNodes, index);
  const entry = nodeDict[key];
  if (!entry.prev) {
    entry.prev = []; entry.next = [];
    for (let d = 1; d <= NEIGHBOR_RADIUS; d++) {
      if (index - d >= 0) entry.prev.push(registerOcc(sha, commitNodes, index - d));
      if (index + d < commitNodes.length) entry.next.push(registerOcc(sha, commitNodes, index + d));
    }
  }
  return key;
}

// Register a #117 md SUBJECT under its real UUID (not content-address). Two md docs that share
// content — the same annotation in two scopes (Governance + Support "Ambiguity") — otherwise
// collapse to one case AND one identity, dropping the second doc's history entirely. Keying the
// subject by uuid keeps them distinct so both thread (bijection pass assigns them 1:1). Neighbors
// are the surrounding md docs (content-addressed, display-only).
function attachSubjectByUuid(sha, commitNodes, index) {
  const node = commitNodes[index];
  const key = `${sha}:${node.uuid}`;
  if (!nodeDict[key]) {
    nodeDict[key] = { sha, title: node.title || "", doc_no: node.doc_no || null, type: node.type || "", content: node.content || "", ...pathFields(node) };
    const entry = nodeDict[key];
    entry.prev = []; entry.next = [];
    for (let d = 1; d <= NEIGHBOR_RADIUS; d++) {
      if (index - d >= 0) entry.prev.push(registerNode(sha, commitNodes[index - d]));
      if (index + d < commitNodes.length) entry.next.push(registerNode(sha, commitNodes[index + d]));
    }
  }
  return key;
}

// Rank the `pool` of older nodes by shingle similarity to `subject`, return the top K
// as {key, score}. `mustInclude` (the matcher's auto-pick) is force-included so the
// human always sees what the pipeline chose, even if it scores below the cutoff.
function rankCandidates(subject, subjectShingles, olderSha, pool, poolShingles, mustIncludeNode) {
  const scored = pool.map((node, i) => ({ node, i, score: jaccard(subjectShingles, poolShingles[i]) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
  if (mustIncludeNode && !scored.some((c) => c.node === mustIncludeNode)) {
    const i = pool.indexOf(mustIncludeNode);
    if (i >= 0) scored.push({ node: mustIncludeNode, i, score: jaccard(subjectShingles, poolShingles[i]) });
  }
  const keep = mustIncludeNode ? new Set([keyOf(olderSha, mustIncludeNode.content)]) : null;
  // `diff` = the changed lines from this candidate (older) to the subject (newer): the true
  // predecessor shows a small/coherent edit, a wrong candidate a large incoherent one — sharper
  // than whole-body similarity. Identical stubs stay as separate, neighbor-disambiguated options.
  return expandCandidates(
    scored,
    (c) => keyOf(olderSha, c.node.content),
    (c) => ({ key: attachOcc(olderSha, pool, c.i), score: +c.score.toFixed(3), diff: diffText(c.node, subject) }),
    keep,
  );
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
// populate the scope map (A.N → scope name) from the Scopes section, e.g. "A.1" → "Governance".
for (const n of lastHtmlNodes) {
  if (n.section !== "Scopes" || !n.doc_no) continue;
  const m = n.doc_no.match(/^A\.\d+/);
  if (m) scopeMap.set(m[0], (n.title || "").replace(/^The\s+/i, "").replace(/\s+Scope$/i, "").trim() || n.title);
}
log(`curation: ${markdownDocs.length} md docs, ${htmlCommits.length} html commits, ${scopeMap.size} scopes`);

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
  const subjectKey = attachSubjectByUuid(MIGRATION_SHA, markdownDocs, mi);
  // Identical last-HTML stubs are the dominant seed ambiguity (~38% of these cases have all-
  // identical candidate titles): keep every one as a distinct, neighbor-disambiguated option and
  // key it by occurrence so the recorded pick threads into the RIGHT stub. Occurrence keys must
  // match autoKey, so the auto-pick uses attachOcc too.
  const keepAddr = new Set([keyOf(LAST_HTML_SHA, lastHtmlNodes[autoRow].content)]);
  const candidates = expandCandidates(
    ranked,
    ([ri]) => keyOf(LAST_HTML_SHA, lastHtmlNodes[ri].content),
    ([ri, cov]) => ({ key: attachOcc(LAST_HTML_SHA, lastHtmlNodes, ri), score: +cov.toFixed(3) }),
    keepAddr,
  );
  // subjectOrder = the #117 document order (md array index) so the UI groups this
  // commit's changes in document order.
  addCase({ key: subjectKey, kind: "seed-close", newerSha: MIGRATION_SHA, olderSha: LAST_HTML_SHA, subjectKey, subjectOrder: mi, autoKey: attachOcc(LAST_HTML_SHA, lastHtmlNodes, autoRow), candidates });
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
  // tier-1.7: the changed-lines signal must match prepare-html-history exactly (same threading
  // ⇒ decisions map). It pre-resolves near-identical-sibling edits that would else surface as
  // tier-2.5/2.7/3 or ambiguous cases here — shrinking the queue to the genuinely hard calls.
  const result = matchNodes(olderCommit.nodes, newerCommit.nodes, {
    recoverByContent: RECOVER,
    diffEdits: DIFF ? diffEditsMap(olderCommit.nodes, newerCommit.nodes) : null,
  });

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
      autoKey: attachOcc(olderCommit.sha, olderCommit.nodes, pair.older.order), candidates,
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

// Enrich each commit with its PR title + the linked forum thread's edit-list ("Update X", "Add Y")
// — the editorial intent behind the transition, a strong threading signal the LLM/human sees per
// case. Cached on disk (.cache/github-prs, shared with build-history); first run fetches, later runs are instant.
if (PR_CONTEXT) log("curation: fetching PR/forum change descriptions (cached)…");
const commits = htmlCommits.map((c) => {
  const pr = commitMeta.get(c.sha)?.pr ?? null;
  const ctx = PR_CONTEXT && pr ? fetchPrContext(pr, ATLAS_REPO, PR_CACHE) : null;
  return {
    sha: c.sha, date: commitMeta.get(c.sha)?.date ?? null, pr,
    ...(ctx?.title ? { prTitle: ctx.title } : {}),
    ...(ctx?.summary ? { changeSummary: ctx.summary } : {}),
  };
});
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
  const { proposePredecessor, proposeClusterAssignment } = await import("../../src/server/history-curate.ts");
  const { config } = await import("../../src/server/config.ts");
  const frontierModel = FRONTIER_MODEL_ARG || config.curationFrontierModel;
  const clusterModels = config.curationClusterModels;
  const cache = NO_CACHE ? new Map() : loadLlmCache(CACHE_OUT);
  const clusterOn = autoOpts.cluster && clusterModels.length >= 2;
  log(`\nauto-curation (forward∩reverse${clusterOn ? ` + cluster ${clusterModels.join("∩")}` : ""} + LLM∩matcher${autoOpts.frontier ? ` + frontier ${frontierModel}` : ""})${cache.size ? `  ·  resuming from ${cache.size} cached asks` : ""}…`);
  const { decisions, proposals, summary, cache: outCache } = await runAutoCurate({
    data: artifact, commits: htmlCommits, propose: proposePredecessor,
    proposeCluster: proposeClusterAssignment, clusterModels,
    haveKey: !!config.openrouterApiKey, ...autoOpts, frontierModel, cache, cheapModel: config.curationSelectorModel, log,
  });
  reportAutoCuration(artifact, decisions, summary);
  writeAutoDecisions(AUTO_OUT, artifact, decisions, summary, autoOpts.concurrency);
  log(`wrote ${path.relative(ROOT, AUTO_OUT)}  (${decisions.length} auto-decisions)`);
  if (proposals.length) {
    writeProposals(PROPOSALS_OUT, frontierModel, proposals);
    const posN = proposals.filter((p) => p.via === "positional").length;
    log(`wrote ${path.relative(ROOT, PROPOSALS_OUT)}  (${proposals.length} hints: ${proposals.length - posN} frontier + ${posN} positional)`);
  }
  if (!NO_CACHE) { writeLlmCache(CACHE_OUT, outCache); log(`wrote ${path.relative(ROOT, CACHE_OUT)}  (${outCache.size} cached asks)`); }
  console.error(`\nnext: review the ${summary.residual} residual cases at /reports/history-curate (auto-resolved are pre-filled), then bake with:  pnpm htmlhist:apply ${path.relative(ROOT, AUTO_OUT)}`);
}
