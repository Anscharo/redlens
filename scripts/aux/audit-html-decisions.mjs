// Decision audit of the HTML-era curation (plan §10.4) — pass 1 of 2. After the human curation
// step, double-check EVERY applied decision with an INDEPENDENT, cheap second model: for each
// decision (deterministic, AI, or human) re-ask "which older candidate is this newer doc's
// previous version?" and flag any case where the auditor disagrees with the recorded pick. The
// flagged set is then adjudicated by a stronger reviewer (pass 2 — Claude/a human) who makes the
// final call with a rationale. The auditor's pick is INDEPENDENT (it never sees the recorded
// decision), so a disagreement is a genuine second opinion, not a rubber stamp.
//
// OFFLINE review tooling: reads the committed decision files + the queue, writes ONLY .cache/
// (never artifact data on the build path), so determinism/reproducibility are untouched.
// Resumable: every auditor ask is cached by content-addressed caseKey + model, so a capped run
// never re-spends and a later run finishes the rest (mirrors the curate/resume loop).
//
//   bun scripts/aux/audit-html-decisions.mjs                  # audit public/history-decisions.json
//   bun scripts/aux/audit-html-decisions.mjs --limit 100      # cap NEW asks (resume later for the rest)
//   bun scripts/aux/audit-html-decisions.mjs --model M        # override the auditor model
//   bun scripts/aux/audit-html-decisions.mjs --decisions FILE # audit a different decisions file
//   bun scripts/aux/audit-html-decisions.mjs --no-cache       # ignore the resume cache (re-ask all)

import fs from "node:fs";
import path from "node:path";
import { proposePredecessor } from "../../src/server/history-curate.ts";
import { config } from "../../src/server/config.ts";
import { loadLlmCache, writeLlmCache } from "../lib/auto-curate-io.mjs";
import { buildAuditItems, summarizeAudit } from "../lib/audit-decisions.mjs";
import { buildClaimIndex, enrichSubject, enrichCandidates } from "../lib/curate-context.mjs";

const ROOT = process.cwd();
const arg = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; };
const CURATION = path.join(ROOT, "public/history-curation.json");
const DECISIONS = path.resolve(ROOT, arg("--decisions") || "public/history-decisions.json");
const CACHE_OUT = path.resolve(ROOT, arg("--cache") || ".cache/audit-html-decisions-cache.json");
const OUT_JSON = path.join(ROOT, ".cache/audit-html-disagreements.json");
const OUT_MD = path.join(ROOT, ".cache/audit-html-disagreements.md");
const LEDGER = path.join(ROOT, ".cache/audit-html-decisions.json");
const MODEL = arg("--model") || config.curationAuditModel;
const LIMIT = arg("--limit") ? Number(arg("--limit")) : Infinity;
const CONCURRENCY = arg("--concurrency") ? Math.max(1, Number(arg("--concurrency"))) : 6;
const NO_CACHE = process.argv.includes("--no-cache");

const t0 = Date.now();
const log = (m) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

if (!config.openrouterApiKey) { console.error("audit needs OPENROUTER_API_KEY in the environment."); process.exit(1); }
for (const f of [CURATION, DECISIONS]) {
  if (!fs.existsSync(f)) { console.error(`missing ${path.relative(ROOT, f)} — run pnpm htmlhist:curate (then curate + save) first`); process.exit(1); }
}

const data = JSON.parse(fs.readFileSync(CURATION, "utf8"));
const decisionsFile = JSON.parse(fs.readFileSync(DECISIONS, "utf8"));
const nodeOf = (k) => data.nodes[k] || { title: "(missing)", type: "", doc_no: null, content: "" };
const claimIndex = buildClaimIndex(data.cases); // sole-home signal, same as the curator sees
const changeBySha = new Map(); // per-commit PR/forum change description, keyed by newer sha
for (const c of data.commits || []) if (c.prTitle || c.changeSummary) changeBySha.set(c.sha, { pr: c.pr, title: c.prTitle, summary: c.changeSummary });
const { items, unmapped } = buildAuditItems(data, decisionsFile);
log(`auditing ${items.length} decisions from ${path.relative(ROOT, DECISIONS)} with ${MODEL}${unmapped.length ? `  (${unmapped.length} unmapped, skipped)` : ""}`);

