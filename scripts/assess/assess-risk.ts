// Risk-rules assessment — LLM-drafted ratings for every atlas paragraph that
// defines a risk rule/parameter/process, against docs/risk-assessment-rubric.md.
// Two incremental stages: triage (in-scope / rule-vs-mention as Jev
// probabilities, assess-risk-jev.ts) and assess (description + preciseness 1-5
// + enforcement weak/mid/strong, a writing model). A row is only (re)run when
// its quote or the rubric changed, so a new model needs --force.
// Output is the committed, human-reviewed artifact public/risk-assessment.json.
//
//   pnpm risk:assess --dry-run             census + sample prompts, zero API calls
//   pnpm risk:assess --bakeoff             calibration docs across the assess models, no writes
//   pnpm risk:assess --stage triage        triage only (default: all)
//   pnpm risk:assess --limit 5 | --only <uuid|key> | --force
//   pnpm risk:assess --width <n>           parallel assess calls (default 6; use 1 for :free models)
//   pnpm risk:assess --model <id>          assess model (default claude-haiku-5.5: bakeoff winner
//                                          on rubric adherence; luna broke the stub rule)
//   pnpm risk:assess --triage-model <id>   System One triage model (default cloudflare/clef: 9/15 on a
//                                          blind review vs jev-1.13 5/15 and gemma 7/15)
//   pnpm risk:assess --rule-tau <p> --domain-tau <p>   triage thresholds, default 0.4 (pnpm risk:triage-compare)
//   pnpm risk:assess --export              artifact → .cache/risk-assessment.md, no API
//
// Runs under bun (auto-loads OPENROUTER_API_KEY from .env.local). Requires
// public/docs.json (pnpm build:index).

import fs from "node:fs";
import path from "node:path";
import type { AtlasNode } from "../../src/types";
import { enumerateRiskCandidates, type RiskCandidate } from "../../src/lib/riskRules";
import type { RiskAssessmentArtifact, RiskAssessmentEntry, RiskRating, RiskTriage } from "../../src/lib/riskAssessment";
import { getClient } from "../../src/server/chat/llm";
import { mapPool } from "../../src/server/pool";
import { loadRubric, MECHANISM_UUIDS, buildAssessSystemPrompt, buildAssessUserPrompt } from "./assess-risk-prompt";
import { validateRating, downgradeEnforcement } from "./assess-risk-validate";
import { buildPrefixIndex, hashOf, withRetry } from "./assess-common";
import { askTriage, triageState, verdictAt } from "./assess-risk-jev";
import { renderMarkdown } from "./assess-risk-export";
import { runBakeoff } from "./assess-risk-bakeoff";

const ROOT = path.resolve(import.meta.dir, "../..");
const ARTIFACT_PATH = path.join(ROOT, "public", "risk-assessment.json");

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i !== -1 ? argv[i + 1] : undefined; };
const DRY = flag("dry-run");
const FORCE = flag("force");
const ONLY = opt("only");
const LIMIT = opt("limit") ? Number(opt("limit")) : Infinity;
const STAGE = opt("stage") ?? "all"; // triage | assess | all
const TRIAGE_MODEL = opt("triage-model") ?? "cloudflare/clef";
const ASSESS_MODEL = opt("model") ?? "anthropic/claude-haiku-5.5";
const ASSESS_WIDTH = Number(opt("width") ?? 6);
const TAU = { rule: Number(opt("rule-tau") ?? 0.4), domain: Number(opt("domain-tau") ?? 0.4) };

// --- enumerate + load ------------------------------------------------------
const docsFile = JSON.parse(fs.readFileSync(path.join(ROOT, "public/docs.json"), "utf8")) as
  { atlasCommit: string | null; nodes: Record<string, AtlasNode> };
const docs = docsFile.nodes;
const { candidates, excluded } = enumerateRiskCandidates(
  { docs, byParent: new Map(), docNoToId: new Map(), atlasCommit: docsFile.atlasCommit },
);
const rubric = loadRubric();
const badCatalog = MECHANISM_UUIDS.filter((u) => !docs[u]);
if (badCatalog.length) {
  console.error("mechanism catalog uuids missing from docs.json:", badCatalog);
  process.exit(1);
}

const existing: RiskAssessmentArtifact = fs.existsSync(ARTIFACT_PATH)
  ? JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"))
  : { rubricVersion: rubric.version, atlasCommit: null, triageModel: TRIAGE_MODEL, triageTau: TAU, assessModel: ASSESS_MODEL, triage: [], assessments: [] };
// Verdicts are re-cut from stored probabilities, so a threshold change costs no calls.
const triageByKey = new Map(existing.triage.map((t) => [t.taskKey, { ...t, ...verdictAt(t.p, TAU) }]));
const assessByKey = new Map(existing.assessments.map((a) => [a.taskKey, a]));

