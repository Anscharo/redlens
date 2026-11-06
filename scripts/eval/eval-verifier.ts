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
//   pnpm eval:verifier --mode paragraph|answer  # which refute mode to grade —
//                                      # defaults to config.chatRefuteMode
//                                      # (CHAT_REFUTE_MODE). Paragraph mode
//                                      # segments the (mutated) answer with the
//                                      # SAME createParagraphSegmenter production
//                                      # uses, runs each paragraph through
//                                      # createParagraphRefuter (the production
//                                      # per-paragraph refuter, not a second
//                                      # pool), and feeds paragraphRefutes into
//                                      # runSlicedVerifier — the identical merge
//                                      # path chat-orchestrator.ts uses.
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
import type { VerifyOverall } from "../../src/server/chat/verify/verifier.ts";
import { grade, type Graded } from "./eval-verifier-grade.ts";
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
const modeFlagIdx = argv.indexOf("--mode");
const modeFlag = modeFlagIdx >= 0 ? argv[modeFlagIdx + 1] : undefined;
const MODE: "answer" | "paragraph" = modeFlag === "answer" || modeFlag === "paragraph" ? modeFlag : config.chatRefuteMode;
const modelsFlag = argv.flatMap((a, i) => (a === "--models" && argv[i + 1] ? argv[i + 1].split(",").map((m) => m.trim()).filter(Boolean) : []));
const MODELS: (string | null)[] = modelsFlag.length ? modelsFlag : [config.chatVerifierModel || null];
const COMPARE = MODELS.length > 1;
if (!MODELS[0]) console.warn("CHAT_VERIFIER_MODEL not set — grading DETERMINISTIC classes only.\n");
if (MODELS[0] && !config.openrouterApiKey) {
  console.error("OPENROUTER_API_KEY is not set — cannot run the model verifier.");
  process.exit(1);
}

const ix = loadIndexes();
const GRADE_CTX = { mode: MODE, ix };

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
  // Where recall is lost, per row: how many candidates survived span validation,
  // how many the confirm gate agreed with, how many the judge asserted but code
  // discarded (span not found). A miss with candidates=0 and discarded=0 is the
  // judge not flagging; discarded>0 is transcription; candidates>agreed is confirm.
  candidates: number;
  agreed: number;
  discarded: number;
}

function toRow(runId: string, kind: string, graded: Graded, caught: boolean | null, informational: boolean): Row {
  return {
    runId, kind, overall: graded.overall, caught, informational,
    agreedContradiction: graded.verdict?.contradictions.some((c) => c.agreed) ?? false,
    candidates: graded.verdict?.contradictions.length ?? 0,
    agreed: graded.verdict?.contradictions.filter((c) => c.agreed).length ?? 0,
    discarded: graded.discarded,
  };
}

async function evalModel(model: string | null) {
  const rows: Row[] = (
    await Promise.all(
      runs.map(async (run) => {
        const out: Row[] = [toRow(run.id, "baseline", await grade(GRADE_CTX, model, run, run.answer), null, false)];
        for (const mut of buildMutations(run, ix)) {
          if (!model && !mut.deterministic) continue;
          const graded = await grade(GRADE_CTX, model, run, mut.answer);
          out.push(toRow(run.id, mut.class, graded, caughtFor(mut.class, graded.overall), mut.informational === true));
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
  console.log(`\nverifier eval — model: ${summary.model}, mode: ${MODE}, corpus: ${runs.length} runs`);
  console.log(`false-contradiction rate: ${(falseContradictionRate * 100).toFixed(0)}% (${falseContradictions}/${baselines.length})`);
  for (const [k, v] of byClass) {
    console.log(`  catch ${k}${v.informational ? " (informational)" : ""}: ${(100 * v.caught / v.total).toFixed(0)}% (${v.caught}/${v.total})`);
  }
  // Where the misses go, for the classes the refute slice owns: the judge never
  // flagged (no candidate, nothing discarded), code discarded its span, or the
  // confirm gate disagreed. Baselines report the same three so a rising
  // false-alarm source is visible before it costs a badge.
  for (const cls of ["contradiction", "number", "wrong_doc", "baseline"]) {
    const rs = rows.filter((r) => r.kind === cls);
    if (!rs.length) continue;
    const notFlagged = rs.filter((r) => r.candidates === 0 && r.discarded === 0).length;
    const discardedOnly = rs.filter((r) => r.candidates === 0 && r.discarded > 0).length;
    const confirmRejected = rs.filter((r) => r.candidates > 0 && r.agreed === 0).length;
    const shipped = rs.filter((r) => r.agreed > 0).length;
    console.log(`    ${cls.padEnd(14)} judge-silent=${notFlagged} span-discarded=${discardedOnly} confirm-rejected=${confirmRejected} shipped=${shipped} (of ${rs.length})`);
  }
  return { summary, rows, byClass, falseContradictionRate };
}

const perModel = [];
for (const m of MODELS) perModel.push(await evalModel(m));

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, JSON.stringify({ ranAt: new Date().toISOString(), mode: MODE, models: perModel.map(({ summary, rows }) => ({ summary, rows })) }, null, 2));
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
