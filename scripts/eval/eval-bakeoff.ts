// Model bakeoff for the chat position — runs every query in
// eval-bakeoff-queries.ts through the REAL tool loop once per candidate model,
// grades each transcript two ways, and reports a per-model scoreboard:
//   - deterministic (code, objective): fabricated citations/doc_nos/quotes/
//     values, how many links citation-repair could save, and what would still
//     ship broken — measured on the string production SHIPS (reference links
//     normalized to inline form, then repaired), never on the raw model output
//   - reference-format compliance: adoption of the definition-block format the
//     prompt asks for, and its defect shapes (see docs/plans/reference-citations.md)
//   - judge (one FIXED strong model across all candidates): support,
//     completeness, honesty vs the query's `expect` rubric
//
//   pnpm eval:bakeoff                          default candidate set
//   pnpm eval:bakeoff --models a,b,c           explicit candidates
//   pnpm eval:bakeoff --only <id> [--only id2] subset of queries
//   pnpm eval:bakeoff --judge <model>          override judge (default sonnet-5)
//   pnpm eval:bakeoff --concurrency N          parallel runs (default 4)
//   pnpm eval:bakeoff --resume                 keep prior ok runs from the last
//                                              report, only run missing/errored
//                                              cells (assumes the same judge)
//
// Requires artifacts + OPENROUTER_API_KEY (.env.local); DB-backed tools need
// DATABASE_URL for a faithful run (history queries degrade to tool errors).
import fs from "node:fs";
import path from "node:path";
import { loadIndexes } from "../../src/server/retrieval/indexes.ts";
import { buildSystemPrompt } from "../../src/server/chat/system-prompt.ts";
import { citationStyleFor } from "../../src/server/chat/model-router.ts";
import { runChat, type ChatEvent } from "../../src/server/chat/chat-loop.ts";
import { makeOpenrouterStream, openrouterJson } from "../../src/server/chat/llm.ts";
import { evidenceFromTranscript } from "../../src/server/chat/verify/verifier.ts";
import { citationValues, extractCitations, runDeterministicChecks } from "../../src/server/chat/verify/verify-checks.ts";
import { normalizeAndRepair } from "../../src/server/chat/chat-orchestrator.ts";
import type { ReferenceExpansion } from "../../src/server/chat/verify/citation-normalize.ts";
import { config } from "../../src/server/config.ts";
import { BAKEOFF_QUERIES, type BakeoffQuery } from "./eval-bakeoff-queries.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const argv = process.argv.slice(2);
const flag = (name: string) => argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] ? [argv[i + 1]] : []));

// Default = the serious contenders from the 2026-07 core bakeoff. Cut:
// sonnet-5 (lost at 3-50x the price), qwen3-32b (deposed incumbent, bottom
// of the field), tencent/hy3 (provider too flaky to grade).
const MODELS = (flag("models")[0]?.split(",") ?? [
  "google/gemma-4-31b-it", "mistralai/mistral-medium-3-5", "z-ai/glm-5.2",
  "deepseek/deepseek-v4-flash", "anthropic/claude-haiku-4.5",
]).map((m) => m.trim()).filter(Boolean);
const JUDGE = flag("judge")[0] ?? "openai/gpt-5.6-terra"; // outside the candidate set — no self-judging
// --no-judge: generate answers + save full toolTexts, but make NO judge call.
// For human/self grading — read each answer against its own toolTexts offline.
const NO_JUDGE = argv.includes("--no-judge");
const CONCURRENCY = Number(flag("concurrency")[0] ?? 4);
const ONLY = new Set(flag("only"));
const REPORT_PATH = path.join(ROOT, ".cache", "eval-bakeoff.json");

if (!config.openrouterApiKey) {
  console.error("OPENROUTER_API_KEY is not set (.env.local) — cannot run the bakeoff.");
  process.exit(1);
}
const ix = loadIndexes();
const queries = ONLY.size ? BAKEOFF_QUERIES.filter((q) => ONLY.has(q.id)) : BAKEOFF_QUERIES;

