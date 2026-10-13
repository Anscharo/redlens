// Measures a Jev-family triage model against the verdicts already in
// public/risk-assessment.json, before any threshold or default is chosen.
// Writes nothing to the artifact. Probabilities are cached per model in
// .cache/risk-triage-compare/, keyed by taskKey + quoteHash, so a rerun or a
// new threshold costs no calls.
//
//   pnpm risk:triage-compare                          default model (CHAT_JEV_MODEL)
//   pnpm risk:triage-compare --model cloudflare/clef
//   pnpm risk:triage-compare --limit 50 --show 0.4    disagreements at τ 0.4

import fs from "node:fs";
import path from "node:path";
import type { AtlasNode } from "../../src/types";
import { enumerateRiskCandidates, type RiskCandidate } from "../../src/lib/riskRules";
import type { RiskAssessmentArtifact, RiskTriageEntry, RiskTriageProbabilities } from "../../src/lib/riskAssessment";
import { config } from "../../src/server/config";
import { mapPool } from "../../src/server/pool";
import { hashOf } from "./assess-common";
import { askTriage } from "./assess-risk-jev";
import { agreementTable, disagreements } from "./assess-risk-triage-stats";

const ROOT = path.resolve(import.meta.dir, "../..");
const argv = process.argv.slice(2);
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i !== -1 ? argv[i + 1] : undefined; };
const MODEL = opt("model") ?? config.chatJevModel;
const LIMIT = opt("limit") ? Number(opt("limit")) : Infinity;
const SHOW = opt("show") ? Number(opt("show")) : null;
const CACHE = path.join(ROOT, ".cache", "risk-triage-compare", `${MODEL.replace(/[^\w.-]+/g, "_")}.json`);

const docsFile = JSON.parse(fs.readFileSync(path.join(ROOT, "public/docs.json"), "utf8")) as
  { atlasCommit: string | null; nodes: Record<string, AtlasNode> };
const docs = docsFile.nodes;
const { candidates } = enumerateRiskCandidates({ docs, byParent: new Map(), docNoToId: new Map(), atlasCommit: docsFile.atlasCommit });
const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, "public/risk-assessment.json"), "utf8")) as RiskAssessmentArtifact;
const labels = new Map(artifact.triage.map((t) => [t.taskKey, t]));

type Cached = Record<string, RiskTriageProbabilities>;
const cache: Cached = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
const keyOf = (c: RiskCandidate) => `${c.taskKey}#${hashOf(c.quote)}`;
const saveCache = () => {
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(cache));
};

const labelled = candidates.filter((c) => labels.get(c.taskKey)?.quoteHash === hashOf(c.quote)).slice(0, LIMIT);
const todo = labelled.filter((c) => !cache[keyOf(c)]);
console.log(`${labelled.length} candidates with a current label (${artifact.triageModel}) · ${todo.length} to ask ${MODEL}`);

let done = 0, failed = 0;
await mapPool(todo, 8, async (c) => {
  try { cache[keyOf(c)] = await askTriage(c, docs, MODEL); }
  catch (err) { failed++; console.warn(`  ${c.docNo} failed: ${(err as Error).message}`); }
  if (++done % 100 === 0) { saveCache(); console.log(`  ${done}/${todo.length}`); }
});
saveCache();
if (failed) console.warn(`${failed} calls failed; rerun to retry them`);

const pairs = labelled
  .filter((c) => cache[keyOf(c)])
  .map((c) => ({ c, label: labels.get(c.taskKey) as RiskTriageEntry, p: cache[keyOf(c)] }));
console.log(`\n${MODEL} vs ${artifact.triageModel} on ${pairs.length} paragraphs\n`);
console.log(agreementTable(pairs));
if (SHOW !== null) {
  const out = path.join(ROOT, ".cache", "risk-triage-compare", `disagreements-${path.basename(CACHE, ".json")}-${SHOW}.md`);
  fs.writeFileSync(out, disagreements(pairs, SHOW));
  console.log(`\nwrote ${out}`);
}
