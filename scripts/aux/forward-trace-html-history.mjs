// Independent forward trace of the HTML-era atlas history + a forward/reverse
// inconsistency report (plan §4.0 / §10.4 "back-and-forward check"). OFFLINE only —
// like the audit, it writes a REVIEW report to .cache/, never artifact data, so
// determinism/reproducibility are untouched.
//
//   bun scripts/aux/forward-trace-html-history.mjs            # trace + diff, write report
//   bun scripts/aux/forward-trace-html-history.mjs --measure  # print summary, write nothing
//
// What it does:
//   1. load the 79 HTML commits oldest→newest (same converter as production).
//   2. forwardTrace() — assign INDEPENDENT quasi-ids forward from the first commit,
//      knowing nothing of the seed or the backward stitching.
//   3. diffPasses() — for every newer doc, compare the predecessor the forward
//      (mutual-best) pass names vs the reverse (production matchNodes) pass names.
//   4. join each divergence to the curation queue (public/history-curation.json, if
//      built) so we can tell "already a human decision" from "a confident reverse
//      pairing the independent pass disputes" (the higher-priority signal).
//   5. write .cache/forward-reverse-diff.json + print a ranked summary.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { loadHtmlAt } from "../lib/atlas-html.mjs";
import { forwardTrace, diffPasses, divergencePriority } from "../lib/history-forward-trace.mjs";

const ROOT = process.cwd();
const REPO = path.join(ROOT, "vendor/next-gen-atlas");
const OUT = path.join(ROOT, ".cache/forward-reverse-diff.json");
const CURATION = path.join(ROOT, "public/history-curation.json");
const MEASURE = process.argv.includes("--measure");
const LAST_HTML_SHA = "7b43d159";
const HTML = "Sky Atlas/Sky Atlas.html";

const git = (args) => execSync(`git -C "${REPO}" ${args}`, { maxBuffer: 1 << 30 }).toString();
const t0 = Date.now();
const log = (m) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

log("loading HTML commits (turndown per row — slow)…");
const shas = git(`log --reverse --format=%H ${LAST_HTML_SHA} -- '${HTML}'`).trim().split("\n");
const commits = shas.map((full, i) => {
  if (i % 20 === 0) log(`  …converting ${i}/${shas.length}`);
  return { sha: full.slice(0, 8), nodes: loadHtmlAt(full, REPO) };
});
log(`loaded ${commits.length} commits`);

// forward pass (independent quasi-ids) + the cross-check
const fwd = forwardTrace(commits);
const { tally, divergences } = diffPasses(commits, { recover: !process.argv.includes("--no-recover") });
log(`forward quasi-ids: ${fwd.quasiCount}  ·  divergences: ${divergences.length}`);

// join to the curation queue: which divergent newer docs are already a human case?
let curationKeys = new Set();
if (fs.existsSync(CURATION)) {
  const cur = JSON.parse(fs.readFileSync(CURATION, "utf8"));
  curationKeys = new Set((cur.cases || []).map((c) => c.key));
  log(`curation queue: ${curationKeys.size} cases (joining)`);
} else {
  log("curation queue not built — skipping join (run `pnpm htmlhist:curate` for the 'inCuration' annotation)");
}
for (const d of divergences) d.inCuration = curationKeys.has(d.newerKey);

// rank: most-surprising first (conflicts on confident reverse tiers, then greedy
// reverse-only guesses the independent pass couldn't corroborate, then the rest).
divergences.sort((a, b) => divergencePriority(a) - divergencePriority(b) || a.newerSha.localeCompare(b.newerSha));

// "Surprising" = a divergence NOT already covered by a curation case — the queue is
// supposed to contain the gray zone, so a divergence outside it means either a
// confident reverse pairing is shaky or the queue is missing a case.
const surprising = divergences.filter((d) => !d.inCuration);
const byType = (list) => list.reduce((m, d) => ((m[d.type] = (m[d.type] || 0) + 1), m), {});

const summary = {
  htmlCommits: commits.length,
  forwardQuasiIds: fwd.quasiCount,
  ...tally,
  agreementRate: +(tally.agree / Math.max(1, tally.agree + tally.conflict + tally.forwardOnly + tally.reverseOnly)).toFixed(4),
  divergenceTotal: divergences.length,
  divergencesByType: byType(divergences),
  notInCuration: surprising.length,
  notInCurationByType: byType(surprising),
};

console.error("\n=== forward vs reverse ===");
console.error(JSON.stringify(summary, null, 2));
console.error("\n--- top surprising divergences (not already a curation case) ---");
for (const d of surprising.slice(0, 12)) {
  const fo = d.forwardOlder ? `"${d.forwardOlder.title}"` : "(birth)";
  const ro = d.reverseOlder ? `"${d.reverseOlder.title}" t${d.reverseOlder.tier}` : "(birth)";
  console.error(`  [${d.type}] ${d.newerSha} "${d.newer.title}"  fwd←${fo}  rev←${ro}${d.reverseFlaggedAmbiguous ? "  (rev flagged)" : ""}`);
}

if (MEASURE) {
  console.error("\n--measure: report NOT written.");
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  // cap the embedded list so the file stays reviewable; counts above are complete.
  fs.writeFileSync(OUT, JSON.stringify({ meta: summary, forwardBirths: fwd.births, divergences: divergences.slice(0, 2000) }, null, 2));
  log(`wrote ${path.relative(ROOT, OUT)}  (${divergences.length} divergences, first 2000 embedded)`);
}
log("done");