// --resume: keep prior successful runs from the last report (same judge
// assumed) and only run the cells that are missing or errored.
const priorOk = new Map<string, RunResult>();
if (argv.includes("--resume") && fs.existsSync(REPORT_PATH)) {
  const prior = JSON.parse(fs.readFileSync(REPORT_PATH, "utf8")) as { results?: RunResult[] };
  for (const r of prior.results ?? []) {
    // Unjudged runs (judge call failed, e.g. on a budget cap) are re-run too —
    // unless --no-judge, where no run has a judge by design and resuming would
    // otherwise re-pay for the entire grid. Rows from a report predating the
    // reference-citation metrics are re-run as well: `refs` is not
    // reconstructible from a stored row.
    if (!r.error && (NO_JUDGE || r.judge) && r.refs && MODELS.includes(r.model) && queries.some((q) => q.id === r.id)) priorOk.set(`${r.model} ${r.id}`, r);
  }
  if (priorOk.size) console.log(`resuming: keeping ${priorOk.size} ok runs from ${REPORT_PATH}`);
}

interface JudgeScores { support: number; completeness: number; honesty: number; notes: string }
// Reference-style compliance (docs/plans/reference-citations.md). Prompt-behaviour
// measurement, not grading: only `undefinedLabels` and `shippedBrackets` are
// defects — `unusedLabels` and a bottom-placed block are accepted degradations,
// and an inline-only answer is fully supported.
interface RefStats {
  usedRefStyle: boolean;   // emitted a definition block at all
  blockFirst: boolean;     // …and it opened the answer (the streaming win)
  // Reference uses that stream BEFORE the block finishes — the metric that
  // actually matters for the reader: until a label's definition arrives, remark
  // renders its use as literal `[text][label]` brackets. Strictly better than
  // blockFirst, which counts a block sitting under a one-line intro (harmless,
  // no use precedes it) the same as a block at the very bottom (5 uses of
  // visible bracket junk for the whole stream — both measured on gemma).
  usesBeforeBlock: number;
  definitions: number;
  undefinedLabels: number; // used but undeclared AND unresolvable — hard failure
  unusedLabels: number;
  multiLabel: number;      // `[text][a, b]` — invalid CommonMark, normalizer splits it
  shippedBrackets: number; // reference syntax surviving into the shipped answer (bug)
  valueCitations: number;  // citations whose link text IS a value (the directive)
}
interface RunResult {
  model: string; id: string;
  score: number | null; // null = judge unparseable after retry — excluded from quality means
  judge: JudgeScores | null;
  fabrications: { rawInvalidCitations: number; repaired: number; stripped: number; invalidDocNos: number; ungroundedQuotes: number; ungroundedValues: number; undefinedLabels: number };
  refs: RefStats;
  citations: number; rounds: number; toolCalls: number; latencyMs: number;
  usage: { input: number; output: number };
  answer: string; error: string | null;
  // The model's untouched output, kept only when normalization/repair changed it
  // — the shipped `answer` has the definition block expanded away, so this is the
  // only place the reference format can be inspected by eye after the fact.
  rawAnswer?: string;
  // Full tool outputs — lets deterministic checks be recomputed offline after
  // a checker change, without re-paying for the model runs.
  toolTexts?: string[];
}

const clamp01 = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

// Reference-syntax shapes are measured on the RAW answer — normalization erases
// the definition block and rewrites every use — except the two that must be
// counted after it: labels it could not resolve, and reference syntax that
// somehow survived into the shipped text.
// Restricted to /atlas/ destinations, matching definition-block-gate.ts's `DEF`
// — this measures compliance with the citation contract, so an unrelated
// CommonMark ref-def to some other URL is not part of the block.
const DEF_LINE_RE = /^ {0,3}\[[^[\]\n]{1,120}\]:\s*<?\/atlas\//;
const MULTI_LABEL_RE = /\[[^[\]\n]{1,120}\]\[[^[\]\n]*,[^[\]\n]*\]/g;
const REF_USE_RE = /\[[^[\]\n]{1,120}\]\[[^[\]\n]{0,200}\]/g;

function refStats(raw: string, refs: ReferenceExpansion, shipped: string): RefStats {
  const lines = raw.split("\n");
  const firstLine = lines.find((l) => l.trim() !== "") ?? "";
  const lastDef = lines.reduce((last, l, i) => (DEF_LINE_RE.test(l) ? i : last), -1);
  return {
    usedRefStyle: refs.definitions.size > 0,
    blockFirst: DEF_LINE_RE.test(firstLine),
    usesBeforeBlock: lines
      .slice(0, Math.max(0, lastDef))
      .filter((l) => !DEF_LINE_RE.test(l))
      .reduce((n, l) => n + (l.match(REF_USE_RE) ?? []).length, 0),
    definitions: refs.definitions.size,
    undefinedLabels: refs.undefinedLabels.length,
    unusedLabels: refs.unusedLabels.length,
    multiLabel: (raw.match(MULTI_LABEL_RE) ?? []).length,
    shippedBrackets: (shipped.match(REF_USE_RE) ?? []).length,
    valueCitations: extractCitations(shipped).filter((c) => citationValues(c.title).length > 0).length,
  };
}

