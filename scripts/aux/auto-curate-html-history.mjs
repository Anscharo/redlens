// Offline AUTO-curator for the HTML-era history queue (plan §10.4). Shrinks the
// hand-review queue by resolving the cases two INDEPENDENT signals already agree on,
// so a human only sees the genuinely contested ones. Like the audit + forward trace,
// it is OFFLINE review tooling: it writes a decisions file (gitignored), never artifact
// data on the build path, so determinism/reproducibility are untouched.
//
//   bun scripts/aux/auto-curate-html-history.mjs              # both passes, write decisions
//   bun scripts/aux/auto-curate-html-history.mjs --no-llm     # mechanism 1 only (no API calls)
//   bun scripts/aux/auto-curate-html-history.mjs --measure    # print stats, write nothing
//   bun scripts/aux/auto-curate-html-history.mjs --limit 25   # cap LLM calls (trial run)
//   bun scripts/aux/auto-curate-html-history.mjs --out FILE   # custom output path
//
// Two passes (see scripts/lib/auto-curate.mjs for the rules):
//   1. forward∩reverse — replay the INDEPENDENT forward tracer (forwardLinks) and lock
//      every case whose forward predecessor matches the reverse matcher's auto-pick.
//      Deterministic, free, the strongest signal.
//   2. LLM∩matcher — for the still-undecided cases whose matcher pick is ≥90% confident,
//      ask the shared LLM proposer; lock the ones where the model independently names
//      the matcher's pick.
// Output: public/history-auto-decisions.json — apply-ready (same shape the UI exports,
// consumable by `pnpm history:apply-decisions`) AND fetched by the curation UI as a
// pre-filled baseline so the queue the human walks is only the residual.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { loadHtmlAt } from "../lib/atlas-html.mjs";
import { forwardLinks } from "../lib/history-forward-trace.mjs";
import { autoConfidence, forwardAgrees, llmEligible, llmConfirms, resolveCase, LLM_CONFIRM_THRESHOLD } from "../lib/auto-curate.mjs";
import { proposePredecessor } from "../../src/server/history-curate.ts";
import { config } from "../../src/server/config.ts";

const ROOT = process.cwd();
const REPO = path.join(ROOT, "vendor/next-gen-atlas");
const CURATION = path.join(ROOT, "public/history-curation.json");
const arg = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; };
const OUT = path.resolve(ROOT, arg("--out") || "public/history-auto-decisions.json");
const MEASURE = process.argv.includes("--measure");
const NO_LLM = process.argv.includes("--no-llm");
const LIMIT = arg("--limit") ? Number(arg("--limit")) : Infinity;
const THRESHOLD = arg("--threshold") ? Number(arg("--threshold")) : LLM_CONFIRM_THRESHOLD;
const CONCURRENCY = arg("--concurrency") ? Math.max(1, Number(arg("--concurrency"))) : 5;
const LAST_HTML_SHA = "7b43d159";
const HTML = "Sky Atlas/Sky Atlas.html";

const git = (a) => execSync(`git -C "${REPO}" ${a}`, { maxBuffer: 1 << 30 }).toString();
const t0 = Date.now();
const log = (m) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const tallyByKind = (list) => list.reduce((m, c) => ((m[c.kind] = (m[c.kind] || 0) + 1), m), {});

if (!fs.existsSync(CURATION)) {
  console.error(`curation queue not found: ${path.relative(ROOT, CURATION)}\n  run: bun scripts/aux/build-history-curation.mjs`);
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(CURATION, "utf8"));
const cases = data.cases || [];
log(`curation queue: ${cases.length} cases (${JSON.stringify(tallyByKind(cases))})`);

// --- pass 1: forward∩reverse ------------------------------------------------------
log("loading HTML commits for the independent forward pass (turndown — slow)…");
const shas = git(`log --reverse --format=%H ${LAST_HTML_SHA} -- '${HTML}'`).trim().split("\n");
const commits = shas.map((full, i) => {
  if (i % 20 === 0) log(`  …converting ${i}/${shas.length}`);
  return { sha: full.slice(0, 8), nodes: loadHtmlAt(full, REPO) };
});
const links = forwardLinks(commits);
log(`forward links: ${links.size} newer nodes`);

const decisions = [];
const record = (kase, chosenKey, via, why) => decisions.push({
  caseKey: kase.key, kind: kase.kind, subjectKey: kase.subjectKey,
  newerSha: kase.newerSha, olderSha: kase.olderSha,
  chosenKey, agreedWithAuto: chosenKey === kase.autoKey, auto: via, ...(why ? { why } : {}),
});

