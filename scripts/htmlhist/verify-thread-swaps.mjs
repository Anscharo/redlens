// VERIFY the reconstructed thread by hunting identity SWAPS (prototype C, the inverse of
// the false-birth chase). A swap = the backward thread carried ONE uuid across a point
// where the body was WHOLESALE-replaced — i.e. it glued two different documents into one
// chain. This is the verification mirror of the PR #108 UUID-swap detector, run on
// consecutive versions of each threaded uuid instead of a fork-vs-live diff.
//
//   bun scripts/htmlhist/verify-thread-swaps.mjs
//
// For every `modified` transition (same uuid, adjacent commits, content changed) it
// measures same-document similarity (ordered containment); a near-zero score means the
// version-to-version content barely overlaps — suspicious. It then checks whether the OLD
// body RELOCATED into another doc at the new commit (findContainer): if so, the uuid was
// almost certainly repurposed (a real swap / mis-thread), not just heavily rewritten.
// Offline review tool (like audit + trace); writes nothing.

import path from "node:path";
import { execSync } from "node:child_process";
import { loadHtmlAt } from "./atlas-html.mjs";
import { seedFromMd, threadBackward } from "./history-html-era.mjs";
import { isSynthetic } from "./history-identity.mjs";
import { sameDocScore, findContainer } from "./ordered-containment.mjs";

const ROOT = process.cwd();
const REPO = path.join(ROOT, "vendor/next-gen-atlas");
const MD117 = "22cc27b5", SEED_HTML = "7b43d159";
const HTML = "Sky Atlas/Sky Atlas.html", MD = "Sky Atlas/Sky Atlas.md";
const SWAP_MAX = 0.2; // version-to-version same-doc score at/below this = a content cliff
const git = (a) => execSync(`git -C "${REPO}" ${a}`, { maxBuffer: 1 << 30 }).toString();
const t0 = Date.now();
const log = (m) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ntitle = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();

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

log("loading md + html commits…");
const md = parseMd117(git(`show ${MD117}:'${MD}'`));
const shas = git(`log --reverse --format=%H ${SEED_HTML} -- '${HTML}'`).trim().split("\n");
const commits = shas.map((full, i) => { if (i % 20 === 0) log(`  …${i}/${shas.length}`); return { sha: full.slice(0, 8), nodes: loadHtmlAt(full, REPO) }; });

const seed = seedFromMd(md, commits[commits.length - 1].nodes);
threadBackward(commits, { seed: seed.uuidByRow }); // assigns node.uuid everywhere
log("threaded; scanning for swaps…");

// per-uuid occurrences in commit order
const byUuid = new Map();
commits.forEach((c, idx) => { for (const n of c.nodes) { let a = byUuid.get(n.uuid); if (!a) byUuid.set(n.uuid, (a = [])); a.push({ idx, node: n }); } });

const suspects = [];
let transitions = 0;
for (const [uuid, occAll] of byUuid) {
  const occ = occAll.sort((a, b) => a.idx - b.idx).filter((o, i, arr) => i === 0 || o.idx !== arr[i - 1].idx);
  for (let i = 1; i < occ.length; i++) {
    if (occ[i].idx !== occ[i - 1].idx + 1) continue; // gap (removed→re-added), not a modify
    const prev = occ[i - 1].node, curr = occ[i].node;
    if (prev.contentHash === curr.contentHash) continue;
    transitions++;
    const score = sameDocScore(prev.content, curr.content);
    if (score > SWAP_MAX) continue;
    // did the OLD body relocate into another doc at the new commit? (strong swap signal)
    const others = commits[occ[i].idx].nodes.filter((x) => x !== curr && x.section === prev.section);
    const reloc = findContainer(prev.content, others);
    suspects.push({
      uuid, sha: commits[occ[i].idx].sha, score: +score.toFixed(2), synthetic: isSynthetic(uuid),
      titleChanged: ntitle(prev.title) !== ntitle(curr.title), prevTitle: prev.title, currTitle: curr.title,
      relocated: !!reloc, relocTitle: reloc?.title || null,
    });
  }
}

suspects.sort((a, b) => (b.relocated - a.relocated) || (a.score - b.score));
const relocated = suspects.filter((s) => s.relocated);
const titleChanged = suspects.filter((s) => s.titleChanged);
console.error(`\n=== thread swap verification (same-doc ≤ ${SWAP_MAX} across a modify) ===`);
console.error(JSON.stringify({
  modifyTransitions: transitions,
  suspectCliffs: suspects.length,
  withTitleChange: titleChanged.length,
  withRelocation_highConfidence: relocated.length, // old body found in another doc → likely a real mis-thread
}, null, 2));
console.error("\n--- highest-confidence suspected swaps (old body relocated elsewhere) ---");
for (const s of (relocated.length ? relocated : suspects).slice(0, 14)) {
  console.error(`  ${s.sha} s=${s.score}${s.synthetic ? " synth" : ""}  "${(s.prevTitle || "").slice(0, 28)}" → "${(s.currTitle || "").slice(0, 28)}"${s.relocated ? `  (old→ "${(s.relocTitle || "").slice(0, 24)}")` : ""}`);
}
log("done");