const keys = new Set(candidates.map((c) => c.taskKey));
for (const map of [triageByKey, assessByKey] as Map<string, { taskKey: string }>[]) {
  for (const k of [...map.keys()]) {
    if (!keys.has(k)) { map.delete(k); console.log(`orphan dropped: ${k}`); }
  }
}

// "Current" means the record matches today's quote (and rubric). --force is
// applied once, where the queues are built, so the census and the assess gate
// still see the verdicts a forced triage just wrote.
const triageCurrent = (c: RiskCandidate) => triageByKey.get(c.taskKey)?.quoteHash === hashOf(c.quote);
const assessCurrent = (c: RiskCandidate) => {
  const e = assessByKey.get(c.taskKey);
  return !!e && e.quoteHash === hashOf(c.quote) && e.rubricVersion === rubric.version;
};
const ruleVerdict = (taskKey: string) => {
  const t = triageByKey.get(taskKey);
  return !!t && t.inScope && t.isRule;
};
const inScopeRule = (c: RiskCandidate) => ruleVerdict(c.taskKey);
// A rating survives only under an in-scope-rule verdict. Runs after every
// change to the verdicts: the threshold re-cut at load and the triage stage.
const pruneAssessments = () => { for (const [k] of assessByKey) if (!ruleVerdict(k)) assessByKey.delete(k); };
pruneAssessments();

const pick = (xs: RiskCandidate[]) =>
  (ONLY ? xs.filter((c) => c.uuid.startsWith(ONLY) || c.taskKey === ONLY) : xs).slice(0, LIMIT);
const triageQueue = pick(candidates.filter((c) => FORCE || !triageCurrent(c)));
const assessQueue = () => pick(candidates.filter((c) => triageCurrent(c) && inScopeRule(c) && (FORCE || !assessCurrent(c))));

// --- census (always printed; the whole story for --dry-run) ----------------
const count = (xs: RiskCandidate[], f: (c: RiskCandidate) => string) =>
  xs.reduce((m, c) => m.set(f(c), (m.get(f(c)) ?? 0) + 1), new Map<string, number>());
console.log(`candidates: ${candidates.length} · excluded: ${JSON.stringify(excluded)}`);
console.log(`anchored: ${candidates.filter((c) => c.anchored).length} · residue: ${candidates.filter((c) => !c.anchored).length} · stubs: ${candidates.filter((c) => c.stub).length} · with metrics: ${candidates.filter((c) => c.hasMetrics).length}`);
console.log(`by primary domain: ${JSON.stringify(Object.fromEntries(count(candidates, (c) => c.domains[0])))}`);
const triaged = candidates.filter(triageCurrent);
console.log(`triage: ${triaged.length} current (${triaged.filter(inScopeRule).length} in-scope rules) · ${triageQueue.length} queued [${TRIAGE_MODEL} τ rule ${TAU.rule} domain ${TAU.domain}]`);
console.log(`assess: ${candidates.filter(assessCurrent).length} current · ${assessQueue().length} queued now [${ASSESS_MODEL}] · rubric ${rubric.version}`);

if (flag("export")) {
  const out = path.join(ROOT, ".cache", "risk-assessment.md");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, renderMarkdown(existing));
  console.log(`wrote ${out} (${existing.assessments.length} rows)`);
  process.exit(0);
}
if (DRY) {
  const c = triageQueue[0] ?? candidates[0];
  console.log(`\n— sample triage state (${c.docNo} ${c.title}) —\n${JSON.stringify(triageState(c, docs), null, 2)}`);
  console.log(`\n— assess system prompt: ${buildAssessSystemPrompt(rubric.text).length} chars · sample user prompt —\n${buildAssessUserPrompt(c, docs)}`);
  process.exit(0);
}
if (!process.env.OPENROUTER_API_KEY) {
  console.error("OPENROUTER_API_KEY is not set (.env.local) — cannot assess.");
  process.exit(1);
}

// --- assess loop: --width parallel calls (default 6; use 1 for :free models,
// which rate-limit hard), transport retries with backoff, then up to 3
// corrective retries on validation errors.
type Msg = { role: "system" | "user" | "assistant"; content: string };
const spend = new Map<string, number>(); // dollars per model, from OpenRouter's usage.cost
async function callValidated<T>(model: string, messages: Msg[], validate: (raw: string) => { ok: boolean; error?: string; value?: T }): Promise<{ value: T | null; last?: { error?: string; value?: T } }> {
  let last: { error?: string; value?: T } | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    // OpenRouter can return 200 with an error payload and no choices (e.g.
    // :free rate limits) — throw inside withRetry so it backs off and retries.
    const raw = await withRetry(async () => {
      const res = await getClient().chat.completions.create({ model, messages, temperature: 0 });
      spend.set(model, (spend.get(model) ?? 0) + ((res.usage as { cost?: number } | undefined)?.cost ?? 0));
      const content = res.choices?.[0]?.message?.content;
      if (!content) throw new Error(`no choices in response: ${JSON.stringify(res).slice(0, 200)}`);
      return content;
    });
    const v = validate(raw);
    if (v.ok) return { value: v.value! };
    last = v;
    console.warn(`  invalid (attempt ${attempt + 1}): ${v.error}`);
    messages.push({ role: "assistant", content: raw },
      { role: "user", content: `Your response failed validation: ${v.error}. Reply again with ONLY the corrected JSON object.` });
  }
  return { value: null, last };
}

