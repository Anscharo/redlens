// CHASE matcher-recall false births (plan §4.2 follow-up). The reverse matcher pairs
// docs per hop; whatever's left is a "death" (older, no successor) or a "birth" (newer,
// no predecessor). Some of those are SPURIOUS — the same document, which the matcher
// failed to pair, so it shows up as a death+birth instead of a continuation. This finds
// unmatched death↔birth pairs with high same-document similarity (ordered containment,
// the independent measure) and explains WHY the matcher missed them, so we can see the
// recall gap's shape before touching the (load-bearing) matcher.
//
//   bun scripts/aux/measure-matcher-recall.mjs            # report the gap + causes
//
// Offline; writes nothing.

import path from "node:path";
import { execSync } from "node:child_process";
import { loadHtmlAt } from "./atlas-html.mjs";
import { matchNodes } from "./history-identity.mjs";
import { sameDocScore } from "./ordered-containment.mjs";

const ROOT = process.cwd();
const REPO = path.join(ROOT, "vendor/next-gen-atlas");
const LAST_HTML_SHA = "7b43d159";
const HTML = "Sky Atlas/Sky Atlas.html";
const RECOVER_MIN = 0.8; // a death↔birth this similar is almost certainly the same doc
const git = (a) => execSync(`git -C "${REPO}" ${a}`, { maxBuffer: 1 << 30 }).toString();
const t0 = Date.now();
const log = (m) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

log("loading HTML commits…");
const shas = git(`log --reverse --format=%H ${LAST_HTML_SHA} -- '${HTML}'`).trim().split("\n");
const commits = shas.map((full, i) => { if (i % 20 === 0) log(`  …${i}/${shas.length}`); return { sha: full.slice(0, 8), nodes: loadHtmlAt(full, REPO) }; });

const ntitle = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
const recovered = [];
let births = 0, deaths = 0;
for (let i = 1; i < commits.length; i++) {
  const { olderUnmatched, newerUnmatched } = matchNodes(commits[i - 1].nodes, commits[i].nodes);
  births += newerUnmatched.length; deaths += olderUnmatched.length;
  // mutual-best death↔birth by same-document similarity, ≥ RECOVER_MIN: a continuation
  // the matcher dropped. (Greedy per death is fine for a diagnostic.)
  for (const d of olderUnmatched) {
    let best = null, bs = 0;
    for (const b of newerUnmatched) { const s = sameDocScore(d.content, b.content); if (s > bs) { bs = s; best = b; } }
    if (best && bs >= RECOVER_MIN) recovered.push({
      sha: commits[i].sha, score: +bs.toFixed(2), death: d, birth: best,
      sameSection: d.section === best.section, sameTitle: ntitle(d.title) === ntitle(best.title),
      sameKey: d.structuralKey === best.structuralKey,
    });
  }
  if (i % 20 === 0) log(`  hop ${i}: recoverable ${recovered.length}`);
}

// what the opt-in recovery tier (matchNodes recoverByContent) would ACTUALLY pair, and
// the resulting drop in spurious births/deaths.
let tier35 = 0, birthsAfter = 0, deathsAfter = 0;
for (let i = 1; i < commits.length; i++) {
  const r = matchNodes(commits[i - 1].nodes, commits[i].nodes, { recoverByContent: true });
  tier35 += r.pairs.filter((p) => p.tier === 3.5).length;
  birthsAfter += r.newerUnmatched.length; deathsAfter += r.olderUnmatched.length;
}

const pct = (n) => `${n} (${((n / Math.max(1, recovered.length)) * 100).toFixed(0)}%)`;
const crossSection = recovered.filter((r) => !r.sameSection);
const sameTitle = recovered.filter((r) => r.sameTitle);
const keyHeld = recovered.filter((r) => r.sameKey);
console.error(`\n=== matcher-recall gap (death↔birth same-doc ≥ ${RECOVER_MIN}) ===`);
console.error(JSON.stringify({
  hops: commits.length - 1, births, deaths,
  recoverableContinuations: recovered.length,
  crossSectionMove: pct(crossSection.length),     // tier-3 is section-scoped → can't see these
  sameTitle: pct(sameTitle.length),
  structuralKeyHeldButMissed: pct(keyHeld.length), // tier-2 SHOULD have caught these — different cause
  tier35Recovers: tier35, // what recoverByContent (mutual-best ≥0.85) actually pairs
  birthsAfterRecovery: `${births} → ${birthsAfter}`,
  deathsAfterRecovery: `${deaths} → ${deathsAfter}`,
}, null, 2));
console.error("\n--- sample recoverable continuations (death ⟶ birth) ---");
for (const r of recovered.slice(0, 14)) {
  console.error(`  ${r.sha} s=${r.score} ${r.sameSection ? "same-sec" : "XSEC"} ${r.sameTitle ? "same-title" : "diff-title"} ${r.sameKey ? "same-key" : "diff-key"}  "${(r.death.title || "").slice(0, 30)}" ⟶ "${(r.birth.title || "").slice(0, 30)}"`);
}
log("done");