async function judgeAnswer(q: BakeoffQuery, evidence: string, answer: string): Promise<JudgeScores | null> {
  const messages = [
    {
      role: "system" as const,
      content:
        "You are a strict evaluator of a governance research assistant that must answer ONLY from the retrieved evidence. " +
        "Grade the answer against the evidence and the expectation. Your own knowledge is irrelevant — a fact absent from the evidence is unsupported even if true. " +
        'Respond with STRICT JSON only: {"support":0..1,"completeness":0..1,"honesty":0..1,"notes":"≤50 words"} — ' +
        "support = share of factual claims grounded in the evidence; completeness = how fully it answers what was asked given what the evidence offers; " +
        "honesty = does it admit gaps instead of inventing (1.0 = fully honest).",
    },
    {
      role: "user" as const,
      content: `## Question\n${q.query}\n\n## What a good answer looks like\n${q.expect}\n\n## Evidence retrieved by the assistant\n${evidence || "(none — no tools were called)"}\n\n## Answer to grade\n${answer}`,
    },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await openrouterJson({ model: JUDGE, messages, maxTokens: 600, signal: AbortSignal.timeout(60_000) });
      const s = res.text.indexOf("{");
      const e = res.text.lastIndexOf("}");
      if (s === -1 || e <= s) continue;
      const j = JSON.parse(res.text.slice(s, e + 1)) as Record<string, unknown>;
      return { support: clamp01(j.support), completeness: clamp01(j.completeness), honesty: clamp01(j.honesty), notes: String(j.notes ?? "") };
    } catch {
      // retry once, then give up — an unjudged run is excluded from quality means
    }
  }
  return null;
}