const docIds = new Set(Object.keys(docs));
const byPrefix = buildPrefixIndex(docIds);
const assessSystem = buildAssessSystemPrompt(rubric.text);

const runAssess = (c: RiskCandidate, model = ASSESS_MODEL) =>
  callValidated<RiskRating>(model, [
    { role: "system", content: assessSystem },
    { role: "user", content: buildAssessUserPrompt(c, docs) },
  ], (raw) => validateRating(raw, docIds, byPrefix));

const writeArtifact = () => {
  const byDocNo = (a: { docNo?: string; taskKey: string }, b: { docNo?: string; taskKey: string }) =>
    (a.docNo ?? a.taskKey).localeCompare(b.docNo ?? b.taskKey, undefined, { numeric: true });
  const artifact: RiskAssessmentArtifact = {
    rubricVersion: rubric.version, atlasCommit: docsFile.atlasCommit,
    triageModel: TRIAGE_MODEL, triageTau: TAU, assessModel: ASSESS_MODEL,
    triage: [...triageByKey.values()].sort((a, b) => a.taskKey.localeCompare(b.taskKey)),
    assessments: [...assessByKey.values()].sort(byDocNo),
  };
  fs.writeFileSync(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
};

// --- bakeoff: calibration docs across assess models, printed side by side --
if (flag("bakeoff")) {
  await runBakeoff(candidates, runAssess, spend);
  process.exit(0);
}

// --- stage 1: triage (parallel: Jev answers in ~0.3 s and does not rate-limit like :free models)
if (STAGE !== "assess") {
  let n = 0, failed = 0;
  await mapPool(triageQueue, 8, async (c) => {
    let value: RiskTriage;
    try { value = verdictAt(await askTriage(c, docs, TRIAGE_MODEL), TAU); }
    catch (err) { failed++; console.warn(`[triage] ${c.docNo} ${c.title} — SKIPPED: ${(err as Error).message}`); return; }
    triageByKey.set(c.taskKey, { taskKey: c.taskKey, quoteHash: hashOf(c.quote), model: TRIAGE_MODEL, ...value });
    if (++n % 100 === 0) { writeArtifact(); console.log(`[triage ${n}/${triageQueue.length}]`); }
  });
  pruneAssessments();
  writeArtifact();
  console.log(`triage: ${n} written, ${failed} skipped (stay queued)`);
}

// --- stage 2: assess --------------------------------------------------------
if (STAGE !== "triage") {
  const queue = assessQueue();
  let n = 0, skipped = 0;
  await mapPool(queue, ASSESS_WIDTH, async (c) => {
    const t = triageByKey.get(c.taskKey)!;
    const { value, last } = await runAssess(c);
    const rating = value ?? (last?.value ? downgradeEnforcement(last.value) : null);
    if (!rating) { skipped++; console.warn(`[assess ${++n}/${queue.length}] ${c.docNo} ${c.title} — SKIPPED (stays queued)`); return; }
    const entry: RiskAssessmentEntry = {
      taskKey: c.taskKey, uuid: c.uuid, docNo: c.docNo, title: c.title,
      domains: t.domains.length ? t.domains : c.domains, agents: c.agents,
      anchored: c.anchored, stub: c.stub, hasMetrics: c.hasMetrics,
      quote: c.quote, quoteHash: hashOf(c.quote),
      model: ASSESS_MODEL, rubricVersion: rubric.version, ...rating,
    };
    assessByKey.set(c.taskKey, entry);
    console.log(`[assess ${++n}/${queue.length}] ${c.docNo} ${c.title} → preciseness:${rating.preciseness} enforcement:${rating.enforcement}`);
    if (n % 10 === 0) writeArtifact();
  });
  writeArtifact();
  console.log(`\nwrote ${ARTIFACT_PATH}: ${assessByKey.size} assessments, ${triageByKey.size} triage verdicts (${skipped} skipped)`);
} else {
  console.log(`\nwrote ${ARTIFACT_PATH}: ${triageByKey.size} triage verdicts`);
}
