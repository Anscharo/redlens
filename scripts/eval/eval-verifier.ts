// Verifier eval — the harness's key instrument (docs/plans/archive/chat-reliability-harness.md).
// Grades the REFUTATION-ONLY verifier (verify/sliced-verifier.ts) against saved
// passing runs and their mutations:
//
//   false-contradiction rate — unmutated (clean) runs where the confirm-gated
//                              audit still asserts an AGREED contradiction
//   catch rate per class     — mutated runs flagged, by defect class
//
//   pnpm eval:golden --save-evidence   # build the corpus first (needs API key)
//   pnpm eval:verifier                 # grade CHAT_VERIFIER_MODEL against it
//   pnpm eval:verifier --models a,b,c  # verifier-position bakeoff: compare
//                                      # candidate models across every slice role
//
// Deterministic classes (unknown_uuid) are checked with pure code — must be
// 1.0 by construction. Model classes need CHAT_VERIFIER_MODEL set. `fabrication`
// and `enumeration` are INFORMATIONAL — the refutation-only design cannot catch
// an appended/unmentioned fact by construction (the evidence is silent about it,
// never contradicts it) — so they're reported but never gated. Exit is nonzero
// under thresholds (single-model mode only): contradiction catch ≥ 0.8, ruling
// catch ≥ 0.9, false-contradiction rate ≤ 0.05.
import fs from "node:fs";
import path from "node:path";
import { loadIndexes } from "../../src/server/retrieval/indexes.ts";
import { config } from "../../src/server/config.ts";
import { openrouterJson } from "../../src/server/chat/llm.ts";
import { runDeterministicChecks } from "../../src/server/chat/verify/verify-checks.ts";
import { computeOverall, type Verdict, type VerifyOverall } from "../../src/server/chat/verify/verifier.ts";
import { runSlicedVerifier, sliceModels } from "../../src/server/chat/verify/sliced-verifier.ts";
import { buildMutations, type Mutation, type SavedRun } from "./eval-verifier-mutations.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const EVIDENCE_DIR = process.env.EVAL_EVIDENCE_DIR ?? path.join(ROOT, "scripts", "eval", "eval-corpora", "evidence");
const REPORT_PATH = path.join(ROOT, ".cache", "eval-verifier.json");

const THRESHOLDS = { contradiction: 0.8, ruling: 0.9, falseContradictionMax: 0.05 };

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

// `model`, when set, becomes CHAT_VERIFIER_MODEL for the duration of the call
// so sliceModels() routes every role (refute/overreach/confirm) to it, unless
// CHAT_VERIFIER_SLICE_MODELS overrides a role explicitly.
async function grade(model: string | null, run: SavedRun, answer: string): Promise<{ overall: VerifyOverall; verdict: Verdict | null }> {
  const checks = runDeterministicChecks(answer, run.evidence.map((e) => e.content), ix, {
    question: run.question,
    evidence: run.evidence,
  });
  if (!model) return { overall: checks.failed ? "fail" : "unverified", verdict: null };
  const prev = config.chatVerifierModel;
  config.chatVerifierModel = model;
  try {
    const res = await runSlicedVerifier({
      call: openrouterJson, models: sliceModels(), ix,
      question: run.question, answer, evidence: run.evidence, checks,
    });
    return { overall: computeOverall(checks, res.verdict), verdict: res.verdict };
  } finally {
    config.chatVerifierModel = prev;
  }
}

// `ruling` is caught by "warn or fail" (an unconfirmed overreach ruling still
// carries the finding); every other class needs the hard "fail" a confirmed,
// code-validated contradiction produces.
function caughtFor(cls: Mutation["class"], overall: VerifyOverall): boolean {
  return cls === "ruling" ? overall === "warn" || overall === "fail" : overall === "fail";
}

interface Row {
  runId: string;
  kind: string; // 'baseline' | mutation class
  overall: VerifyOverall;
  caught: boolean | null; // null for baseline
  informational: boolean;
  agreedContradiction: boolean; // ≥1 AGREED contradiction in this row's verdict
}