async function runOne(model: string, q: BakeoffQuery): Promise<RunResult> {
  const started = Date.now();
  const base = {
    model, id: q.id, score: null as number | null, judge: null as JudgeScores | null,
    fabrications: { rawInvalidCitations: 0, repaired: 0, stripped: 0, invalidDocNos: 0, ungroundedQuotes: 0, ungroundedValues: 0, undefinedLabels: 0 },
    refs: { usedRefStyle: false, blockFirst: false, definitions: 0, undefinedLabels: 0, unusedLabels: 0, multiLabel: 0, shippedBrackets: 0, valueCitations: 0 },
    citations: 0, rounds: 0, toolCalls: 0, latencyMs: 0, usage: { input: 0, output: 0 }, answer: "", error: null as string | null,
  };
  try {
    const messages = [
      // Production's per-model citation format, so a candidate is graded on the
      // prompt it would actually receive (CHAT_REFERENCE_CITATION_MODELS).
      { role: "system" as const, content: buildSystemPrompt(ix, undefined, citationStyleFor(model)) },
      { role: "user" as const, content: q.query },
    ];
    let done: Extract<ChatEvent, { type: "done" }> | null = null;
    let rounds = 0;
    // Some models (deepseek) intermittently return an empty final message —
    // retry the chat once so a flake doesn't hole the grid.
    for (let attempt = 0; attempt < 2 && !done?.content.trim(); attempt++) {
      for await (const ev of runChat({
        ix, messages, stream: makeOpenrouterStream({}, [model]),
        maxIterations: config.chatMaxIterations, signal: AbortSignal.timeout(240_000),
        onRoundEnd: (info) => { rounds = Math.max(rounds, info.iter + 1); },
      })) {
        if (ev.type === "done") done = ev;
      }
    }
    if (!done || !done.content.trim()) throw new Error("empty answer");

    const toolTexts = done.transcript.filter((m) => m.role === "tool" && typeof m.content === "string").map((m) => m.content as string);
    // Production's exact pipeline: expand reference links into the canonical
    // inline shape, THEN repair. Both check passes read normalized text — a
    // reference-style answer contains no `[text](/atlas/<uuid>)` for any checker
    // to see, so grading the raw string would score it as entirely uncited.
    const { refs, repair } = normalizeAndRepair(done.content, toolTexts, ix);
    const turnEvidence = evidenceFromTranscript(done.transcript);
    const completeness = { question: q.query, evidence: turnEvidence };
    const rawChecks = runDeterministicChecks(refs.content, toolTexts, ix, completeness); // before repair
    const shipped = runDeterministicChecks(repair.content, toolTexts, ix, completeness); // what ships
    const evidence = turnEvidence.map((e) => `${e.label} ${e.tool}(${e.args}) →\n${e.content}`).join("\n\n");
    const judge = NO_JUDGE ? null : await judgeAnswer(q, evidence, repair.content);

    const fabrications = {
      rawInvalidCitations: rawChecks.invalidCitations.length,
      repaired: repair.repaired.length,
      stripped: repair.stripped.length,
      invalidDocNos: shipped.invalidDocNos.length,
      ungroundedQuotes: shipped.ungroundedQuotes.length,
      // Both are hard failures in chat-orchestrator's repairedChecks: a figure
      // attributed to a doc that does not contain it, and a citation whose label
      // resolved to nothing and was de-linkified to plain text.
      ungroundedValues: shipped.ungroundedCitationValues.length,
      undefinedLabels: refs.undefinedLabels.length,
    };
    // Judge quality, penalized by what would still ship broken (hard fabrications)
    // and lightly by garbles production had to repair.
    const hardFab =
      fabrications.stripped + fabrications.invalidDocNos + fabrications.ungroundedQuotes +
      fabrications.ungroundedValues + fabrications.undefinedLabels;
    const quality = judge ? 0.4 * judge.support + 0.3 * judge.completeness + 0.3 * judge.honesty : null;
    const score = quality === null ? null : Math.max(0, quality - 0.15 * hardFab - 0.05 * fabrications.repaired);

    return {
      ...base, score: score === null ? null : Number(score.toFixed(3)), judge, fabrications,
      refs: refStats(done.content, refs, repair.content),
      citations: shipped.citations.length, rounds, toolCalls: done.toolCalls.length,
      latencyMs: Date.now() - started, usage: done.usage, answer: repair.content, toolTexts,
      rawAnswer: repair.content === done.content ? undefined : done.content,
    };
  } catch (e) {
    return { ...base, latencyMs: Date.now() - started, error: e instanceof Error ? e.message : String(e) };
  }
}

// Simple worker pool over the model × query grid.
const grid = MODELS.flatMap((model) => queries.map((q) => ({ model, q }))).filter(({ model, q }) => !priorOk.has(`${model} ${q.id}`));
const results: RunResult[] = [...priorOk.values()];
function saveReport(extra: Record<string, unknown> = {}) {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify({ judge: JUDGE, atlasCommit: ix.meta.atlasCommit ?? null, ranAt: new Date().toISOString(), ...extra, results }, null, 2));
}
let cursor = 0;
async function worker() {
  for (;;) {
    const i = cursor++;
    if (i >= grid.length) return;
    const { model, q } = grid[i];
    const r = await runOne(model, q);
    results.push(r);
    saveReport(); // incremental — a killed run keeps everything paid for so far
    console.log(`[${results.length - priorOk.size}/${grid.length}] ${model} × ${q.id} → ${r.error ? `ERROR ${r.error.slice(0, 60)}` : `score=${r.score}`}`);
  }
}
await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));

// ── Scoreboard ─────────────────────────────────────────────────────────────
const byModel = MODELS.map((model) => {
  const rs = results.filter((r) => r.model === model);
  const ok = rs.filter((r) => !r.error);
  const graded = ok.filter((r) => r.judge); // quality means only over judged runs
  const avg = (f: (r: RunResult) => number) => (ok.length ? ok.reduce((s, r) => s + f(r), 0) / ok.length : 0);
  const gavg = (f: (r: RunResult) => number) => (graded.length ? graded.reduce((s, r) => s + f(r), 0) / graded.length : 0);
  return {
    model,
    meanScore: Number(gavg((r) => r.score ?? 0).toFixed(3)),
    support: Number(gavg((r) => r.judge?.support ?? 0).toFixed(2)),
    completeness: Number(gavg((r) => r.judge?.completeness ?? 0).toFixed(2)),
    honesty: Number(gavg((r) => r.judge?.honesty ?? 0).toFixed(2)),
    unjudged: ok.length - graded.length,
    hardFabPerRun: Number(
      avg((r) =>
        r.fabrications.stripped + r.fabrications.invalidDocNos + r.fabrications.ungroundedQuotes +
        r.fabrications.ungroundedValues + r.fabrications.undefinedLabels).toFixed(2),
    ),
    repairedPerRun: Number(avg((r) => r.fabrications.repaired).toFixed(2)),
    citationsPerRun: Number(avg((r) => r.citations).toFixed(1)),
    meanLatencyS: Number((avg((r) => r.latencyMs) / 1000).toFixed(1)),
    meanTokens: Math.round(avg((r) => r.usage.input + r.usage.output)),
    errors: rs.length - ok.length,
  };
}).sort((a, b) => b.meanScore - a.meanScore);

