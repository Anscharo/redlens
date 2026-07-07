// Risk-rules assessment — LLM-drafted ratings for every atlas paragraph that
// defines a risk rule/parameter/process, against docs/risk-assessment-rubric.md.
// Two incremental stages: triage (in-scope / rule-vs-mention / description,
// cheap model) and assess (preciseness 1-5 + enforcement weak/mid/strong,
// reasoning model). A row is only (re)run when its quote or the rubric changed.
// Output is the committed, human-reviewed artifact public/risk-assessment.json.
//
//   pnpm risk:assess --dry-run             census + sample prompts, zero API calls
//   pnpm risk:assess --bakeoff             calibration docs across 3 models, no writes
//   pnpm risk:assess --stage triage        triage only (default: all)
//   pnpm risk:assess --limit 5 | --only <uuid|key> | --force
//   pnpm risk:assess --model <id>          assess model (default deepseek-v4-pro — bakeoff
//                                          winner on reliability; nemotron ultra :free ties
//                                          on quality but rate-limits hard)
//   pnpm risk:assess --triage-model <id>   triage model (default gemma)
//   pnpm risk:assess --export              artifact → .cache/risk-assessment.md, no API
//
// Runs under bun (auto-loads OPENROUTER_API_KEY from .env.local). Requires
// public/docs.json (pnpm build:index).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { AtlasNode } from "../../src/types";
import { enumerateRiskCandidates, type RiskCandidate } from "../../src/lib/riskRules";
import { normalizeAssessedText } from "../../src/lib/oeaTasks";
import type { RiskAssessmentArtifact, RiskAssessmentEntry, RiskRating, RiskTriage, RiskTriageEntry } from "../../src/lib/riskAssessment";
import { getClient } from "../../src/server/llm";
import { loadRubric, MECHANISM_UUIDS, buildTriageSystemPrompt, buildTriageUserPrompt, buildAssessSystemPrompt, buildAssessUserPrompt } from "./assess-risk-prompt";
import { validateTriage, validateRating, downgradeEnforcement } from "./assess-risk-validate";
import { buildPrefixIndex, withRetry } from "./assess-common";
import { renderMarkdown } from "./assess-risk-export";

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
const TRIAGE_MODEL = opt("triage-model") ?? "google/gemma-4-26b-a4b-it";
const ASSESS_MODEL = opt("model") ?? "deepseek/deepseek-v4-pro";

const hashOf = (quote: string) =>
  crypto.createHash("sha256").update(normalizeAssessedText(quote)).digest("hex").slice(0, 16);

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
  : { rubricVersion: rubric.version, atlasCommit: null, triageModel: TRIAGE_MODEL, assessModel: ASSESS_MODEL, triage: [], assessments: [] };
const triageByKey = new Map(existing.triage.map((t) => [t.taskKey, t]));
const assessByKey = new Map(existing.assessments.map((a) => [a.taskKey, a]));

const keys = new Set(candidates.map((c) => c.taskKey));
for (const map of [triageByKey, assessByKey] as Map<string, { taskKey: string }>[]) {
  for (const k of [...map.keys()]) {
    if (!keys.has(k)) { map.delete(k); console.log(`orphan dropped: ${k}`); }
  }
}

const triageFresh = (c: RiskCandidate) => !FORCE && triageByKey.get(c.taskKey)?.quoteHash === hashOf(c.quote);
const assessFresh = (c: RiskCandidate) => {
  const e = assessByKey.get(c.taskKey);
  return !FORCE && !!e && e.quoteHash === hashOf(c.quote) && e.rubricVersion === rubric.version;
};
const inScopeRule = (c: RiskCandidate) => {
  const t = triageByKey.get(c.taskKey);
  return !!t && t.inScope && t.isRule;
};

const pick = (xs: RiskCandidate[]) =>
  (ONLY ? xs.filter((c) => c.uuid.startsWith(ONLY) || c.taskKey === ONLY) : xs).slice(0, LIMIT);
const triageQueue = pick(candidates.filter((c) => !triageFresh(c)));
const assessQueue = () => pick(candidates.filter((c) => triageFresh(c) && inScopeRule(c) && !assessFresh(c)));

// --- census (always printed; the whole story for --dry-run) ----------------
const count = (xs: RiskCandidate[], f: (c: RiskCandidate) => string) =>
  xs.reduce((m, c) => m.set(f(c), (m.get(f(c)) ?? 0) + 1), new Map<string, number>());
