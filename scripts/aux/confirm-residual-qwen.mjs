// Third-family corroboration of the frontier HINTS (plan §10.4 residual close-out). The frontier
// pass emits a HINT when its predecessor pick has no INDEPENDENT corroborator (matcher/forward/
// containment all disagreed), so it stays residual. This runs qwen — a family independent of the
// deepseek frontier and the mistral selector — over the residual and PROMOTES a hint to a locked
// decision when BOTH of these hold:
//   1. qwen independently picks the SAME predecessor as the hint (two independent LLM families agree), and
//   2. a DETERMINISTIC signal supports that pick: the matcher's autoKey == pick, OR the pick's matcher
//      content-similarity score >= --score (default 0.70). For a "none" hint, the matcher must ALSO have
//      had no confident predecessor (autoKey null) — i.e. the deterministic side agrees it's a birth.
// Two independent families + a similarity floor = strong enough to auto-decide. Recorded as a frontier
// lock (auto:"frontier") with corroborator:"qwen" so provenance stays "ai" and reuses every mapping.
//
//   bun scripts/aux/confirm-residual-qwen.mjs [--model qwen/qwen3.7-plus] [--score 0.7] [--apply]
//   (default is DRY — reports the agreement breakdown and writes nothing; --apply appends the promotions)
import fs from "node:fs";
import path from "node:path";
import { proposePredecessor } from "../../src/server/history-curate.ts";
import { config } from "../../src/server/config.ts";
import { buildClaimIndex, enrichSubject, enrichCandidates } from "../lib/curate-context.mjs";

const ROOT = process.cwd();
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const MODEL = arg("--model", "qwen/qwen3.7-plus");
const THRESH = Number(arg("--score", "0.7"));
const CONC = Math.max(1, Number(arg("--concurrency", "4")));
const APPLY = process.argv.includes("--apply");

if (!config.openrouterApiKey) { console.error("needs OPENROUTER_API_KEY in the environment."); process.exit(1); }
const QUEUE = path.join(ROOT, "public/history-curation.json");
const AUTO = path.join(ROOT, "public/history-auto-decisions.json");
const PROPOSALS = path.join(ROOT, "public/history-curation-proposals.json");
for (const f of [QUEUE, AUTO, PROPOSALS]) if (!fs.existsSync(f)) { console.error(`missing ${path.relative(ROOT, f)}`); process.exit(1); }

const q = JSON.parse(fs.readFileSync(QUEUE, "utf8"));
const auto = JSON.parse(fs.readFileSync(AUTO, "utf8"));
const hints = (JSON.parse(fs.readFileSync(PROPOSALS, "utf8")).proposals) || {};
const byCase = new Map((q.cases || []).map((c) => [c.key, c]));
const claimIndex = buildClaimIndex(q.cases);
const changeBySha = new Map();
for (const c of q.commits || []) if (c.prTitle || c.changeSummary) changeBySha.set(c.sha, { pr: c.pr, title: c.prTitle, summary: c.changeSummary });

const resolved = new Set((auto.decisions || []).map((d) => d.caseKey));
const residual = (q.cases || []).filter((c) => !resolved.has(c.key));
// Mutual-exclusion guard: an older occurrence is the predecessor of AT MOST ONE newer doc.
// The frontier HINTS this promotes were the cases the frontier could NOT lock — some point at
// an occurrence a stronger pass already claimed (which is often WHY they stayed residual). A
// promotion into an already-claimed occurrence would re-introduce the double-book the pass-0/
// conflict-sweep fix removed, so skip it (leave for the human). `${olderSha}|${chosenKey}`.
const claimKey = (sha, key) => `${sha}|${key}`;
const claimed = new Set((auto.decisions || []).filter((d) => d.chosenKey && d.chosenKey !== "none").map((d) => claimKey(d.olderSha, d.chosenKey)));
console.error(`residual: ${residual.length}  ·  with a frontier hint: ${residual.filter((c) => hints[c.key]).length}  ·  qwen model: ${MODEL}  ·  score floor: ${THRESH}${APPLY ? "  ·  APPLY" : "  ·  DRY (no write)"}\n`);

