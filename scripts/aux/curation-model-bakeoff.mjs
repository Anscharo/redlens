// Model bakeoff for the HTML-era curation SELECTOR (plan §10.4). Picking the predecessor model by
// vibes is wrong; measure it. Scores a roster of models on two sets:
//   EASY  — cases the DETERMINISTIC passes already locked (forward∩reverse + containment): free,
//           trustworthy gold. A model that can't match these is disqualified as a selector.
//   HARD  — a hand-labeled set of the genuinely-ambiguous cases (title-degenerate / boilerplate /
//           scope): the signal that actually discriminates. Built by curation-hard-set.mjs.
// Per model it reports accuracy on each set, JSON-compliance (non-JSON → an exception here),
// none-rate, latency, and an estimated $/1k-cases from OpenRouter's live pricing. Reuses the EXACT
// production prompt (proposePredecessor) + context (curate-context + the per-commit change), so the
// numbers reflect what the real pipeline would do.
//
//   bun scripts/aux/curation-model-bakeoff.mjs [--easy 120] [--hard .cache/curation-hard-gold.json]
//        [--models a,b,c] [--concurrency 4]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { proposePredecessor } from "../../src/server/history-curate.ts";
import { config } from "../../src/server/config.ts";
import { buildClaimIndex, enrichSubject, enrichCandidates } from "../lib/curate-context.mjs";

const ROOT = process.cwd();
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const QUEUE = path.join(ROOT, "public/history-curation.json");
const AUTO = path.join(ROOT, "public/history-auto-decisions.json");
const HARDSET = path.join(ROOT, "public/history-hard-set.json"); // the bakeoff case keys
const DECISIONS = path.join(ROOT, "public/history-decisions.json"); // your UI picks = the hard gold
const GOLD_FALLBACK = path.resolve(ROOT, arg("--hard", ".cache/curation-hard-gold.json")); // by-number fallback
const EASY_N = Number(arg("--easy", "120"));
const CONC = Math.max(1, Number(arg("--concurrency", "4")));
const DEFAULT_MODELS = [
  "deepseek/deepseek-v4-flash", "deepseek/deepseek-v4-pro", "google/gemma-4-31b-it",
  "openai/gpt-oss-120b", "mistralai/mistral-nemo", "qwen/qwen3-32b", "openai/gpt-5.5",
];
const MODELS = (arg("--models", "") ? arg("--models", "").split(",") : DEFAULT_MODELS).map((s) => s.trim()).filter(Boolean);

if (!config.openrouterApiKey) { console.error("bakeoff needs OPENROUTER_API_KEY in the environment."); process.exit(1); }
for (const f of [QUEUE, AUTO]) if (!fs.existsSync(f)) { console.error(`missing ${path.relative(ROOT, f)} — run pnpm htmlhist:curate first`); process.exit(1); }

const data = JSON.parse(fs.readFileSync(QUEUE, "utf8"));
const auto = JSON.parse(fs.readFileSync(AUTO, "utf8"));
const byCase = new Map((data.cases || []).map((c) => [c.key, c]));
const claimIndex = buildClaimIndex(data.cases);
const changeBySha = new Map();
for (const c of data.commits || []) if (c.prTitle || c.changeSummary) changeBySha.set(c.sha, { pr: c.pr, title: c.prTitle, summary: c.changeSummary });

// ---- build the two labeled sets -------------------------------------------------
// EASY: deterministic locks only (the trustworthy mechanisms), capped + interleaved by kind so the
// sample isn't all seed-close. HARD: the hand-labeled file (skipped with a warning if absent).
const DETERMINISTIC = new Set(["forward-reverse", "containment"]);
const easyAll = (auto.decisions || [])
  .filter((d) => DETERMINISTIC.has(d.auto) && d.chosenKey && byCase.has(d.caseKey))
  .map((d) => ({ caseKey: d.caseKey, gold: d.chosenKey }));
const easy = easyAll.slice(0, Number.isFinite(EASY_N) ? EASY_N : easyAll.length);

// HARD gold: prefer your UI picks (history-decisions.json ∩ history-hard-set.json — label the "Hard
// set" filter in the curation page, then ⤒ save). Fall back to the by-number JSON if you edited that.
const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);
let hard = [];
const hardSetFile = readJson(HARDSET);
const decFile = readJson(DECISIONS);
if (hardSetFile && decFile) {
  const dec = new Map((decFile.decisions || []).map((d) => [d.caseKey, d.chosenKey]));
  const keys = hardSetFile.caseKeys || [];
  const labeled = keys.map((k) => ({ caseKey: k, gold: dec.get(k) })).filter((x) => x.gold !== undefined);
  // drop STALE gold — a pick whose chosenKey is no longer a candidate of this case (labeled on an
  // earlier queue rev). Scoring against a key no model can return would just uniformly penalize all.
  hard = labeled.filter((x) => x.gold === "none" || (byCase.get(x.caseKey)?.candidates || []).some((c) => c.key === x.gold));
  console.error(`hard gold: ${hard.length} valid of ${labeled.length} labeled (${labeled.length - hard.length} stale, skipped) — ${keys.length} in the hard set`);
} else {
  const raw = readJson(GOLD_FALLBACK)?.cases || [];
  hard = raw.map((x) => {
    if (x.gold === "skip" || x.gold == null) return null;
    if (x.gold === "none") return { caseKey: x.caseKey, gold: "none" };
    const kase = byCase.get(x.caseKey); if (!kase) return null;
    const key = enrichCandidates(kase, data.nodes, claimIndex)[Number(x.gold) - 1]?.key;
    return key ? { caseKey: x.caseKey, gold: key } : null;
  }).filter(Boolean);
}
if (!hard.length) console.error(`(no labeled hard set — run curation-hard-set.mjs, label the "Hard set" filter in the UI + save, then re-run. Running EASY only.)`);
console.error(`bakeoff: ${MODELS.length} models · EASY ${easy.length}/${easyAll.length} deterministic locks · HARD ${hard.length} hand-labeled`);