const llmQueue = []; // ≥THRESHOLD-confident cases the forward pass did NOT corroborate
let fwdResolved = 0;
for (const kase of cases) {
  const fwd = links.get(kase.key) ?? null;
  if (forwardAgrees(kase, fwd)) { record(kase, kase.autoKey, "forward-reverse"); fwdResolved++; continue; }
  if (llmEligible(kase, THRESHOLD)) llmQueue.push(kase); // counted regardless; --no-llm just won't ask
}
log(`pass 1 (forward∩reverse): ${fwdResolved} locked · ${llmQueue.length} uncorroborated cases ≥${THRESHOLD} confident (LLM-eligible)`);

// --- pass 2: LLM∩matcher (≥THRESHOLD confident, still undecided) -------------------
const llmStats = { considered: 0, confirmed: 0, disagreed: 0, limited: 0, errors: 0 };
const haveKey = !!config.openrouterApiKey;
if (NO_LLM) {
  log(`pass 2 skipped (--no-llm) — ${llmQueue.length} LLM-eligible cases left for a human`);
  llmStats.limited = llmQueue.length;
} else if (!haveKey) {
  log("pass 2 skipped — no OpenRouter key configured (set OPENROUTER_API_KEY to run the LLM cross-check)");
  llmStats.limited = llmQueue.length;
} else {
  const toAsk = llmQueue.slice(0, Number.isFinite(LIMIT) ? LIMIT : llmQueue.length);
  llmStats.limited = llmQueue.length - toAsk.length;
  log(`pass 2 (LLM∩matcher): asking ${toAsk.length}/${llmQueue.length} eligible cases (concurrency ${CONCURRENCY})…`);
  let done = 0;
  await mapPool(toAsk, CONCURRENCY, async (kase) => {
    const subject = data.nodes[kase.subjectKey];
    const candidates = kase.candidates
      .map((c) => ({ key: c.key, node: data.nodes[c.key] }))
      .filter((c) => c.node)
      .map((c) => ({ key: c.key, title: c.node.title, content: c.node.content }));
    if (!subject || !candidates.length) return;
    llmStats.considered++;
    try {
      const { chosenKey, why } = await proposePredecessor({ title: subject.title, content: subject.content }, candidates);
      if (llmConfirms(kase, chosenKey)) { record(kase, kase.autoKey, "llm-90", why); llmStats.confirmed++; }
      else llmStats.disagreed++;
    } catch (e) {
      llmStats.errors++;
      if (llmStats.errors <= 3) log(`  llm error on ${kase.key}: ${String(e?.message || e).slice(0, 120)}`);
    }
    if (++done % 25 === 0) log(`  …${done}/${toAsk.length} asked (${llmStats.confirmed} confirmed)`);
  });
  log(`pass 2 (LLM∩matcher): ${llmStats.confirmed} locked · ${llmStats.disagreed} LLM disagreed · ${llmStats.errors} errors`);
}

// --- report + write ----------------------------------------------------------------
const resolvedKeys = new Set(decisions.map((d) => d.caseKey));
const residual = cases.filter((c) => !resolvedKeys.has(c.key));
const summary = {
  totalCases: cases.length,
  resolved: decisions.length,
  resolvedByForwardReverse: fwdResolved,
  resolvedByLlm: llmStats.confirmed,
  residual: residual.length,
  reductionPct: +((decisions.length / Math.max(1, cases.length)) * 100).toFixed(1),
  llm: { eligible: llmQueue.length, ...llmStats, threshold: THRESHOLD },
  resolvedByKind: tallyByKind(cases.filter((c) => resolvedKeys.has(c.key))),
  residualByKind: tallyByKind(residual),
};
console.error("\n=== auto-curation ===");
console.error(JSON.stringify(summary, null, 2));
console.error(
  `\nhand-review queue: ${cases.length} → ${residual.length}  ` +
  `(${summary.reductionPct}% auto-resolved: ${fwdResolved} forward∩reverse + ${llmStats.confirmed} LLM∩matcher)`,
);

if (MEASURE) {
  console.error("\n--measure: decisions NOT written.");
} else {
  const file = {
    kind: "html-era-history-decisions",
    source: "auto-curate",
    builtFrom: { migrationSha: data.meta?.migrationSha, lastHtmlSha: data.meta?.lastHtmlSha },
    auto: { forwardReverse: fwdResolved, ...llmStats, threshold: THRESHOLD, concurrency: CONCURRENCY },
    count: decisions.length,
    decisions,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(file, null, 2));
  log(`wrote ${path.relative(ROOT, OUT)}  (${decisions.length} auto-decisions)`);
  console.error(
    `\nnext: review the ${residual.length} residual cases at /reports/history-curate (auto-resolved cases are pre-filled),\n` +
    `then bake everything with:  pnpm history:apply-decisions ${path.relative(ROOT, OUT)}`,
  );
}
log("done");

// bounded-concurrency async map (no deps): keeps at most `n` promises in flight.
async function mapPool(items, n, fn) {
  const it = items[Symbol.iterator]();
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    for (let next = it.next(); !next.done; next = it.next()) await fn(next.value);
  });
  await Promise.all(workers);
}