const cache = NO_CACHE ? new Map() : loadLlmCache(CACHE_OUT);
if (cache.size) log(`resume cache: ${cache.size} prior asks`);

// Ask the auditor model to INDEPENDENTLY pick the predecessor (same prompt the curator used, a
// different/cheaper model, never shown the recorded pick). Cached by caseKey + model so re-runs
// don't re-spend; the --limit is spent only on NOT-yet-asked cases. Errors are NOT cached → retried.
// Exponential backoff absorbs OpenRouter rate-limiting (429s) — without it a throttled run errors
// out en masse and a resume just re-throttles. Backoff is per-case, so `asked` (the cap) is unchanged.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function askAuditor(subject, candidates, change, tries = 5) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await proposePredecessor(subject, candidates, { model: MODEL, change });
    } catch (e) {
      if (attempt >= tries - 1) throw e;
      await sleep(800 * 2 ** attempt + Math.floor(attempt * 137)); // 0.8s,1.7s,3.5s,7s… mild jitter
    }
  }
}
let asked = 0, cacheHits = 0, done = 0;
async function auditOne({ kase, decision }) {
  const key = `audit|${decision.caseKey}`;
  const hit = cache.get(key);
  if (hit && hit.model === MODEL) { cacheHits++; return hit; }
  if (asked >= LIMIT) return null; // over the cap → leave for a later run (resumable via cache)
  asked++;
  const candidates = enrichCandidates(kase, data.nodes, claimIndex);
  const subject = enrichSubject(kase.subjectKey, data.nodes) || { title: "(missing)", content: "" };
  try {
    const res = await askAuditor(subject, candidates, changeBySha.get(kase.newerSha));
    const out = { chosenKey: res.chosenKey, why: res.why, model: MODEL };
    cache.set(key, out);
    return out;
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

// Run with bounded concurrency, preserving order (the LLM calls are the bottleneck).
async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i], i);
      if (++done % 50 === 0) log(`  ${done}/${list.length} (asked ${asked}, cached ${cacheHits})`);
    }
  }));
  return out;
}

const results = await mapLimit(items, CONCURRENCY, auditOne);
const summary = summarizeAudit(items, results, nodeOf);

// ---- report (review-only, all under .cache/) -----------------------------------
fs.mkdirSync(path.join(ROOT, ".cache"), { recursive: true });
const meta = {
  kind: "html-era-decision-audit", model: MODEL, decisionsFile: path.relative(ROOT, DECISIONS),
  audited: summary.audited, agree: summary.agree, disagree: summary.disagree,
  skipped: summary.skipped, errors: summary.errors.length, unmapped: unmapped.length,
  byMethod: summary.byMethod, byKind: summary.byKind,
};

// full ledger: every audited decision + whether the auditor agreed (transparency + reproducibility)
const ledger = items.map((it, i) => {
  const r = results[i];
  return {
    caseKey: it.decision.caseKey, method: it.method, kind: it.decision.kind,
    decision: it.decision.chosenKey, auditor: r && !r.error ? r.chosenKey : null,
    agree: r && !r.error ? r.chosenKey === it.decision.chosenKey : null,
  };
});
fs.writeFileSync(LEDGER, JSON.stringify({ ...meta, ledger }, null, 1));
fs.writeFileSync(OUT_JSON, JSON.stringify({ ...meta, disagreements: summary.disagreements }, null, 2));
fs.writeFileSync(OUT_MD, renderMarkdown(meta, summary));
if (!NO_CACHE) {
  // Additive write: re-load whatever's on disk now and keep any entry we don't already hold, so a
  // resume STRICTLY grows the cache — it can never drop a prior run's asks (the observed clobber).
  for (const [k, v] of loadLlmCache(CACHE_OUT)) if (!cache.has(k)) cache.set(k, v);
  writeLlmCache(CACHE_OUT, cache);
  log(`wrote ${path.relative(ROOT, CACHE_OUT)}  (${cache.size} cached asks)`);
}

