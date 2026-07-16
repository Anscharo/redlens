// Sliced-verifier bakeoff — measures each specialist (src/server/verifier-slices.ts)
// against the mutation class it is built for, plus the REAL audited defects.
//
// Routing matters for cost AND for honesty: a slice is graded only on the
// defects it targets, never on the whole cross-product. Fabrication/ruling are
// already 1.00 on the single verifier, so `claims` and `overreach` carry them
// as sanity classes while `sets`/`figures` get the classes that are broken.
//
// Scored per (model, slice):
//   catch    — target mutations flagged (any claim not `supported`)
//   FPR      — clean baselines wrongly flagged
//   spanKill — share of `supported` verdicts whose span FAILED code validation
//              (the model tried to assert support into existence)
//   real     — verdict on audited real defects (scripts/aux/eval-corpora/evidence/*.audit)
//
//   pnpm eval:slices                       default models × all slices
//   pnpm eval:slices --models a,b --limit 8
import fs from "node:fs";
import path from "node:path";
import { loadIndexes } from "../../src/server/indexes.ts";
import { config } from "../../src/server/config.ts";
import { openrouterJson } from "../../src/server/llm.ts";
import { runDeterministicChecks } from "../../src/server/verify-checks.ts";
import { runSlice, type SliceName, type SliceClaim } from "../../src/server/verifier-slices.ts";
import { buildMutations, type SavedRun } from "./eval-verifier-mutations.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const EVIDENCE_DIR = process.env.EVAL_EVIDENCE_DIR ?? path.join(ROOT, "scripts", "aux", "eval-corpora", "evidence");
const REPORT_PATH = path.join(ROOT, ".cache", "eval-slices.json");
const argv = process.argv.slice(2);
const flag = (n: string) => argv.flatMap((a, i) => (a === `--${n}` && argv[i + 1] ? [argv[i + 1]] : []));

const MODELS = (flag("models")[0]?.split(",") ?? ["google/gemma-4-31b-it", "anthropic/claude-haiku-4.5", "openai/gpt-5-mini"]).map((m) => m.trim());
const LIMIT = Number(flag("limit")[0] ?? 10);
const CONCURRENCY = Number(flag("concurrency")[0] ?? 4);

// Which mutation classes each slice is responsible for catching.
const ROUTING: Record<SliceName, string[]> = {
  claims: ["wrong_doc", "fabrication"],
  figures: ["number"],
  sets: ["enumeration"],
  overreach: ["ruling"],
};

if (!config.openrouterApiKey) {
  console.error("OPENROUTER_API_KEY is not set (.env.local).");
  process.exit(1);
}
const ix = loadIndexes();
type Corpus = SavedRun & { audit?: { verdict: "clean" | "defect"; notes: string } | null; sourceModel?: string };
const all: Corpus[] = fs.readdirSync(EVIDENCE_DIR).filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, f), "utf8")) as Corpus);
// Audited real defects are graded separately and are never mutation bases.
// Borderline entries are neither clean enough to be an FPR baseline nor a
// crisp defect to grade catch on, so they are excluded from both pools.
const realDefects = all.filter((r) => r.audit?.verdict === "defect");
const runs = all.filter((r) => r.audit?.verdict !== "defect" && r.audit?.verdict !== "borderline").slice(0, LIMIT);
// FPR is only trustworthy over AUDITED-clean baselines; everything else is
// reported as "unaudited" so we never again call judge-approved "clean".
const auditedClean = new Set(all.filter((r) => r.audit?.verdict === "clean").map((r) => r.id));

interface Cell {
  model: string; slice: SliceName; runId: string;
  kind: string; // baseline | <mutation class> | real_defect
  parsed: boolean; flagged: boolean; caught: boolean | null;
  supportedClaims: number; spanKilled: number; latencyMs: number | null;
  usage: { input: number; output: number } | null;
  // Full claims incl. spans + scores — so a threshold change can be re-scored
  // offline for free instead of re-buying every model call (the toolTexts
  // lesson, applied to spans).
  claims: SliceClaim[];
  evidenceTexts: string[];
}

const cells: Cell[] = [];
const save = () => {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify({ ranAt: new Date().toISOString(), models: MODELS, corpus: runs.length, cells }, null, 2));
};

