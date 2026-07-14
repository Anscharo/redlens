// Model bakeoff for the chat position — runs every query in
// eval-bakeoff-queries.ts through the REAL tool loop once per candidate model,
// grades each transcript two ways, and reports a per-model scoreboard:
//   - deterministic (code, objective): fabricated citations/doc_nos/quotes on
//     the raw answer, how many links citation-repair could save, and what
//     would still ship broken
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
import { loadIndexes } from "../../src/server/indexes.ts";
import { buildSystemPrompt } from "../../src/server/system-prompt.ts";
import { runChat, type ChatEvent } from "../../src/server/chat-loop.ts";
import { makeOpenrouterStream, openrouterJson } from "../../src/server/llm.ts";
import { evidenceFromTranscript } from "../../src/server/verifier.ts";
import { runDeterministicChecks } from "../../src/server/verify-checks.ts";
import { repairCitations } from "../../src/server/citation-repair.ts";
import { config } from "../../src/server/config.ts";
import { BAKEOFF_QUERIES, type BakeoffQuery } from "./eval-bakeoff-queries.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const REPORT_PATH = path.join(ROOT, ".cache", "eval-bakeoff.json");
const argv = process.argv.slice(2);
const flag = (name: string) => argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] ? [argv[i + 1]] : []));

const MODELS = (flag("models")[0]?.split(",") ?? [
  "qwen/qwen3-32b", "anthropic/claude-haiku-4.5", "anthropic/claude-sonnet-5", "deepseek/deepseek-v4-flash",
  "z-ai/glm-5.2", "tencent/hy3", "google/gemma-4-31b-it", "mistralai/mistral-medium-3-5",
]).map((m) => m.trim()).filter(Boolean);
const JUDGE = flag("judge")[0] ?? "anthropic/claude-opus-4.8"; // outside the candidate set — no self-judging
const CONCURRENCY = Number(flag("concurrency")[0] ?? 4);
const ONLY = new Set(flag("only"));

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
    if (!r.error && MODELS.includes(r.model) && queries.some((q) => q.id === r.id)) priorOk.set(`${r.model} ${r.id}`, r);
  }
  if (priorOk.size) console.log(`resuming: keeping ${priorOk.size} ok runs from ${REPORT_PATH}`);
}

interface JudgeScores { support: number; completeness: number; honesty: number; notes: string }
interface RunResult {
  model: string; id: string;
  score: number | null; // null = judge unparseable after retry — excluded from quality means
  judge: JudgeScores | null;
  fabrications: { rawInvalidCitations: number; repaired: number; stripped: number; invalidDocNos: number; ungroundedQuotes: number };
  citations: number; rounds: number; toolCalls: number; latencyMs: number;
  usage: { input: number; output: number };
  answer: string; error: string | null;
}

const clamp01 = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

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
    fabrications: { rawInvalidCitations: 0, repaired: 0, stripped: 0, invalidDocNos: 0, ungroundedQuotes: 0 },
    citations: 0, rounds: 0, toolCalls: 0, latencyMs: 0, usage: { input: 0, output: 0 }, answer: "", error: null as string | null,
  };
  try {
    const messages = [
      { role: "system" as const, content: buildSystemPrompt(ix) },
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
    const rawChecks = runDeterministicChecks(done.content, toolTexts, ix);
    const repair = repairCitations(done.content, toolTexts, ix); // what production would ship
    const shipped = runDeterministicChecks(repair.content, toolTexts, ix);
    const evidence = evidenceFromTranscript(done.transcript).map((e) => `${e.label} ${e.tool}(${e.args}) →\n${e.content}`).join("\n\n");
    const judge = await judgeAnswer(q, evidence, repair.content);

    const fabrications = {
      rawInvalidCitations: rawChecks.invalidCitations.length,
      repaired: repair.repaired.length,
      stripped: repair.stripped.length,
      invalidDocNos: shipped.invalidDocNos.length,
      ungroundedQuotes: shipped.ungroundedQuotes.length,
    };
    // Judge quality, penalized by what would still ship broken (hard fabrications)
    // and lightly by garbles production had to repair.
    const hardFab = fabrications.stripped + fabrications.invalidDocNos + fabrications.ungroundedQuotes;
    const quality = judge ? 0.4 * judge.support + 0.3 * judge.completeness + 0.3 * judge.honesty : null;
    const score = quality === null ? null : Math.max(0, quality - 0.15 * hardFab - 0.05 * fabrications.repaired);

    return {
      ...base, score: score === null ? null : Number(score.toFixed(3)), judge, fabrications,
      citations: shipped.citations.length, rounds, toolCalls: done.toolCalls.length,
      latencyMs: Date.now() - started, usage: done.usage, answer: repair.content,
    };
  } catch (e) {
    return { ...base, latencyMs: Date.now() - started, error: e instanceof Error ? e.message : String(e) };
  }
}

// Simple worker pool over the model × query grid.
const grid = MODELS.flatMap((model) => queries.map((q) => ({ model, q }))).filter(({ model, q }) => !priorOk.has(`${model} ${q.id}`));
const results: RunResult[] = [...priorOk.values()];
let cursor = 0;
async function worker() {
  for (;;) {
    const i = cursor++;
    if (i >= grid.length) return;
    const { model, q } = grid[i];
    const r = await runOne(model, q);
    results.push(r);
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
    hardFabPerRun: Number(avg((r) => r.fabrications.stripped + r.fabrications.invalidDocNos + r.fabrications.ungroundedQuotes).toFixed(2)),
    repairedPerRun: Number(avg((r) => r.fabrications.repaired).toFixed(2)),
    citationsPerRun: Number(avg((r) => r.citations).toFixed(1)),
    meanLatencyS: Number((avg((r) => r.latencyMs) / 1000).toFixed(1)),
    meanTokens: Math.round(avg((r) => r.usage.input + r.usage.output)),
    errors: rs.length - ok.length,
  };
}).sort((a, b) => b.meanScore - a.meanScore);

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, JSON.stringify({ judge: JUDGE, atlasCommit: ix.meta.atlasCommit ?? null, ranAt: new Date().toISOString(), scoreboard: byModel, results }, null, 2));

const cols = ["model", "meanScore", "support", "completeness", "honesty", "hardFabPerRun", "repairedPerRun", "citationsPerRun", "meanLatencyS", "meanTokens", "unjudged", "errors"] as const;
const width = (c: string) => Math.max(c.length, ...byModel.map((r) => String(r[c as keyof typeof r]).length)) + 2;
console.log(`\njudge=${JUDGE}  queries=${queries.length}  atlas=${(ix.meta.atlasCommit ?? "?").slice(0, 8)}`);
console.log(cols.map((c) => c.padEnd(width(c))).join(""));
for (const row of byModel) console.log(cols.map((c) => String(row[c]).padEnd(width(c))).join(""));

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
