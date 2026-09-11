// Sliced-verifier bakeoff — measures each specialist role
// (src/server/chat/verify/verifier-slices.ts's `refute`/`overreach`, plus the
// confirm gate that chains off a refute cell with ≥1 candidate) against the
// mutation class each is built for, plus the REAL audited defects.
// Since 2026-09-10 the two slices + conditional confirm ARE the only live
// audit path (verify/sliced-verifier.ts) — this eval arbitrates which model
// fills each role (CHAT_VERIFIER_SLICE_MODELS), not whether to wire them in.
//
// Routing matters for cost AND for honesty: a slice is graded only on the
// defects it targets, never on the whole cross-product. `confirm` is never
// independently routed against a mutation class — it only ever judges the
// candidates a refute cell already produced, so its effect shows up IN the
// refute row (agreed vs candidates), not as its own row.
//
// Scored per (model, slice):
//   catch      — target mutations FLAGGED (an agreed contradiction, or a
//                ruling for the overreach slice)
//   FCR        — clean baselines wrongly flagged (false-contradiction rate)
//   discarded  — candidates the model asserted whose span code REJECTED (the
//                model tried to assert a contradiction into existence)
//   real       — verdict on audited real defects (scripts/eval/eval-corpora/evidence/*.audit)
//
//   pnpm eval:slices                       default models × both slices
//   pnpm eval:slices --models a,b --limit 8
import fs from "node:fs";
import path from "node:path";
import { loadIndexes } from "../../src/server/retrieval/indexes.ts";
import { config } from "../../src/server/config.ts";
import { openrouterJson } from "../../src/server/chat/llm.ts";
import type { Contradiction } from "../../src/server/chat/verify/verifier.ts";
import { runSlice, type SliceName } from "../../src/server/chat/verify/verifier-slices.ts";
import { runConfirm } from "../../src/server/chat/verify/confirm.ts";
import { buildMutations, type SavedRun } from "./eval-verifier-mutations.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const EVIDENCE_DIR = process.env.EVAL_EVIDENCE_DIR ?? path.join(ROOT, "scripts", "eval", "eval-corpora", "evidence");
const REPORT_PATH = path.join(ROOT, ".cache", "eval-slices.json");
const argv = process.argv.slice(2);
const flag = (n: string) => argv.flatMap((a, i) => (a === `--${n}` && argv[i + 1] ? [argv[i + 1]] : []));

const MODELS = (flag("models")[0]?.split(",") ?? ["google/gemma-4-31b-it", "anthropic/claude-haiku-4.5", "openai/gpt-5.6-luna"]).map((m) => m.trim());
const LIMIT = Number(flag("limit")[0] ?? 10);
const CONCURRENCY = Number(flag("concurrency")[0] ?? 4);

// Which mutation classes each ROUTED slice is responsible for catching.
// `confirm` is intentionally absent — see the header comment.
const ROUTING: Record<Exclude<SliceName, "confirm">, string[]> = {
  refute: ["number", "contradiction", "wrong_doc"],
  overreach: ["ruling"],
};
const ROUTED_SLICES = Object.keys(ROUTING) as Exclude<SliceName, "confirm">[];

if (!config.openrouterApiKey) {
  console.error("OPENROUTER_API_KEY is not set (.env.local).");
  process.exit(1);
}
const ix = loadIndexes();
type Corpus = SavedRun & { audit?: { verdict: "clean" | "defect"; notes: string } | null; sourceModel?: string };
const all: Corpus[] = fs.readdirSync(EVIDENCE_DIR).filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, f), "utf8")) as Corpus);
// Audited real defects are graded separately and are never mutation bases.
// Borderline entries are neither clean enough to be an FCR baseline nor a
// crisp defect to grade catch on, so they are excluded from both pools.
const realDefects = all.filter((r) => r.audit?.verdict === "defect");
const runs = all.filter((r) => r.audit?.verdict !== "defect" && r.audit?.verdict !== "borderline").slice(0, LIMIT);
// FCR is only trustworthy over AUDITED-clean baselines; everything else is
// reported as "unaudited" so we never again call judge-approved "clean".
const auditedClean = new Set(all.filter((r) => r.audit?.verdict === "clean").map((r) => r.id));

