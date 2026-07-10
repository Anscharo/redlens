// Golden-question regression harness for the in-app chatbot (Phase 4 of
// docs/plans/chatbot-readiness-remediation-plan.md). Runs each fixture in
// scripts/aux/eval-golden-questions.ts through the SAME tool-calling loop the
// live chat uses (runChat + the real ATLAS_TOOLS registry + a real OpenRouter
// stream), grades the transcript with the pure rubric in eval-golden-grade.ts,
// and writes a report capturing model, atlas commit, tool calls, and outcome —
// the "capture per run" list Phase 4.1 asks for.
//
//   pnpm eval:golden               run the full set
//   pnpm eval:golden --only <id>   run one fixture (repeatable)
//   pnpm eval:golden --json        machine-readable output only (still writes the report file)
//
// Requires: public/docs.json + graph.json (pnpm build:index / build:graph) and
// OPENROUTER_API_KEY. Postgres-backed tools (atlas_history_stats, atlas_pr,
// atlas_first_seen, atlas_get_address, …) degrade to a caught tool error
// without a live DB — that surfaces as a tool_failure warning per question,
// not a crash, but for a faithful run point DATABASE_URL at a synced instance.
//
// Exit code is nonzero if any question fails its rubric (Phase 4.3: "block
// promotion on hallucination regressions … and answer completeness").
import fs from "node:fs";
import path from "node:path";
import { loadIndexes } from "../../src/server/indexes.ts";
import { buildSystemPrompt } from "../../src/server/system-prompt.ts";
import { runChat, type ChatEvent } from "../../src/server/chat-loop.ts";
import { openrouterStream } from "../../src/server/llm.ts";
import { config } from "../../src/server/config.ts";
import { GOLDEN_QUESTIONS } from "./eval-golden-questions.ts";
import { gradeAnswer, type GoldenGradeResult } from "./eval-golden-grade.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const REPORT_PATH = path.join(ROOT, ".cache", "eval-golden.json");

const argv = process.argv.slice(2);
const JSON_ONLY = argv.includes("--json");
const ONLY = new Set(
  argv.flatMap((a, i) => (a === "--only" && argv[i + 1] ? [argv[i + 1]] : [])),
);

if (!config.openrouterApiKey) {
  console.error("OPENROUTER_API_KEY is not set (.env.local) — cannot run the golden eval.");
  process.exit(1);
}

const ix = loadIndexes();
if (ix.docMap.size === 0) {
  console.error("public/docs.json has no nodes — run `pnpm build:index` (and `pnpm build:graph`) first.");
  process.exit(1);
}

const questions = ONLY.size ? GOLDEN_QUESTIONS.filter((q) => ONLY.has(q.id)) : GOLDEN_QUESTIONS;
if (questions.length === 0) {
  console.error(`--only matched nothing (valid ids: ${GOLDEN_QUESTIONS.map((q) => q.id).join(", ")})`);
  process.exit(1);
}

interface RunRecord {
  id: string;
  category: string;
  query: string;
  answer: string;
  toolCalls: Array<{ name: string; ok: boolean; truncated?: boolean }>;
  grade: GoldenGradeResult;
}

// Each fixture is an independent LLM run against the same read-only `ix` — run
// them concurrently rather than paying N sequential network round trips.
// Logging happens as each settles, so ordering in the console may interleave;
// `runs` itself preserves the original fixture order (Promise.all).
const runs: RunRecord[] = await Promise.all(
  questions.map(async (q) => {
    const messages = [
      { role: "system" as const, content: buildSystemPrompt(ix) },
      { role: "user" as const, content: q.query },
    ];

    let done: Extract<ChatEvent, { type: "done" }> | null = null;
    for await (const ev of runChat({ ix, messages, stream: openrouterStream, maxIterations: config.chatMaxIterations })) {
      if (ev.type === "done") done = ev;
    }
    const answer = done?.content ?? "";
    const toolCalls = (done?.toolCalls ?? []).map((c) => ({ name: c.name, ok: c.ok, truncated: c.truncated }));
    const grade = gradeAnswer(q, answer, toolCalls);

    if (!JSON_ONLY) {
      const mark = grade.passed ? "PASS" : "FAIL";
      console.log(`\n[${mark}] ${q.id} (${q.category}) → ${grade.outcome}`);
      if (grade.failures.length) console.log(`  failures: ${grade.failures.join("; ")}`);
      if (grade.warnings.length) console.log(`  warnings: ${grade.warnings.join("; ")}`);
    }

    return { id: q.id, category: q.category, query: q.query, answer, toolCalls, grade };
  }),
);

const summary = {
  model: config.chatModel,
  atlasCommit: ix.meta.atlasCommit ?? null,
  appCommit: ix.meta.appCommit ?? null,
  ranAt: new Date().toISOString(),
  total: runs.length,
  passed: runs.filter((r) => r.grade.passed).length,
  byOutcome: Object.fromEntries(
    [...new Set(runs.map((r) => r.grade.outcome))].map((o) => [o, runs.filter((r) => r.grade.outcome === o).length]),
  ),
};

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, JSON.stringify({ summary, runs }, null, 2));

if (JSON_ONLY) {
  console.log(JSON.stringify({ summary, runs }, null, 2));
} else {
  console.log(`\n${summary.passed}/${summary.total} passed — ${JSON.stringify(summary.byOutcome)}`);
  console.log(`wrote ${REPORT_PATH}`);
}

process.exit(summary.passed === summary.total ? 0 : 1);