console.log(`candidates: ${candidates.length} · excluded: ${JSON.stringify(excluded)}`);
console.log(`anchored: ${candidates.filter((c) => c.anchored).length} · residue: ${candidates.filter((c) => !c.anchored).length} · stubs: ${candidates.filter((c) => c.stub).length} · with metrics: ${candidates.filter((c) => c.hasMetrics).length}`);
console.log(`by primary domain: ${JSON.stringify(Object.fromEntries(count(candidates, (c) => c.domains[0])))}`);
const triaged = candidates.filter(triageFresh);
console.log(`triage: ${triaged.length} fresh (${triaged.filter(inScopeRule).length} in-scope rules) · ${triageQueue.length} queued [${TRIAGE_MODEL}]`);
console.log(`assess: ${candidates.filter(assessFresh).length} fresh · ${assessQueue().length} queued now [${ASSESS_MODEL}] · rubric ${rubric.version}`);

if (flag("export")) {
  const out = path.join(ROOT, ".cache", "risk-assessment.md");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, renderMarkdown(existing));
  console.log(`wrote ${out} (${existing.assessments.length} rows)`);
  process.exit(0);
}
if (DRY) {
  const c = triageQueue[0] ?? candidates[0];
  console.log(`\n— sample triage prompt (${c.docNo} ${c.title}) —\n${buildTriageUserPrompt(c, docs)}`);
  console.log(`\n— assess system prompt: ${buildAssessSystemPrompt(rubric.text).length} chars · sample user prompt —\n${buildAssessUserPrompt(c, "(triage description)", docs)}`);
  process.exit(0);
}
if (!process.env.OPENROUTER_API_KEY) {
  console.error("OPENROUTER_API_KEY is not set (.env.local) — cannot assess.");
  process.exit(1);
}