// A slice "flags" an answer when any claim is not supported, or a ruling fired.
async function judge(model: string, slice: SliceName, run: Corpus, answer: string, kind: string, caught: boolean | null): Promise<Cell> {
  const evidenceTexts = run.evidence.map((e) => e.content);
  const worklist = slice === "figures" ? runDeterministicChecks(answer, evidenceTexts, ix).untracedNumbers : undefined;
  const r = await runSlice({
    call: openrouterJson, model, slice, question: run.question, answer, evidence: run.evidence, worklist,
    // Reasoning models need headroom or they truncate into "unparseable".
    maxTokens: 6000, signal: AbortSignal.timeout(180_000),
  });
  const flagged = r.rulingIssued || r.claims.some((c) => c.status !== "supported");
  const supported = r.claims.filter((c) => c.status === "supported");
  return {
    model, slice, runId: run.id, kind, parsed: r.parsed, flagged,
    caught: caught === null ? null : flagged,
    supportedClaims: supported.length,
    spanKilled: r.claims.filter((c) => c.spanValid === false).length,
    latencyMs: r.latencyMs, usage: r.usage,
    claims: r.claims, evidenceTexts,
  };
}

// Build the work list: per model × slice → its routed mutations + baselines + real defects.
const work: { model: string; slice: SliceName; run: Corpus; answer: string; kind: string; caught: boolean | null }[] = [];
for (const model of MODELS) {
  for (const slice of Object.keys(ROUTING) as SliceName[]) {
    for (const run of runs) {
      work.push({ model, slice, run, answer: run.answer, kind: "baseline", caught: null });
      for (const m of buildMutations(run, ix)) {
        if (!ROUTING[slice].includes(m.class)) continue;
        work.push({ model, slice, run, answer: m.answer, kind: m.class, caught: false });
      }
    }
    for (const run of realDefects) work.push({ model, slice, run, answer: run.answer, kind: "real_defect", caught: false });
  }
}

console.log(`sliced-verifier bakeoff — ${MODELS.length} models × ${Object.keys(ROUTING).length} slices`);
console.log(`corpus ${runs.length} runs + ${realDefects.length} audited real defect(s) → ${work.length} calls\n`);

let cursor = 0;
async function worker() {
  for (;;) {
    const i = cursor++;
    if (i >= work.length) return;
    const w = work[i];
    cells.push(await judge(w.model, w.slice, w.run, w.answer, w.kind, w.caught));
    save();
    if (cells.length % 20 === 0) console.log(`  [${cells.length}/${work.length}]`);
  }
}
await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));

// ── Scoreboard ─────────────────────────────────────────────────────────────
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : "  —");
console.log(`\n${"model".padEnd(22)}${"slice".padEnd(10)}${"catch".padStart(7)}${"FPR·aud".padStart(9)}${"FPR·all".padStart(9)}${"parse".padStart(7)}${"spanKill".padStart(10)}${"p50 ms".padStart(8)}`);
console.log(`(FPR·aud = over ${auditedClean.size} AUDITED-clean baselines — the only trustworthy FPR; FPR·all includes unaudited)`);
console.log("─".repeat(82));
for (const model of MODELS) {
  for (const slice of Object.keys(ROUTING) as SliceName[]) {
    const rs = cells.filter((c) => c.model === model && c.slice === slice);
    const targets = rs.filter((c) => c.caught !== null && c.kind !== "real_defect");
    const base = rs.filter((c) => c.kind === "baseline");
    const baseAud = base.filter((c) => auditedClean.has(c.runId));
    const lat = rs.map((c) => c.latencyMs ?? 0).filter(Boolean).sort((a, b) => a - b);
    console.log(
      model.split("/")[1].slice(0, 20).padEnd(22) + slice.padEnd(10) +
      pct(targets.filter((c) => c.caught).length, targets.length).padStart(7) +
      pct(baseAud.filter((c) => c.flagged).length, baseAud.length).padStart(9) +
      pct(base.filter((c) => c.flagged).length, base.length).padStart(9) +
      pct(rs.filter((c) => c.parsed).length, rs.length).padStart(7) +
      String(rs.reduce((s, c) => s + c.spanKilled, 0)).padStart(10) +
      String(lat.length ? lat[Math.floor(lat.length / 2)] : "—").padStart(8),
    );
  }
}
if (realDefects.length) {
  console.log(`\nREAL audited defects (the ones both single verifiers passed):`);
  for (const rd of realDefects) {
    console.log(`  ${rd.id}`);
    for (const model of MODELS) {
      const got = (Object.keys(ROUTING) as SliceName[])
        .map((s) => {
          const c = cells.find((x) => x.model === model && x.slice === s && x.runId === rd.id && x.kind === "real_defect");
          return `${s}=${!c ? "?" : !c.parsed ? "unparsed" : c.flagged ? "CAUGHT" : "missed"}`;
        })
        .join("  ");
      console.log(`    ${model.split("/")[1].padEnd(22)} ${got}`);
    }
  }
}
console.log(`\nwrote ${REPORT_PATH}`);