async function evalModel(model: string | null) {
  const rows: Row[] = (
    await Promise.all(
      runs.map(async (run) => {
        const out: Row[] = [];
        const baseline = await grade(model, run, run.answer);
        out.push({
          runId: run.id, kind: "baseline", overall: baseline.overall, caught: null, informational: false,
          agreedContradiction: baseline.verdict?.contradictions.some((c) => c.agreed) ?? false,
        });
        for (const mut of buildMutations(run, ix)) {
          if (!model && !mut.deterministic) continue;
          const graded = await grade(model, run, mut.answer);
          out.push({
            runId: run.id, kind: mut.class, overall: graded.overall,
            caught: caughtFor(mut.class, graded.overall), informational: mut.informational === true,
            agreedContradiction: graded.verdict?.contradictions.some((c) => c.agreed) ?? false,
          });
        }
        return out;
      }),
    )
  ).flat();

  const byClass = new Map<string, { caught: number; total: number; informational: boolean }>();
  for (const r of rows) {
    if (r.caught === null) continue;
    const c = byClass.get(r.kind) ?? { caught: 0, total: 0, informational: r.informational };
    c.total++;
    if (r.caught) c.caught++;
    byClass.set(r.kind, c);
  }
  const baselines = rows.filter((r) => r.kind === "baseline");
  const falseContradictions = baselines.filter((r) => r.agreedContradiction).length;
  const falseContradictionRate = falseContradictions / baselines.length;

  const summary = {
    model: model || "(deterministic only)",
    runs: runs.length,
    falseContradictionRate,
    catchRates: Object.fromEntries(
      [...byClass].map(([k, v]) => [k, { rate: v.caught / v.total, caught: v.caught, total: v.total, informational: v.informational }]),
    ),
  };
  console.log(`\nverifier eval — model: ${summary.model}, corpus: ${runs.length} runs`);
  console.log(`false-contradiction rate: ${(falseContradictionRate * 100).toFixed(0)}% (${falseContradictions}/${baselines.length})`);
  for (const [k, v] of byClass) {
    console.log(`  catch ${k}${v.informational ? " (informational)" : ""}: ${(100 * v.caught / v.total).toFixed(0)}% (${v.caught}/${v.total})`);
  }
  return { summary, rows, byClass, falseContradictionRate };
}

const perModel = [];
for (const m of MODELS) perModel.push(await evalModel(m));

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, JSON.stringify({ ranAt: new Date().toISOString(), models: perModel.map(({ summary, rows }) => ({ summary, rows })) }, null, 2));
console.log(`\nwrote ${REPORT_PATH}`);

if (COMPARE) {
  // Comparison scoreboard — thresholds informational, no exit failure.
  console.log(`\nverifier-position scoreboard (catch rates / false-contradiction rate):`);
  for (const { summary } of perModel) {
    const cr = summary.catchRates as Record<string, { rate: number }>;
    const cells = ["unknown_uuid", "contradiction", "number", "wrong_doc", "fabrication", "ruling"].map(
      (k) => `${k}=${cr[k] ? cr[k].rate.toFixed(2) : "-"}`,
    );
    console.log(`  ${summary.model.padEnd(36)} ${cells.join("  ")}  FCR=${summary.falseContradictionRate.toFixed(2)}`);
  }
} else {
  const { byClass, falseContradictionRate } = perModel[0];
  const model = MODELS[0];
  const failures: string[] = [];
  const det = byClass.get("unknown_uuid");
  if (det && det.caught !== det.total) failures.push(`unknown_uuid catch ${det.caught}/${det.total} — must be 1.0 by construction`);
  for (const cls of ["contradiction", "ruling"] as const) {
    const c = byClass.get(cls);
    if (model && c && c.caught / c.total < THRESHOLDS[cls]) failures.push(`${cls} catch ${(c.caught / c.total).toFixed(2)} < ${THRESHOLDS[cls]}`);
  }
  if (model && falseContradictionRate > THRESHOLDS.falseContradictionMax) {
    failures.push(`false-contradiction rate ${falseContradictionRate.toFixed(2)} > ${THRESHOLDS.falseContradictionMax}`);
  }
  if (failures.length) {
    console.error(`\nTHRESHOLD FAILURES:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
}
