// Advisor-position bakeoff — compares candidate models on the advisor's job:
// given a failed turn (question + retrieval digest + verdict/check failures),
// pick the right recovery action with guidance that targets the actual defect.
//
// Scenarios are built from the verifier corpus (.cache/eval-evidence/*, from
// `pnpm eval:golden --save-evidence`) — no live chat runs, so it's cheap:
//   - each mutation class (unknown_uuid/wrong_doc/number/fabrication/ruling)
//     plants a KNOWN defect while the evidence stays sufficient → the right
//     action is "rewrite", and good guidance names the planted defect
//   - a "no_evidence" scenario per run empties the retrieval digest → the
//     right action is "requery" or "decline", never "rewrite" (guards against
//     rewrite-always models)
//
//   pnpm eval:advisor                          grade CHAT_ADVISOR_MODEL
//   pnpm eval:advisor --models a,b,c           advisor-position comparison
//
// Scored per model: parse rate, correct-action rate, defect-targeting rate
// (guidance mentions the planted item), latency vs chatAdvisorTimeoutMs.
import fs from "node:fs";
import path from "node:path";
import { loadIndexes } from "../../src/server/indexes.ts";
import { config } from "../../src/server/config.ts";
import { openrouterJson } from "../../src/server/llm.ts";
import { adviseRecovery } from "../../src/server/advisor.ts";
import type { Verdict } from "../../src/server/verifier.ts";
import type { RoundTelemetry } from "../../src/server/round-checks.ts";
import { buildMutations, type SavedRun } from "./eval-verifier-mutations.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const EVIDENCE_DIR = path.join(ROOT, ".cache", "eval-evidence");
const REPORT_PATH = path.join(ROOT, ".cache", "eval-advisor.json");
const argv = process.argv.slice(2);
const modelsFlag = argv.flatMap((a, i) => (a === "--models" && argv[i + 1] ? argv[i + 1].split(",").map((m) => m.trim()).filter(Boolean) : []));
const MODELS = modelsFlag.length ? modelsFlag : [config.chatAdvisorModel].filter(Boolean) as string[];

if (!MODELS.length) {
  console.error("no advisor model — set CHAT_ADVISOR_MODEL or pass --models a,b,c");
  process.exit(1);
}
if (!config.openrouterApiKey) {
  console.error("OPENROUTER_API_KEY is not set (.env.local) — cannot run the advisor eval.");
  process.exit(1);
}
if (!fs.existsSync(EVIDENCE_DIR)) {
  console.error(`no ${EVIDENCE_DIR} — run \`pnpm eval:golden --save-evidence\` first.`);
  process.exit(1);
}
const runs: SavedRun[] = fs.readdirSync(EVIDENCE_DIR).filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, f), "utf8")) as SavedRun);
if (!runs.length) {
  console.error("evidence dir is empty — run `pnpm eval:golden --save-evidence` first.");
  process.exit(1);
}

const ix = loadIndexes();

interface Scenario {
  runId: string;
  kind: string; // mutation class | 'no_evidence'
  question: string;
  transcriptDigest: string;
  verdict: Verdict | null;
  checkFailures: string[];
  telemetry: RoundTelemetry;
  expectActions: string[]; // acceptable recovery actions
  targetHints: string[]; // strings good guidance should mention (any one)
}

const quietTelemetry: RoundTelemetry = { rounds: 2, toolCalls: 3, emptyResults: 0, errorResults: 0, repeatedQueries: 0, notes: [] };

function digestOf(run: SavedRun): string {
  return run.evidence.map((e) => `${e.tool}(${e.args}) → ${e.content.slice(0, 200)}`).join("\n");
}

// Mimics what the orchestrator hands the advisor per defect class: the
// deterministic classes arrive as checkFailures, the model-caught classes as
// a verifier verdict flagging the planted claim.
function scenariosOf(run: SavedRun): Scenario[] {
  const base = { runId: run.id, question: run.question, transcriptDigest: digestOf(run), telemetry: quietTelemetry };
  const out: Scenario[] = [];
  for (const mut of buildMutations(run, ix)) {
    const s: Scenario = { ...base, kind: mut.class, verdict: null, checkFailures: [], expectActions: ["rewrite"], targetHints: [] };
    if (mut.class === "unknown_uuid") {
      s.checkFailures = ["cited doc 00000000-dead-beef-0000-000000000000 does not exist in the atlas — cite only docs retrieved this turn"];
      s.targetHints = ["00000000-dead-beef", "citation", "cited doc"];
    } else if (mut.class === "fabrication") {
      s.verdict = verdictFor("The responsible facilitator receives a fixed monthly retainer of 250,000 USDS paid quarterly from the Accessibility Reserve.", "invented");
      s.targetHints = ["250,000", "retainer", "Accessibility Reserve"];
    } else if (mut.class === "ruling") {
      s.verdict = { claims: [], invented_facts: [], ruling_issued: true, confidence: 0.9, feedback: "The answer issues an adjudication; the assistant must report, never rule." };
      s.targetHints = ["ruling", "rule", "adjudic", "eligib"];
    } else if (mut.class === "number") {
      s.verdict = verdictFor("A numeric value in the answer does not match the retrieved evidence.", "contradicted");
      s.targetHints = ["number", "numeric", "value", "figure"];
    } else {
      // wrong_doc — citation points at a real but unrelated document.
      s.verdict = verdictFor("A claim cites a document that does not support it.", "unsupported");
      s.targetHints = ["citation", "cited", "doc"];
    }
    out.push(s);
  }
  out.push({
    ...base,
    kind: "no_evidence",
    transcriptDigest: [
      `atlas_search({"query":"..."}) → (no results)`,
      `atlas_search({"query":"..."}) → (no results)`,
      `atlas_query({"sql":"..."}) → (0 rows)`,
    ].join("\n"),
    verdict: null,
    checkFailures: [],
    telemetry: { rounds: 3, toolCalls: 3, emptyResults: 3, errorResults: 0, repeatedQueries: 1, notes: ["3 consecutive empty tool results"] },
    expectActions: ["requery", "decline"],
    targetHints: [],
  });
  return out;
}