// ---- console summary -----------------------------------------------------------
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : "—");
console.error("\n=== decision audit ===");
console.error(`model: ${MODEL}   audited: ${summary.audited}   agree: ${summary.agree} (${pct(summary.agree, summary.audited)})   disagree: ${summary.disagree} (${pct(summary.disagree, summary.audited)})`);
if (summary.skipped) console.error(`skipped (over --limit ${LIMIT}): ${summary.skipped}  — re-run to finish (cache keeps the rest)`);
if (summary.errors.length) console.error(`errors (not cached, retried next run): ${summary.errors.length}`);
console.error("\nby method (how the ORIGINAL decision was made):");
for (const [m, s] of Object.entries(summary.byMethod)) console.error(`  ${m.padEnd(14)} ${String(s.disagree).padStart(4)} / ${String(s.audited).padStart(4)} disagree  (${pct(s.disagree, s.audited)})`);
console.error("\nby kind:");
for (const [k, s] of Object.entries(summary.byKind)) console.error(`  ${k.padEnd(14)} ${String(s.disagree).padStart(4)} / ${String(s.audited).padStart(4)} disagree  (${pct(s.disagree, s.audited)})`);
console.error(`\nwrote ${path.relative(ROOT, OUT_JSON)} + ${path.relative(ROOT, OUT_MD)} (${summary.disagree} flagged for pass-2 review) + ${path.relative(ROOT, LEDGER)}`);

// Pass-2-ready markdown: the flagged disagreements with full evidence, highest-signal first.
function renderMarkdown(meta, summary) {
  const lines = [];
  lines.push(`# HTML-era decision audit — disagreements`, "");
  lines.push(`Auditor model **${meta.model}** independently re-picked the predecessor for ${meta.audited} decisions in \`${meta.decisionsFile}\`.`, "");
  lines.push(`- agree: **${meta.agree}** · disagree: **${meta.disagree}** · skipped: ${meta.skipped} · errors: ${meta.errors}`, "");
  lines.push(`Disagreements by method: ${Object.entries(meta.byMethod).map(([m, s]) => `${m} ${s.disagree}/${s.audited}`).join(" · ") || "none"}`, "");
  lines.push(`> Pass 2: a reviewer adjudicates each below — keep the recorded decision or switch to the auditor's pick — and records why.`, "");
  summary.disagreements.forEach((d, i) => {
    lines.push(`---`, "", `## ${i + 1}. [${d.method}] ${d.kind} — ${d.subject.title || "(untitled)"}`, "");
    lines.push(`- **subject** (newer @ \`${d.newerSha}\`): ${d.subject.doc_no || "—"} *${d.subject.type || ""}* — ${d.subject.title}`);
    lines.push(`- **recorded decision** → \`${d.decision.chosenKey}\` — ${d.decision.title}`);
    lines.push(`- **auditor** → \`${d.auditor.chosenKey}\` — ${d.auditor.title}  _("${d.auditor.why}")_`, "");
    lines.push(`  candidates:`);
    for (const c of d.candidates) {
      const mark = c.isDecision && c.isAuditor ? "◆both" : c.isDecision ? "●decision" : c.isAuditor ? "○auditor" : "  ";
      lines.push(`  - ${mark} \`${(c.score ?? 0).toFixed?.(2) ?? c.score}\` ${c.title} *${c.type || ""}*`);
    }
    lines.push("", `  subject: ${d.subject.content.replace(/\n+/g, " ").slice(0, 280)}`, "");
  });
  return lines.join("\n");
}
