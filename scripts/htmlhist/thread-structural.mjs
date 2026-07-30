// Structural threading pass over the #117 seam (see history-anchored-align.mjs for WHY).
//
// The content passes leave the atlas's degenerate template leaves — "Global Activation
// Status" and friends, one word of prose repeated once per primitive per agent — as
// seam:"created", i.e. "born at #117", when the HTML plainly carried them. This pass
// recovers those by ORDER: docs the seed already threaded are anchors, and a doc between
// two anchors on one side must correspond to a doc between the same two anchors on the
// other. It emits only the assignments those bounds FORCE, never a ranked guess.
//
// Output is ordinary curation decisions (plan §10.4), so everything downstream — apply,
// audit, render-decisions, check-cross-agent — works on them unchanged.
//
//   bun scripts/htmlhist/thread-structural.mjs                 # write the proposals file
//   bun scripts/htmlhist/thread-structural.mjs --measure       # report only, write nothing
//   bun scripts/htmlhist/thread-structural.mjs --merge         # fold into history-decisions.json
//   bun scripts/htmlhist/thread-structural.mjs --out <path>    # alternate output path
//
// ADDITIVE by construction: it reads the committed decisions as input (so curated picks
// are anchors, never overwritten) and `--merge` skips any subject already decided.

import fs from "node:fs";
import path from "node:path";
import { seedHtmlEra, SEED_HTML, MD117 } from "./run-thread.mjs";
import { anchoredAlign } from "./history-anchored-align.mjs";
import { contentDupCounts, occKey } from "./history-occkey.mjs";

const ROOT = process.cwd();
const DECISIONS = path.join(ROOT, "public/history-decisions.json");
const MEASURE = process.argv.includes("--measure");
const MERGE = process.argv.includes("--merge");
const OUT = (() => {
  const i = process.argv.indexOf("--out");
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? path.resolve(ROOT, process.argv[i + 1])
    : path.join(ROOT, "public/history-structural-decisions.json");
})();

const t0 = Date.now();
const hasDecisions = fs.existsSync(DECISIONS);
console.error(`seed: ${hasDecisions ? `applying ${path.relative(ROOT, DECISIONS)}` : "no committed decisions (plain auto-seed)"}`);
const { md, htmlNodes, seed, applied } = seedHtmlEra({ decisionsPath: hasDecisions ? DECISIONS : null });
if (applied) console.error(`seed: applied ${applied.seed} seed decisions, ${applied.unresolved} unresolved`);
console.error(`loaded seam in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${md.length} md docs vs ${htmlNodes.length} html rows`);

const { pairs, gaps, stats } = anchoredAlign(md, htmlNodes, seed.uuidByRow);

// forced pairs → seed-close decisions keyed exactly as resolveDecisionOverrides resolves them
const dupCounts = contentDupCounts(htmlNodes);
const decisions = pairs.map((p) => ({
  caseKey: `${MD117}:${p.mdUuid}`,
  kind: "seed-close",
  subjectKey: `${MD117}:${p.mdUuid}`,
  newerSha: MD117,
  olderSha: SEED_HTML,
  chosenKey: occKey(SEED_HTML, p.htmlNode, dupCounts),
  agreedWithAuto: false, // by definition: the auto seed left these unthreaded
  method: "deterministic",
  auto: "structural-align",
  why: `anchored order alignment (${p.rule}): forced between adjacent threaded anchors in a ${p.gapSize}-doc gap; title+type identical${p.contentEq ? ", content identical" : ""}`,
}));

// A chosen row must be free — two md docs claiming one HTML row would break the
// one-uuid-per-row invariant the seed maintains. Forced pairs can't collide (each gap
// pairs 1:1 and gaps are disjoint), so this is a guard, not a filter.
const byRow = new Map();
for (const d of decisions) {
  if (byRow.has(d.chosenKey)) throw new Error(`row ${d.chosenKey} claimed twice (${byRow.get(d.chosenKey)} / ${d.subjectKey})`);
  byRow.set(d.chosenKey, d.subjectKey);
}

const gapReasons = {};
for (const g of gaps) gapReasons[g.reason] = (gapReasons[g.reason] || 0) + 1;
const contentIdentical = pairs.filter((p) => p.contentEq).length;
console.error("\n=== structural pass ===");
console.error(JSON.stringify({ ...stats, contentIdentical, gapReasons }, null, 2));

// what it actually recovered, by title — the eyeball check before anyone applies it
const byTitle = new Map();
for (const p of pairs) byTitle.set(p.title, (byTitle.get(p.title) || 0) + 1);
const top = [...byTitle].sort((a, b) => b[1] - a[1]).slice(0, 15);
console.error(`\ntop recovered titles (${byTitle.size} distinct):`);
for (const [title, n] of top) console.error(`  ${String(n).padStart(4)}  ${title}`);

if (MEASURE) {
  console.error("\n--measure: nothing written.");
} else if (MERGE) {
  const file = JSON.parse(fs.readFileSync(DECISIONS, "utf8"));
  const decided = new Set((file.decisions || []).map((d) => d.subjectKey));
  const fresh = decisions.filter((d) => !decided.has(d.subjectKey));
  file.decisions = [...(file.decisions || []), ...fresh];
  file.count = file.decisions.length;
  fs.writeFileSync(DECISIONS, `${JSON.stringify(file, null, 2)}\n`);
  console.error(`\nmerged ${fresh.length} new decision(s) into ${path.relative(ROOT, DECISIONS)} (${decisions.length - fresh.length} already decided, left alone) → ${file.count} total`);
  console.error("next: pnpm htmlhist:apply  (re-freezes public/history-html-era.json)");
} else {
  const artifact = {
    kind: "html-era-structural-decisions",
    note: "Forced-by-order seam threading (scripts/htmlhist/history-anchored-align.mjs). Merge with --merge, or apply directly: pnpm htmlhist:apply public/history-structural-decisions.json",
    builtFrom: { migrationCommit: MD117, lastHtmlCommit: SEED_HTML, seededFrom: hasDecisions ? "public/history-decisions.json" : null },
    stats: { ...stats, contentIdentical, gapReasons },
    count: decisions.length,
    decisions,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`);
  console.error(`\nwrote ${path.relative(ROOT, OUT)} — ${decisions.length} decision(s)`);
  console.error("next: --merge to fold into public/history-decisions.json, then pnpm htmlhist:apply");
}
console.error(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