// --- LLM loops: sequential (the :free variants rate-limit hard), transport
// retries with backoff, then up to 3 corrective retries on validation errors.
type Msg = { role: "system" | "user" | "assistant"; content: string };
async function callValidated<T>(model: string, messages: Msg[], validate: (raw: string) => { ok: boolean; error?: string; value?: T }): Promise<{ value: T | null; last?: { error?: string; value?: T } }> {
  let last: { error?: string; value?: T } | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    // OpenRouter can return 200 with an error payload and no choices (e.g.
    // :free rate limits) — throw inside withRetry so it backs off and retries.
    const raw = await withRetry(async () => {
      const res = await getClient().chat.completions.create({ model, messages, temperature: 0 });
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
const triageSystem = buildTriageSystemPrompt();
const assessSystem = buildAssessSystemPrompt(rubric.text);

const runTriage = (c: RiskCandidate) =>
  callValidated<RiskTriage>(TRIAGE_MODEL, [
    { role: "system", content: triageSystem },
    { role: "user", content: buildTriageUserPrompt(c, docs) },
  ], validateTriage);

const runAssess = (c: RiskCandidate, description: string, model = ASSESS_MODEL) =>
  callValidated<RiskRating>(model, [
    { role: "system", content: assessSystem },
    { role: "user", content: buildAssessUserPrompt(c, description, docs) },
  ], (raw) => validateRating(raw, docIds, byPrefix));

const writeArtifact = () => {
  const byDocNo = (a: { docNo?: string; taskKey: string }, b: { docNo?: string; taskKey: string }) =>
    (a.docNo ?? a.taskKey).localeCompare(b.docNo ?? b.taskKey, undefined, { numeric: true });
  const artifact: RiskAssessmentArtifact = {
    rubricVersion: rubric.version, atlasCommit: docsFile.atlasCommit,
    triageModel: TRIAGE_MODEL, assessModel: ASSESS_MODEL,
    triage: [...triageByKey.values()].sort((a, b) => a.taskKey.localeCompare(b.taskKey)),
    assessments: [...assessByKey.values()].sort(byDocNo),
  };
  fs.writeFileSync(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
};

// --- bakeoff: calibration docs across models, printed side by side ---------
if (flag("bakeoff")) {
  const MODELS = ["google/gemma-4-26b-a4b-it", "nvidia/nemotron-3-ultra-550b-a55b:free", "deepseek/deepseek-v4-pro"];
  const CALIBRATION = [
    "475fe222-9e4a-4e9d-9be6-a7a424ce02f8", // Minimum ASC — expect preciseness 5
    "bce9331b-04ca-4c50-9783-098739fc72c8", // Liquidation Penalty — expect 3
    "035ec13b-5676-45f0-a3b3-8b8e24a4adcf", // Legal/Regulatory Risk Monitoring — expect 2, weak
    "a2df2b73-c1c5-40d6-b87e-43ba24f54870", // IJRC stub — expect 1
    "39473e1a-63f8-433b-a850-08f53b2dcf02", // Lite PSM
    "12b7d480-68a0-4493-9534-d6915f86c112", // Risk-Capital Incident Response
    "5c3dd35a-0c67-44c2-b51b-d40bc865af85", // Conservatorship
    "fd1f682c-2d8a-47c5-8c1d-d95a0a2f2021", // Risk-based insurance pricing
  ];
  for (const uuid of CALIBRATION) {
    const c = candidates.find((x) => x.uuid === uuid);
    if (!c) { console.warn(`bakeoff: ${uuid} not in candidates`); continue; }
    const t = await runTriage(c);
    const desc = t.value?.description ?? c.title;
    console.log(`\n=== ${c.docNo} ${c.title} (stub=${c.stub})\n  triage[${TRIAGE_MODEL}]: ${JSON.stringify(t.value)}`);
    for (const model of MODELS) {
      const a = await runAssess(c, desc, model);
      const v = a.value ?? a.last?.value;
      console.log(`  ${model}: preciseness ${v?.preciseness} — ${v?.precisenessReasoning}\n    enforcement ${v?.enforcement} [${v?.mechanismUuids?.join(", ") ?? ""}] — ${v?.enforcementReasoning}`);
    }
  }
  process.exit(0);
}

// --- stage 1: triage --------------------------------------------------------
if (STAGE !== "assess") {
  let n = 0;
  for (const c of triageQueue) {
    n++;
    const { value } = await runTriage(c);
    if (!value) { console.warn(`[triage ${n}/${triageQueue.length}] ${c.docNo} ${c.title} — SKIPPED`); continue; }
    const entry: RiskTriageEntry = { taskKey: c.taskKey, quoteHash: hashOf(c.quote), model: TRIAGE_MODEL, ...value };
    triageByKey.set(c.taskKey, entry);
    if (!value.inScope || !value.isRule) assessByKey.delete(c.taskKey); // verdict changed under an old rating
    console.log(`[triage ${n}/${triageQueue.length}] ${c.docNo} ${c.title} → ${value.inScope ? value.domains.join("+") : "out-of-scope"}${value.isRule ? "" : " (not a rule)"}`);
    if (n % 20 === 0) writeArtifact();
  }
  writeArtifact();
}

// --- stage 2: assess --------------------------------------------------------
if (STAGE !== "triage") {
  const queue = assessQueue();
  let n = 0, skipped = 0;
  for (const c of queue) {
    n++;
    const t = triageByKey.get(c.taskKey)!;
    const { value, last } = await runAssess(c, t.description);
    const rating = value ?? (last?.value ? downgradeEnforcement(last.value) : null);
    if (!rating) { skipped++; console.warn(`[assess ${n}/${queue.length}] ${c.docNo} ${c.title} — SKIPPED (stays queued)`); continue; }
    const entry: RiskAssessmentEntry = {
      taskKey: c.taskKey, uuid: c.uuid, docNo: c.docNo, title: c.title,
      domains: t.domains.length ? t.domains : c.domains, agents: c.agents,
      anchored: c.anchored, stub: c.stub, hasMetrics: c.hasMetrics,
      description: t.description, quote: c.quote, quoteHash: hashOf(c.quote),
      model: ASSESS_MODEL, rubricVersion: rubric.version, ...rating,
    };
    assessByKey.set(c.taskKey, entry);
    console.log(`[assess ${n}/${queue.length}] ${c.docNo} ${c.title} → preciseness:${rating.preciseness} enforcement:${rating.enforcement}`);
    if (n % 10 === 0) writeArtifact();
  }
  writeArtifact();
  console.log(`\nwrote ${ARTIFACT_PATH}: ${assessByKey.size} assessments, ${triageByKey.size} triage verdicts (${skipped} skipped)`);
} else {
  console.log(`\nwrote ${ARTIFACT_PATH}: ${triageByKey.size} triage verdicts`);
}