const scoreOf = (kase, key) => (kase.candidates || []).find((c) => c.key === key)?.score ?? 0;

async function mapPool(list, limit, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => { while (next < list.length) await fn(list[next++]); }));
}

const stat = { noHint: 0, qwenDisagree: 0, agreeButNoDet: 0, contended: 0, promote: 0, viaAutoKey: 0, viaScore: 0, viaNone: 0, errors: 0 };
const promotions = [];
let done = 0;
await mapPool(residual, CONC, async (kase) => {
  const hint = hints[kase.key]?.chosenKey;
  if (hint === undefined) { stat.noHint++; return; }
  const subject = enrichSubject(kase.subjectKey, q.nodes);
  const candidates = enrichCandidates(kase, q.nodes, claimIndex);
  if (!subject || !candidates.length) { stat.noHint++; return; }
  let pick;
  try { pick = (await proposePredecessor(subject, candidates, { model: MODEL, change: changeBySha.get(kase.newerSha) })).chosenKey; }
  catch (e) { stat.errors++; if (stat.errors <= 3) console.error(`  qwen error on ${kase.key}: ${String(e?.message || e).slice(0, 100)}`); return; }
  if (pick !== hint) { stat.qwenDisagree++; return; }
  // deterministic support for the agreed pick
  let det = null;
  if (pick === "none") { if (kase.autoKey == null) det = "none"; }
  else if (kase.autoKey === pick) det = "autoKey";
  else if (scoreOf(kase, pick) >= THRESH) det = "score";
  if (!det) { stat.agreeButNoDet++; return; }
  // mutual-exclusion: never promote onto an occurrence already claimed (by an existing decision or
  // an earlier promotion this run). No await between check and add → atomic across the concurrent pool.
  if (pick !== "none" && claimed.has(claimKey(kase.olderSha, pick))) { stat.contended++; return; }
  if (pick !== "none") claimed.add(claimKey(kase.olderSha, pick));
  stat.promote++;
  if (det === "autoKey") stat.viaAutoKey++; else if (det === "score") stat.viaScore++; else stat.viaNone++;
  promotions.push({
    caseKey: kase.key, kind: kase.kind, subjectKey: kase.subjectKey, newerSha: kase.newerSha, olderSha: kase.olderSha,
    chosenKey: pick, agreedWithAuto: pick === kase.autoKey, auto: "frontier", corroborator: "qwen", why: hints[kase.key]?.why || "",
  });
  if (++done % 15 === 0) console.error(`  …${done} promotable so far`);
});

console.error("\n=== qwen ∩ frontier-hint + deterministic ===");
console.error(`residual seen: ${residual.length}`);
console.error(`  no hint:                  ${stat.noHint}`);
console.error(`  qwen disagreed with hint: ${stat.qwenDisagree}`);
console.error(`  agreed but no det support: ${stat.agreeButNoDet}`);
console.error(`  agreed+det but occ already claimed (skipped): ${stat.contended}`);
console.error(`  PROMOTABLE (agree + det + free):  ${stat.promote}   [via autoKey ${stat.viaAutoKey} · score≥${THRESH} ${stat.viaScore} · none ${stat.viaNone}]`);
console.error(`  qwen errors:              ${stat.errors}`);
console.error(`\nresidual ${residual.length} → ${residual.length - stat.promote} if applied`);

if (APPLY && promotions.length) {
  const existing = new Set((auto.decisions || []).map((d) => d.caseKey));
  const add = promotions.filter((p) => !existing.has(p.caseKey));
  auto.decisions.push(...add);
  auto.count = auto.decisions.length;
  if (auto.auto) auto.auto.qwenPromoted = add.length;
  fs.writeFileSync(AUTO, JSON.stringify(auto, null, 2));
  console.error(`\napplied: appended ${add.length} promotions to ${path.relative(ROOT, AUTO)} (now ${auto.count} auto-decisions)`);
} else if (!APPLY) {
  console.error(`\n(dry run — re-run with --apply to append the ${stat.promote} promotions)`);
}