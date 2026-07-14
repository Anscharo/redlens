// Verifier eval — the harness's key instrument (chat-reliability-harness plan).
// Grades the verification stack against saved passing runs and their mutations:
//
//   false-positive rate  — unmutated runs the verifier calls "fail"
//   catch rate per class — mutated runs flagged (fail/warn), by defect class
//
//   pnpm eval:golden --save-evidence   # build the corpus first (needs API key)
//   pnpm eval:verifier                 # grade CHAT_VERIFIER_MODEL against it
//
// Deterministic classes (unknown_uuid) are checked with pure code — must be
// 1.0 by construction. Model classes need CHAT_VERIFIER_MODEL set. Exit is
// nonzero under thresholds: fabrication/ruling catch ≥ 0.9, FPR ≤ 0.1.
import fs from "node:fs";
import path from "node:path";
import { loadIndexes } from "../../src/server/indexes.ts";
import { config } from "../../src/server/config.ts";
import { openrouterJson } from "../../src/server/llm.ts";
import { runDeterministicChecks } from "../../src/server/verify-checks.ts";
import { computeOverall, runVerifier, type VerifyOverall } from "../../src/server/verifier.ts";
import type { RoundTelemetry } from "../../src/server/round-checks.ts";
import { buildMutations, type SavedRun } from "./eval-verifier-mutations.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const EVIDENCE_DIR = path.join(ROOT, ".cache", "eval-evidence");
const REPORT_PATH = path.join(ROOT, ".cache", "eval-verifier.json");

const THRESHOLDS = { fabrication: 0.9, ruling: 0.9, fprMax: 0.1 };

if (!fs.existsSync(EVIDENCE_DIR)) {
  console.error(`no ${EVIDENCE_DIR} — run \`pnpm eval:golden --save-evidence\` first.`);
  process.exit(1);
}
const runs: SavedRun[] = fs
  .readdirSync(EVIDENCE_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, f), "utf8")) as SavedRun);
if (runs.length === 0) {
  console.error("evidence dir is empty — run `pnpm eval:golden --save-evidence` first.");
  process.exit(1);
}

const model = config.chatVerifierModel;
if (!model) console.warn("CHAT_VERIFIER_MODEL not set — grading DETERMINISTIC classes only.\n");
if (model && !config.openrouterApiKey) {
  console.error("OPENROUTER_API_KEY is not set — cannot run the model verifier.");
  process.exit(1);
}

const ix = loadIndexes();
// Real per-run telemetry isn't in the corpus; a quiet-turn baseline keeps the
// prompt's telemetry section shaped correctly without biasing the verdict.
const telemetry: RoundTelemetry = { rounds: 1, toolCalls: 1, emptyResults: 0, errorResults: 0, repeatedQueries: 0, notes: [] };

async function grade(run: SavedRun, answer: string): Promise<VerifyOverall> {
  const checks = runDeterministicChecks(answer, run.evidence.map((e) => e.content), ix);
  if (!model) return checks.failed ? "fail" : "unverified";
  const v = await runVerifier({ call: openrouterJson, model, question: run.question, answer, evidence: run.evidence, checks, telemetry });
  return computeOverall(checks, v.verdict);
}

interface Row {
  runId: string;
  kind: string; // 'baseline' | mutation class
  overall: VerifyOverall;
  caught: boolean | null; // null for baseline
}

const rows: Row[] = (
  await Promise.all(
    runs.map(async (run) => {
      const out: Row[] = [];
      const baseline = await grade(run, run.answer);
      out.push({ runId: run.id, kind: "baseline", overall: baseline, caught: null });
      for (const mut of buildMutations(run, ix)) {
        if (!model && !mut.deterministic) continue;
        const overall = await grade(run, mut.answer);
        out.push({ runId: run.id, kind: mut.class, overall, caught: overall === "fail" || overall === "warn" });
      }
      return out;
    }),
  )
).flat();

const byClass = new Map<string, { caught: number; total: number }>();
for (const r of rows) {
  if (r.caught === null) continue;
  const c = byClass.get(r.kind) ?? { caught: 0, total: 0 };
  c.total++;
  if (r.caught) c.caught++;
  byClass.set(r.kind, c);
}
const baselines = rows.filter((r) => r.kind === "baseline");
const falsePositives = baselines.filter((r) => r.overall === "fail").length;
const fpr = falsePositives / baselines.length;

const summary = {
  model: model || "(deterministic only)",
  ranAt: new Date().toISOString(),
  runs: runs.length,
  falsePositiveRate: fpr,
  catchRates: Object.fromEntries([...byClass].map(([k, v]) => [k, { rate: v.caught / v.total, caught: v.caught, total: v.total }])),
};
fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, JSON.stringify({ summary, rows }, null, 2));

console.log(`verifier eval — model: ${summary.model}, corpus: ${runs.length} runs`);
console.log(`false-positive rate: ${(fpr * 100).toFixed(0)}% (${falsePositives}/${baselines.length})`);
for (const [k, v] of byClass) console.log(`  catch ${k}: ${(100 * v.caught / v.total).toFixed(0)}% (${v.caught}/${v.total})`);
console.log(`wrote ${REPORT_PATH}`);

const failures: string[] = [];
const det = byClass.get("unknown_uuid");
if (det && det.caught !== det.total) failures.push(`unknown_uuid catch ${det.caught}/${det.total} — must be 1.0 by construction`);
for (const cls of ["fabrication", "ruling"] as const) {
  const c = byClass.get(cls);
  if (model && c && c.caught / c.total < THRESHOLDS[cls]) failures.push(`${cls} catch ${(c.caught / c.total).toFixed(2)} < ${THRESHOLDS[cls]}`);
}
if (model && fpr > THRESHOLDS.fprMax) failures.push(`false-positive rate ${fpr.toFixed(2)} > ${THRESHOLDS.fprMax}`);
if (failures.length) {
  console.error(`\nTHRESHOLD FAILURES:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
