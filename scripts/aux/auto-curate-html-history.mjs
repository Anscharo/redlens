// Standalone AUTO-curator for the HTML-era history queue (plan §10.4). Re-runs the
// two auto-resolution passes over an EXISTING queue (public/history-curation.json)
// without rebuilding it — handy when tuning the threshold or re-running the LLM pass.
// The combined `pnpm htmlhist:curate` builds the queue AND auto-resolves in one shot
// (see build-history-curation.mjs --auto); reach for this one only to re-resolve.
//
//   bun scripts/aux/auto-curate-html-history.mjs              # both passes, write decisions
//   bun scripts/aux/auto-curate-html-history.mjs --no-llm     # mechanism 1 only (no API calls)
//   bun scripts/aux/auto-curate-html-history.mjs --measure    # print stats, write nothing
//   bun scripts/aux/auto-curate-html-history.mjs --limit 25   # cap LLM calls (trial run)
//   bun scripts/aux/auto-curate-html-history.mjs --concurrency 12 --out FILE
//   bun scripts/aux/auto-curate-html-history.mjs --frontier [--frontier-limit N] [--frontier-model M]
//                                                            # pass 3: escalate uncertain residual
//
// Like the audit + forward trace, this is OFFLINE review tooling: it writes a decisions
// file (gitignored), never artifact data on the build path, so determinism is untouched.
// Output: public/history-auto-decisions.json — apply-ready (same shape the UI exports,
// consumable by `pnpm htmlhist:apply`) AND fetched by the curation UI as a pre-filled
// baseline so the queue the human walks is only the residual.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { loadHtmlAt } from "../lib/atlas-html.mjs";
import { runAutoCurate } from "../lib/auto-curate-run.mjs";
import { writeAutoDecisions, reportAutoCuration, writeProposals, loadLlmCache, writeLlmCache } from "../lib/auto-curate-io.mjs";
import { proposePredecessor } from "../../src/server/history-curate.ts";
import { config } from "../../src/server/config.ts";

const ROOT = process.cwd();
const REPO = path.join(ROOT, "vendor/next-gen-atlas");
const CURATION = path.join(ROOT, "public/history-curation.json");
const arg = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; };
const OUT = path.resolve(ROOT, arg("--out") || "public/history-auto-decisions.json");
const PROPOSALS_OUT = path.resolve(ROOT, arg("--proposals-out") || "public/history-curation-proposals.json");
const CACHE_OUT = path.resolve(ROOT, arg("--cache") || "public/history-curation-llm-cache.json");
const NO_CACHE = process.argv.includes("--no-cache");
const MEASURE = process.argv.includes("--measure");
const FRONTIER_MODEL = arg("--frontier-model") || config.curationFrontierModel;
const opts = {
  noLlm: process.argv.includes("--no-llm"),
  containment: !process.argv.includes("--no-containment"),
  limit: arg("--limit") ? Number(arg("--limit")) : Infinity,
  threshold: arg("--threshold") ? Number(arg("--threshold")) : undefined,
  concurrency: arg("--concurrency") ? Math.max(1, Number(arg("--concurrency"))) : 5,
  frontier: process.argv.includes("--frontier"),
  frontierModel: FRONTIER_MODEL,
  frontierLimit: arg("--frontier-limit") ? Number(arg("--frontier-limit")) : Infinity,
  frontierConcurrency: arg("--frontier-concurrency") ? Math.max(1, Number(arg("--frontier-concurrency"))) : 3,
};
const LAST_HTML_SHA = "7b43d159";
const HTML = "Sky Atlas/Sky Atlas.html";

const git = (a) => execSync(`git -C "${REPO}" ${a}`, { maxBuffer: 1 << 30 }).toString();
const t0 = Date.now();
const log = (m) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

if (!fs.existsSync(CURATION)) {
  console.error(`curation queue not found: ${path.relative(ROOT, CURATION)}\n  run: pnpm htmlhist:curate`);
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(CURATION, "utf8"));
log(`curation queue: ${(data.cases || []).length} cases`);

log("loading HTML commits for the independent forward pass (turndown — slow)…");
const shas = git(`log --reverse --format=%H ${LAST_HTML_SHA} -- '${HTML}'`).trim().split("\n");
const commits = shas.map((full, i) => {
  if (i % 20 === 0) log(`  …converting ${i}/${shas.length}`);
  return { sha: full.slice(0, 8), nodes: loadHtmlAt(full, REPO) };
});

const cache = NO_CACHE ? new Map() : loadLlmCache(CACHE_OUT);
if (cache.size) log(`resuming from ${cache.size} cached asks`);
const { decisions, proposals, summary, cache: outCache } = await runAutoCurate({ data, commits, propose: proposePredecessor, haveKey: !!config.openrouterApiKey, ...opts, cache, cheapModel: config.chatModel, log });
reportAutoCuration(data, decisions, summary);
if (MEASURE) console.error("\n--measure: decisions NOT written.");
else {
  writeAutoDecisions(OUT, data, decisions, summary, opts.concurrency);
  log(`wrote ${path.relative(ROOT, OUT)}  (${decisions.length} auto-decisions)`);
  if (opts.frontier) {
    writeProposals(PROPOSALS_OUT, FRONTIER_MODEL, proposals);
    log(`wrote ${path.relative(ROOT, PROPOSALS_OUT)}  (${proposals.length} frontier hints)`);
  }
  if (!NO_CACHE) { writeLlmCache(CACHE_OUT, outCache); log(`wrote ${path.relative(ROOT, CACHE_OUT)}  (${outCache.size} cached asks)`); }
}
log("done");