const items = [...easy.map((x) => ({ ...x, set: "easy" })), ...hard.map((x) => ({ ...x, set: "hard" }))];
const promptFor = (kase) => ({
  subject: enrichSubject(kase.subjectKey, data.nodes),
  candidates: enrichCandidates(kase, data.nodes, claimIndex),
  change: changeBySha.get(kase.newerSha),
});

// ---- live pricing (best-effort) -------------------------------------------------
let priceMap = new Map();
try {
  const raw = execFileSync("curl", ["-sL", "--max-time", "20", "https://openrouter.ai/api/v1/models"], { encoding: "utf8", maxBuffer: 1 << 24 });
  for (const m of JSON.parse(raw).data) priceMap.set(m.id, { in: +m.pricing.prompt, out: +m.pricing.completion });
} catch { /* cost estimate skipped */ }
const approxTokens = (s) => Math.ceil((s || "").length / 4);

// ---- run ------------------------------------------------------------------------
async function mapPool(list, limit, fn) {
  const out = new Array(list.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) { const i = next++; out[i] = await fn(list[i]); }
  }));
  return out;
}

const results = {};
for (const model of MODELS) {
  const stat = { easy: { n: 0, ok: 0 }, hard: { n: 0, ok: 0 }, none: 0, jsonFail: 0, ms: 0, inTok: 0, outTok: 0 };
  let done = 0;
  await mapPool(items, CONC, async (it) => {
    const kase = byCase.get(it.caseKey); if (!kase) return;
    const { subject, candidates, change } = promptFor(kase);
    if (!subject || !candidates.length) return;
    const t0 = Date.now();
    try {
      const res = await proposePredecessor(subject, candidates, { model, change });
      stat.ms += Date.now() - t0;
      stat.inTok += approxTokens(subject.content) + candidates.reduce((s, c) => s + approxTokens(c.content) + approxTokens(c.diff), 0) + approxTokens(change?.summary);
      stat.outTok += 20;
      if (res.chosenKey === "none") stat.none++;
      const s = stat[it.set]; s.n++;
      if (res.chosenKey === it.gold) s.ok++;
    } catch { stat.jsonFail++; }
    if (++done % 40 === 0) console.error(`  ${model}: ${done}/${items.length}`);
  });
  const price = priceMap.get(model);
  const costPer1k = price ? ((stat.inTok / items.length) * price.in + (stat.outTok / items.length) * price.out) * 1000 : null;
  results[model] = {
    easyAcc: stat.easy.n ? stat.easy.ok / stat.easy.n : null,
    hardAcc: stat.hard.n ? stat.hard.ok / stat.hard.n : null,
    noneRate: items.length ? stat.none / items.length : 0,
    jsonFail: stat.jsonFail, avgMs: Math.round(stat.ms / Math.max(1, items.length - stat.jsonFail)), costPer1k,
  };
  const r = results[model];
  console.error(`${model.padEnd(30)} easy ${pct(r.easyAcc)}  hard ${pct(r.hardAcc)}  none ${pct(r.noneRate)}  jsonFail ${r.jsonFail}  ${r.avgMs}ms  ${r.costPer1k != null ? "$" + r.costPer1k.toFixed(2) + "/1k" : ""}`);
}

function pct(x) { return x == null ? "  — " : `${(100 * x).toFixed(0)}%`.padStart(4); }

// ---- report ---------------------------------------------------------------------
fs.mkdirSync(path.join(ROOT, ".cache"), { recursive: true });
const OUT = path.join(ROOT, ".cache/curation-model-bakeoff.json");
fs.writeFileSync(OUT, JSON.stringify({ easy: easy.length, hard: hard.length, models: results }, null, 2));
console.error(`\n=== bakeoff (easy=${easy.length} deterministic locks, hard=${hard.length} hand-labeled) ===`);
console.error("model                          easy  hard  none  jsonFail  latency  cost");
for (const [m, r] of Object.entries(results))
  console.error(`${m.padEnd(30)} ${pct(r.easyAcc)}  ${pct(r.hardAcc)}  ${pct(r.noneRate)}  ${String(r.jsonFail).padStart(4)}     ${String(r.avgMs).padStart(5)}ms  ${r.costPer1k != null ? "$" + r.costPer1k.toFixed(2) + "/1k" : "—"}`);
console.error(`\nwrote ${path.relative(ROOT, OUT)}`);
