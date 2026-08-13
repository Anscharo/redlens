// Verifier eval — the harness's key instrument (chat-reliability-harness plan).
// Grades the verification stack against saved passing runs and their mutations:
//
//   false-positive rate  — unmutated runs the verifier calls "fail"
//   catch rate per class — mutated runs flagged (fail/warn), by defect class
//
//   pnpm eval:golden --save-evidence   # build the corpus first (needs API key)
//   pnpm eval:verifier                 # grade CHAT_VERIFIER_MODEL against it
//   pnpm eval:verifier --models a,b,c  # verifier-position bakeoff: compare
//                                      # candidate models on the same corpus
//
// Deterministic classes (unknown_uuid) are checked with pure code — must be
// 1.0 by construction. Model classes need CHAT_VERIFIER_MODEL set. Exit is
// nonzero under thresholds (single-model mode only): fabrication/ruling
// catch ≥ 0.9, FPR ≤ 0.1.
import fs from "node:fs";
import path from "node:path";
import { loadIndexes } from "../../src/server/retrieval/indexes.ts";
import { config } from "../../src/server/config.ts";
import { openrouterJson } from "../../src/server/chat/llm.ts";
import { runDeterministicChecks } from "../../src/server/chat/verify/verify-checks.ts";
import { computeOverall, runVerifier, type VerifyOverall } from "../../src/server/chat/verify/verifier.ts";
import type { RoundTelemetry } from "../../src/server/chat/verify/round-checks.ts";
import { buildMutations, type SavedRun } from "./eval-verifier-mutations.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const EVIDENCE_DIR = process.env.EVAL_EVIDENCE_DIR ?? path.join(ROOT, "scripts", "eval", "eval-corpora", "evidence");
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

const argv = process.argv.slice(2);
const modelsFlag = argv.flatMap((a, i) => (a === "--models" && argv[i + 1] ? argv[i + 1].split(",").map((m) => m.trim()).filter(Boolean) : []));
const MODELS: (string | null)[] = modelsFlag.length ? modelsFlag : [config.chatVerifierModel || null];
const COMPARE = MODELS.length > 1;
if (!MODELS[0]) console.warn("CHAT_VERIFIER_MODEL not set — grading DETERMINISTIC classes only.\n");
if (MODELS[0] && !config.openrouterApiKey) {
  console.error("OPENROUTER_API_KEY is not set — cannot run the model verifier.");
  process.exit(1);
}

const ix = loadIndexes();
// Real per-run telemetry isn't in the corpus; a quiet-turn baseline keeps the
// prompt's telemetry section shaped correctly without biasing the verdict.
const telemetry: RoundTelemetry = { rounds: 1, toolCalls: 1, emptyResults: 0, errorResults: 0, repeatedQueries: 0, notes: [] };

async function grade(model: string | null, run: SavedRun, answer: string): Promise<VerifyOverall> {
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

async function evalModel(model: string | null) {
  const rows: Row[] = (
    await Promise.all(
      runs.map(async (run) => {
        const out: Row[] = [];
        const baseline = await grade(model, run, run.answer);
        out.push({ runId: run.id, kind: "baseline", overall: baseline, caught: null });
        for (const mut of buildMutations(run, ix)) {
          if (!model && !mut.deterministic) continue;
          const overall = await grade(model, run, mut.answer);
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
    runs: runs.length,
    falsePositiveRate: fpr,
    catchRates: Object.fromEntries([...byClass].map(([k, v]) => [k, { rate: v.caught / v.total, caught: v.caught, total: v.total }])),
  };
  console.log(`\nverifier eval — model: ${summary.model}, corpus: ${runs.length} runs`);
  console.log(`false-positive rate: ${(fpr * 100).toFixed(0)}% (${falsePositives}/${baselines.length})`);
  for (const [k, v] of byClass) console.log(`  catch ${k}: ${(100 * v.caught / v.total).toFixed(0)}% (${v.caught}/${v.total})`);
  return { summary, rows, byClass, fpr };
}

const perModel = [];
for (const m of MODELS) perModel.push(await evalModel(m));

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, JSON.stringify({ ranAt: new Date().toISOString(), models: perModel.map(({ summary, rows }) => ({ summary, rows })) }, null, 2));
console.log(`\nwrote ${REPORT_PATH}`);

if (COMPARE) {
  // Comparison scoreboard — thresholds informational, no exit failure.
  console.log(`\nverifier-position scoreboard (catch rates / FPR):`);
  for (const { summary } of perModel) {
    const cr = summary.catchRates as Record<string, { rate: number }>;
    const cells = ["unknown_uuid", "wrong_doc", "number", "fabrication", "ruling"].map((k) => `${k}=${cr[k] ? cr[k].rate.toFixed(2) : "-"}`);
    console.log(`  ${summary.model.padEnd(36)} ${cells.join("  ")}  FPR=${summary.falsePositiveRate.toFixed(2)}`);
  }
} else {
  const { byClass, fpr } = perModel[0];
  const model = MODELS[0];
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
}