function verdictFor(claim: string, status: "unsupported" | "contradicted" | "invented"): Verdict {
  return {
    claims: [{ claim, status: status === "invented" ? "unsupported" : status, evidence: [], cited_uuid: null, note: null }],
    invented_facts: status === "invented" ? [claim] : [],
    ruling_issued: false,
    confidence: 0.85,
    feedback: "One claim failed the audit; see claims.",
  };
}

const scenarios = runs.flatMap(scenariosOf);

interface Cell {
  model: string; runId: string; kind: string;
  parsed: boolean; action: string | null; actionOk: boolean; targeted: boolean | null; latencyMs: number | null;
}

const cells: Cell[] = [];
// Incremental save — a killed run keeps every scenario paid for so far.
const saveCells = () => {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify({ ranAt: new Date().toISOString(), scenarios: scenarios.length, cells }, null, 2));
};
for (const model of MODELS) {
  for (const s of scenarios) {
    const res = await adviseRecovery({
      call: openrouterJson, model, question: s.question, transcriptDigest: s.transcriptDigest,
      verdict: s.verdict, telemetry: s.telemetry, checkFailures: s.checkFailures,
      timeoutMs: 30_000, // generous here; production fitness is judged via latency vs config below
    });
    const r = res.recovery;
    const guidance = (r?.guidance ?? "") + " " + JSON.stringify(r?.calls ?? []);
    cells.push({
      model, runId: s.runId, kind: s.kind,
      parsed: r !== null,
      action: r?.action ?? null,
      actionOk: r !== null && s.expectActions.includes(r.action),
      targeted: s.targetHints.length ? s.targetHints.some((h) => guidance.toLowerCase().includes(h.toLowerCase())) : null,
      latencyMs: res.latencyMs,
    });
    saveCells();
    console.log(`${model} × ${s.runId}/${s.kind} → ${r ? `${r.action}${cells.at(-1)!.actionOk ? "" : " (WRONG)"}` : "unparseable"}`);
  }
}

const scoreboard = MODELS.map((model) => {
  const rs = cells.filter((c) => c.model === model);
  const pct = (xs: Cell[], f: (c: Cell) => boolean) => (xs.length ? xs.filter(f).length / xs.length : 0);
  const targetable = rs.filter((c) => c.targeted !== null);
  const lats = rs.map((c) => c.latencyMs).filter((l): l is number => l !== null).sort((a, b) => a - b);
  return {
    model,
    parseRate: Number(pct(rs, (c) => c.parsed).toFixed(2)),
    actionRate: Number(pct(rs, (c) => c.actionOk).toFixed(2)),
    targetRate: Number(pct(targetable, (c) => c.targeted === true).toFixed(2)),
    p50LatencyMs: lats.length ? lats[Math.floor(lats.length / 2)] : null,
    overBudget: lats.filter((l) => l > config.chatAdvisorTimeoutMs).length,
    n: rs.length,
  };
}).sort((a, b) => b.actionRate - a.actionRate || b.targetRate - a.targetRate);

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, JSON.stringify({ ranAt: new Date().toISOString(), scenarios: scenarios.length, scoreboard, cells }, null, 2));


console.log(`\nadvisor eval — ${scenarios.length} scenarios (${runs.length} runs), production timeout ${config.chatAdvisorTimeoutMs}ms`);
for (const row of scoreboard) {
  console.log(`  ${row.model.padEnd(36)} parse=${row.parseRate}  action=${row.actionRate}  target=${row.targetRate}  p50=${row.p50LatencyMs}ms  overBudget=${row.overBudget}/${row.n}`);
}
console.log(`wrote ${REPORT_PATH}`);