// Reference-format compliance — does the model actually write the citation
// format the prompt asks for (docs/plans/reference-citations.md)? Adoption and
// placement are behavioural; undefLabels/multiLabel/shippedBrackets are defects.
const refBoard = MODELS.map((model) => {
  const ok = results.filter((r) => r.model === model && !r.error);
  const share = (f: (r: RunResult) => boolean) => (ok.length ? `${Math.round((100 * ok.filter(f).length) / ok.length)}%` : "-");
  const sum = (f: (r: RunResult) => number) => ok.reduce((s, r) => s + f(r), 0);
  const avg = (f: (r: RunResult) => number) => (ok.length ? Number((sum(f) / ok.length).toFixed(2)) : 0);
  const cites = sum((r) => r.citations);
  return {
    model,
    refStyle: share((r) => r.refs.usedRefStyle),
    blockFirst: share((r) => r.refs.blockFirst),
    defsPerRun: avg((r) => r.refs.definitions),
    // The "make the value the link text" directive — the behaviour the per-doc
    // value check depends on. 0% means that check has no coverage on this model.
    valueCitePct: cites ? `${Math.round((100 * sum((r) => r.refs.valueCitations)) / cites)}%` : "-",
    undefLabels: avg((r) => r.refs.undefinedLabels),
    unusedLabels: avg((r) => r.refs.unusedLabels),
    multiLabel: avg((r) => r.refs.multiLabel),
    shippedBrackets: avg((r) => r.refs.shippedBrackets),
    ungroundedValues: avg((r) => r.fabrications.ungroundedValues),
  };
});

saveReport({ scoreboard: byModel, refBoard });

const table = <T extends Record<string, unknown>>(rows: T[], cols: readonly (keyof T & string)[]) => {
  const width = (c: string) => Math.max(c.length, ...rows.map((r) => String(r[c as keyof T]).length)) + 2;
  console.log(cols.map((c) => c.padEnd(width(c))).join(""));
  for (const row of rows) console.log(cols.map((c) => String(row[c]).padEnd(width(c))).join(""));
};

console.log(`\njudge=${NO_JUDGE ? "(none — self/manual grading)" : JUDGE}  queries=${queries.length}  atlas=${(ix.meta.atlasCommit ?? "?").slice(0, 8)}`);
table(byModel, ["model", "meanScore", "support", "completeness", "honesty", "hardFabPerRun", "repairedPerRun", "citationsPerRun", "meanLatencyS", "meanTokens", "unjudged", "errors"]);

console.log(`\nreference-format compliance:`);
table(refBoard, ["model", "refStyle", "blockFirst", "defsPerRun", "valueCitePct", "undefLabels", "unusedLabels", "multiLabel", "shippedBrackets", "ungroundedValues"]);

// Per-query score grid — spot which questions separate the field.
console.log(`\nper-query scores (rows=queries, cols=models):`);
const mw = Math.max(...queries.map((q) => q.id.length)) + 2;
console.log(" ".repeat(mw) + MODELS.map((m) => m.split("/")[1].slice(0, 18).padEnd(20)).join(""));
for (const q of queries) {
  const cells = MODELS.map((m) => {
    const r = results.find((x) => x.model === m && x.id === q.id);
    return (r?.error ? "ERR" : r?.score === null ? "n/j" : String(r?.score ?? "-")).padEnd(20);
  });
  console.log(q.id.padEnd(mw) + cells.join(""));
}
console.log(`\nwrote ${REPORT_PATH}`);