interface Cell {
  model: string; slice: Exclude<SliceName, "confirm">; runId: string;
  kind: string; // baseline | <mutation class> | real_defect
  parsed: boolean; flagged: boolean; caught: boolean | null;
  candidates: number; // validated contradiction candidates BEFORE the confirm gate
  agreed: number; // confirm-agreed count (always 0 for overreach — it has no candidates)
  discarded: number; latencyMs: number | null;
  usage: { input: number; output: number } | null;
  // Full contradictions incl. spans — so a threshold change can be re-scored
  // offline for free instead of re-buying every model call.
  contradictions: Contradiction[];
  evidenceTexts: string[];
}

const cells: Cell[] = [];
const save = () => {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify({ ranAt: new Date().toISOString(), models: MODELS, corpus: runs.length, cells }, null, 2));
};

// A cell "flags" an answer when the confirm gate agreed on ≥1 candidate, or a
// ruling fired — the exact rule sliced-verifier.ts's computeOverall applies.
async function judge(model: string, slice: Exclude<SliceName, "confirm">, run: Corpus, answer: string, kind: string, caught: boolean | null): Promise<Cell> {
  const evidenceTexts = run.evidence.map((e) => e.content);
  const r = await runSlice({
    call: openrouterJson, model, slice, question: run.question, answer, evidence: run.evidence,
    // Reasoning models need headroom or they truncate into "unparseable".
    maxTokens: 6000, signal: AbortSignal.timeout(180_000),
  });
  let agreed = 0;
  // Only a refute cell with something to look at ever chains a confirm call —
  // the whole point of the conditional gate is that the clean/overreach path
  // never pays for it.
  if (slice === "refute" && r.contradictions.length > 0) {
    const confirmed = await runConfirm({
      call: openrouterJson, model, answer, candidates: r.contradictions, signal: AbortSignal.timeout(180_000),
    });
    agreed = confirmed.agreed.size;
  }
  const flagged = agreed > 0 || r.rulingIssued;
  return {
    model, slice, runId: run.id, kind, parsed: r.parsed, flagged,
    caught: caught === null ? null : flagged,
    candidates: r.contradictions.length, agreed, discarded: r.discarded,
    latencyMs: r.latencyMs, usage: r.usage,
    contradictions: r.contradictions, evidenceTexts,
  };
}

// Build the work list: per model × slice → its routed mutations + baselines + real defects.
const work: { model: string; slice: Exclude<SliceName, "confirm">; run: Corpus; answer: string; kind: string; caught: boolean | null }[] = [];
for (const model of MODELS) {
  for (const slice of ROUTED_SLICES) {
    for (const run of runs) {
      work.push({ model, slice, run, answer: run.answer, kind: "baseline", caught: null });
      for (const m of buildMutations(run, ix)) {
        if (m.informational) continue; // this design cannot catch these by construction
        if (!ROUTING[slice].includes(m.class)) continue;
        work.push({ model, slice, run, answer: m.answer, kind: m.class, caught: false });
      }
    }
    for (const run of realDefects) work.push({ model, slice, run, answer: run.answer, kind: "real_defect", caught: false });
  }
}

console.log(`sliced-verifier bakeoff — ${MODELS.length} models × ${ROUTED_SLICES.length} slices (+ conditional confirm on refute)`);
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
console.log(`\n${"model".padEnd(22)}${"slice".padEnd(10)}${"catch".padStart(7)}${"FCR·aud".padStart(9)}${"FCR·all".padStart(9)}${"parse".padStart(7)}${"discarded".padStart(11)}${"p50 ms".padStart(8)}`);
console.log(`(FCR·aud = over ${auditedClean.size} AUDITED-clean baselines — the only trustworthy FCR; FCR·all includes unaudited)`);
console.log("─".repeat(84));
for (const model of MODELS) {
  for (const slice of ROUTED_SLICES) {
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
      String(rs.reduce((s, c) => s + c.discarded, 0)).padStart(11) +
      String(lat.length ? lat[Math.floor(lat.length / 2)] : "—").padStart(8),
    );
  }
}
if (realDefects.length) {
  console.log(`\nREAL audited defects (the ones both single verifiers passed):`);
  for (const rd of realDefects) {
    console.log(`  ${rd.id}`);
    for (const model of MODELS) {
      const got = ROUTED_SLICES
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
