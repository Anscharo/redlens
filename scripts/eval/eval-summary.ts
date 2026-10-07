// Conversation-compaction (summary) model bakeoff: runs the real summarizePrefix
// on real and synthetic threads, then grades each summary with an outside judge
// on probe retention, fabrication, and operational cost. Writes .cache/eval-summary.json.
//   bun scripts/eval/eval-summary.ts [--models a,b] [--judge m] [--only-real|--only-synthetic] [--resume] [--concurrency 4]
import fs from "node:fs";
import path from "node:path";
import { config } from "../../src/server/config.ts";
import { buildSyntheticThreads, loadRealThreads, threadChars, type Thread } from "./eval-summary-data.ts";
import { findFabrications, getProbes, gradeRetention, judgeUsage, prefixTextOf, unmatchedIds, type Probe } from "./eval-summary-judge.ts";
import { atCap, runSummary } from "./eval-summary-run.ts";
import { printBoard, printRows, type Row } from "./eval-summary-report.ts";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => argv.find((_a, i) => argv[i - 1] === `--${name}`);
const MODELS = (flag("models") ?? "openai/gpt-5.6-luna,openai/gpt-6-luna").split(",").map((m) => m.trim()).filter(Boolean);
const JUDGE = flag("judge") ?? "openai/gpt-5.6-terra";
const CONCURRENCY = Number(flag("concurrency") ?? 4);
const RESUME = argv.includes("--resume");
// One report per summary size, so arms run with different CHAT_SUMMARY_MAX_CHARS sit side by side.
const OUT = path.resolve(import.meta.dir, `../../.cache/eval-summary-cap${config.chatSummaryMaxChars}.json`);

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

async function gradeOne(t: Thread, model: string, probes: Probe[]): Promise<Row> {
  const run = await runSummary(model, t, RESUME);
  const prefixText = prefixTextOf(t);
  const base = { thread: t.id, kind: t.kind, label: t.label, model, prefixChars: threadChars(t.rows), probes: probes.length, latencyMs: run.latencyMs, input: run.input, output: run.output, costUsd: run.costUsd };
  const none = { correct: 0, partial: 0, missing: 0, wrong: 0, retention: null, fabrications: [], unmatchedIds: [], summaryChars: 0 };
  if (!run.summary) return { ...base, ...none, parseFailure: !run.error, atCap: false, error: run.error };
  const grades = await gradeRetention(JUDGE, run.summary, probes);
  const n = (g: string) => grades.filter((x) => x === g).length;
  return {
    ...base, correct: n("correct"), partial: n("partial"), missing: n("missing"), wrong: n("wrong"),
    retention: (n("correct") + 0.5 * n("partial")) / probes.length,
    fabrications: await findFabrications(JUDGE, run.summary, prefixText),
    unmatchedIds: unmatchedIds(run.summary, prefixText),
    parseFailure: false, atCap: atCap(run.summary), error: null, summaryChars: run.summary.length,
  };
}

function printAll(rows: Row[]): void {
  const real = rows.filter((r) => r.kind === "real");
  const syn = rows.filter((r) => r.kind === "synthetic");
  if (real.length) printBoard("REAL conversations", real, MODELS);
  if (syn.length) printBoard("SYNTHETIC threads", syn, MODELS);
  printRows(rows);
  console.log(`\njudge ${JUDGE}: ${judgeUsage.calls} calls, ${judgeUsage.input} in / ${judgeUsage.output} out tokens`);
}

async function main(): Promise<void> {
  if (!config.openrouterApiKey) throw new Error("OPENROUTER_API_KEY is not set (.env.local)");
  const threads: Thread[] = [];
  if (!argv.includes("--only-synthetic")) threads.push(...(await loadRealThreads()));
  if (!argv.includes("--only-real")) threads.push(...buildSyntheticThreads());
  console.log(`${threads.length} threads, models ${MODELS.join(", ")}, judge ${JUDGE}`);
  const probeSets = await pool(threads, CONCURRENCY, (t) => getProbes(JUDGE, t, prefixTextOf(t)));
  const jobs = threads.flatMap((t, i) => MODELS.map((m) => ({ t, m, probes: probeSets[i] })));
  const rows = await pool(jobs, CONCURRENCY, (j) => gradeOne(j.t, j.m, j.probes));
  printAll(rows);
  fs.writeFileSync(OUT, JSON.stringify({ models: MODELS, judge: JUDGE, judgeUsage, rows }, null, 2));
  console.log(`wrote ${OUT}`);
}

await main();
process.exit(0);
